import asyncio
import os
import tempfile
import unittest
from pathlib import Path


TEST_ROOT = Path(tempfile.mkdtemp(prefix="cipherpay-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(TEST_ROOT / 'cipherpay-test.db').as_posix()}"
os.environ["CIPHERPAY_KEY_DIR"] = str(TEST_ROOT / "keys")

from backend.core.attack_engine import attack_engine
from backend.core.crypto_utils import sign_data
from backend.core.key_store import load_private_key
from backend.core.ledger_state import blockchain
from backend.core.network_state import network_state
from backend.database import SessionLocal
from backend.main import initialize_in_memory_state
from backend.models import User
from backend.routers.blockchain import process_blockchain_transfer
from backend.routers.api_v1 import UnifiedTransferRequest, payment_transfer
from backend.routers.blockchain import BlockchainTransferRequest
from backend.routers.centralized import TransferRequest, process_centralized_transfer
from backend.seed import seed_db
from backend.services import get_network_overview


class PaymentFlowTests(unittest.TestCase):
    def setUp(self):
        seed_db()
        initialize_in_memory_state()
        self.db = SessionLocal()
        self.admin = self.db.query(User).filter(User.username == "admin").first()
        self.alice = self.db.query(User).filter(User.username == "alice").first()

    def tearDown(self):
        self.db.close()

    def _overview(self):
        return get_network_overview(self.db, current_user=self.admin)

    def _sign_blockchain_request(self, tx_id, sender_id, recipient_id, amount):
        private_key = load_private_key(sender_id)
        tx_data = {
            "id": tx_id,
            "sender_id": sender_id,
            "recipient_id": recipient_id,
            "amount": amount,
            "payment_template_id": None,
        }
        signature = sign_data(private_key, tx_data)
        return BlockchainTransferRequest(
            **tx_data,
            signature=signature,
            public_key=self.db.query(User).filter(User.id == sender_id).first().public_key,
        )

    def test_blockchain_tamper_is_rejected_without_deduction(self):
        network_state.set_mode("blockchain")
        attack_engine.toggle_attack("tamper", True)
        before = self._overview()
        alice_before = next(user for user in before["users"] if user["id"] == 2)["spendable_balance"]

        request = self._sign_blockchain_request("bc-reject-1", 2, 3, 100)
        payload = asyncio.run(process_blockchain_transfer(request, self.db, self.admin))

        self.assertEqual(payload["status"], "rejected")
        self.assertTrue(payload["security_events"])

        after = self._overview()
        alice_after = next(user for user in after["users"] if user["id"] == 2)["spendable_balance"]
        self.assertEqual(alice_before, alice_after)

    def test_blockchain_replay_settles_once_and_blocks_duplicate(self):
        network_state.set_mode("blockchain")
        attack_engine.toggle_attack("replay", True)

        request = self._sign_blockchain_request("bc-replay-1", 2, 3, 100)
        payload = asyncio.run(process_blockchain_transfer(request, self.db, self.admin))

        self.assertEqual(payload["status"], "partial_protected")
        self.assertEqual(payload["primary_transaction"]["status"], "partial_protected")
        self.assertEqual(len(payload["security_events"]), 1)
        self.assertEqual(payload["security_events"][0]["security_event_type"], "replay_blocked")

        overview = self._overview()
        alice = next(user for user in overview["users"] if user["id"] == 2)
        bob = next(user for user in overview["users"] if user["id"] == 3)
        self.assertEqual(alice["spendable_balance"], 400.0)
        self.assertEqual(bob["spendable_balance"], 600.0)

    def test_centralized_mitm_reports_intercepted_response(self):
        network_state.set_mode("centralized")
        attack_engine.toggle_attack("mitm", True)

        request = TransferRequest(
            id="centralized-mitm-1",
            sender_id=2,
            recipient_id=3,
            amount=100,
            payment_template_id=None,
        )
        payload = asyncio.run(process_centralized_transfer(request, self.db, self.admin))

        self.assertEqual(payload["status"], "intercepted")
        self.assertEqual(payload["primary_transaction"]["status"], "intercepted")
        self.assertEqual(payload["security_events"][0]["security_event_type"], "mitm_applied")

    def test_payment_transfer_wrapper_returns_truthful_status(self):
        network_state.set_mode("blockchain")
        attack_engine.toggle_attack("tamper", True)

        payload = asyncio.run(
            payment_transfer(
                UnifiedTransferRequest(
                    id="wrapper-reject-1",
                    sender_id=2,
                    recipient_id=3,
                    amount=100,
                    mode="blockchain",
                    payment_template_id=None,
                ),
                self.db,
                self.admin,
            )
        )

        self.assertEqual(payload["status"], "rejected")

    def test_startup_rebuild_restores_blockchain_balances(self):
        network_state.set_mode("blockchain")
        request = self._sign_blockchain_request("startup-rebuild-1", 2, 3, 100)
        payload = asyncio.run(process_blockchain_transfer(request, self.db, self.admin))
        self.assertEqual(payload["status"], "success")

        blockchain.reset_chain()
        initialize_in_memory_state()

        overview = self._overview()
        alice = next(user for user in overview["users"] if user["id"] == 2)
        bob = next(user for user in overview["users"] if user["id"] == 3)
        self.assertEqual(alice["chain_balance"], 400.0)
        self.assertEqual(bob["chain_balance"], 600.0)


if __name__ == "__main__":
    unittest.main()

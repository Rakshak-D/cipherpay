import hashlib
import json
import time
from copy import deepcopy
from backend.core.settings import settings
from .crypto_utils import verify_signature


class Block:
    def __init__(self, index: int, transactions: list, previous_hash: str):
        self.index = index
        self.timestamp = time.time()
        self.transactions = transactions  # list of transaction dictionaries
        self.previous_hash = previous_hash
        self.nonce = 0
        self.hash = self.calculate_hash()

    def calculate_hash(self) -> str:
        """Calculates the SHA-256 hash of the block."""
        block_string = json.dumps({
            "index": self.index,
            "timestamp": self.timestamp,
            "transactions": self.transactions,
            "previous_hash": self.previous_hash,
            "nonce": self.nonce
        }, sort_keys=True).encode('utf-8')
        return hashlib.sha256(block_string).hexdigest()

class Blockchain:
    def __init__(self):
        self.chain = []
        self.pending_transactions = []
        self.seen_tx_uuids = set()
        self.archived_epochs = []
        self.active_epoch_id = 1
        self.epoch_metadata = {
            1: {
                "epoch_id": 1,
                "parent_epoch_id": None,
                "started_at": time.time(),
                "start_reason": "Initial ledger bootstrap",
                "fork_from_block": None,
            }
        }
        self.difficulty = settings.blockchain_difficulty
        # Starting balances used to compute balances from the immutable ledger.
        # This is configured by `seed.py` so we avoid hardcoded genesis balances.
        self.initial_balances = {}
        # Create the genesis block
        self.create_genesis_block()

    def create_genesis_block(self):
        """Generates the first block of the chain."""
        genesis_block = Block(0, [], "0")
        self.mine_block_logic(genesis_block)
        self.chain.append(genesis_block)

    def _reset_active_chain(self, *, clear_seen_tx_ids: bool):
        self.chain = []
        self.pending_transactions = []
        if clear_seen_tx_ids:
            self.seen_tx_uuids = set()
        self.create_genesis_block()

    def _clone_block(self, block: Block) -> Block:
        clone = Block(block.index, deepcopy(block.transactions), block.previous_hash)
        clone.timestamp = block.timestamp
        clone.nonce = block.nonce
        clone.hash = block.hash
        return clone

    def _set_active_chain_from_blocks(self, blocks: list[Block], *, clear_seen_tx_ids: bool):
        self.pending_transactions = []
        if clear_seen_tx_ids:
            self.seen_tx_uuids = set()
        self.chain = [self._clone_block(block) for block in blocks] if blocks else []
        if not self.chain:
            self.create_genesis_block()

    def reset_chain(self):
        """Resets in-memory chain/pending state and clears archived continuity history."""
        self.archived_epochs = []
        self.active_epoch_id = 1
        self.epoch_metadata = {
            1: {
                "epoch_id": 1,
                "parent_epoch_id": None,
                "started_at": time.time(),
                "start_reason": "Initial ledger bootstrap",
                "fork_from_block": None,
            }
        }
        self._reset_active_chain(clear_seen_tx_ids=True)

    def configure_initial_balances(self, balances: dict):
        """Sets starting balances used by `compute_balances()`."""
        self.initial_balances = dict(balances or {})

    def compute_balances(self, upto_index: int | None = None) -> dict:
        """
        Computes current balances from:
        - `initial_balances`
        - all mined transactions (each transaction updates sender and recipient).
        """
        balances = dict(self.initial_balances)
        for block in self.chain:
            if upto_index is not None and block.index > upto_index:
                break
            for tx_wrapper in block.transactions:
                tx = tx_wrapper.get("tx_data", {})
                sender = tx.get("sender_id")
                recipient = tx.get("recipient_id")
                amount = tx.get("amount", 0)

                # Only apply updates for users that exist in the initial balance map.
                # This keeps the demo deterministic and avoids implicit account creation.
                if sender in balances:
                    balances[sender] -= amount
                if recipient in balances:
                    balances[recipient] += amount
        return balances

    def get_trusted_balances(self) -> dict:
        invalid_index = self.get_invalid_index()
        if invalid_index is None:
            return self.compute_balances()
        if invalid_index <= 0:
            return dict(self.initial_balances)
        return self.compute_balances(upto_index=invalid_index - 1)

    def get_latest_block(self) -> Block:
        return self.chain[-1]

    def add_transaction(self, tx_data: dict, signature: str, sender_public_key: str) -> dict:
        """
        Validates RSA signature and prevents Replay Attacks (duplicate UUID).
        If valid, adds to pending transactions.
        """
        tx_uuid = tx_data.get("id")
        if not tx_uuid:
            return {"status": "rejected", "reason": "Missing transaction UUID."}

        # Replay Attack Prevention (check UUID uniqueness)
        if tx_uuid in self.seen_tx_uuids:
            return {"status": "rejected", "reason": "Duplicate transaction detected (Replay Attack)."}

        # Basic validation (defensive checks; required for safe real-world-like usage)
        amount = tx_data.get("amount")
        if amount is None or not isinstance(amount, (int, float)) or amount <= 0:
            return {"status": "rejected", "reason": "Invalid amount."}

        sender_id = tx_data.get("sender_id")
        recipient_id = tx_data.get("recipient_id")
        if sender_id is None or recipient_id is None:
            return {"status": "rejected", "reason": "Missing sender/recipient."}

        if sender_id == recipient_id:
            return {"status": "rejected", "reason": "Sender and recipient must differ."}

        balances = self.compute_balances()
        if sender_id not in balances or recipient_id not in balances:
            return {"status": "rejected", "reason": "Unknown sender or recipient wallet."}
        if balances.get(sender_id, 0) < amount:
            return {"status": "rejected", "reason": "Insufficient on-chain balance."}

        # Validate Signature
        if not verify_signature(sender_public_key, tx_data, signature):
            return {"status": "rejected", "reason": "Invalid RSA signature (MITM/Tampering detected)."}

        self.pending_transactions.append({
            "tx_data": tx_data,
            "signature": signature
        })
        self.seen_tx_uuids.add(tx_uuid)
        return {"status": "success", "message": "Transaction added to pending pool."}

    def add_historical_transaction(self, tx_data: dict) -> dict:
        """
        Replays a previously-settled blockchain transaction during startup recovery.
        This bypasses signature checks because the source of truth is the persisted
        payment record, not a live network submission.
        """
        tx_uuid = tx_data.get("id")
        if not tx_uuid or tx_uuid in self.seen_tx_uuids:
            return {"status": "rejected", "reason": "Duplicate or missing transaction UUID."}

        amount = tx_data.get("amount")
        sender_id = tx_data.get("sender_id")
        recipient_id = tx_data.get("recipient_id")
        if amount is None or amount <= 0 or sender_id is None or recipient_id is None:
            return {"status": "rejected", "reason": "Invalid historical transaction data."}

        self.pending_transactions.append({
            "tx_data": tx_data,
            "signature": "historical-rebuild",
        })
        self.seen_tx_uuids.add(tx_uuid)
        self.mine_block()
        return {"status": "success", "message": "Historical transaction rebuilt."}

    def mine_block(self) -> Block:
        """Bundles pending transactions into a new block and adds to the chain."""
        if not self.pending_transactions:
            return None  # Nothing to mine

        latest_block = self.get_latest_block()
        new_block = Block(
            index=latest_block.index + 1,
            transactions=self.pending_transactions,
            previous_hash=latest_block.hash
        )
        
        # Proof of Work
        self.mine_block_logic(new_block)
        
        # Add to chain and clear pending
        self.chain.append(new_block)
        self.pending_transactions = []
        
        return new_block

    def mine_block_logic(self, block: Block):
        """Performs Proof-of-Work to find a hash with `difficulty` leading zeros."""
        target = "0" * self.difficulty
        while block.hash[:self.difficulty] != target:
            block.nonce += 1
            block.hash = block.calculate_hash()

    def get_invalid_index(self):
        """
        Returns the first invalid block index if the chain is corrupted, else None.
        """
        if not self.chain:
            return 0

        genesis = self.chain[0]
        if genesis.index != 0 or genesis.previous_hash != "0":
            return 0
        if genesis.hash != genesis.calculate_hash():
            return 0
        if not genesis.hash.startswith("0" * self.difficulty):
            return 0

        for i in range(1, len(self.chain)):
            current_block = self.chain[i]
            previous_block = self.chain[i - 1]

            # Recalculate hash and check if it matches the stored hash
            if current_block.hash != current_block.calculate_hash():
                return i

            # Check if the block correctly links to the previous block
            if current_block.previous_hash != previous_block.hash:
                return i

            # Validate PoW constraint
            if not current_block.hash.startswith("0" * self.difficulty):
                return i

        return None

    def is_chain_valid(self) -> bool:
        """Verifies the integrity of the blockchain."""
        return self.get_invalid_index() is None

    def archive_compromised_epoch(self, reason: str) -> dict | None:
        invalid_index = self.get_invalid_index()
        if invalid_index is None:
            return None

        trusted_balances = self.get_trusted_balances()
        current_epoch_id = self.active_epoch_id
        next_epoch_id = current_epoch_id + 1
        fork_from_block = max(invalid_index - 1, 0)
        archive = {
            "epoch_id": current_epoch_id,
            "status": "compromised",
            "reason": reason,
            "invalid_from_index": invalid_index,
            "archived_at": time.time(),
            "block_count": len(self.chain),
            "continued_to_epoch": next_epoch_id,
            "fork_from_block": fork_from_block,
            "parent_epoch_id": self.epoch_metadata.get(current_epoch_id, {}).get("parent_epoch_id"),
            "trusted_balances": trusted_balances,
            "final_hash": self.chain[-1].hash if self.chain else None,
            "chain": [
                {
                    "index": block.index,
                    "timestamp": block.timestamp,
                    "transactions": block.transactions,
                    "previous_hash": block.previous_hash,
                    "nonce": block.nonce,
                    "hash": block.hash,
                }
                for block in self.chain
            ],
        }
        self.archived_epochs.append(archive)
        self.active_epoch_id = next_epoch_id
        self.epoch_metadata[self.active_epoch_id] = {
            "epoch_id": self.active_epoch_id,
            "parent_epoch_id": current_epoch_id,
            "started_at": time.time(),
            "start_reason": reason,
            "fork_from_block": fork_from_block,
        }
        if invalid_index <= 0:
            self._reset_active_chain(clear_seen_tx_ids=False)
        else:
            self._set_active_chain_from_blocks(self.chain[: fork_from_block + 1], clear_seen_tx_ids=False)
        return archive

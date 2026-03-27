import time
from backend.core.settings import settings


class AttackEngine:
    def __init__(self):
        self.attacks_enabled = {
            "mitm": False,
            "replay": False,
            "tamper": False,
            "insider": False
        }
        self.attack_logs = []
        self.attacker_wallet_id = None

    def configure_attacker_wallet(self, user_id: int):
        """Configures which wallet will receive funds during tampering."""
        self.attacker_wallet_id = user_id

    def toggle_attack(self, attack_type: str, state: bool):
        if attack_type in self.attacks_enabled:
            self.attacks_enabled[attack_type] = state
            return {"status": "success", "message": f"{attack_type} set to {state}"}
        return {"status": "error", "message": "Unknown attack type"}

    def reset(self):
        self.attack_logs = []
        self.attacks_enabled = {key: False for key in self.attacks_enabled}
        self.attacker_wallet_id = None

    def clear_logs(self):
        self.attack_logs = []

    def clear_attacks(self):
        self.attacks_enabled = {key: False for key in self.attacks_enabled}

    def log_attack(self, attack_type: str, original: dict, altered: dict):
        log_entry = {
            "attack_type": attack_type,
            "original_values": original,
            "altered_values": altered,
            "timestamp": time.time()
        }
        self.attack_logs.append(log_entry)
        return log_entry

    def intercept_transaction(self, tx_data: dict) -> tuple[dict, bool, list]:
        """
        Takes original tx_data and applies active attacks.
        Returns (altered_tx_data, duplicate_flag, logs_emitted).
        """
        altered_data = tx_data.copy()
        is_replay = False
        emitted_logs = []

        if self.attacks_enabled["mitm"]:
            # MITM steals 40% of the amount
            original_amount = altered_data.get("amount", 0)
            stolen = round(original_amount * settings.mitm_steal_ratio, 2)
            altered_data["amount"] = original_amount - stolen
            emitted_logs.append(self.log_attack(
                "MITM", 
                {"tx_id": altered_data.get("id"), "amount": original_amount}, 
                {"amount": altered_data["amount"], "stolen": stolen}
            ))

        if self.attacks_enabled["replay"]:
            # Replay just flags that we should process it twice
            is_replay = True
            emitted_logs.append(self.log_attack(
                "Replay", 
                {"uuid": altered_data.get("id")}, 
                {"action": "duplicate_execution"}
            ))
            
        if self.attacks_enabled["tamper"]:
            # Tampering changes the recipient to attacker wallet
            original_recipient = altered_data.get("recipient_id")
            if self.attacker_wallet_id is None:
                # If not configured, do nothing but still log the attempt.
                emitted_logs.append(self.log_attack(
                    "Tampering",
                    {"recipient_id": original_recipient},
                    {"recipient_id": None, "note": "No attacker wallet configured"}
                ))
            else:
                altered_data["recipient_id"] = self.attacker_wallet_id
                emitted_logs.append(self.log_attack(
                    "Tampering",
                    {"recipient_id": original_recipient},
                    {"recipient_id": self.attacker_wallet_id}
                ))

        return altered_data, is_replay, emitted_logs

    def execute_insider(self, user_id: int, db_session) -> bool:
        """
        Insider Attack: Admin directly modifies SQLite balance without a transaction.
        We'll invoke this from a route when the attack is toggled or requested.
        """
        if self.attacks_enabled["insider"]:
            from backend.models import Balance
            balance_record = db_session.query(Balance).filter(Balance.user_id == user_id).first()
            if balance_record:
                original = balance_record.balance
                balance_record.balance -= settings.insider_adjustment
                db_session.commit()
                self.log_attack(
                    "Insider",
                    {"user_id": user_id, "balance": original},
                    {"user_id": user_id, "balance": balance_record.balance, "note": "Direct DB edit, no tx record"}
                )
                return True
        return False

# Global instance to be used by routers
attack_engine = AttackEngine()

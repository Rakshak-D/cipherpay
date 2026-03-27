import json
import os
import time

from backend.core.auth import hash_password
from backend.core.crypto_utils import generate_keypair
from backend.core.key_store import save_private_key
from backend.core.ledger_state import blockchain
from backend.core.network_state import network_state
from backend.core.settings import DEFAULT_USERS
from backend.database import Base, SessionLocal, engine
from backend.models import AuditLog, Balance, SystemState, TransactionRecord, User
from backend.core.attack_engine import attack_engine


def load_users_data():
    if os.getenv("CIPHERPAY_SEED_USERS"):
        return json.loads(os.getenv("CIPHERPAY_SEED_USERS"))
    return DEFAULT_USERS


def seed_db(users_data=None):
    print("Dropping existing tables...")
    Base.metadata.drop_all(bind=engine)
    print("Creating tables...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    blockchain.reset_chain()
    attack_engine.reset()
    network_state.set_mode("centralized")

    print("Generating RSA keypairs and seeding users...")
    users_data = users_data or load_users_data()
    initial_balances = {user["id"]: float(user["balance"]) for user in users_data}

    blockchain.configure_initial_balances(initial_balances)

    attacker_wallet_id = next((user["id"] for user in users_data if user.get("is_attacker")), None)
    if attacker_wallet_id is not None:
        attack_engine.configure_attacker_wallet(attacker_wallet_id)

    for user_data in users_data:
        private_key, public_key = generate_keypair()
        save_private_key(user_data["id"], private_key)

        user = User(
            id=user_data["id"],
            name=user_data["name"],
            username=user_data.get("username"),
            password_hash=hash_password(user_data.get("password", "viewer123")),
            role=user_data.get("role", "viewer"),
            is_active=True,
            is_admin=user_data.get("is_admin", False),
            is_attacker=user_data.get("is_attacker", False),
            public_key=public_key,
        )
        db.add(user)
        db.add(Balance(user_id=user_data["id"], balance=float(user_data["balance"])))

    db.add(
        SystemState(
            id=1,
            current_mode="centralized",
            current_scenario="clean-startup",
            last_reset_type="seed",
            last_reset_at=time.time(),
            ledger_status="healthy",
            ledger_note="System seeded and ready.",
            ledger_anchor_balances=json.dumps({str(user["id"]): float(user["balance"]) for user in users_data}),
        )
    )
    db.add(
        AuditLog(
            actor_username="system",
            actor_role="system",
            action="seed_system",
            target="environment",
            details="Initial database, wallet balances, and blockchain state seeded.",
        )
    )

    db.commit()
    db.close()

    print("Database seeding completed.")


if __name__ == "__main__":
    seed_db()

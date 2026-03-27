import os


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


class Settings:
    currency_code = os.getenv("CIPHERPAY_CURRENCY_CODE", "INR")
    currency_symbol = os.getenv("CIPHERPAY_CURRENCY_SYMBOL", "Rs.")
    auth_secret = os.getenv("CIPHERPAY_AUTH_SECRET", "cipherpay-dev-secret")
    auth_token_ttl_seconds = int(os.getenv("CIPHERPAY_AUTH_TOKEN_TTL_SECONDS", "28800"))
    blockchain_difficulty = int(os.getenv("BLOCKCHAIN_DIFFICULTY", "3"))
    mitm_steal_ratio = _env_float("CIPHERPAY_MITM_STEAL_RATIO", 0.4)
    insider_adjustment = _env_float("CIPHERPAY_INSIDER_ADJUSTMENT", 200.0)


DEFAULT_USERS = [
    {
        "id": 1,
        "name": "Bank Admin",
        "username": "admin",
        "role": "admin",
        "is_admin": True,
        "balance": 10000,
        "password": os.getenv("CIPHERPAY_ADMIN_PASSWORD", "admin123"),
    },
    {
        "id": 2,
        "name": "Alice Wallet",
        "username": "alice",
        "role": "operator",
        "is_admin": False,
        "balance": 500,
        "password": os.getenv("CIPHERPAY_OPERATOR_PASSWORD", "operator123"),
    },
    {
        "id": 3,
        "name": "Bob Device",
        "username": "bob",
        "role": "viewer",
        "is_admin": False,
        "balance": 500,
        "password": os.getenv("CIPHERPAY_VIEWER_PASSWORD", "viewer123"),
    },
    {
        "id": 4,
        "name": "Charlie Corp",
        "username": "charlie",
        "role": "viewer",
        "is_admin": False,
        "balance": 500,
        "password": os.getenv("CIPHERPAY_VIEWER_PASSWORD", "viewer123"),
    },
    {
        "id": 5,
        "name": "Dave Mobile",
        "username": "dave",
        "role": "viewer",
        "is_admin": False,
        "is_attacker": True,
        "balance": 500,
        "password": os.getenv("CIPHERPAY_VIEWER_PASSWORD", "viewer123"),
    },
]


DEMO_SCENARIOS = {
    "clean-startup": {
        "id": "clean-startup",
        "name": "Clean Startup",
        "description": "Fresh payment environment with no attacks, no transaction history, and a valid chain.",
        "mode": "centralized",
        "attacks": {"mitm": False, "replay": False, "tamper": False, "insider": False},
        "balances": None,
        "reanchor_chain": True,
        "clear_history": True,
        "seed_transaction": None,
        "tamper_chain": False,
    },
    "centralized-under-attack": {
        "id": "centralized-under-attack",
        "name": "Centralized Under Attack",
        "description": "Centralized mode with MITM and tampering enabled to demonstrate vulnerable clearing.",
        "mode": "centralized",
        "attacks": {"mitm": True, "replay": False, "tamper": True, "insider": False},
        "balances": None,
        "reanchor_chain": True,
        "clear_history": True,
        "seed_transaction": None,
        "tamper_chain": False,
    },
    "blockchain-protected": {
        "id": "blockchain-protected",
        "name": "Blockchain Protected",
        "description": "Blockchain mode with attack toggles enabled so users can see signature and replay protections.",
        "mode": "blockchain",
        "attacks": {"mitm": True, "replay": True, "tamper": True, "insider": False},
        "balances": None,
        "reanchor_chain": True,
        "clear_history": True,
        "seed_transaction": None,
        "tamper_chain": False,
    },
    "insider-db-drift": {
        "id": "insider-db-drift",
        "name": "Insider DB Drift",
        "description": "Balances are modified directly in the database to create a mismatch against the chain.",
        "mode": "blockchain",
        "attacks": {"mitm": False, "replay": False, "tamper": False, "insider": True},
        "balances": {2: 800, 3: 450, 4: 650, 5: 500},
        "reanchor_chain": True,
        "clear_history": True,
        "seed_transaction": None,
        "tamper_chain": False,
    },
    "tampered-historical-chain": {
        "id": "tampered-historical-chain",
        "name": "Tampered Historical Chain",
        "description": "Creates a clean blockchain transfer and then corrupts history so operators can study forensic mode.",
        "mode": "blockchain",
        "attacks": {"mitm": False, "replay": False, "tamper": False, "insider": False},
        "balances": None,
        "reanchor_chain": True,
        "clear_history": True,
        "seed_transaction": {
            "sender_id": 1,
            "recipient_id": 2,
            "amount": 120.0,
        },
        "tamper_chain": True,
    },
}


VISIBLE_SYSTEM_COPY = {
    "platform_title": "CipherPay Network",
    "platform_subtitle": "Trusted payment operations and settlement",
    "overview_tagline": "Local-first payment operations with cryptographic settlement and forensic recovery.",
}


settings = Settings()

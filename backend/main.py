from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text

from backend.database import engine, Base, SessionLocal
from backend.core.auth import hash_password
from backend.core.attack_engine import attack_engine
from backend.core.ledger_state import blockchain as blockchain_instance
from backend.core.network_state import network_state
from backend.core.settings import DEFAULT_USERS
from backend.models import User, Balance
from backend.routers import api_v1, centralized, blockchain as blockchain_router, attack, utils
from backend.core.socket_manager import manager
from backend.services import get_or_create_system_state, rebuild_blockchain_state

# Create DB tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="CipherPay API", description="Digital Payment Simulation System with Attack Vectors and Blockchain defense")

# CORS setup for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Since it's a demo
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(centralized.router)
app.include_router(blockchain_router.router)
app.include_router(attack.router)
app.include_router(utils.router)
app.include_router(api_v1.router)


@app.on_event("startup")
def initialize_in_memory_state():
    """
    The SQLite ledger and the in-memory blockchain/attack engine must be initialized
    together so the demo works after server restarts.
    """
    ensure_sqlite_schema()
    db = SessionLocal()
    try:
        # Reset in-memory state for deterministic behavior.
        attack_engine.reset()
        blockchain_instance.reset_chain()

        users = db.query(User).all()
        for u in users:
            if not u.username:
                seed_user = next((item for item in DEFAULT_USERS if item["id"] == u.id), None)
                if seed_user:
                    u.username = seed_user.get("username")
                    u.role = seed_user.get("role", "viewer")
                    u.password_hash = hash_password(seed_user.get("password", "viewer123"))
                    u.is_active = True
        db.commit()

        state = get_or_create_system_state(db)
        network_state.set_mode(state.current_mode or "centralized")
        rebuild_blockchain_state(db)

        attacker_user = db.query(User).filter(User.is_attacker == True).first()  # noqa: E712
        if attacker_user:
            attack_engine.configure_attacker_wallet(attacker_user.id)
    finally:
        db.close()


def ensure_sqlite_schema():
    """
    Best-effort SQLite schema migration for demo stability.
    If you previously ran the demo with an older DB (missing columns), the server
    should still boot and the ledger should keep working.
    """
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as conn:
        users_info = conn.execute(text("PRAGMA table_info(users)")).fetchall()
        users_cols = {row[1] for row in users_info}  # column name is index 1
        if "is_attacker" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_attacker BOOLEAN DEFAULT 0"))
        if "username" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR"))
        if "password_hash" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR"))
        if "role" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'viewer'"))
        if "is_active" not in users_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1"))

        tx_info = conn.execute(text("PRAGMA table_info(transactions)")).fetchall()
        tx_cols = {row[1] for row in tx_info}
        if "reason" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN reason VARCHAR"))
        if "source" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN source VARCHAR DEFAULT 'user'"))
        if "stage" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN stage VARCHAR DEFAULT 'submitted'"))
        if "explanation" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN explanation VARCHAR"))
        if "balance_source" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN balance_source VARCHAR DEFAULT 'database'"))
        if "chain_status" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN chain_status VARCHAR DEFAULT 'healthy'"))
        if "initiated_by" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN initiated_by VARCHAR"))
        if "payment_type" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN payment_type VARCHAR"))
        if "payment_label" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN payment_label VARCHAR"))
        if "reference_label" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN reference_label VARCHAR"))
        if "business_context" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN business_context VARCHAR"))
        if "sender_impact_amount" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN sender_impact_amount FLOAT DEFAULT 0"))
        if "recipient_impact_amount" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN recipient_impact_amount FLOAT DEFAULT 0"))
        if "intended_recipient_id" not in tx_cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN intended_recipient_id INTEGER"))

        state_info = conn.execute(text("PRAGMA table_info(system_state)")).fetchall()
        state_cols = {row[1] for row in state_info}
        if "ledger_anchor_balances" not in state_cols:
            conn.execute(text("ALTER TABLE system_state ADD COLUMN ledger_anchor_balances VARCHAR"))


ensure_sqlite_schema()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Just keep the connection open, we don't expect messages from client
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

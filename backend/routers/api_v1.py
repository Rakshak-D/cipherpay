import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.attack_engine import attack_engine
from backend.core.auth import authenticate_user, create_access_token, get_current_user, require_role
from backend.core.crypto_utils import sign_data
from backend.core.key_store import load_private_key
from backend.core.network_state import network_state
from backend.core.socket_manager import manager
from backend.database import SessionLocal, get_db
from backend.models import User
from backend.routers.blockchain import (
    BlockchainTransferRequest,
    ContinuityRequest,
    TamperRequest,
    continue_after_tamper,
    process_blockchain_transfer,
    simulate_tamper,
    verify_chain,
)
from backend.routers.attack import InsiderRequest
from backend.routers.centralized import TransferRequest, process_centralized_transfer
from backend.seed import seed_db
from backend.services import (
    apply_scenario,
    build_balance_snapshot,
    clear_transaction_history,
    create_audit_log,
    get_network_overview,
    get_or_create_system_state,
    reset_runtime_state,
    update_user_balance,
)


router = APIRouter(prefix="/api/v1")


class LoginRequest(BaseModel):
    username: str
    password: str


class UnifiedTransferRequest(BaseModel):
    id: str
    sender_id: int
    recipient_id: int
    amount: float
    mode: str | None = None
    payment_template_id: str | None = None


class LedgerRecoverRequest(BaseModel):
    use_current_balances: bool = True


class BalancePatchRequest(BaseModel):
    balance: float
    reanchor_ledger: bool = True


class AttackResetRequest(BaseModel):
    clear_logs: bool = True
    disable_attacks: bool = True


class AttackToggleRequest(BaseModel):
    state: bool

@router.post("/auth/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, request.username, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = create_access_token(user)
    return {
        "token": token,
        "user": {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "role": user.role,
        },
    }


@router.get("/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "username": current_user.username,
        "role": current_user.role,
    }


@router.post("/auth/logout")
def logout(current_user: User = Depends(get_current_user)):
    return {"status": "success", "message": f"Session closed for {current_user.username}."}


@router.get("/system/overview")
def system_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_network_overview(db, current_user=current_user)


@router.post("/payments/transfer")
async def payment_transfer(
    request: UnifiedTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    selected_mode = (request.mode or network_state.mode).lower()
    if selected_mode == "blockchain":
        sender = db.query(User).filter(User.id == request.sender_id).first()
        if not sender or not sender.public_key:
            raise HTTPException(status_code=404, detail="Sender public key not found.")
        private_key = load_private_key(request.sender_id)
        if not private_key:
            raise HTTPException(status_code=404, detail="Private signing key not found.")
        tx_data = {
            "id": request.id,
            "sender_id": request.sender_id,
            "recipient_id": request.recipient_id,
            "amount": request.amount,
            "payment_template_id": request.payment_template_id,
        }
        signature = sign_data(private_key, tx_data)
        payload = BlockchainTransferRequest(
            **tx_data,
            signature=signature,
            public_key=sender.public_key,
        )
        return await process_blockchain_transfer(payload, db, current_user)

    payload = TransferRequest(
        id=request.id,
        sender_id=request.sender_id,
        recipient_id=request.recipient_id,
        amount=request.amount,
        payment_template_id=request.payment_template_id,
    )
    return await process_centralized_transfer(payload, db, current_user)


@router.get("/ledger/overview")
def ledger_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    overview = get_network_overview(db, current_user=current_user)
    return {
        "blockchain": overview["blockchain"],
        "recoverability": overview["recoverability"],
        "recent_audit_items": overview["recent_audit_items"],
    }


@router.get("/ledger/integrity")
def ledger_integrity(current_user: User = Depends(get_current_user)):
    return verify_chain(current_user)


@router.post("/ledger/tamper")
async def ledger_tamper(
    request: TamperRequest,
    current_user: User = Depends(require_role("admin")),
):
    return await simulate_tamper(request, current_user)  # type: ignore[name-defined]


@router.post("/ledger/recover")
def ledger_recover(
    request: LedgerRecoverRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    reset_runtime_state(
        db,
        clear_transactions=True,
        use_current_balances=request.use_current_balances,
        current_scenario="clean-startup",
        note="Ledger recovered from forensic mode.",
    )
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "recover_ledger",
        "ledger",
        f"Ledger recovered with use_current_balances={request.use_current_balances}.",
    )
    return {"status": "success", "message": "Ledger recovered and blockchain state re-anchored."}


@router.post("/ledger/continue")
async def ledger_continue(
    request: ContinuityRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    return await continue_after_tamper(request, db, current_user)


@router.post("/admin/system/reset")
async def admin_system_reset(
    current_user: User = Depends(require_role("admin")),
):
    seed_db()
    audit_db = SessionLocal()
    try:
        create_audit_log(
            audit_db,
            current_user.username,
            current_user.role,
            "reset_system",
            "environment",
            "System reset to seed state.",
        )
    finally:
        audit_db.close()
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
    return {"status": "success", "message": "Full system reset completed."}


@router.post("/admin/ledger/reset")
async def admin_ledger_reset(
    request: LedgerRecoverRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    reset_runtime_state(
        db,
        clear_transactions=True,
        use_current_balances=request.use_current_balances,
        current_scenario="clean-startup",
        note="Ledger reset via admin control.",
    )
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "reset_ledger",
        "ledger",
        f"Admin ledger reset with use_current_balances={request.use_current_balances}.",
    )
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
    return {"status": "success", "message": "Ledger reset completed."}


@router.post("/admin/history/clear")
async def admin_history_clear(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    clear_transaction_history(db)
    state = get_or_create_system_state(db)
    state.last_reset_type = "history-clear"
    state.last_reset_at = time.time()
    state.ledger_note = "Transaction history cleared by admin."
    db.commit()
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "clear_history",
        "transactions",
        "Transaction history cleared without reseeding users.",
    )
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    return {"status": "success", "message": "Transaction history cleared."}


@router.patch("/admin/users/{user_id}/balance")
async def admin_patch_balance(
    user_id: int,
    request: BalancePatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    update_user_balance(db, user_id, request.balance)
    if request.reanchor_ledger:
        reset_runtime_state(
            db,
            clear_transactions=True,
            use_current_balances=True,
            current_scenario="custom-balance-setup",
            note="Balances changed and blockchain re-anchored by admin.",
        )
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "override_balance",
        f"user:{user_id}",
        f"Balance updated to {request.balance}; reanchor_ledger={request.reanchor_ledger}.",
    )
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
    return {"status": "success", "message": "Balance updated."}


@router.post("/admin/scenarios/{scenario_id}/apply")
async def admin_apply_scenario(
    scenario_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    try:
        scenario = apply_scenario(db, scenario_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "apply_scenario",
        scenario_id,
        scenario["description"],
    )
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
    return {"status": "success", "scenario": scenario}


@router.post("/admin/attacks/reset")
async def admin_reset_attacks(
    request: AttackResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    if request.disable_attacks:
        attack_engine.clear_attacks()
    if request.clear_logs:
        attack_engine.clear_logs()
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "reset_attacks",
        "attack_engine",
        f"disable_attacks={request.disable_attacks}; clear_logs={request.clear_logs}.",
    )
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    return {"status": "success", "message": "Attack engine state updated."}


@router.post("/admin/attacks/{attack_id}")
async def admin_toggle_attack(
    attack_id: str,
    request: AttackToggleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    result = attack_engine.toggle_attack(attack_id, request.state)
    if result["status"] != "success":
        raise HTTPException(status_code=404, detail=result["message"])
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "toggle_attack",
        attack_id,
        f"Attack '{attack_id}' set to {request.state}.",
    )
    await manager.broadcast({"type": "ATTACK_STATE_UPDATE", "data": attack_engine.attacks_enabled})
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    return result


@router.post("/admin/attacks/insider/apply")
async def admin_apply_insider_attack(
    request: InsiderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
):
    success = attack_engine.execute_insider(request.user_id, db)
    if not success:
        raise HTTPException(status_code=400, detail="Insider attack is not enabled or user not found.")
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "apply_insider_attack",
        f"user:{request.user_id}",
        "Direct database balance drift applied without a settlement transaction.",
    )
    latest_log = attack_engine.attack_logs[-1] if attack_engine.attack_logs else None
    if latest_log:
        await manager.broadcast({"type": "ATTACK_LOG", "data": latest_log})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    return {"status": "success", "message": "Insider DB modification complete."}

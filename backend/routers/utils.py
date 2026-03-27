from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from backend.core.crypto_utils import sign_data
from backend.core.auth import get_current_user, require_role
from backend.core.key_store import load_private_key
from backend.core.network_state import network_state
from backend.core.socket_manager import manager
from backend.database import SessionLocal, get_db
from backend.models import User
from backend.services import create_audit_log, full_system_reset, get_network_overview, reset_runtime_state, update_user_balance
from sqlalchemy.orm import Session

router = APIRouter(prefix="/utils")

class SignRequest(BaseModel):
    user_id: int
    data: dict


class ModeRequest(BaseModel):
    mode: str


class LedgerResetRequest(BaseModel):
    use_current_balances: bool = True


class BalanceUpdateRequest(BaseModel):
    user_id: int
    balance: float
    reset_ledger: bool = True

@router.post("/sign")
def sign_transaction(
    req: SignRequest,
    current_user: User = Depends(require_role("admin", "operator")),
):
    _ = current_user
    private_key = load_private_key(req.user_id)
    if not private_key:
        raise HTTPException(status_code=404, detail="Private key not found for this user.")

    signature = sign_data(private_key, req.data)
    return {"signature": signature}


@router.get("/network/overview")
def network_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_network_overview(db, current_user=current_user)


@router.post("/network/mode")
async def set_network_mode(
    req: ModeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    try:
        mode = network_state.set_mode(req.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "switch_mode",
        "network",
        f"Settlement mode changed to {mode}.",
    )
    await manager.broadcast({"type": "NETWORK_MODE_CHANGED", "data": {"mode": mode}})
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    return {"status": "success", "mode": mode}


@router.post("/admin/reset-system")
async def reset_system(
    current_user: User = Depends(require_role("admin")),
):
    full_system_reset()
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
    return {"status": "success", "message": "Database, balances, attacks, and blockchain were reset to seed state."}


@router.post("/admin/reset-ledger")
async def reset_ledger(
    req: LedgerResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    reset_runtime_state(db, clear_transactions=True, use_current_balances=req.use_current_balances)
    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "reset_ledger",
        "ledger",
        f"Ledger reset with use_current_balances={req.use_current_balances}.",
    )
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
    return {
        "status": "success",
        "message": "Ledger and blockchain were reset.",
        "mode": network_state.mode,
    }


@router.post("/admin/update-balance")
async def admin_update_balance(
    req: BalanceUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    if req.balance < 0:
        raise HTTPException(status_code=400, detail="Balance cannot be negative.")

    try:
        update_user_balance(db, req.user_id, req.balance)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if req.reset_ledger:
        reset_runtime_state(db, clear_transactions=True, use_current_balances=True)

    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "override_balance",
        f"user:{req.user_id}",
        f"Balance set to {req.balance}; reset_ledger={req.reset_ledger}.",
    )

    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
    return {
        "status": "success",
        "message": "Balance updated successfully.",
        "reset_ledger": req.reset_ledger,
    }

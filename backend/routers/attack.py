from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from backend.core.auth import get_current_user, require_role
from backend.core.attack_engine import attack_engine
from backend.database import get_db
from backend.models import User
from backend.core.socket_manager import manager

router = APIRouter(prefix="/attack")

class ToggleRequest(BaseModel):
    attack_type: str
    state: bool

class InsiderRequest(BaseModel):
    user_id: int

@router.post("/toggle")
async def toggle_attack(
    req: ToggleRequest,
    current_user: User = Depends(require_role("admin")),
):
    result = attack_engine.toggle_attack(req.attack_type, req.state)
    await manager.broadcast({"type": "ATTACK_STATE_UPDATE", "data": attack_engine.attacks_enabled})
    return result

@router.get("/state")
def get_attack_state(_current_user: User = Depends(get_current_user)):
    return attack_engine.attacks_enabled

@router.post("/insider")
async def trigger_insider(
    req: InsiderRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_role("admin")),
):
    """Triggers the direct SQLite modification attack."""
    success = attack_engine.execute_insider(req.user_id, db)
    if success:
        # Broadcast the insider log immediately
        latest_log = attack_engine.attack_logs[-1]
        await manager.broadcast({"type": "ATTACK_LOG", "data": latest_log})
        await manager.broadcast({"type": "BALANCE_UPDATE"})
        await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
        return {"status": "success", "message": "Insider DB modification complete."}
    return {"status": "error", "message": "Insider attack is not enabled or user not found."}

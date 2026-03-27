import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.core.attack_engine import attack_engine
from backend.core.socket_manager import manager
from backend.core.validation import normalize_currency_amount
from backend.database import get_db
from backend.models import Balance, TransactionRecord, User
from backend.services import (
    build_balance_snapshot,
    create_security_event,
    serialize_transactions,
    serialize_users,
)
from backend.core.auth import get_current_user, require_role

router = APIRouter()


class TransferRequest(BaseModel):
    id: str
    sender_id: int
    recipient_id: int
    amount: float
    payment_template_id: str | None = None


def _payment_record_payload(record: TransactionRecord) -> dict:
    all_items = serialize_transactions(record._sa_instance_state.session)
    return next((item for item in all_items if item["kind"] == "payment" and item["tx_uuid"] == record.tx_uuid), None)


def _security_event_payloads(db: Session, tx_uuid: str) -> list[dict]:
    return [
        item for item in serialize_transactions(db)
        if item["kind"] == "security_event" and item["parent_tx_uuid"] == tx_uuid
    ]


@router.get("/users")
def get_users(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    return serialize_users(db)


@router.get("/transactions")
def get_transactions(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    return serialize_transactions(db)


@router.post("/transfer")
async def process_centralized_transfer(
    req: TransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    amount = normalize_currency_amount(req.amount)
    if req.sender_id == req.recipient_id:
        raise HTTPException(status_code=400, detail="Sender and recipient must be different.")

    sender = db.query(User).filter(User.id == req.sender_id).first()
    intended_recipient = db.query(User).filter(User.id == req.recipient_id).first()
    if not sender or not intended_recipient:
        raise HTTPException(status_code=404, detail="Sender or recipient not found.")

    from backend.core.payment_flows import build_payment_metadata

    payment_meta = build_payment_metadata(
        template_id=req.payment_template_id,
        tx_id=req.id,
        sender_name=sender.name,
        recipient_name=intended_recipient.name,
    )

    tx_data = {
        "id": req.id,
        "sender_id": req.sender_id,
        "recipient_id": req.recipient_id,
        "amount": amount,
        "payment_template_id": req.payment_template_id,
    }
    altered_tx_data, is_replay, emitted_logs = attack_engine.intercept_transaction(tx_data)
    for log_entry in emitted_logs:
        await manager.broadcast({"type": "ATTACK_LOG", "data": log_entry})

    executions = 2 if is_replay else 1
    actual_recipient_id = altered_tx_data["recipient_id"]
    actual_amount = normalize_currency_amount(altered_tx_data["amount"])
    sender_impact_amount = 0.0
    recipient_impact_amount = 0.0
    settled_executions = 0
    replay_blocked = False

    try:
        for _ in range(executions):
            sender_bal = (
                db.query(Balance)
                .filter(Balance.user_id == req.sender_id)
                .with_for_update()
                .first()
            )
            recipient_bal = (
                db.query(Balance)
                .filter(Balance.user_id == actual_recipient_id)
                .with_for_update()
                .first()
            )
            if not sender_bal or not recipient_bal:
                raise HTTPException(status_code=404, detail="Wallet balance record not found.")

            if sender_bal.balance < amount:
                replay_blocked = settled_executions > 0 and is_replay
                break

            sender_bal.balance -= amount
            recipient_bal.balance += actual_amount
            sender_impact_amount += amount
            recipient_impact_amount += actual_amount
            settled_executions += 1

        if settled_executions == 0:
            status = "rejected"
            reason = "Insufficient funds"
            explanation = "The sender does not have enough balance in the operational database."
        else:
            compromised = (
                settled_executions > 1
                or actual_amount != amount
                or actual_recipient_id != req.recipient_id
            )
            if compromised:
                status = "intercepted"
                reason = "The centralized processor settled an altered payment."
                explanation = (
                    f"{payment_meta['business_context']} The payment settled, but one or more attack paths altered the"
                    " credited amount, recipient, or execution count."
                )
            elif replay_blocked:
                status = "partial_protected"
                reason = "A duplicate replay attempt was blocked before a second settlement."
                explanation = (
                    f"{payment_meta['business_context']} The requested transfer settled once and a duplicate replay"
                    " attempt failed before funds could move again."
                )
            else:
                status = "success"
                reason = None
                explanation = f"{payment_meta['business_context']} The payment cleared through the centralized database."

        record = TransactionRecord(
            tx_uuid=req.id,
            sender_id=req.sender_id,
            recipient_id=actual_recipient_id,
            intended_recipient_id=req.recipient_id,
            amount=amount,
            sender_impact_amount=sender_impact_amount,
            recipient_impact_amount=recipient_impact_amount,
            mode="centralized",
            status=status,
            reason=reason,
            source="attack" if status in {"intercepted", "partial_protected"} and emitted_logs else "user",
            stage="cleared" if status in {"success", "partial_protected"} else "rejected" if status == "rejected" else "validated",
            explanation=explanation,
            balance_source="database",
            chain_status="healthy",
            initiated_by=current_user.username,
            payment_type=payment_meta["payment_type"],
            payment_label=payment_meta["payment_label"],
            reference_label=payment_meta["reference_label"],
            business_context=payment_meta["business_context"],
        )
        db.add(record)
        db.commit()
        db.refresh(record)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Ledger error: {str(exc)}") from exc

    for log in emitted_logs:
        attack_type = log.get("attack_type")
        if attack_type == "MITM" and settled_executions > 0:
            create_security_event(
                db,
                parent_tx_uuid=req.id,
                mode="centralized",
                security_event_type="mitm_applied",
                title="MITM interception applied",
                summary=f"The sender lost {amount:.2f}, but only {actual_amount:.2f} reached the settled recipient.",
                status="applied",
                sender_id=req.sender_id,
                recipient_id=actual_recipient_id,
                amount=actual_amount,
            )
        if attack_type == "Tampering" and settled_executions > 0:
            create_security_event(
                db,
                parent_tx_uuid=req.id,
                mode="centralized",
                security_event_type="tamper_applied",
                title="Recipient changed in transit",
                summary=f"The payment was redirected from wallet {req.recipient_id} to wallet {actual_recipient_id}.",
                status="applied",
                sender_id=req.sender_id,
                recipient_id=actual_recipient_id,
                amount=actual_amount,
            )
        if attack_type == "Replay":
            if settled_executions > 1:
                create_security_event(
                    db,
                    parent_tx_uuid=req.id,
                    mode="centralized",
                    security_event_type="replay_applied",
                    title="Replay duplicated execution",
                    summary="The same payment reference executed more than once in centralized mode.",
                    status="applied",
                    sender_id=req.sender_id,
                    recipient_id=actual_recipient_id,
                    amount=recipient_impact_amount,
                )
            elif replay_blocked:
                create_security_event(
                    db,
                    parent_tx_uuid=req.id,
                    mode="centralized",
                    security_event_type="replay_blocked",
                    title="Replay blocked before second settlement",
                    summary="A duplicate execution path was attempted, but the second settlement did not complete.",
                    status="blocked",
                    sender_id=req.sender_id,
                    recipient_id=actual_recipient_id,
                    amount=amount,
                )

    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await asyncio.sleep(0.1)
    return {
        "status": status,
        "mode": "centralized",
        "message": explanation,
        "primary_transaction": _payment_record_payload(record),
        "security_events": _security_event_payloads(db, req.id),
        "balance_snapshot": build_balance_snapshot(db, [req.sender_id, req.recipient_id, actual_recipient_id]),
    }

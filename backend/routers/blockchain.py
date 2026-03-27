import asyncio
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.core.attack_engine import attack_engine
from backend.core.auth import get_current_user, require_role
from backend.core.ledger_state import blockchain
from backend.core.network_state import network_state
from backend.core.socket_manager import manager
from backend.core.validation import normalize_currency_amount
from backend.database import get_db
from backend.models import TransactionRecord, User
from backend.services import (
    build_balance_snapshot,
    create_audit_log,
    create_security_event,
    get_or_create_system_state,
    serialize_transactions,
)

router = APIRouter(prefix="/blockchain")


def _block_integrity_status(block_index: int, invalid_index: int | None) -> str:
    if invalid_index is None or block_index < invalid_index:
        return "trusted"
    if block_index == invalid_index:
        return "tampered"
    return "downstream_invalid"


def _serialize_block(block, invalid_index: int | None):
    block_index = block.index if hasattr(block, "index") else block["index"]
    block_timestamp = block.timestamp if hasattr(block, "timestamp") else block["timestamp"]
    block_transactions = block.transactions if hasattr(block, "transactions") else block["transactions"]
    block_previous_hash = block.previous_hash if hasattr(block, "previous_hash") else block["previous_hash"]
    block_nonce = block.nonce if hasattr(block, "nonce") else block["nonce"]
    block_hash = block.hash if hasattr(block, "hash") else block["hash"]
    integrity_status = _block_integrity_status(block_index, invalid_index)
    return {
        "index": block_index,
        "timestamp": block_timestamp,
        "transactions": block_transactions,
        "previous_hash": block_previous_hash,
        "nonce": block_nonce,
        "hash": block_hash,
        "integrity_status": integrity_status,
        "is_tampered": integrity_status == "tampered",
        "is_downstream_invalid": integrity_status == "downstream_invalid",
    }


class BlockchainTransferRequest(BaseModel):
    id: str
    sender_id: int
    recipient_id: int
    amount: float
    payment_template_id: str | None = None
    signature: str
    public_key: str


class TamperRequest(BaseModel):
    block_index: int
    tx_index: int
    new_amount: float


class ContinuityRequest(BaseModel):
    reason: str | None = None


def _payment_record_payload(record: TransactionRecord) -> dict:
    all_items = serialize_transactions(record._sa_instance_state.session)
    return next((item for item in all_items if item["kind"] == "payment" and item["tx_uuid"] == record.tx_uuid), None)


def _security_event_payloads(db: Session, tx_uuid: str) -> list[dict]:
    return [
        item for item in serialize_transactions(db)
        if item["kind"] == "security_event" and item["parent_tx_uuid"] == tx_uuid
    ]


@router.get("/chain")
def get_chain(_current_user: User = Depends(get_current_user)):
    invalid_index = blockchain.get_invalid_index()
    return {
        "chain": [_serialize_block(block, invalid_index) for block in blockchain.chain],
        "active_epoch_id": blockchain.active_epoch_id,
        "active_epoch_parent_id": blockchain.epoch_metadata.get(blockchain.active_epoch_id, {}).get("parent_epoch_id"),
        "active_epoch_started_at": blockchain.epoch_metadata.get(blockchain.active_epoch_id, {}).get("started_at"),
        "active_epoch_start_reason": blockchain.epoch_metadata.get(blockchain.active_epoch_id, {}).get("start_reason"),
        "active_epoch_fork_from_block": blockchain.epoch_metadata.get(blockchain.active_epoch_id, {}).get("fork_from_block"),
        "archived_epochs": [
            {
                "epoch_id": epoch["epoch_id"],
                "status": epoch["status"],
                "reason": epoch["reason"],
                "continued_to_epoch": epoch.get("continued_to_epoch"),
                "fork_from_block": epoch.get("fork_from_block"),
                "parent_epoch_id": epoch.get("parent_epoch_id"),
                "invalid_from_index": epoch["invalid_from_index"],
                "archived_at": epoch["archived_at"],
                "block_count": epoch["block_count"],
                "final_hash": epoch["final_hash"],
                "trusted_balances": epoch["trusted_balances"],
                "chain": [
                    _serialize_block(block, epoch["invalid_from_index"])
                    for block in epoch["chain"]
                ],
            }
            for epoch in blockchain.archived_epochs
        ],
        "is_valid": invalid_index is None,
        "invalid_from_index": invalid_index,
    }


@router.get("/verify")
def verify_chain(_current_user: User = Depends(get_current_user)):
    invalid_index = blockchain.get_invalid_index()
    return {"is_valid": invalid_index is None, "invalid_from_index": invalid_index}


@router.post("/transfer")
async def process_blockchain_transfer(
    req: BlockchainTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    amount = normalize_currency_amount(req.amount)
    if req.sender_id == req.recipient_id:
        raise HTTPException(status_code=400, detail="Sender and recipient must be different.")

    rolled_into_new_epoch = False
    if not blockchain.is_chain_valid():
        archived_epoch = blockchain.archive_compromised_epoch(
            "Automatic continuity rollover triggered after integrity violation."
        )
        rolled_into_new_epoch = archived_epoch is not None
        if rolled_into_new_epoch:
            create_audit_log(
                db,
                current_user.username,
                current_user.role,
                "archive_compromised_epoch",
                f"epoch:{archived_epoch['epoch_id']}",
                "Compromised blockchain epoch archived automatically and continuity resumed from the last trusted block.",
            )
            state = get_or_create_system_state(db)
            state.ledger_status = "healthy"
            state.ledger_note = "A compromised epoch was archived and settlement continued from the last trusted block."
            state.last_reset_type = "continuity-rollover"
            state.last_reset_at = time.time()
            db.commit()

    network_state.set_mode("blockchain")
    tx_data = {
        "id": req.id,
        "sender_id": req.sender_id,
        "recipient_id": req.recipient_id,
        "amount": amount,
        "payment_template_id": req.payment_template_id,
    }

    sender = db.query(User).filter(User.id == req.sender_id).first()
    intended_recipient = db.query(User).filter(User.id == req.recipient_id).first()
    if not sender or sender.public_key != req.public_key:
        raise HTTPException(status_code=400, detail="Public key does not match sender.")
    if not intended_recipient:
        raise HTTPException(status_code=404, detail="Recipient not found.")

    from backend.core.payment_flows import build_payment_metadata

    payment_meta = build_payment_metadata(
        template_id=req.payment_template_id,
        tx_id=req.id,
        sender_name=sender.name,
        recipient_name=intended_recipient.name,
    )

    altered_tx_data, is_replay, emitted_logs = attack_engine.intercept_transaction(tx_data)
    for log_entry in emitted_logs:
        await manager.broadcast({"type": "ATTACK_LOG", "data": log_entry})

    actual_recipient_id = altered_tx_data["recipient_id"]
    actual_amount = normalize_currency_amount(altered_tx_data["amount"])
    primary_result = None
    replay_result = None

    try:
        primary_result = blockchain.add_transaction(altered_tx_data.copy(), req.signature, req.public_key)
        if primary_result["status"] == "success":
            blockchain.mine_block()

        if primary_result["status"] == "success" and is_replay:
            replay_result = blockchain.add_transaction(altered_tx_data.copy(), req.signature, req.public_key)

        if primary_result["status"] != "success":
            status = "rejected"
            reason = primary_result.get("reason")
            explanation = reason or "The blockchain rejected the transfer."
            sender_impact_amount = 0.0
            recipient_impact_amount = 0.0
            settled_recipient_id = req.recipient_id
        elif replay_result and replay_result["status"] == "rejected":
            status = "partial_protected"
            reason = replay_result.get("reason")
            explanation = (
                f"{payment_meta['business_context']} The intended transfer settled on-chain, and the replay attempt"
                " was blocked before it could execute again."
            )
            sender_impact_amount = amount
            recipient_impact_amount = amount
            settled_recipient_id = req.recipient_id
        else:
            status = "success"
            reason = None
            explanation = (
                f"{payment_meta['business_context']} The transfer was signed, validated, and mined into the blockchain."
            )
            sender_impact_amount = amount
            recipient_impact_amount = amount
            settled_recipient_id = req.recipient_id

        record = TransactionRecord(
            tx_uuid=req.id,
            sender_id=req.sender_id,
            recipient_id=settled_recipient_id,
            intended_recipient_id=req.recipient_id,
            amount=amount,
            sender_impact_amount=sender_impact_amount,
            recipient_impact_amount=recipient_impact_amount,
            mode="blockchain",
            status=status,
            reason=reason,
            source="attack" if emitted_logs and status in {"rejected", "partial_protected"} else "user",
            stage="settled_on_chain" if status in {"success", "partial_protected"} else "rejected",
            explanation=(
                (
                    f"{payment_meta['business_context']} The transfer was settled on a continuity branch after a"
                    " compromised segment was archived and the ledger resumed from the last trusted block."
                )
                if rolled_into_new_epoch and status in {"success", "partial_protected"}
                else explanation
            ),
            balance_source="blockchain",
            chain_status=(
                "continuity_epoch"
                if rolled_into_new_epoch and blockchain.is_chain_valid()
                else "healthy" if blockchain.is_chain_valid() else "paused"
            ),
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
        if attack_type == "MITM" and status == "rejected":
            create_security_event(
                db,
                parent_tx_uuid=req.id,
                mode="blockchain",
                security_event_type="mitm_blocked",
                title="MITM blocked by signature validation",
                summary=f"The signed transfer for {amount:.2f} was modified in transit and the blockchain rejected it.",
                status="blocked",
                sender_id=req.sender_id,
                recipient_id=actual_recipient_id,
                amount=actual_amount,
            )
        if attack_type == "Tampering" and status == "rejected":
            create_security_event(
                db,
                parent_tx_uuid=req.id,
                mode="blockchain",
                security_event_type="tamper_blocked",
                title="Recipient tamper blocked",
                summary=f"The signed recipient field was changed from wallet {req.recipient_id} to wallet {actual_recipient_id}, so settlement was rejected.",
                status="blocked",
                sender_id=req.sender_id,
                recipient_id=actual_recipient_id,
                amount=actual_amount,
            )
        if attack_type == "Replay" and replay_result and replay_result["status"] == "rejected":
            create_security_event(
                db,
                parent_tx_uuid=req.id,
                mode="blockchain",
                security_event_type="replay_blocked",
                title="Replay blocked on duplicate reference",
                summary="The first signed settlement succeeded, and the duplicate replay submission was rejected.",
                status="blocked",
                sender_id=req.sender_id,
                recipient_id=req.recipient_id,
                amount=amount,
            )

    await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    await asyncio.sleep(0.1)
    return {
        "status": status,
        "mode": "blockchain",
        "message": record.explanation,
        "primary_transaction": _payment_record_payload(record),
        "security_events": _security_event_payloads(db, req.id),
        "balance_snapshot": build_balance_snapshot(db, [req.sender_id, req.recipient_id]),
        "continuity_rollover": rolled_into_new_epoch,
        "active_epoch_id": blockchain.active_epoch_id,
    }


@router.post("/tamper")
async def simulate_tamper(
    req: TamperRequest,
    current_user: User = Depends(require_role("admin")),
):
    _ = current_user
    if req.block_index < len(blockchain.chain):
        block = blockchain.chain[req.block_index]
        if req.tx_index < len(block.transactions):
            block.transactions[req.tx_index]["tx_data"]["amount"] = req.new_amount
            await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
            await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
            return {"status": "success", "message": "Block tampered."}
    raise HTTPException(status_code=404, detail="Block or Transaction not found.")


@router.post("/continue")
async def continue_after_tamper(
    req: ContinuityRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin", "operator")),
):
    archived_epoch = blockchain.archive_compromised_epoch(
        req.reason or "Operator archived a compromised epoch and started a continuity ledger."
    )
    if not archived_epoch:
        return {
            "status": "noop",
            "message": "Ledger is healthy. No continuity rollover was required.",
            "active_epoch_id": blockchain.active_epoch_id,
        }

    create_audit_log(
        db,
        current_user.username,
        current_user.role,
        "continue_blockchain_epoch",
        f"epoch:{archived_epoch['epoch_id']}",
        "Compromised epoch preserved for forensics and the active ledger continued from the last trusted block.",
    )
    state = get_or_create_system_state(db)
    state.ledger_status = "healthy"
    state.ledger_note = "Compromised epoch archived. Active settlement continues from the last trusted block."
    state.last_reset_type = "continuity-rollover"
    state.last_reset_at = time.time()
    db.commit()
    await manager.broadcast({"type": "BLOCKCHAIN_UPDATE"})
    await manager.broadcast({"type": "BALANCE_UPDATE"})
    await manager.broadcast({"type": "NETWORK_STATE_UPDATE"})
    return {
        "status": "success",
        "message": "Compromised epoch archived. Active settlement now continues from the last trusted block.",
        "archived_epoch_id": archived_epoch["epoch_id"],
        "active_epoch_id": blockchain.active_epoch_id,
    }


@router.get("/balances")
def get_blockchain_balances(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    _ = db.query(User).count()
    return blockchain.get_trusted_balances()

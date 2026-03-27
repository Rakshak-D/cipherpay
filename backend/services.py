import json
import time
import uuid

from sqlalchemy.orm import Session

from backend.core.attack_engine import attack_engine
from backend.core.crypto_utils import sign_data
from backend.core.key_store import load_private_key
from backend.core.ledger_state import blockchain
from backend.core.network_state import network_state
from backend.core.payment_flows import list_payment_templates
from backend.core.settings import DEMO_SCENARIOS, DEFAULT_USERS, VISIBLE_SYSTEM_COPY, settings
from backend.models import AuditLog, Balance, SecurityEvent, SystemState, TransactionRecord, User
from backend.seed import seed_db


def get_or_create_system_state(db: Session) -> SystemState:
    state = db.query(SystemState).filter(SystemState.id == 1).first()
    if not state:
        state = SystemState(id=1)
        db.add(state)
        db.commit()
        db.refresh(state)
    return state


def create_audit_log(db: Session, actor_username: str, actor_role: str, action: str, target: str, details: str):
    log = AuditLog(
        actor_username=actor_username,
        actor_role=actor_role,
        action=action,
        target=target,
        details=details,
    )
    db.add(log)
    db.commit()
    return log


def _current_balances(db: Session) -> dict[int, float]:
    return {row.user_id: float(row.balance) for row in db.query(Balance).all()}


def _chain_balance_source() -> str:
    if not blockchain.is_chain_valid():
        return "last_trusted_block"
    if blockchain.archived_epochs:
        return "continuity_epoch"
    return "active_chain"


def set_ledger_anchor(db: Session, balances: dict[int, float]):
    state = get_or_create_system_state(db)
    state.ledger_anchor_balances = json.dumps({str(user_id): float(value) for user_id, value in balances.items()})
    db.commit()


def _load_ledger_anchor(db: Session) -> dict[int, float]:
    state = get_or_create_system_state(db)
    if not state.ledger_anchor_balances:
        balances = _current_balances(db)
        set_ledger_anchor(db, balances)
        return balances
    try:
        parsed = json.loads(state.ledger_anchor_balances)
    except json.JSONDecodeError:
        balances = _current_balances(db)
        set_ledger_anchor(db, balances)
        return balances
    return {int(user_id): float(value) for user_id, value in parsed.items()}


def _blockchain_balances() -> tuple[dict[int, float], bool]:
    if not blockchain.initial_balances:
        return {}, False
    return {
        int(user_id): float(balance)
        for user_id, balance in blockchain.get_trusted_balances().items()
    }, True


def rebuild_blockchain_state(db: Session):
    anchor_balances = _load_ledger_anchor(db)
    blockchain.reset_chain()
    blockchain.configure_initial_balances(anchor_balances)

    successful_records = (
        db.query(TransactionRecord)
        .filter(
            TransactionRecord.mode == "blockchain",
            TransactionRecord.status.in_(("success", "partial_protected")),
        )
        .order_by(TransactionRecord.timestamp.asc(), TransactionRecord.id.asc())
        .all()
    )

    for record in successful_records:
        tx_data = {
            "id": record.tx_uuid,
            "sender_id": record.sender_id,
            "recipient_id": record.recipient_id,
            "amount": float(record.amount),
            "payment_template_id": record.payment_type,
        }
        blockchain.add_historical_transaction(tx_data)


def serialize_users(db: Session):
    db_balances = _current_balances(db)
    chain_balances, chain_balance_available = _blockchain_balances()
    mode = network_state.mode
    chain_balance_source = _chain_balance_source()
    users = db.query(User).order_by(User.id.asc()).all()
    serialized = []

    for user in users:
        db_balance = db_balances.get(user.id, 0.0)
        chain_balance = chain_balances.get(user.id) if chain_balance_available else None
        balance_difference = None if chain_balance is None else round(chain_balance - db_balance, 2)
        spendable_balance = (
            chain_balance if mode == "blockchain" and chain_balance is not None
            else db_balance if mode == "centralized"
            else None
        )
        spendable_source = (
            chain_balance_source if mode == "blockchain" and chain_balance is not None
            else "database" if mode == "centralized"
            else "unavailable"
        )
        serialized.append(
            {
                "id": user.id,
                "name": user.name,
                "username": user.username,
                "role": user.role,
                "is_active": user.is_active,
                "is_admin": user.is_admin,
                "is_attacker": user.is_attacker,
                "public_key": user.public_key,
                "balance": spendable_balance,
                "spendable_balance": spendable_balance,
                "spendable_balance_source": spendable_source,
                "database_balance": db_balance,
                "chain_balance": chain_balance,
                "chain_balance_available": chain_balance is not None,
                "balance_difference": balance_difference,
                "chain_balance_source": chain_balance_source,
            }
        )

    return serialized


def build_balance_snapshot(db: Session, user_ids: list[int] | None = None):
    users = serialize_users(db)
    if user_ids is None:
        return users
    wanted = {int(user_id) for user_id in user_ids}
    return [user for user in users if user["id"] in wanted]


def _derive_transaction_source(record: TransactionRecord) -> str:
    if record.source:
        return record.source
    if record.status in {"intercepted", "rejected"} and record.mode == "blockchain":
        return "attack"
    if record.reason and "insider" in record.reason.lower():
        return "admin"
    return "user"


def _derive_transaction_stage(record: TransactionRecord) -> str:
    if record.stage:
        return record.stage
    if record.status in {"success", "partial_protected"}:
        return "settled_on_chain" if record.mode == "blockchain" else "cleared"
    if record.status == "rejected":
        return "rejected"
    if record.status == "intercepted":
        return "validated"
    return "submitted"


def _derive_transaction_explanation(record: TransactionRecord) -> str:
    if record.explanation:
        return record.explanation
    if record.reason:
        return record.reason
    if record.mode == "blockchain" and record.status in {"success", "partial_protected"}:
        return "The transfer was signed, verified, added to the ledger, and mined into a block."
    if record.mode == "centralized" and record.status == "success":
        return "The transfer was cleared directly against the operational database."
    if record.status == "partial_protected":
        return "The requested transfer settled, and additional attack activity was blocked and logged."
    if record.status == "intercepted":
        return "The simulator altered the transfer to demonstrate how insecure clearing can be exploited."
    return "The system processed this transaction through the current settlement flow."


def _derive_display_status(status: str, kind: str) -> str:
    if kind == "security_event":
        return status.replace("_", " ")
    return {
        "success": "Settled",
        "partial_protected": "Settled with blocked attack",
        "rejected": "Rejected",
        "intercepted": "Compromised settlement",
    }.get(status, status.replace("_", " "))


def create_security_event(
    db: Session,
    *,
    parent_tx_uuid: str,
    mode: str,
    security_event_type: str,
    title: str,
    summary: str,
    status: str,
    sender_id: int | None = None,
    recipient_id: int | None = None,
    amount: float | None = None,
):
    event = SecurityEvent(
        parent_tx_uuid=parent_tx_uuid,
        mode=mode,
        sender_id=sender_id,
        recipient_id=recipient_id,
        amount=amount,
        status=status,
        security_event_type=security_event_type,
        title=title,
        summary=summary,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def serialize_transactions(db: Session):
    payment_records = db.query(TransactionRecord).all()
    security_events = db.query(SecurityEvent).all()
    chain_status = "paused" if not blockchain.is_chain_valid() else "healthy"
    items = []

    for record in payment_records:
        items.append(
            {
                "id": f"payment-{record.id}",
                "kind": "payment",
                "parent_tx_uuid": None,
                "tx_uuid": record.tx_uuid,
                "sender_id": record.sender_id,
                "recipient_id": record.recipient_id,
                "intended_recipient_id": record.intended_recipient_id or record.recipient_id,
                "amount": record.amount,
                "sender_impact_amount": (
                    record.sender_impact_amount if record.sender_impact_amount is not None else record.amount
                ),
                "recipient_impact_amount": (
                    record.recipient_impact_amount if record.recipient_impact_amount is not None else record.amount
                ),
                "mode": record.mode,
                "status": record.status,
                "display_status": _derive_display_status(record.status, "payment"),
                "timestamp": record.timestamp,
                "reason": record.reason,
                "source": _derive_transaction_source(record),
                "stage": _derive_transaction_stage(record),
                "explanation": _derive_transaction_explanation(record),
                "balance_source": record.balance_source or ("blockchain" if record.mode == "blockchain" else "database"),
                "chain_status": record.chain_status or chain_status,
                "initiated_by": record.initiated_by or f"wallet:{record.sender_id}",
                "payment_type": record.payment_type or "operational_transfer",
                "payment_label": record.payment_label or "Operational transfer",
                "reference_label": record.reference_label or record.tx_uuid,
                "business_context": record.business_context,
                "security_event_type": None,
            }
        )

    for event in security_events:
        items.append(
            {
                "id": f"security-{event.id}",
                "kind": "security_event",
                "parent_tx_uuid": event.parent_tx_uuid,
                "tx_uuid": event.parent_tx_uuid,
                "sender_id": event.sender_id,
                "recipient_id": event.recipient_id,
                "intended_recipient_id": event.recipient_id,
                "amount": event.amount,
                "sender_impact_amount": 0.0,
                "recipient_impact_amount": 0.0,
                "mode": event.mode,
                "status": event.status,
                "display_status": _derive_display_status(event.status, "security_event"),
                "timestamp": event.timestamp,
                "reason": event.summary,
                "source": event.source or "attack",
                "stage": "security_review",
                "explanation": event.summary,
                "balance_source": "security_event",
                "chain_status": chain_status,
                "initiated_by": "security-monitor",
                "payment_type": "security_event",
                "payment_label": event.title,
                "reference_label": event.parent_tx_uuid,
                "business_context": None,
                "security_event_type": event.security_event_type,
            }
        )

    return sorted(items, key=lambda item: (item["timestamp"], item["id"]), reverse=True)


def _scenario_summaries():
    return [
        {
            "id": item["id"],
            "name": item["name"],
            "description": item["description"],
            "mode": item["mode"],
        }
        for item in DEMO_SCENARIOS.values()
    ]


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


def _recoverability_metadata(state: SystemState):
    is_valid = blockchain.is_chain_valid()
    return {
        "is_valid": is_valid,
        "is_paused": not is_valid,
        "can_reset_ledger": True,
        "can_reset_system": True,
        "can_start_continuity_epoch": not is_valid,
        "status": "forensic_mode" if not is_valid else "healthy",
        "note": state.ledger_note,
        "last_reset_type": state.last_reset_type,
        "last_reset_at": state.last_reset_at,
        "current_scenario": state.current_scenario,
    }


def get_network_overview(db: Session, current_user: User | None = None):
    state = get_or_create_system_state(db)
    state.current_mode = network_state.mode
    state.ledger_status = "paused" if not blockchain.is_chain_valid() else "healthy"
    if not blockchain.is_chain_valid() and not state.ledger_note:
        state.ledger_note = (
            "Historical tampering detected. Chain balances are frozen at the last trusted block until you"
            " start a continuity epoch or reset the ledger."
        )
    db.commit()
    db.refresh(state)

    users = serialize_users(db)
    transactions = serialize_transactions(db)
    payment_transactions = [tx for tx in transactions if tx["kind"] == "payment"]
    invalid_index = blockchain.get_invalid_index()
    total_volume = sum(
        float(tx["recipient_impact_amount"] or 0.0)
        for tx in payment_transactions
        if tx["status"] != "rejected"
    )
    active_attacks = [name for name, enabled in attack_engine.attacks_enabled.items() if enabled]
    drifted_wallets = [
        user for user in users
        if user["balance_difference"] is not None and abs(float(user["balance_difference"])) > 0.009
    ]
    recent_audit_items = (
        db.query(AuditLog)
        .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .limit(10)
        .all()
    )
    active_alerts = []

    if invalid_index is not None:
        active_alerts.append(
            {
                "id": "ledger-forensic",
                "title": "Ledger forensic mode",
                "severity": "high",
                "message": f"Historical block tampering was detected from block {invalid_index}.",
                "recommended_action": (
                    "Balances are now frozen at the last trusted block. Archive the compromised epoch into"
                    " continuity mode or reset the ledger before accepting more blockchain settlements."
                ),
            }
        )
    if blockchain.archived_epochs:
        active_alerts.append(
            {
                "id": "continuity-epochs",
                "title": "Continuity ledger active",
                "severity": "low",
                "message": f"{len(blockchain.archived_epochs)} compromised epoch(s) were preserved while the active branch continues from the last trusted block.",
                "recommended_action": "Review archived epochs in the explorer while continuing to settle on the active epoch.",
            }
        )
    if drifted_wallets:
        active_alerts.append(
            {
                "id": "balance-drift",
                "title": "Balance drift detected",
                "severity": "medium",
                "message": f"{len(drifted_wallets)} wallet(s) differ between database and chain balances.",
                "recommended_action": "Use blockchain mode for verification and inspect the affected wallets.",
            }
        )
    if active_attacks:
        active_alerts.append(
            {
                "id": "attack-simulation",
                "title": "Training mode active",
                "severity": "medium",
                "message": f"Enabled attack simulations: {', '.join(active_attacks)}.",
                "recommended_action": "Keep this on only for guided demos or resilience training.",
            }
        )

    if invalid_index is not None:
        recommended_mode = "centralized"
        next_action = "Start a continuity epoch to preserve forensic evidence and continue signed settlement from the last trusted block."
    elif blockchain.archived_epochs:
        recommended_mode = "blockchain"
        next_action = "Continue operating on the active epoch while reviewing archived compromised epochs in the explorer."
    elif active_attacks or drifted_wallets:
        recommended_mode = "blockchain"
        next_action = "Use blockchain mode to surface tampering, replay attempts, and balance drift."
    else:
        recommended_mode = network_state.mode
        next_action = "Run normal transfers or choose a training scenario to demonstrate a specific payment-control story."

    chain_balances, chain_balance_available = _blockchain_balances()

    return {
        "mode": network_state.mode,
        "users": users,
        "transactions": transactions,
        "attack_state": dict(attack_engine.attacks_enabled),
        "attack_logs": attack_engine.attack_logs[-50:][::-1],
        "blockchain": {
            "is_valid": invalid_index is None,
            "invalid_from_index": invalid_index,
            "height": len(blockchain.chain),
            "pending_transactions": len(blockchain.pending_transactions),
            "balances": chain_balances,
            "balance_available": chain_balance_available,
            "balance_source": _chain_balance_source(),
            "active_epoch_id": blockchain.active_epoch_id,
            "active_epoch_parent_id": blockchain.epoch_metadata.get(blockchain.active_epoch_id, {}).get("parent_epoch_id"),
            "active_epoch_started_at": blockchain.epoch_metadata.get(blockchain.active_epoch_id, {}).get("started_at"),
            "active_epoch_start_reason": blockchain.epoch_metadata.get(blockchain.active_epoch_id, {}).get("start_reason"),
            "active_epoch_fork_from_block": blockchain.epoch_metadata.get(blockchain.active_epoch_id, {}).get("fork_from_block"),
            "archived_epoch_count": len(blockchain.archived_epochs),
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
            "chain": [_serialize_block(block, invalid_index) for block in blockchain.chain],
        },
        "recoverability": _recoverability_metadata(state),
        "scenarios": _scenario_summaries(),
        "recent_audit_items": [
            {
                "id": item.id,
                "actor_username": item.actor_username,
                "actor_role": item.actor_role,
                "action": item.action,
                "target": item.target,
                "details": item.details,
                "timestamp": item.timestamp,
            }
            for item in recent_audit_items
        ],
        "metrics": {
            "user_count": len([user for user in users if not user["is_admin"]]),
            "transaction_count": len(transactions),
            "payment_count": len(payment_transactions),
            "security_event_count": len([tx for tx in transactions if tx["kind"] == "security_event"]),
            "total_volume": total_volume,
            "active_attack_count": len(active_attacks),
            "drifted_wallet_count": len(drifted_wallets),
        },
        "insights": {
            "recommended_mode": recommended_mode,
            "next_action": next_action,
            "active_alerts": active_alerts,
            "operational_focus": (
                "Best suited for merchant payouts, payroll approval flows, and treasury-grade settlement verification."
            ),
        },
        "config": {
            "currency_code": settings.currency_code,
            "currency_symbol": settings.currency_symbol,
            "visible_copy": VISIBLE_SYSTEM_COPY,
            "payment_templates": list_payment_templates(),
        },
        "current_user": None if not current_user else {
            "id": current_user.id,
            "name": current_user.name,
            "username": current_user.username,
            "role": current_user.role,
        },
    }


def _set_balances(db: Session, balances: dict[int, float]):
    for row in db.query(Balance).all():
        if row.user_id in balances:
            row.balance = float(balances[row.user_id])
    db.commit()


def clear_transaction_history(db: Session):
    db.query(TransactionRecord).delete()
    db.query(SecurityEvent).delete()
    db.commit()


def reset_runtime_state(
    db: Session,
    *,
    clear_transactions: bool,
    use_current_balances: bool,
    current_scenario: str = "clean-startup",
    note: str = "Ledger reset.",
):
    if clear_transactions:
        clear_transaction_history(db)

    attack_engine.clear_logs()
    attack_engine.clear_attacks()
    network_state.set_mode("centralized")

    if not use_current_balances:
        configured = {user["id"]: float(user["balance"]) for user in DEFAULT_USERS}
        _set_balances(db, configured)

    balances = _current_balances(db)
    set_ledger_anchor(db, balances)
    blockchain.reset_chain()
    blockchain.configure_initial_balances(balances)

    users = db.query(User).order_by(User.id.asc()).all()
    attacker = next((user for user in users if user.is_attacker), None)
    if attacker:
        attack_engine.configure_attacker_wallet(attacker.id)

    state = get_or_create_system_state(db)
    state.current_mode = network_state.mode
    state.current_scenario = current_scenario
    state.last_reset_type = "ledger"
    state.last_reset_at = time.time()
    state.ledger_status = "healthy"
    state.ledger_note = note
    db.commit()


def update_user_balance(db: Session, user_id: int, new_balance: float):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise ValueError("User not found.")

    balance_row = db.query(Balance).filter(Balance.user_id == user_id).first()
    if not balance_row:
        raise ValueError("Balance record not found.")

    balance_row.balance = float(new_balance)
    db.commit()
    db.refresh(balance_row)
    return user


def full_system_reset():
    seed_db()


def _seed_blockchain_transaction(db: Session, sender_id: int, recipient_id: int, amount: float):
    sender = db.query(User).filter(User.id == sender_id).first()
    if not sender:
        return

    private_key = load_private_key(sender_id)
    if not private_key:
        return

    tx_data = {
        "id": f"scenario-{uuid.uuid4()}",
        "sender_id": sender_id,
        "recipient_id": recipient_id,
        "amount": amount,
    }
    signature = sign_data(private_key, tx_data)
    result = blockchain.add_transaction(tx_data, signature, sender.public_key)
    db.add(
        TransactionRecord(
            tx_uuid=tx_data["id"],
            sender_id=sender_id,
            recipient_id=recipient_id,
            intended_recipient_id=recipient_id,
            amount=amount,
            sender_impact_amount=amount,
            recipient_impact_amount=amount,
            mode="blockchain",
            status=result["status"],
            reason=result.get("reason"),
            source="system",
            stage="settled_on_chain" if result["status"] == "success" else "rejected",
            explanation="Scenario preset created a sample blockchain settlement.",
            balance_source="blockchain",
            chain_status="healthy",
            initiated_by="system:scenario",
        )
    )
    db.commit()
    if result["status"] == "success":
        blockchain.mine_block()


def apply_scenario(db: Session, scenario_id: str):
    scenario = DEMO_SCENARIOS.get(scenario_id)
    if not scenario:
        raise ValueError("Unknown scenario.")

    reset_runtime_state(
        db,
        clear_transactions=scenario.get("clear_history", True),
        use_current_balances=False if scenario.get("balances") is None else True,
        current_scenario=scenario_id,
        note=f"Scenario '{scenario['name']}' applied.",
    )

    if scenario.get("balances"):
        _set_balances(db, {int(k): float(v) for k, v in scenario["balances"].items()})
        if scenario.get("reanchor_chain", True):
            balances = _current_balances(db)
            set_ledger_anchor(db, balances)
            blockchain.reset_chain()
            blockchain.configure_initial_balances(balances)

    network_state.set_mode(scenario["mode"])
    attack_engine.clear_attacks()
    attack_engine.clear_logs()
    for attack_type, state in scenario["attacks"].items():
        attack_engine.toggle_attack(attack_type, state)

    if scenario.get("seed_transaction"):
        sample = scenario["seed_transaction"]
        _seed_blockchain_transaction(db, sample["sender_id"], sample["recipient_id"], sample["amount"])

    if scenario_id == "insider-db-drift":
        balance_row = db.query(Balance).filter(Balance.user_id == 2).first()
        if balance_row:
            balance_row.balance -= settings.insider_adjustment
            db.commit()

    if scenario.get("tamper_chain") and len(blockchain.chain) > 1 and blockchain.chain[1].transactions:
        blockchain.chain[1].transactions[0]["tx_data"]["amount"] += 15

    state = get_or_create_system_state(db)
    state.current_mode = network_state.mode
    state.current_scenario = scenario_id
    state.last_reset_type = "scenario"
    state.last_reset_at = time.time()
    state.ledger_status = "paused" if not blockchain.is_chain_valid() else "healthy"
    state.ledger_note = scenario["description"]
    db.commit()

    return scenario

import time

from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    username = Column(String, unique=True, index=True, nullable=True)
    password_hash = Column(String, nullable=True)
    role = Column(String, default="viewer")
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    is_attacker = Column(Boolean, default=False)
    public_key = Column(Text, nullable=True)

    balance_record = relationship("Balance", back_populates="user", uselist=False)


class Balance(Base):
    __tablename__ = "balances"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    balance = Column(Float, default=0.0)

    user = relationship("User", back_populates="balance_record")


class TransactionRecord(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    tx_uuid = Column(String, unique=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"))
    recipient_id = Column(Integer, ForeignKey("users.id"))
    amount = Column(Float)
    sender_impact_amount = Column(Float, default=0.0)
    recipient_impact_amount = Column(Float, default=0.0)
    intended_recipient_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    timestamp = Column(Float, default=time.time)
    mode = Column(String)
    status = Column(String)
    reason = Column(Text, nullable=True)
    source = Column(String, default="user")
    stage = Column(String, default="submitted")
    explanation = Column(Text, nullable=True)
    balance_source = Column(String, default="database")
    chain_status = Column(String, default="healthy")
    initiated_by = Column(String, nullable=True)
    payment_type = Column(String, nullable=True)
    payment_label = Column(String, nullable=True)
    reference_label = Column(String, nullable=True)
    business_context = Column(Text, nullable=True)


class SecurityEvent(Base):
    __tablename__ = "security_events"

    id = Column(Integer, primary_key=True, index=True)
    parent_tx_uuid = Column(String, index=True, nullable=False)
    timestamp = Column(Float, default=time.time)
    mode = Column(String, nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    amount = Column(Float, nullable=True)
    source = Column(String, default="attack")
    status = Column(String, default="observed")
    security_event_type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    summary = Column(Text, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_username = Column(String, nullable=False)
    actor_role = Column(String, nullable=False)
    action = Column(String, nullable=False)
    target = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    timestamp = Column(Float, default=time.time)


class SystemState(Base):
    __tablename__ = "system_state"

    id = Column(Integer, primary_key=True, default=1)
    current_mode = Column(String, default="centralized")
    current_scenario = Column(String, default="clean-startup")
    last_reset_type = Column(String, default="system")
    last_reset_at = Column(Float, default=time.time)
    ledger_status = Column(String, default="healthy")
    ledger_note = Column(Text, nullable=True)
    ledger_anchor_balances = Column(Text, nullable=True)

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON, BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid, func, text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

PREFIX_CHECK = "length(device_prefix) BETWEEN 6 AND 24 AND device_prefix = upper(device_prefix) AND device_prefix LIKE '%-%'"
EVENT_TYPES = ("attendance.check_in", "pos.cash_sale", "shift.arqueo_close", "shift.open")
FLAG_KINDS = (
    "inventory_variance", "price_drift", "cash_discrepancy", "clock_skew", "unverified_clock",
    "entitlement_denied_on_sync", "actor_not_authorized", "orphan_shift_reference", "linked_check_in",
)


def _in(values: tuple[str, ...]) -> str:
    return "(" + ", ".join(f"'{value}'" for value in values) + ")"


class SyncDevice(Base):
    """Provisioned reception device allowed to upload contingency events (token stored as sha256 only)."""

    __tablename__ = "sync_devices"
    __table_args__ = (
        CheckConstraint("length(token_digest) = 64", name="ck_sync_devices_digest"),
        CheckConstraint("last_ingested_seq >= 0", name="ck_sync_devices_seq_nonnegative"),
        CheckConstraint(PREFIX_CHECK, name="ck_sync_devices_prefix"),
        Index("uq_sync_devices_token_digest", "token_digest", unique=True),
        Index("uq_sync_devices_active_prefix", "device_prefix", unique=True,
              postgresql_where=text("revoked_at IS NULL"), sqlite_where=text("revoked_at IS NULL")),
        Index("ix_sync_devices_branch", "branch_id", "device_prefix"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    reception_station_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("reception_stations.id", ondelete="RESTRICT"))
    device_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    token_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    provisioned_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_ingested_seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class ContingencyEvent(Base):
    """Journal row for one uploaded offline event; the original payload is kept verbatim."""

    __tablename__ = "contingency_events"
    __table_args__ = (
        CheckConstraint(f"event_type IN {_in(EVENT_TYPES)}", name="ck_contingency_events_type"),
        CheckConstraint("status IN ('accepted', 'flagged_audit', 'rejected')", name="ck_contingency_events_status"),
        CheckConstraint("seq >= 1", name="ck_contingency_events_seq_positive"),
        CheckConstraint("length(payload_hash) = 64", name="ck_contingency_events_hash_length"),
        UniqueConstraint("event_id", name="uq_contingency_events_event_id"),
        UniqueConstraint("device_id", "seq", name="uq_contingency_events_device_seq"),
        Index("ix_contingency_events_result_shift", "result_shift_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    device_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("sync_devices.id", ondelete="RESTRICT"), nullable=False)
    event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    client_recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    clock_anchor_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    clock_monotonic_delta_ms: Mapped[int | None] = mapped_column(BigInteger)
    server_received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    reason_code: Mapped[str | None] = mapped_column(String(64))
    result_order_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="RESTRICT"))
    result_check_in_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("member_check_ins.id", ondelete="RESTRICT"))
    result_shift_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"))


class SyncAuditFlag(Base):
    """Reconciliation flag tied to an ingested event; only resolved_at/resolved_by are ever updated."""

    __tablename__ = "sync_audit_flags"
    __table_args__ = (
        CheckConstraint(f"kind IN {_in(FLAG_KINDS)}", name="ck_sync_audit_flags_kind"),
        Index("ix_sync_audit_flags_branch_open", "branch_id", "resolved_at"),
        Index("ix_sync_audit_flags_shift", "shift_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    event_row_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("contingency_events.id", ondelete="RESTRICT"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False)
    shift_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("shifts.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"))

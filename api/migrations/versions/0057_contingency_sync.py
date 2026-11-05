"""Contingency (offline) sync: devices, immutable event journal, audit flags, order origin, product updated_at.

Revision ID: 0057_contingency_sync
Revises: 0056_gimi_knowledge
"""
from alembic import op
import sqlalchemy as sa

revision = "0057_contingency_sync"
down_revision = "0056_gimi_knowledge"
branch_labels = None
depends_on = None

_AUDIT_OLD = "action IN ('member_read', 'member_write', 'finance_read', 'shift_post', 'staff_authorization_changed')"
_AUDIT_NEW = ("action IN ('member_read', 'member_write', 'finance_read', 'shift_post', "
              "'staff_authorization_changed', 'sync_ingest')")
_PREFIX_CHECK = "length(device_prefix) BETWEEN 6 AND 24 AND device_prefix = upper(device_prefix) AND device_prefix LIKE '%-%'"
_EVENT_TYPES = "('attendance.check_in', 'pos.cash_sale', 'shift.arqueo_close', 'shift.open')"
_FLAG_KINDS = ("('inventory_variance', 'price_drift', 'cash_discrepancy', 'clock_skew', 'unverified_clock', "
               "'entitlement_denied_on_sync', 'actor_not_authorized', 'orphan_shift_reference', 'linked_check_in')")


def upgrade() -> None:
    op.create_table(
        "sync_devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("reception_station_id", sa.Uuid(), nullable=True),
        sa.Column("device_prefix", sa.String(length=32), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("provisioned_by", sa.Uuid(), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_ingested_seq", sa.Integer(), server_default="0", nullable=False),
        sa.CheckConstraint("length(token_digest) = 64", name="ck_sync_devices_digest"),
        sa.CheckConstraint("last_ingested_seq >= 0", name="ck_sync_devices_seq_nonnegative"),
        sa.CheckConstraint(_PREFIX_CHECK, name="ck_sync_devices_prefix"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reception_station_id"], ["reception_stations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["provisioned_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_sync_devices_token_digest", "sync_devices", ["token_digest"], unique=True)
    op.create_index(
        "uq_sync_devices_active_prefix", "sync_devices", ["device_prefix"], unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"), sqlite_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index("ix_sync_devices_branch", "sync_devices", ["branch_id", "device_prefix"])

    op.create_table(
        "contingency_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("actor_staff_id", sa.Uuid(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("client_recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clock_anchor_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clock_monotonic_delta_ms", sa.BigInteger(), nullable=True),
        sa.Column("server_received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reason_code", sa.String(length=64), nullable=True),
        sa.Column("result_order_id", sa.Uuid(), nullable=True),
        sa.Column("result_check_in_id", sa.Uuid(), nullable=True),
        sa.Column("result_shift_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(f"event_type IN {_EVENT_TYPES}", name="ck_contingency_events_type"),
        sa.CheckConstraint("status IN ('accepted', 'flagged_audit', 'rejected')", name="ck_contingency_events_status"),
        sa.CheckConstraint("seq >= 1", name="ck_contingency_events_seq_positive"),
        sa.CheckConstraint("length(payload_hash) = 64", name="ck_contingency_events_hash_length"),
        sa.ForeignKeyConstraint(["device_id"], ["sync_devices.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_staff_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["result_order_id"], ["orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["result_check_in_id"], ["member_check_ins.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["result_shift_id"], ["shifts.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_contingency_events_event_id"),
        sa.UniqueConstraint("device_id", "seq", name="uq_contingency_events_device_seq"),
    )
    op.create_index("ix_contingency_events_result_shift", "contingency_events", ["result_shift_id"])

    op.create_table(
        "sync_audit_flags",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_row_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("shift_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(f"kind IN {_FLAG_KINDS}", name="ck_sync_audit_flags_kind"),
        sa.ForeignKeyConstraint(["event_row_id"], ["contingency_events.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["shift_id"], ["shifts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["resolved_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sync_audit_flags_branch_open", "sync_audit_flags", ["branch_id", "resolved_at"])
    op.create_index("ix_sync_audit_flags_shift", "sync_audit_flags", ["shift_id"])

    with op.batch_alter_table("orders") as batch:
        batch.add_column(sa.Column("offline_receipt_number", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("origin", sa.String(length=16), server_default="online", nullable=False))
        batch.create_unique_constraint("uq_orders_offline_receipt_number", ["offline_receipt_number"])
        batch.create_check_constraint("ck_orders_origin", "origin IN ('online', 'contingency')")

    with op.batch_alter_table("products") as batch:
        batch.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))

    with op.batch_alter_table("audit_events") as batch:
        batch.drop_constraint("ck_audit_events_action", type_="check")
        batch.create_check_constraint("ck_audit_events_action", _AUDIT_NEW)


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM audit_events WHERE action = 'sync_ingest' LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade while sync_ingest audit events exist")
    if connection.execute(sa.text("SELECT 1 FROM orders WHERE origin = 'contingency' LIMIT 1")).first():
        raise RuntimeError("Cannot downgrade while contingency orders exist")
    with op.batch_alter_table("audit_events") as batch:
        batch.drop_constraint("ck_audit_events_action", type_="check")
        batch.create_check_constraint("ck_audit_events_action", _AUDIT_OLD)
    with op.batch_alter_table("products") as batch:
        batch.drop_column("updated_at")
    with op.batch_alter_table("orders") as batch:
        batch.drop_constraint("ck_orders_origin", type_="check")
        batch.drop_constraint("uq_orders_offline_receipt_number", type_="unique")
        batch.drop_column("origin")
        batch.drop_column("offline_receipt_number")
    op.drop_table("sync_audit_flags")
    op.drop_table("contingency_events")
    op.drop_table("sync_devices")

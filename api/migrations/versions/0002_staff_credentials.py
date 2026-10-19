"""Add minimal staff PIN credential and pending security-event tables.

Revision ID: 0002_staff_credentials
Revises: 0001_baseline
"""
from alembic import op
import sqlalchemy as sa


revision = "0002_staff_credentials"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "staff_users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("login_identifier", sa.String(length=320), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "length(login_identifier) > 0 AND login_identifier = lower(trim(login_identifier))",
            name="ck_staff_users_login_identifier_normalized",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("login_identifier", name="uq_staff_users_login_identifier"),
    )
    op.create_table(
        "staff_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("method", sa.String(length=16), server_default="pin", nullable=False),
        sa.Column("secret_hash", sa.String(length=255), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("method = 'pin'", name="ck_staff_credentials_supported_method"),
        sa.CheckConstraint("failed_attempts >= 0 AND failed_attempts <= 5", name="ck_staff_credentials_failed_attempts"),
        sa.CheckConstraint("length(secret_hash) >= 50", name="ck_staff_credentials_hash_nonempty"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("staff_id", "method", name="uq_staff_credentials_staff_method"),
    )
    op.create_table(
        "security_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(length=32), server_default="staff_pin_lockout", nullable=False),
        sa.Column("delivery_status", sa.String(length=16), server_default="pending", nullable=False),
        sa.CheckConstraint("reason = 'staff_pin_lockout'", name="ck_security_events_reason"),
        sa.CheckConstraint("delivery_status = 'pending'", name="ck_security_events_pending_delivery"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("security_events")
    op.drop_table("staff_credentials")
    op.drop_table("staff_users")

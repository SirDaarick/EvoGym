"""Add minimal transaction-owned application audit events.

Revision ID: 0004_audit_events
Revises: 0003_authorization_sessions
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_audit_events"
down_revision = "0003_authorization_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "action IN ('member_read', 'member_write', 'finance_read', 'shift_post', 'staff_authorization_changed')",
            name="ck_audit_events_action",
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("audit_events")

"""Add Admin password authentication and single-use email recovery records.

Revision ID: 0005_admin_auth_recovery
Revises: 0004_audit_events
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_admin_auth_recovery"
down_revision = "0004_audit_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("staff_sessions") as batch:
        batch.alter_column("branch_id", existing_type=sa.Uuid(), nullable=True)
        batch.add_column(sa.Column("scope_kind", sa.String(16), server_default="branch", nullable=False))
        batch.add_column(sa.Column("auth_method", sa.String(24), server_default="pin", nullable=False))
        batch.create_check_constraint(
            "ck_staff_sessions_scope_method",
            "(scope_kind = 'branch' AND branch_id IS NOT NULL AND auth_method = 'pin') OR "
            "(scope_kind = 'organization' AND branch_id IS NULL AND auth_method = 'admin_password')",
        )
    op.create_table(
        "admin_password_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("recovery_email", sa.String(320), nullable=False),
        sa.Column("recovery_email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("failed_attempts >= 0 AND failed_attempts <= 5", name="ck_admin_password_failed_attempts"),
        sa.CheckConstraint("length(password_hash) >= 50", name="ck_admin_password_hash_nonempty"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("staff_id", name="uq_admin_password_staff"),
    )
    op.create_table(
        "admin_recovery_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("token_digest", sa.String(64), nullable=False),
        sa.Column("email_digest", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delivery_status", sa.String(16), server_default="pending", nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("expires_at > created_at", name="ck_admin_recovery_expiry"),
        sa.CheckConstraint("delivery_status IN ('pending', 'sent', 'failed')", name="ck_admin_recovery_delivery"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_recovery_token_digest", "admin_recovery_tokens", ["token_digest"], unique=True)
    op.create_index("ix_admin_recovery_staff", "admin_recovery_tokens", ["staff_id"])
    op.create_table(
        "admin_auth_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("subject_staff_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("action IN ('admin_password_login_succeeded', 'admin_password_recovered', 'admin_session_revoked')", name="ck_admin_auth_events_action"),
        sa.ForeignKeyConstraint(["actor_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["subject_staff_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("admin_auth_events")
    op.drop_index("ix_admin_recovery_staff", table_name="admin_recovery_tokens")
    op.drop_index("ix_admin_recovery_token_digest", table_name="admin_recovery_tokens")
    op.drop_table("admin_recovery_tokens")
    op.drop_table("admin_password_credentials")
    with op.batch_alter_table("staff_sessions") as batch:
        batch.drop_constraint("ck_staff_sessions_scope_method", type_="check")
        batch.drop_column("auth_method")
        batch.drop_column("scope_kind")
        batch.alter_column("branch_id", existing_type=sa.Uuid(), nullable=False)

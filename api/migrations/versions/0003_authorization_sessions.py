"""Create minimal branch authorization and opaque revocable staff sessions.

Revision ID: 0003_authorization_sessions
Revises: 0002_staff_credentials
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_authorization_sessions"
down_revision = "0002_staff_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "branches",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint("length(code) > 0 AND code = lower(trim(code))", name="ck_branches_code_normalized"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_branches_code"),
    )
    op.create_table(
        "staff_role_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("scope_kind", sa.String(length=16), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint("(role = 'admin' AND scope_kind IN ('organization', 'branch')) OR (role = 'receptionist' AND scope_kind = 'branch')", name="ck_staff_role_grants_role_scope"),
        sa.CheckConstraint("(scope_kind = 'organization' AND branch_id IS NULL) OR (scope_kind = 'branch' AND branch_id IS NOT NULL)", name="ck_staff_role_grants_branch_scope"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("staff_id", "role", "scope_kind", "branch_id", name="uq_staff_role_grants_scope"),
    )
    op.create_index(
        "uq_staff_role_grants_org_admin",
        "staff_role_grants",
        ["staff_id"],
        unique=True,
        postgresql_where=sa.text("role = 'admin' AND scope_kind = 'organization'"),
        sqlite_where=sa.text("role = 'admin' AND scope_kind = 'organization'"),
    )
    op.create_table(
        "staff_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("expires_at > issued_at", name="ck_staff_sessions_expiry_after_issue"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_sessions_token_digest", "staff_sessions", ["token_digest"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_staff_sessions_token_digest", table_name="staff_sessions")
    op.drop_table("staff_sessions")
    op.drop_index("uq_staff_role_grants_org_admin", table_name="staff_role_grants")
    op.drop_table("staff_role_grants")
    op.drop_table("branches")

"""Persist Admin device trust, approval attempts, and refresh state."""
from alembic import op
import sqlalchemy as sa


revision = "0031_admin_session_policy"
down_revision = "0030_staff_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("admin_password_credentials", sa.Column("is_owner", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_index("uq_admin_password_single_owner", "admin_password_credentials", ["is_owner"], unique=True,
                    postgresql_where=sa.text("is_owner"), sqlite_where=sa.text("is_owner = 1"))
    op.create_table(
        "admin_trusted_devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("cookie_digest", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("category IN ('computer', 'phone')", name="ck_admin_trusted_devices_category"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_trusted_devices_staff_category", "admin_trusted_devices", ["staff_id", "category"])
    op.create_index("ix_admin_trusted_devices_cookie_digest", "admin_trusted_devices", ["cookie_digest"], unique=True)
    op.create_table(
        "admin_login_approvals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("approval_token_digest", sa.String(length=64), nullable=False),
        sa.Column("poll_token_digest", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("category IN ('computer', 'phone')", name="ck_admin_login_approvals_category"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_login_approvals_staff_category", "admin_login_approvals", ["staff_id", "category"])
    op.create_index("ix_admin_login_approvals_link_digest", "admin_login_approvals", ["approval_token_digest"], unique=True)
    op.create_index("ix_admin_login_approvals_poll_digest", "admin_login_approvals", ["poll_token_digest"], unique=True)
    with op.batch_alter_table("staff_sessions") as batch:
        batch.add_column(sa.Column("admin_category", sa.String(length=16), nullable=True))
        batch.add_column(sa.Column("admin_trusted_device_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("refresh_token_digest", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("refresh_generation", sa.Integer(), server_default="0", nullable=False))
        batch.add_column(sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_check_constraint("ck_staff_sessions_refresh_generation", "refresh_generation >= 0")
        batch.create_foreign_key("fk_staff_sessions_admin_trusted_device_id_admin_trusted_devices", "admin_trusted_devices", ["admin_trusted_device_id"], ["id"], ondelete="SET NULL")
    with op.batch_alter_table("admin_auth_events") as batch:
        batch.drop_constraint("ck_admin_auth_events_action", type_="check")
        batch.create_check_constraint(
            "ck_admin_auth_events_action",
            "action IN ('admin_password_login_succeeded', 'admin_password_recovered', 'admin_session_revoked', "
            "'admin_device_approval_requested', 'admin_device_approved', 'admin_trusted_device_revoked', "
            "'admin_session_replaced', 'admin_refresh_reuse_detected', 'enrollment_code_issued', "
            "'enrollment_code_revoked', 'device_pairing_code_issued', 'device_paired', 'device_revoked')",
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("select count(*) from admin_password_credentials where is_owner = true")).scalar_one():
        raise RuntimeError("The owner designation is retained")
    if connection.execute(sa.text("select count(*) from staff_sessions where refresh_token_digest is not null or admin_trusted_device_id is not null")).scalar_one():
        raise RuntimeError("Admin session policy data is retained")
    if connection.execute(sa.text("select count(*) from admin_login_approvals")).scalar_one():
        raise RuntimeError("Admin login approval history is retained")
    if connection.execute(sa.text("select count(*) from admin_trusted_devices")).scalar_one():
        raise RuntimeError("Admin trusted device state is retained")
    with op.batch_alter_table("admin_auth_events") as batch:
        batch.drop_constraint("ck_admin_auth_events_action", type_="check")
        batch.create_check_constraint(
            "ck_admin_auth_events_action",
            "action IN ('admin_password_login_succeeded', 'admin_password_recovered', 'admin_session_revoked', "
            "'enrollment_code_issued', 'enrollment_code_revoked', 'device_pairing_code_issued', 'device_paired', 'device_revoked')",
        )
    with op.batch_alter_table("staff_sessions") as batch:
        batch.drop_constraint("fk_staff_sessions_admin_trusted_device_id_admin_trusted_devices", type_="foreignkey")
        batch.drop_constraint("ck_staff_sessions_refresh_generation", type_="check")
        batch.drop_column("absolute_expires_at")
        batch.drop_column("last_seen_at")
        batch.drop_column("refresh_generation")
        batch.drop_column("refresh_token_digest")
        batch.drop_column("admin_trusted_device_id")
        batch.drop_column("admin_category")
    op.drop_index("ix_admin_login_approvals_poll_digest", table_name="admin_login_approvals")
    op.drop_index("ix_admin_login_approvals_link_digest", table_name="admin_login_approvals")
    op.drop_index("ix_admin_login_approvals_staff_category", table_name="admin_login_approvals")
    op.drop_table("admin_login_approvals")
    op.drop_index("ix_admin_trusted_devices_cookie_digest", table_name="admin_trusted_devices")
    op.drop_index("ix_admin_trusted_devices_staff_category", table_name="admin_trusted_devices")
    op.drop_table("admin_trusted_devices")
    op.drop_index("uq_admin_password_single_owner", table_name="admin_password_credentials")
    op.drop_column("admin_password_credentials", "is_owner")

"""Add staff enrollment codes and staff device pairing and binding tables.

Revision ID: 0006_enrollment_and_devices
Revises: 0005_admin_auth_recovery
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_enrollment_and_devices"
down_revision = "0005_admin_auth_recovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Update check constraint on admin_auth_events to support enrollment and device actions
    with op.batch_alter_table("admin_auth_events") as batch:
        batch.drop_constraint("ck_admin_auth_events_action", type_="check")
        batch.create_check_constraint(
            "ck_admin_auth_events_action",
            "action IN ('admin_password_login_succeeded', 'admin_password_recovered', 'admin_session_revoked', "
            "'enrollment_code_issued', 'enrollment_code_revoked', 'device_pairing_code_issued', 'device_paired', 'device_revoked')",
        )

    # 1. Staff enrollment codes table
    op.create_table(
        "staff_enrollment_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("login_identifier", sa.String(320), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("expires_at > created_at", name="ck_staff_enrollment_codes_expiry"),
        sa.CheckConstraint("role IN ('admin', 'receptionist')", name="ck_staff_enrollment_codes_role"),
        sa.CheckConstraint("(role != 'receptionist') OR (branch_id IS NOT NULL)", name="ck_staff_enrollment_codes_receptionist_branch"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_enrollment_codes_lookup", "staff_enrollment_codes", ["code_hash"], unique=True)
    op.create_index("ix_staff_enrollment_codes_login", "staff_enrollment_codes", ["login_identifier"])

    # 2. Staff device pairing codes table
    op.create_table(
        "staff_device_pairing_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("expires_at > created_at", name="ck_staff_device_pairing_codes_expiry"),
        sa.CheckConstraint("failed_attempts >= 0 AND failed_attempts <= 3", name="ck_staff_device_pairing_codes_attempts"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_device_pairing_codes_staff", "staff_device_pairing_codes", ["staff_id"])
    op.create_index("ix_staff_device_pairing_codes_hash", "staff_device_pairing_codes", ["code_hash"])

    # 3. Staff paired devices table
    op.create_table(
        "staff_paired_devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("device_identifier_hash", sa.String(64), nullable=False),
        sa.Column("device_name", sa.String(128), nullable=False),
        sa.Column("paired_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_staff_paired_devices_staff", "staff_paired_devices", ["staff_id"])
    op.create_index(
        "uq_staff_active_paired_device",
        "staff_paired_devices",
        ["staff_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
        sqlite_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_staff_active_paired_device",
        table_name="staff_paired_devices",
        postgresql_where=sa.text("revoked_at IS NULL"),
        sqlite_where=sa.text("revoked_at IS NULL"),
    )
    op.drop_index("ix_staff_paired_devices_staff", table_name="staff_paired_devices")
    op.drop_table("staff_paired_devices")

    op.drop_index("ix_staff_device_pairing_codes_hash", table_name="staff_device_pairing_codes")
    op.drop_index("ix_staff_device_pairing_codes_staff", table_name="staff_device_pairing_codes")
    op.drop_table("staff_device_pairing_codes")

    op.drop_index("ix_staff_enrollment_codes_login", table_name="staff_enrollment_codes")
    op.drop_index("ix_staff_enrollment_codes_lookup", table_name="staff_enrollment_codes")
    op.drop_table("staff_enrollment_codes")

    with op.batch_alter_table("admin_auth_events") as batch:
        batch.drop_constraint("ck_admin_auth_events_action", type_="check")
        batch.create_check_constraint(
            "ck_admin_auth_events_action",
            "action IN ('admin_password_login_succeeded', 'admin_password_recovered', 'admin_session_revoked')",
        )

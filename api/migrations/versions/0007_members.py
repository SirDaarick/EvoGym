"""Add members table.

Revision ID: 0007_members
Revises: 0006_enrollment_and_devices
"""
from alembic import op
import sqlalchemy as sa

revision = "0007_members"
down_revision = "0006_enrollment_and_devices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_number", sa.String(32), nullable=False),
        sa.Column("full_name", sa.String(160), nullable=False),
        sa.Column("phone", sa.String(32), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("emergency_contact_name", sa.String(160), nullable=True),
        sa.Column("emergency_contact_phone", sa.String(32), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), server_default="active", nullable=False),
        sa.Column("joined_on", sa.Date(), server_default=sa.func.current_date(), nullable=False),
        sa.Column("credit_balance_minor", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("photo_url", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'inactive', 'expired', 'suspended', 'pending')",
            name="ck_members_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_members_member_number", "members", ["member_number"], unique=True)
    op.create_index("ix_members_full_name", "members", ["full_name"])
    op.create_index("ix_members_phone", "members", ["phone"])
    op.create_index("ix_members_status", "members", ["status"])


def downgrade() -> None:
    op.drop_index("ix_members_status", table_name="members")
    op.drop_index("ix_members_phone", table_name="members")
    op.drop_index("ix_members_full_name", table_name="members")
    op.drop_index("ix_members_member_number", table_name="members")
    op.drop_table("members")

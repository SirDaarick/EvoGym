"""Add member notes, eligibility records, and preferred_name to members.

Revision ID: 0008_member_notes_and_eligibility
Revises: 0007_members
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_member_notes_and_eligibility"
down_revision = "0007_members"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add preferred_name to members table
    with op.batch_alter_table("members") as batch:
        batch.add_column(sa.Column("preferred_name", sa.String(160), nullable=True))

    # 2. Create member_notes table
    op.create_table(
        "member_notes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["voided_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_member_notes_member_id", "member_notes", ["member_id"])

    # 3. Create member_eligibility_records table
    op.create_table(
        "member_eligibility_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("eligibility_type", sa.String(64), nullable=False),
        sa.Column("verified_by", sa.Uuid(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["verified_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["revoked_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_member_eligibility_records_member_id", "member_eligibility_records", ["member_id"])
    op.create_index("ix_member_eligibility_records_eligibility_type", "member_eligibility_records", ["eligibility_type"])


def downgrade() -> None:
    op.drop_index("ix_member_eligibility_records_eligibility_type", table_name="member_eligibility_records")
    op.drop_index("ix_member_eligibility_records_member_id", table_name="member_eligibility_records")
    op.drop_table("member_eligibility_records")

    op.drop_index("ix_member_notes_member_id", table_name="member_notes")
    op.drop_table("member_notes")

    with op.batch_alter_table("members") as batch:
        batch.drop_column("preferred_name")

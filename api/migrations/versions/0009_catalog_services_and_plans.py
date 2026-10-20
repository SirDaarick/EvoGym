"""Catalog services, plans, and plan versions.

Revision ID: 0009_catalog_services_and_plans
Revises: 0008_member_notes_and_eligibility
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_catalog_services_and_plans"
down_revision = "0008_member_notes_and_eligibility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create services table
    op.create_table(
        "services",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("status", sa.String(24), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_services_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_services_code", "services", ["code"], unique=True)
    op.create_index("ix_services_status", "services", ["status"])

    # 2. Create plans table
    op.create_table(
        "plans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(48), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("kind", sa.String(24), server_default="membership", nullable=False),
        sa.Column("status", sa.String(24), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('membership', 'visit')", name="ck_plans_kind"),
        sa.CheckConstraint("status IN ('active', 'inactive', 'archived')", name="ck_plans_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_plans_code", "plans", ["code"], unique=True)
    op.create_index("ix_plans_kind", "plans", ["kind"])
    op.create_index("ix_plans_status", "plans", ["status"])

    # 3. Create plan_versions table
    op.create_table(
        "plan_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("price_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), server_default="MXN", nullable=False),
        sa.Column("reference_amount_minor", sa.BigInteger(), nullable=True),
        sa.Column("duration_value", sa.Integer(), nullable=False),
        sa.Column("duration_unit", sa.String(16), nullable=False),
        sa.Column("eligibility_type", sa.String(64), nullable=True),
        sa.Column("restriction_notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("version_number > 0", name="ck_plan_versions_version_number"),
        sa.CheckConstraint("price_minor >= 0", name="ck_plan_versions_price_minor"),
        sa.CheckConstraint(
            "reference_amount_minor IS NULL OR reference_amount_minor >= 0",
            name="ck_plan_versions_ref_amount",
        ),
        sa.CheckConstraint("duration_value > 0", name="ck_plan_versions_duration_val"),
        sa.CheckConstraint(
            "duration_unit IN ('day', 'month', 'year')",
            name="ck_plan_versions_duration_unit",
        ),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plan_id", "version_number", name="uq_plan_versions_plan_version"),
    )
    op.create_index("ix_plan_versions_plan_id", "plan_versions", ["plan_id"])
    op.create_index("ix_plan_versions_eligibility_type", "plan_versions", ["eligibility_type"])
    op.create_index("ix_plan_versions_is_active", "plan_versions", ["is_active"])

    # 4. Create plan_version_services table
    op.create_table(
        "plan_version_services",
        sa.Column("plan_version_id", sa.Uuid(), nullable=False),
        sa.Column("service_id", sa.Uuid(), nullable=False),
        sa.Column("session_limit", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "session_limit IS NULL OR session_limit > 0",
            name="ck_plan_version_services_session_limit",
        ),
        sa.ForeignKeyConstraint(["plan_version_id"], ["plan_versions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["service_id"], ["services.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("plan_version_id", "service_id"),
    )


def downgrade() -> None:
    op.drop_table("plan_version_services")

    op.drop_index("ix_plan_versions_is_active", table_name="plan_versions")
    op.drop_index("ix_plan_versions_eligibility_type", table_name="plan_versions")
    op.drop_index("ix_plan_versions_plan_id", table_name="plan_versions")
    op.drop_table("plan_versions")

    op.drop_index("ix_plans_status", table_name="plans")
    op.drop_index("ix_plans_kind", table_name="plans")
    op.drop_index("ix_plans_code", table_name="plans")
    op.drop_table("plans")

    op.drop_index("ix_services_status", table_name="services")
    op.drop_index("ix_services_code", table_name="services")
    op.drop_table("services")

"""Add typed single-entry membership sales and retained entitlements."""
from alembic import op
import sqlalchemy as sa


revision = "0028_class_sample_entitlements"
down_revision = "0027_member_checkin_visits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("plan_versions") as batch:
        batch.add_column(sa.Column("entitlement_mode", sa.String(24), nullable=False, server_default="period"))
        batch.alter_column("duration_value", existing_type=sa.Integer(), nullable=True)
        batch.alter_column("duration_unit", existing_type=sa.String(16), nullable=True)
        batch.drop_constraint("ck_plan_versions_duration_val", type_="check")
        batch.drop_constraint("ck_plan_versions_duration_unit", type_="check")
        batch.create_check_constraint(
            "ck_plan_versions_duration_val",
            "(entitlement_mode = 'period' AND duration_value IS NOT NULL AND duration_value > 0 "
            "AND duration_unit IS NOT NULL AND duration_unit IN ('day', 'month', 'year')) OR "
            "(entitlement_mode = 'single_entry' AND duration_value IS NULL AND duration_unit IS NULL)",
        )
        batch.create_check_constraint("ck_plan_versions_entitlement_mode", "entitlement_mode IN ('period', 'single_entry')")
    with op.batch_alter_table("order_items") as batch:
        batch.add_column(sa.Column("entitlement_mode", sa.String(24), nullable=False, server_default="period"))
        batch.alter_column("duration_value", existing_type=sa.Integer(), nullable=True)
        batch.alter_column("duration_unit", existing_type=sa.String(16), nullable=True)
        batch.drop_constraint("ck_order_items_duration", type_="check")
        batch.create_check_constraint(
            "ck_order_items_duration",
            "(entitlement_mode = 'period' AND duration_value IS NOT NULL AND duration_value > 0 "
            "AND duration_unit IS NOT NULL AND duration_unit IN ('day', 'month', 'year')) OR "
            "(entitlement_mode = 'single_entry' AND duration_value IS NULL AND duration_unit IS NULL)",
        )
        batch.create_check_constraint("ck_order_items_entitlement_mode", "entitlement_mode IN ('period', 'single_entry')")
    op.create_table(
        "class_sample_entitlements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("order_item_id", sa.Uuid(), nullable=False),
        sa.Column("plan_version_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["plan_version_id"], ["plan_versions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("member_id", name="uq_class_sample_entitlements_member"),
        sa.UniqueConstraint("order_item_id", name="uq_class_sample_entitlements_order_item"),
    )
    op.create_index("ix_class_sample_entitlements_plan_version", "class_sample_entitlements", ["plan_version_id"])


def downgrade() -> None:
    connection = op.get_bind()
    entitlement_count = connection.execute(sa.text("SELECT count(*) FROM class_sample_entitlements")).scalar_one()
    plan_count = connection.execute(sa.text("SELECT count(*) FROM plan_versions WHERE entitlement_mode = 'single_entry'")).scalar_one()
    item_count = connection.execute(sa.text("SELECT count(*) FROM order_items WHERE entitlement_mode = 'single_entry'")).scalar_one()
    if entitlement_count or plan_count or item_count:
        raise RuntimeError("Cannot downgrade while single-entry plan, sale, or entitlement data exists.")
    op.drop_index("ix_class_sample_entitlements_plan_version", table_name="class_sample_entitlements")
    op.drop_table("class_sample_entitlements")
    with op.batch_alter_table("order_items") as batch:
        batch.drop_constraint("ck_order_items_entitlement_mode", type_="check")
        batch.drop_constraint("ck_order_items_duration", type_="check")
        batch.create_check_constraint("ck_order_items_duration", "duration_value > 0 AND duration_unit IN ('day', 'month', 'year')")
        batch.alter_column("duration_value", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("duration_unit", existing_type=sa.String(16), nullable=False)
        batch.drop_column("entitlement_mode")
    with op.batch_alter_table("plan_versions") as batch:
        batch.drop_constraint("ck_plan_versions_entitlement_mode", type_="check")
        batch.drop_constraint("ck_plan_versions_duration_val", type_="check")
        batch.create_check_constraint("ck_plan_versions_duration_val", "duration_value > 0")
        batch.create_check_constraint("ck_plan_versions_duration_unit", "duration_unit IN ('day', 'month', 'year')")
        batch.alter_column("duration_value", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("duration_unit", existing_type=sa.String(16), nullable=False)
        batch.drop_column("entitlement_mode")

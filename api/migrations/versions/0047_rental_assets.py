"""Individually identified branch rental assets."""
from alembic import op
import sqlalchemy as sa

revision = "0047_rental_assets"
down_revision = "0046_card_payments_point"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rental_assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("branch_id", sa.Uuid(), sa.ForeignKey("branches.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("price_minor", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="available"),
        sa.Column("color", sa.String(64)),
        sa.Column("ounces", sa.Integer()),
        sa.Column("locker_number", sa.Integer()),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("branch_id", "kind", "code", name="uq_rental_assets_code"),
        sa.UniqueConstraint("branch_id", "locker_number", name="uq_rental_assets_locker_number"),
        sa.CheckConstraint("kind IN ('glove', 'locker')", name="ck_rental_assets_kind"),
        sa.CheckConstraint("length(code) BETWEEN 1 AND 64 AND code = lower(trim(code))", name="ck_rental_assets_code"),
        sa.CheckConstraint("price_minor BETWEEN 0 AND 9223372036854775807", name="ck_rental_assets_price"),
        sa.CheckConstraint("status IN ('available', 'employee', 'out_of_service') AND (status != 'employee' OR kind = 'locker')", name="ck_rental_assets_status"),
        sa.CheckConstraint(
            "(kind = 'glove' AND color IS NOT NULL AND length(color) BETWEEN 1 AND 64 "
            "AND ounces IS NOT NULL AND ounces > 0 AND locker_number IS NULL) OR "
            "(kind = 'locker' AND locker_number IS NOT NULL AND locker_number > 0 AND color IS NULL AND ounces IS NULL)",
            name="ck_rental_assets_attributes",
        ),
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT 1 FROM rental_assets LIMIT 1")).first():
        raise RuntimeError("Cannot remove recorded rental assets.")
    op.drop_table("rental_assets")

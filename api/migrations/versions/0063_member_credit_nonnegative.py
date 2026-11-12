"""Forbid a negative member credit balance at the database level."""
from alembic import op
import sqlalchemy as sa

revision = "0063_member_credit_nonnegative"
down_revision = "0062_member_phone_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_context().as_sql:
        op.execute("DO $$ BEGIN IF EXISTS (SELECT 1 FROM members WHERE credit_balance_minor < 0) THEN RAISE EXCEPTION 'Fix members with a negative credit balance before migrating.'; END IF; END $$")
    elif op.get_bind().execute(sa.text("SELECT 1 FROM members WHERE credit_balance_minor < 0 LIMIT 1")).first():
        raise RuntimeError("Fix members with a negative credit balance before migrating.")
    with op.batch_alter_table("members") as batch:
        batch.create_check_constraint("ck_members_credit_balance_nonnegative", "credit_balance_minor >= 0")


def downgrade() -> None:
    with op.batch_alter_table("members") as batch:
        batch.drop_constraint("ck_members_credit_balance_nonnegative", type_="check")

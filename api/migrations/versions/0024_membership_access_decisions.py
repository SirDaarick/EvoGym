"""Add append-only administrator membership access decisions."""
from alembic import op
import sqlalchemy as sa

revision = "0024_member_access_decisions"
down_revision = "0023_staff_sched_checkout"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_access_decisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("period_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.String(length=240), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("action IN ('restrict', 'restore')", name="ck_member_access_decisions_action"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_member_access_decisions_fingerprint"),
        sa.ForeignKeyConstraint(["period_id"], ["membership_periods.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period_id", "idempotency_key", name="uq_member_access_decisions_key"),
    )
    op.create_index("ix_member_access_decisions_period_created", "member_access_decisions", ["period_id", "created_at"])
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        op.execute("CREATE TRIGGER trg_member_access_decisions_no_update BEFORE UPDATE ON member_access_decisions BEGIN SELECT RAISE(ABORT, 'member_access_decisions are append-only'); END")
        op.execute("CREATE TRIGGER trg_member_access_decisions_no_delete BEFORE DELETE ON member_access_decisions BEGIN SELECT RAISE(ABORT, 'member_access_decisions are append-only'); END")
    elif connection.dialect.name == "postgresql":
        op.execute("CREATE FUNCTION reject_member_access_decisions_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'member_access_decisions are append-only'; END; $$ LANGUAGE plpgsql")
        op.execute("CREATE TRIGGER trg_member_access_decisions_no_update_delete BEFORE UPDATE OR DELETE ON member_access_decisions FOR EACH ROW EXECUTE FUNCTION reject_member_access_decisions_mutation()")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT count(*) FROM member_access_decisions")).scalar_one():
        raise RuntimeError("Cannot downgrade while membership access decisions exist.")
    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER trg_member_access_decisions_no_delete")
        op.execute("DROP TRIGGER trg_member_access_decisions_no_update")
    elif connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER trg_member_access_decisions_no_update_delete ON member_access_decisions")
        op.execute("DROP FUNCTION reject_member_access_decisions_mutation()")
    op.drop_index("ix_member_access_decisions_period_created", table_name="member_access_decisions")
    op.drop_table("member_access_decisions")

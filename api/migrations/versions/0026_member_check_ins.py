"""Record append-only online member check-in events."""
from alembic import op
import sqlalchemy as sa

revision = "0026_member_check_ins"
down_revision = "0025_member_access_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_check_ins",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("period_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("access_reason", sa.String(length=64), nullable=False),
        sa.Column("access_warnings", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_member_check_ins_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_member_check_ins_fingerprint"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["period_id"], ["membership_periods.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["recorded_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("branch_id", "recorded_by", "idempotency_key", name="uq_member_check_ins_actor_key"),
    )
    op.create_index("ix_member_check_ins_period_occurred", "member_check_ins", ["period_id", "occurred_at"])
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        op.execute("CREATE TRIGGER trg_member_check_ins_no_update BEFORE UPDATE ON member_check_ins BEGIN SELECT RAISE(ABORT, 'member_check_ins are append-only'); END")
        op.execute("CREATE TRIGGER trg_member_check_ins_no_delete BEFORE DELETE ON member_check_ins BEGIN SELECT RAISE(ABORT, 'member_check_ins are append-only'); END")
    elif connection.dialect.name == "postgresql":
        op.execute("CREATE FUNCTION reject_member_check_ins_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'member_check_ins are append-only'; END; $$ LANGUAGE plpgsql")
        op.execute("CREATE TRIGGER trg_member_check_ins_no_update_delete BEFORE UPDATE OR DELETE ON member_check_ins FOR EACH ROW EXECUTE FUNCTION reject_member_check_ins_mutation()")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT count(*) FROM member_check_ins")).scalar_one():
        raise RuntimeError("Cannot downgrade while member check-in events exist.")
    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER trg_member_check_ins_no_delete")
        op.execute("DROP TRIGGER trg_member_check_ins_no_update")
    elif connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER trg_member_check_ins_no_update_delete ON member_check_ins")
        op.execute("DROP FUNCTION reject_member_check_ins_mutation()")
    op.drop_index("ix_member_check_ins_period_occurred", table_name="member_check_ins")
    op.drop_table("member_check_ins")

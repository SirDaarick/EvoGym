"""Add retained one-time class-sample check-in events."""
from alembic import op
import sqlalchemy as sa


revision = "0029_class_sample_check_ins"
down_revision = "0028_class_sample_entitlements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "class_sample_check_ins",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entitlement_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("access_reason", sa.String(length=64), nullable=False),
        sa.Column("access_warnings", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["entitlement_id"], ["class_sample_entitlements.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["recorded_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("entitlement_id", name="uq_class_sample_check_ins_entitlement"),
        sa.UniqueConstraint("branch_id", "recorded_by", "idempotency_key", name="uq_class_sample_check_ins_actor_key"),
        sa.CheckConstraint("length(idempotency_key) BETWEEN 1 AND 128", name="ck_class_sample_check_ins_key_length"),
        sa.CheckConstraint("length(request_fingerprint) = 64", name="ck_class_sample_check_ins_fingerprint"),
    )
    op.create_index("ix_class_sample_check_ins_member_occurred", "class_sample_check_ins", ["member_id", "occurred_at"])
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        op.execute("""
            CREATE TRIGGER trg_class_sample_check_ins_no_update
            BEFORE UPDATE ON class_sample_check_ins
            BEGIN
                SELECT RAISE(ABORT, 'class sample check-in events are append-only');
            END
        """)
        op.execute("""
            CREATE TRIGGER trg_class_sample_check_ins_no_delete
            BEFORE DELETE ON class_sample_check_ins
            BEGIN
                SELECT RAISE(ABORT, 'class sample check-in events are append-only');
            END
        """)
    elif dialect == "postgresql":
        op.execute("""
            CREATE FUNCTION reject_class_sample_check_in_mutation()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION 'class sample check-in events are append-only'
                    USING ERRCODE = '55000';
            END;
            $$
        """)
        op.execute("""
            CREATE TRIGGER trg_class_sample_check_ins_no_update
            BEFORE UPDATE ON class_sample_check_ins
            FOR EACH ROW EXECUTE FUNCTION reject_class_sample_check_in_mutation()
        """)
        op.execute("""
            CREATE TRIGGER trg_class_sample_check_ins_no_delete
            BEFORE DELETE ON class_sample_check_ins
            FOR EACH ROW EXECUTE FUNCTION reject_class_sample_check_in_mutation()
        """)
    else:
        raise RuntimeError(f"Unsupported database dialect for append-only check-ins: {dialect}")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("select count(*) from class_sample_check_ins")).scalar_one():
        raise RuntimeError("class sample check-ins contain retained usage history")
    dialect = connection.dialect.name
    if dialect == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS trg_class_sample_check_ins_no_update")
        op.execute("DROP TRIGGER IF EXISTS trg_class_sample_check_ins_no_delete")
    elif dialect == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_class_sample_check_ins_no_update ON class_sample_check_ins")
        op.execute("DROP TRIGGER IF EXISTS trg_class_sample_check_ins_no_delete ON class_sample_check_ins")
        op.execute("DROP FUNCTION IF EXISTS reject_class_sample_check_in_mutation()")
    op.drop_index("ix_class_sample_check_ins_member_occurred", table_name="class_sample_check_ins")
    op.drop_table("class_sample_check_ins")

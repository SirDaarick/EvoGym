"""Add deterministic membership access decision ordering and restore bindings."""
from alembic import context, op
import sqlalchemy as sa

revision = "0025_member_access_order"
down_revision = "0024_member_access_decisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("member_access_decisions", sa.Column("decision_order", sa.Integer(), nullable=True))
    op.add_column("member_access_decisions", sa.Column("lifted_access_decision_id", sa.Uuid(), nullable=True))
    op.add_column("member_access_decisions", sa.Column("lifted_payment_review_id", sa.Uuid(), nullable=True))
    op.add_column("member_access_decisions", sa.Column("lifted_review_event_count", sa.Integer(), nullable=True))
    connection = op.get_bind()
    sqlite_triggers = connection.dialect.name == "sqlite"
    postgres_trigger = connection.dialect.name == "postgresql"
    if sqlite_triggers and not context.is_offline_mode():
        op.execute("DROP TRIGGER trg_member_access_decisions_no_delete")
        op.execute("DROP TRIGGER trg_member_access_decisions_no_update")
    elif postgres_trigger:
        op.execute("ALTER TABLE member_access_decisions DISABLE TRIGGER trg_member_access_decisions_no_update_delete")
    try:
        if not context.is_offline_mode():
            # Historical same-timestamp order is unknowable; retain the previously used id tie-breaker.
            rows = connection.execute(sa.text(
                "SELECT id, period_id FROM member_access_decisions ORDER BY period_id, created_at, id"
            )).all()
            next_by_period = {}
            for row in rows:
                order = next_by_period.get(row.period_id, 0) + 1
                next_by_period[row.period_id] = order
                connection.execute(sa.text("UPDATE member_access_decisions SET decision_order=:n WHERE id=:id"),
                                   {"n": order, "id": row.id})
        with op.batch_alter_table("member_access_decisions") as batch:
            batch.alter_column("decision_order", nullable=False)
            batch.create_unique_constraint("uq_member_access_decisions_order", ["period_id", "decision_order"])
            batch.create_foreign_key("fk_member_access_decisions_lifted_access", "member_access_decisions",
                                     ["lifted_access_decision_id"], ["id"], ondelete="RESTRICT")
            batch.create_foreign_key("fk_member_access_decisions_lifted_review", "payment_review_events",
                                     ["lifted_payment_review_id"], ["id"], ondelete="RESTRICT")
    finally:
        if sqlite_triggers and not context.is_offline_mode():
            op.execute("CREATE TRIGGER trg_member_access_decisions_no_update BEFORE UPDATE ON member_access_decisions BEGIN SELECT RAISE(ABORT, 'member_access_decisions are append-only'); END")
            op.execute("CREATE TRIGGER trg_member_access_decisions_no_delete BEFORE DELETE ON member_access_decisions BEGIN SELECT RAISE(ABORT, 'member_access_decisions are append-only'); END")
        elif postgres_trigger:
            op.execute("ALTER TABLE member_access_decisions ENABLE TRIGGER trg_member_access_decisions_no_update_delete")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT count(*) FROM member_access_decisions")).scalar_one():
        raise RuntimeError("Cannot downgrade while membership access decisions exist.")
    with op.batch_alter_table("member_access_decisions") as batch:
        batch.drop_constraint("fk_member_access_decisions_lifted_review", type_="foreignkey")
        batch.drop_constraint("fk_member_access_decisions_lifted_access", type_="foreignkey")
        batch.drop_constraint("uq_member_access_decisions_order", type_="unique")
        batch.drop_column("lifted_review_event_count")
        batch.drop_column("lifted_payment_review_id")
        batch.drop_column("lifted_access_decision_id")
        batch.drop_column("decision_order")
    if connection.dialect.name == "sqlite":
        op.execute("CREATE TRIGGER trg_member_access_decisions_no_update BEFORE UPDATE ON member_access_decisions BEGIN SELECT RAISE(ABORT, 'member_access_decisions are append-only'); END")
        op.execute("CREATE TRIGGER trg_member_access_decisions_no_delete BEFORE DELETE ON member_access_decisions BEGIN SELECT RAISE(ABORT, 'member_access_decisions are append-only'); END")

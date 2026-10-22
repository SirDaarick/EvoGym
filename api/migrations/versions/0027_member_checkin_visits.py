"""Persist visit roots for online member check-ins."""
from alembic import op
import sqlalchemy as sa

revision = "0027_member_checkin_visits"
down_revision = "0026_member_check_ins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "member_check_in_visits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_member_check_in_visits_member_started", "member_check_in_visits", ["member_id", "started_at"])
    op.add_column("member_check_ins", sa.Column("visit_id", sa.Uuid(), nullable=True))
    connection = op.get_bind()
    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER trg_member_check_ins_no_update")
        op.execute("DROP TRIGGER trg_member_check_ins_no_delete")
    elif connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER trg_member_check_ins_no_update_delete ON member_check_ins")
    connection.execute(sa.text(
        "INSERT INTO member_check_in_visits (id, member_id, started_at) "
        "SELECT id, member_id, occurred_at FROM member_check_ins"
    ))
    connection.execute(sa.text("UPDATE member_check_ins SET visit_id = id"))
    with op.batch_alter_table("member_check_ins") as batch:
        batch.alter_column("visit_id", existing_type=sa.Uuid(), nullable=False)
        batch.create_foreign_key("fk_member_check_ins_visit_id", "member_check_in_visits", ["visit_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_member_check_ins_visit", "member_check_ins", ["visit_id"])
    if connection.dialect.name == "sqlite":
        # SQLite's batch rebuild drops triggers attached to the rebuilt event table.
        op.execute("CREATE TRIGGER trg_member_check_ins_no_update BEFORE UPDATE ON member_check_ins BEGIN SELECT RAISE(ABORT, 'member_check_ins are append-only'); END")
        op.execute("CREATE TRIGGER trg_member_check_ins_no_delete BEFORE DELETE ON member_check_ins BEGIN SELECT RAISE(ABORT, 'member_check_ins are append-only'); END")
        op.execute("CREATE TRIGGER trg_member_check_in_visits_no_update BEFORE UPDATE ON member_check_in_visits BEGIN SELECT RAISE(ABORT, 'member_check_in_visits are append-only'); END")
        op.execute("CREATE TRIGGER trg_member_check_in_visits_no_delete BEFORE DELETE ON member_check_in_visits BEGIN SELECT RAISE(ABORT, 'member_check_in_visits are append-only'); END")
    elif connection.dialect.name == "postgresql":
        op.execute("CREATE TRIGGER trg_member_check_ins_no_update_delete BEFORE UPDATE OR DELETE ON member_check_ins FOR EACH ROW EXECUTE FUNCTION reject_member_check_ins_mutation()")
        op.execute("CREATE FUNCTION reject_member_check_in_visits_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'member_check_in_visits are append-only'; END; $$ LANGUAGE plpgsql")
        op.execute("CREATE TRIGGER trg_member_check_in_visits_no_update_delete BEFORE UPDATE OR DELETE ON member_check_in_visits FOR EACH ROW EXECUTE FUNCTION reject_member_check_in_visits_mutation()")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT count(*) FROM member_check_ins")).scalar_one():
        raise RuntimeError("Cannot downgrade while member check-in events exist.")
    op.drop_index("ix_member_check_ins_visit", table_name="member_check_ins")
    if connection.dialect.name == "sqlite":
        op.execute("DROP TRIGGER trg_member_check_in_visits_no_delete")
        op.execute("DROP TRIGGER trg_member_check_in_visits_no_update")
    elif connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER trg_member_check_in_visits_no_update_delete ON member_check_in_visits")
        op.execute("DROP FUNCTION reject_member_check_in_visits_mutation()")
    with op.batch_alter_table("member_check_ins") as batch:
        batch.drop_constraint("fk_member_check_ins_visit_id", type_="foreignkey")
        batch.drop_column("visit_id")
    if connection.dialect.name == "sqlite":
        op.execute("CREATE TRIGGER trg_member_check_ins_no_update BEFORE UPDATE ON member_check_ins BEGIN SELECT RAISE(ABORT, 'member_check_ins are append-only'); END")
        op.execute("CREATE TRIGGER trg_member_check_ins_no_delete BEFORE DELETE ON member_check_ins BEGIN SELECT RAISE(ABORT, 'member_check_ins are append-only'); END")
    op.drop_index("ix_member_check_in_visits_member_started", table_name="member_check_in_visits")
    op.drop_table("member_check_in_visits")

"""Add global acknowledgement metadata for staff lockout alerts."""

from alembic import op
import sqlalchemy as sa


revision = "0036_staff_lockout_alert_ack"
down_revision = "0035_employee_session_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("security_events") as batch_op:
        batch_op.add_column(sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("acknowledged_by", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_security_events_acknowledged_by_staff_users", "staff_users",
            ["acknowledged_by"], ["id"], ondelete="RESTRICT",
        )
        batch_op.create_check_constraint(
            "ck_security_events_acknowledgement_pair",
            "(acknowledged_at IS NULL AND acknowledged_by IS NULL) OR "
            "(acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)",
        )
    op.create_index(
        "ix_security_events_pending_order", "security_events",
        ["acknowledged_at", "occurred_at", "id"],
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        connection.execute(sa.text("LOCK TABLE security_events IN ACCESS EXCLUSIVE MODE"))
    acknowledged = connection.execute(sa.text(
        "SELECT count(*) FROM security_events "
        "WHERE acknowledged_at IS NOT NULL OR acknowledged_by IS NOT NULL"
    )).scalar_one()
    if acknowledged:
        raise RuntimeError("Acknowledged lockout alert history is retained")

    op.drop_index("ix_security_events_pending_order", table_name="security_events")
    with op.batch_alter_table("security_events") as batch_op:
        batch_op.drop_constraint("ck_security_events_acknowledgement_pair", type_="check")
        batch_op.drop_constraint("fk_security_events_acknowledged_by_staff_users", type_="foreignkey")
        batch_op.drop_column("acknowledged_by")
        batch_op.drop_column("acknowledged_at")

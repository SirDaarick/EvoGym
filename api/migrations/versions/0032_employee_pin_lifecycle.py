"""Add initial employee PIN lifecycle state without invalidating legacy credentials."""

from alembic import op
import sqlalchemy as sa


revision = "0032_employee_pin_lifecycle"
down_revision = "0031_admin_session_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("staff_credentials") as batch_op:
        batch_op.add_column(
            sa.Column("pin_change_required", sa.Boolean(), server_default=sa.false(), nullable=False),
        )
        batch_op.add_column(
            sa.Column("initial_pin_expires_at", sa.DateTime(timezone=True), nullable=True),
        )
        batch_op.create_check_constraint(
            "ck_staff_credentials_initial_pin_expiry",
            "pin_change_required = false OR initial_pin_expires_at IS NOT NULL",
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("select count(*) from staff_credentials where pin_change_required = true")).scalar_one():
        raise RuntimeError("Pending employee PIN changes are retained")
    with op.batch_alter_table("staff_credentials") as batch_op:
        batch_op.drop_constraint("ck_staff_credentials_initial_pin_expiry", type_="check")
        batch_op.drop_column("initial_pin_expires_at")
        batch_op.drop_column("pin_change_required")

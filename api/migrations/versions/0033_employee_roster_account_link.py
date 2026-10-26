"""Link branch roster profiles to existing employee login accounts."""

from alembic import op
import sqlalchemy as sa


revision = "0033_employee_roster_account_link"
down_revision = "0032_employee_pin_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("staff_roster_profiles") as batch:
        batch.add_column(sa.Column("staff_user_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_staff_roster_profiles_staff_user_id_staff_users",
            "staff_users",
            ["staff_user_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch.create_unique_constraint(
            "uq_staff_roster_staff_user_branch",
            ["staff_user_id", "branch_id"],
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text(
        "select count(*) from staff_roster_profiles where staff_user_id is not null"
    )).scalar_one():
        raise RuntimeError("Employee account links are retained")
    with op.batch_alter_table("staff_roster_profiles") as batch:
        batch.drop_constraint("uq_staff_roster_staff_user_branch", type_="unique")
        batch.drop_constraint("fk_staff_roster_profiles_staff_user_id_staff_users", type_="foreignkey")
        batch.drop_column("staff_user_id")

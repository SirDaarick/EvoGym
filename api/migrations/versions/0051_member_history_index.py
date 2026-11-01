"""Index member check-ins for bounded member history reads."""
from alembic import op

revision = "0051_member_history_index"
down_revision = "0050_payroll"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_member_check_ins_member_branch_occurred", "member_check_ins", ["member_id", "branch_id", "occurred_at"])


def downgrade() -> None:
    op.drop_index("ix_member_check_ins_member_branch_occurred", table_name="member_check_ins")

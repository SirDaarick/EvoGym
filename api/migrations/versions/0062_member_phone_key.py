"""Index member phone digits without requiring uniqueness."""
import re

from alembic import op
import sqlalchemy as sa

revision = "0062_member_phone_key"
down_revision = "0061_rental_receipt_credit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("members", sa.Column("phone_key", sa.String(32), nullable=True))
    if op.get_context().as_sql:
        op.execute("UPDATE members SET phone_key = NULLIF(RIGHT(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 32), '')")
    else:
        connection = op.get_bind()
        for member_id, phone in connection.execute(sa.text("SELECT id, phone FROM members")):
            key = re.sub(r"[^0-9]", "", phone or "")[-32:]
            if key:
                connection.execute(sa.text("UPDATE members SET phone_key = :key WHERE id = :id"), {"key": key, "id": member_id})
    op.create_index("ix_members_phone_key", "members", ["phone_key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_members_phone_key", table_name="members")
    with op.batch_alter_table("members") as batch:
        batch.drop_column("phone_key")

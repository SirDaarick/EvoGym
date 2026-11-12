"""Allow shared phones on databases that applied the original unique index."""
from alembic import op

revision = "0065_shared_member_phones"
down_revision = "0064_unique_card_intent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_members_phone_key")
    op.execute("CREATE INDEX IF NOT EXISTS ix_members_phone_key ON members (phone_key)")


def downgrade() -> None:
    # The revised 0062 also uses the nonunique index; no data must be removed.
    pass

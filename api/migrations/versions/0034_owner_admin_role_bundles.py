"""Persist singleton owner identity and scoped reusable Admin permission bundles."""

from alembic import op
import sqlalchemy as sa


revision = "0034_owner_admin_role_bundles"
down_revision = "0033_employee_roster_account_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organization_owners",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint("id = 1", name="ck_organization_owners_singleton"),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("staff_id", name="uq_organization_owners_staff"),
    )
    op.create_table(
        "admin_role_bundles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("normalized_name", sa.String(length=80), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_admin_role_bundles_name_normalized", "admin_role_bundles", ["normalized_name"], unique=True)
    op.create_table(
        "admin_role_bundle_permissions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("bundle_id", sa.Uuid(), nullable=False),
        sa.Column("permission", sa.String(length=64), nullable=False),
        sa.CheckConstraint("length(permission) > 0", name="ck_admin_role_bundle_permission_nonempty"),
        sa.ForeignKeyConstraint(["bundle_id"], ["admin_role_bundles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bundle_id", "permission", name="uq_admin_role_bundle_permission"),
    )
    op.create_table(
        "admin_role_bundle_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("staff_id", sa.Uuid(), nullable=False),
        sa.Column("bundle_id", sa.Uuid(), nullable=False),
        sa.Column("scope_kind", sa.String(length=16), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint(
            "(scope_kind = 'organization' AND branch_id IS NULL) OR "
            "(scope_kind = 'branch' AND branch_id IS NOT NULL)",
            name="ck_admin_role_bundle_assignment_scope",
        ),
        sa.ForeignKeyConstraint(["staff_id"], ["staff_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["bundle_id"], ["admin_role_bundles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("staff_id", "bundle_id", "scope_kind", "branch_id", name="uq_admin_role_bundle_assignment_scope"),
    )
    op.create_index("ix_admin_role_bundle_assignments_staff_active", "admin_role_bundle_assignments", ["staff_id", "is_active"])
    op.get_bind().execute(sa.text("INSERT INTO organization_owners (id, staff_id) VALUES (1, NULL)"))


def downgrade() -> None:
    connection = op.get_bind()
    for table in ("admin_role_bundle_assignments", "admin_role_bundle_permissions", "admin_role_bundles"):
        if connection.execute(sa.text(f"SELECT count(*) FROM {table}")).scalar_one():
            raise RuntimeError("Owner role bundle data is retained")
    if connection.execute(sa.text("SELECT count(*) FROM organization_owners WHERE staff_id IS NOT NULL")).scalar_one():
        raise RuntimeError("Organization ownership is retained")
    op.drop_index("ix_admin_role_bundle_assignments_staff_active", table_name="admin_role_bundle_assignments")
    op.drop_table("admin_role_bundle_assignments")
    op.drop_table("admin_role_bundle_permissions")
    op.drop_index("uq_admin_role_bundles_name_normalized", table_name="admin_role_bundles")
    op.drop_table("admin_role_bundles")
    op.drop_table("organization_owners")

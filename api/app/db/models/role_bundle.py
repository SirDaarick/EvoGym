from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class OrganizationOwner(Base):
    """Singleton ownership pointer; installed empty and claimed only by the operator bootstrap."""

    __tablename__ = "organization_owners"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_organization_owners_singleton"),
        UniqueConstraint("staff_id", name="uq_organization_owners_staff"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    staff_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=True
    )


class RoleBundle(Base):
    __tablename__ = "admin_role_bundles"
    __table_args__ = (Index("uq_admin_role_bundles_name_normalized", "normalized_name", unique=True),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


class RoleBundlePermission(Base):
    __tablename__ = "admin_role_bundle_permissions"
    __table_args__ = (
        UniqueConstraint("bundle_id", "permission", name="uq_admin_role_bundle_permission"),
        CheckConstraint("length(permission) > 0", name="ck_admin_role_bundle_permission_nonempty"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    bundle_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("admin_role_bundles.id", ondelete="CASCADE"), nullable=False
    )
    permission: Mapped[str] = mapped_column(String(64), nullable=False)


class RoleBundleAssignment(Base):
    __tablename__ = "admin_role_bundle_assignments"
    __table_args__ = (
        CheckConstraint(
            "(scope_kind = 'organization' AND branch_id IS NULL) OR "
            "(scope_kind = 'branch' AND branch_id IS NOT NULL)",
            name="ck_admin_role_bundle_assignment_scope",
        ),
        UniqueConstraint("staff_id", "bundle_id", "scope_kind", "branch_id", name="uq_admin_role_bundle_assignment_scope"),
        Index("ix_admin_role_bundle_assignments_staff_active", "staff_id", "is_active"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False
    )
    bundle_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("admin_role_bundles.id", ondelete="RESTRICT"), nullable=False
    )
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    branch_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

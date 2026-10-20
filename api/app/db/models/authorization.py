from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, UniqueConstraint, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Branch(Base):
    """Minimal active branch registry required for authorization scope."""

    __tablename__ = "branches"
    __table_args__ = (
        CheckConstraint("length(code) > 0 AND code = lower(trim(code))", name="ck_branches_code_normalized"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")


class RoleGrant(Base):
    """An explicitly scoped, server-owned assignment; callers cannot supply authority labels."""

    __tablename__ = "staff_role_grants"
    __table_args__ = (
        CheckConstraint(
            "(role = 'admin' AND scope_kind IN ('organization', 'branch')) OR "
            "(role = 'receptionist' AND scope_kind = 'branch')",
            name="ck_staff_role_grants_role_scope",
        ),
        CheckConstraint(
            "(scope_kind = 'organization' AND branch_id IS NULL) OR "
            "(scope_kind = 'branch' AND branch_id IS NOT NULL)",
            name="ck_staff_role_grants_branch_scope",
        ),
        UniqueConstraint("staff_id", "role", "scope_kind", "branch_id", name="uq_staff_role_grants_scope"),
        Index(
            "uq_staff_role_grants_org_admin",
            "staff_id",
            unique=True,
            postgresql_where=text("role = 'admin' AND scope_kind = 'organization'"),
            sqlite_where=text("role = 'admin' AND scope_kind = 'organization'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    staff_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    branch_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("branches.id", ondelete="RESTRICT"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

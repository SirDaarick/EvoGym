"""Catalog database models for services, plans, and plan versions."""
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Service(Base):
    """Commercial service offered (e.g. gym, box, box_kids)."""

    __tablename__ = "services"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'inactive')", name="ck_services_status"),
        Index("ix_services_code", "code", unique=True),
        Index("ix_services_status", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="active", server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Plan(Base):
    """Commercial plan (e.g. gym_month, box_month, combo_month, visit_single)."""

    __tablename__ = "plans"
    __table_args__ = (
        CheckConstraint("kind IN ('membership', 'visit')", name="ck_plans_kind"),
        CheckConstraint(
            "status IN ('active', 'inactive', 'archived')", name="ck_plans_status"
        ),
        Index("ix_plans_code", "code", unique=True),
        Index("ix_plans_kind", "kind"),
        Index("ix_plans_status", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(48), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(24), nullable=False, default="membership", server_default="membership"
    )
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="active", server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    versions: Mapped[list["PlanVersion"]] = relationship(
        "PlanVersion",
        back_populates="plan",
        order_by="PlanVersion.version_number",
        lazy="selectin",
    )

    @property
    def current_version(self) -> "PlanVersion | None":
        """Latest published version of the plan."""
        if not self.versions:
            return None
        return self.versions[-1]


class PlanVersion(Base):
    """Immutable published version of a plan with commercial terms and service mappings."""

    __tablename__ = "plan_versions"
    __table_args__ = (
        CheckConstraint("version_number > 0", name="ck_plan_versions_version_number"),
        CheckConstraint("price_minor >= 0", name="ck_plan_versions_price_minor"),
        CheckConstraint(
            "reference_amount_minor IS NULL OR reference_amount_minor >= 0",
            name="ck_plan_versions_ref_amount",
        ),
        CheckConstraint(
            "(entitlement_mode = 'period' AND duration_value IS NOT NULL AND duration_value > 0 "
            "AND duration_unit IS NOT NULL AND duration_unit IN ('day', 'month', 'year')) OR "
            "(entitlement_mode = 'single_entry' AND duration_value IS NULL AND duration_unit IS NULL)",
            name="ck_plan_versions_duration_val",
        ),
        CheckConstraint("entitlement_mode IN ('period', 'single_entry')", name="ck_plan_versions_entitlement_mode"),
        UniqueConstraint("plan_id", "version_number", name="uq_plan_versions_plan_version"),
        Index("ix_plan_versions_plan_id", "plan_id"),
        Index("ix_plan_versions_eligibility_type", "eligibility_type"),
        Index("ix_plan_versions_is_active", "is_active"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    plan_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("plans.id", ondelete="RESTRICT"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, default="MXN", server_default="MXN"
    )
    reference_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    duration_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    entitlement_mode: Mapped[str] = mapped_column(String(24), nullable=False, default="period", server_default="period")
    eligibility_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    restriction_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    plan: Mapped["Plan"] = relationship("Plan", back_populates="versions")
    services: Mapped[list["PlanVersionService"]] = relationship(
        "PlanVersionService",
        back_populates="plan_version",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class PlanVersionService(Base):
    """Composite mapping linking a plan version to services with optional session limits."""

    __tablename__ = "plan_version_services"
    __table_args__ = (
        CheckConstraint(
            "session_limit IS NULL OR session_limit > 0",
            name="ck_plan_version_services_session_limit",
        ),
    )

    plan_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("plan_versions.id", ondelete="CASCADE"), primary_key=True
    )
    service_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("services.id", ondelete="RESTRICT"), primary_key=True
    )
    session_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)

    plan_version: Mapped["PlanVersion"] = relationship("PlanVersion", back_populates="services")
    service: Mapped["Service"] = relationship("Service", lazy="selectin")


@event.listens_for(PlanVersion, "before_update")
def _reject_plan_version_update(mapper, connection, target):
    raise ValueError("Published plan versions are immutable")

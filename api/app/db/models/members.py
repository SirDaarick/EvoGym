"""Member database model."""
from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Member(Base):
    """Member entity belonging to the organization."""

    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'inactive', 'expired', 'suspended', 'pending')",
            name="ck_members_status",
        ),
        Index("ix_members_member_number", "member_number", unique=True),
        Index("ix_members_full_name", "full_name"),
        Index("ix_members_phone", "phone"),
        Index("ix_members_status", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    member_number: Mapped[str] = mapped_column(String(32), nullable=False)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    preferred_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    emergency_contact_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="active", server_default="active"
    )
    joined_on: Mapped[date] = mapped_column(
        Date, nullable=False, default=date.today, server_default=func.current_date()
    )
    credit_balance_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0"
    )
    photo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class MemberNote(Base):
    """Restricted member note for administrative and audit records."""

    __tablename__ = "member_notes"
    __table_args__ = (
        Index("ix_member_notes_member_id", "member_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    member_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    voided_by: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=True
    )

    @property
    def is_voided(self) -> bool:
        """Indicate whether the note has been voided."""
        return self.voided_at is not None


class MemberEligibilityRecord(Base):
    """Eligibility attestation record for special programs or rates."""

    __tablename__ = "member_eligibility_records"
    __table_args__ = (
        Index("ix_member_eligibility_records_member_id", "member_id"),
        Index("ix_member_eligibility_records_eligibility_type", "eligibility_type"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    member_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("members.id", ondelete="CASCADE"), nullable=False
    )
    eligibility_type: Mapped[str] = mapped_column(String(64), nullable=False)
    verified_by: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=False
    )
    verified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("staff_users.id", ondelete="RESTRICT"), nullable=True
    )

    @property
    def is_valid(self) -> bool:
        """Check if record is active (not revoked and not past valid_until date)."""
        if self.revoked_at is not None:
            return False
        if self.valid_until is not None and self.valid_until < date.today():
            return False
        return True


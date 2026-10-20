from sqlalchemy import CheckConstraint

from app.db.models.authorization import Branch, RoleGrant
from app.db.models.audit import AuditEvent
from app.db.models.admin import AdminAuthEvent, AdminPasswordCredential
from app.db.models.recovery import AdminRecoveryToken
from app.db.models.sessions import StaffSession
from app.db.models.staff import SecurityEvent, StaffCredential, StaffUser
from app.db.models.enrollment import StaffEnrollmentCode
from app.db.models.devices import StaffDevicePairingCode, StaffPairedDevice
from app.db.models.members import Member, MemberEligibilityRecord, MemberNote
from app.db.models.catalog import Plan, PlanVersion, PlanVersionService, Service
from app.db.models.shifts import CashRegister, PaymentTerminal, Shift, ShiftDenominationCount
from app.db.models.inventory import (
    Product,
    RegisterInventorySnapshot,
    RegisterInventorySnapshotItem,
    StockInitialization,
)

# Update AdminAuthEvent check constraint for enrollment and device actions
_old_ck = [c for c in AdminAuthEvent.__table__.constraints if c.name == "ck_admin_auth_events_action"]
if _old_ck:
    AdminAuthEvent.__table__.constraints.remove(_old_ck[0])
    AdminAuthEvent.__table__.append_constraint(
        CheckConstraint(
            "action IN ('admin_password_login_succeeded', 'admin_password_recovered', 'admin_session_revoked', "
            "'enrollment_code_issued', 'enrollment_code_revoked', 'device_pairing_code_issued', 'device_paired', 'device_revoked')",
            name="ck_admin_auth_events_action",
        )
    )

__all__ = [
    "AdminAuthEvent",
    "AdminPasswordCredential",
    "AdminRecoveryToken",
    "AuditEvent",
    "Branch",
    "CashRegister",
    "Member",
    "MemberEligibilityRecord",
    "MemberNote",
    "PaymentTerminal",
    "Product",
    "RegisterInventorySnapshot",
    "RegisterInventorySnapshotItem",
    "Plan",
    "PlanVersion",
    "PlanVersionService",
    "RoleGrant",
    "SecurityEvent",
    "Service",
    "Shift",
    "ShiftDenominationCount",
    "StockInitialization",
    "StaffCredential",
    "StaffDevicePairingCode",
    "StaffEnrollmentCode",
    "StaffPairedDevice",
    "StaffSession",
    "StaffUser",
]

from sqlalchemy import CheckConstraint

from app.db.models.authorization import Branch, RoleGrant
from app.db.models.role_bundle import OrganizationOwner, RoleBundle, RoleBundlePermission, RoleBundleAssignment
from app.db.models.audit import AuditEvent
from app.db.models.admin import AdminAuthEvent, AdminPasswordCredential
from app.db.models.admin_devices import AdminLoginApproval, AdminTrustedDevice
from app.db.models.recovery import AdminRecoveryToken
from app.db.models.sessions import StaffSession
from app.db.models.reception_stations import ReceptionStation
from app.db.models.staff import SecurityEvent, StaffCredential, StaffUser
from app.db.models.staff_roster import StaffRosterProfile
from app.db.models.staff_attendance import StaffAttendanceCheckout, StaffAttendanceRecord
from app.db.models.staff_schedules import StaffScheduleException, StaffScheduleSeries
from app.db.models.enrollment import StaffEnrollmentCode
from app.db.models.devices import StaffDevicePairingCode, StaffPairedDevice
from app.db.models.members import Member, MemberEligibilityRecord, MemberNote
from app.db.models.rentals import RentalAsset
from app.db.models.catalog import Plan, PlanVersion, PlanVersionService, Service
from app.db.models.shifts import CashRegister, PaymentTerminal, Shift, ShiftDenominationCount, ShiftClosingDenominationCount, ShiftInventoryReview, ShiftInventoryObservation
from app.db.models.inventory import (
    Product,
    RegisterInventorySnapshot,
    RegisterInventorySnapshotItem,
    StockInitialization,
    StockMovement,
)
from app.db.models.orders import (
    Order, OrderItem, Payment, ProductRefund, ProductSaleCancellation, ProductSaleIntent, ProductSaleResolution
)
from app.db.models.memberships import MembershipPeriod
from app.db.models.payment_review_events import PaymentReviewEvent
from app.db.models.membership_debts import MembershipDebt
from app.db.models.membership_debt_payments import MembershipDebtPayment
from app.db.models.member_access_decisions import MemberAccessDecision
from app.db.models.member_check_ins import MemberCheckIn
from app.db.models.class_samples import ClassSampleCheckIn, ClassSampleEntitlement

# Update AdminAuthEvent check constraint for enrollment and device actions
_old_ck = [c for c in AdminAuthEvent.__table__.constraints if c.name == "ck_admin_auth_events_action"]
if _old_ck:
    AdminAuthEvent.__table__.constraints.remove(_old_ck[0])
    AdminAuthEvent.__table__.append_constraint(
        CheckConstraint(
            "action IN ('admin_password_login_succeeded', 'admin_password_recovered', 'admin_session_revoked', "
            "'admin_device_approval_requested', 'admin_device_approved', 'admin_trusted_device_revoked', "
            "'admin_session_replaced', 'admin_refresh_reuse_detected', "
            "'enrollment_code_issued', 'enrollment_code_revoked', 'device_pairing_code_issued', 'device_paired', 'device_revoked')",
            name="ck_admin_auth_events_action",
        )
    )

__all__ = [
    "AdminAuthEvent",
    "AdminPasswordCredential",
    "AdminLoginApproval",
    "AdminRecoveryToken",
    "AdminTrustedDevice",
    "AuditEvent",
    "Branch",
    "CashRegister",
    "Member",
    "MemberEligibilityRecord",
    "MemberNote",
    "RentalAsset",
    "MembershipPeriod",
    "MembershipDebt",
    "MembershipDebtPayment",
    "MemberAccessDecision",
    "MemberCheckIn",
    "ClassSampleEntitlement",
    "ClassSampleCheckIn",
    "PaymentReviewEvent",
    "Order",
    "OrderItem",
    "Payment",
    "ProductRefund",
    "ProductSaleCancellation",
    "ProductSaleIntent",
    "ProductSaleResolution",
    "PaymentTerminal",
    "Product",
    "RegisterInventorySnapshot",
    "RegisterInventorySnapshotItem",
    "Plan",
    "PlanVersion",
    "PlanVersionService",
    "RoleGrant",
    "OrganizationOwner",
    "RoleBundle",
    "RoleBundlePermission",
    "RoleBundleAssignment",
    "SecurityEvent",
    "Service",
    "Shift",
    "ShiftDenominationCount",
    "ShiftClosingDenominationCount",
    "ShiftInventoryReview",
    "ShiftInventoryObservation",
    "StockInitialization",
    "StockMovement",
    "StaffCredential",
    "StaffDevicePairingCode",
    "StaffEnrollmentCode",
    "StaffPairedDevice",
    "StaffSession",
    "ReceptionStation",
    "StaffRosterProfile",
    "StaffAttendanceRecord",
    "StaffAttendanceCheckout",
    "StaffScheduleSeries",
    "StaffScheduleException",
    "StaffUser",
]

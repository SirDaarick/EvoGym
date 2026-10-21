from datetime import date
from uuid import uuid4

from app.memberships.eligibility import MembershipAccessStatus, evaluate_membership_access


def test_access_status_contract_is_explicit_and_date_interval_is_half_open():
    assert MembershipAccessStatus.ALLOWED.value == "allowed"
    assert MembershipAccessStatus.EXPIRED.value == "expired"
    assert date(2026, 1, 1) <= date(2026, 1, 1) < date(2026, 2, 1)
    assert not (date(2026, 1, 1) <= date(2026, 2, 1) < date(2026, 2, 1))


def test_access_decision_has_branch_and_reason_fields():
    decision = evaluate_membership_access(None, uuid4(), date(2026, 1, 1), uuid4())
    assert decision.allowed is False
    assert decision.status is MembershipAccessStatus.NOT_FOUND
    assert decision.reason == "membership_not_found"
    assert decision.warnings == ()

from datetime import date
from uuid import uuid4

from app.memberships.eligibility import MembershipAccessStatus, evaluate_membership_access


def test_access_decision_has_branch_and_reason_fields():
    decision = evaluate_membership_access(None, uuid4(), date(2026, 1, 1), uuid4())
    assert decision.allowed is False
    assert decision.status is MembershipAccessStatus.NOT_FOUND
    assert decision.reason == "membership_not_found"
    assert decision.warnings == ()

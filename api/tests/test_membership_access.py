import pytest
from pydantic import ValidationError

from app.api.membership_access import AccessDecisionRequest


def test_admin_access_decision_requires_payment_reason_and_known_action():
    assert AccessDecisionRequest(action="restore", reason="Payment receipt verified").action == "restore"
    with pytest.raises(ValidationError):
        AccessDecisionRequest(action="override_expiry", reason="Not allowed")
    with pytest.raises(ValidationError):
        AccessDecisionRequest(action="restrict", reason="")

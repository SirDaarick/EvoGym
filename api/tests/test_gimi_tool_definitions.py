import pytest
from pydantic import ValidationError

from app.gimi.tool_definitions import (
    GimiRole,
    RecordExpenseParams,
    RecordShrinkageParams,
    RestockProductParams,
    ToolKind,
    get_jev_choices_for_role,
    get_tools_for_role,
    validate_tool_params,
)


def test_member_role_has_only_member_tools():
    member_tools = get_tools_for_role(GimiRole.MEMBER)
    tool_names = {t.name for t in member_tools}

    assert "member_membership_status" in tool_names
    assert "member_pending_balance" in tool_names
    assert "member_locker_status" in tool_names
    assert "gym_faq_and_rules" in tool_names

    # Members MUST NOT have staff or owner tools
    assert "staff_record_checkin" not in tool_names
    assert "staff_record_expense" not in tool_names
    assert "owner_financial_overview" not in tool_names


def test_staff_role_hierarchy():
    staff_tools = get_tools_for_role(GimiRole.STAFF)
    tool_names = {t.name for t in staff_tools}

    # Staff can see member queries
    assert "member_membership_status" in tool_names
    # Staff can perform operational actions
    assert "staff_record_checkin" in tool_names
    assert "staff_record_expense" in tool_names
    assert "staff_record_shrinkage" in tool_names

    # Staff MUST NOT have owner-only tools
    assert "owner_financial_overview" not in tool_names
    assert "owner_attendance_analytics" not in tool_names


def test_owner_role_has_full_suite():
    owner_tools = get_tools_for_role(GimiRole.OWNER)
    tool_names = {t.name for t in owner_tools}

    assert "owner_financial_overview" in tool_names
    assert "owner_attendance_analytics" in tool_names
    assert "staff_record_expense" in tool_names
    assert "member_membership_status" in tool_names


def test_confirmation_requirements_for_sensitive_commands():
    tools = {t.name: t for t in get_tools_for_role(GimiRole.OWNER)}

    # Queries never require confirmation
    assert tools["member_pending_balance"].requires_confirmation is False
    assert tools["owner_financial_overview"].requires_confirmation is False

    # High frequency routine check-in doesn't require confirmation
    assert tools["staff_record_checkin"].requires_confirmation is False

    # Financial and inventory impact actions MUST require confirmation (Draft & Confirm)
    assert tools["staff_record_expense"].requires_confirmation is True
    assert tools["staff_record_shrinkage"].requires_confirmation is True
    assert tools["staff_restock_product"].requires_confirmation is True


def test_record_expense_params_validation():
    # Valid
    params = validate_tool_params("staff_record_expense", {
        "amount_minor": 35000,
        "concept": "Compra de cloro y toallas",
        "category": "limpieza",
    })
    assert isinstance(params, RecordExpenseParams)
    assert params.amount_minor == 35000
    assert params.payment_method == "cash"

    # Invalid category
    with pytest.raises(ValidationError):
        validate_tool_params("staff_record_expense", {
            "amount_minor": 1000,
            "concept": "Test",
            "category": "categoria_inventada",
        })

    # Negative amount
    with pytest.raises(ValidationError):
        validate_tool_params("staff_record_expense", {
            "amount_minor": -500,
            "concept": "Test",
        })


def test_jev_choices_generation():
    choices = get_jev_choices_for_role(GimiRole.MEMBER)
    values = [c["value"] for c in choices]

    assert "member_membership_status" in values
    assert "unrecognized_intent" in values
    # Must not leak staff choices to member
    assert "staff_record_expense" not in values

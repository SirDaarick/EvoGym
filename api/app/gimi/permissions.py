"""Deny-by-default allowlist of Gimi tools. Every tool is read-only and scoped to one verified member."""


class ToolDenied(Exception):
    """The requested tool is not on the allowlist."""


ALLOWED_TOOLS: frozenset[str] = frozenset(
    {"member_pending_balance", "member_membership_status", "knowledge_search"})


def authorize_tool(name: object) -> str:
    if not isinstance(name, str) or name not in ALLOWED_TOOLS:
        raise ToolDenied("tool not allowed")
    return name

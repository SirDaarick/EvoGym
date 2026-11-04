"""Routers are HTTP transport only: no SQL, transactions, permission checks or model/query imports."""
import ast
from pathlib import Path

import pytest

API = Path(__file__).resolve().parents[1]
WATCHED_ROUTERS = ["app/api/sales.py", "app/api/rentals.py", "app/api/staff_attendance.py"]  # later slices append their router here

FORBIDDEN_CALLS = {"select", "execute", "scalar", "scalars", "add", "delete", "flush", "commit",
                   "rollback", "begin", "with_for_update", "authorize"}
FORBIDDEN_MODULES = ("sqlalchemy", "app.db", "app.auth.authorization")


def _bad_module(name: str) -> bool:
    return (name.split(".")[-1] == "queries"
            or any(name == m or name.startswith(m + ".") for m in FORBIDDEN_MODULES))


def violations(source: str) -> list[str]:
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Call):
            func = node.func
            name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
            is_route = isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id == "router"
            if name in FORBIDDEN_CALLS and not is_route:  # `@router.delete(...)` is routing, not SQL
                found.append(f"line {node.lineno}: call to {name}")
        elif isinstance(node, ast.Import):
            found += [f"line {node.lineno}: import {a.name}" for a in node.names if _bad_module(a.name)]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            # `from app.sales import queries` names the forbidden module in the imported names.
            found += [f"line {node.lineno}: from {module} import {a.name}" for a in node.names
                      if _bad_module(module) or _bad_module(f"{module}.{a.name}")]
    return found


@pytest.mark.parametrize("router", WATCHED_ROUTERS)
def test_router_is_transport_only(router):
    assert violations((API / router).read_text()) == []


@pytest.mark.parametrize("source", [
    "from app.sales import queries as q\nq.x()",
    "import app.sales.queries",
    "from sqlalchemy import select as s",
    "import sqlalchemy.orm",
    "from app.db.models import Order",
    "from app.auth.authorization import authorize",
    "session.commit()",
    "s.scalars(x)",
])
def test_guard_flags_bad_source(source):
    assert violations(source)

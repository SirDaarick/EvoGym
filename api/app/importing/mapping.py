"""Legacy data mapping and parsing utilities for Excel/CSV data.

Deterministic, pure-python transformations with no external database dependencies.
"""
from dataclasses import dataclass
from datetime import date, datetime, time
import hashlib
import re
from typing import Any
import unicodedata

SPANISH_MONTHS: dict[str, int] = {
    "ene": 1,
    "feb": 2,
    "mar": 3,
    "abr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dic": 12,
}


def parse_spanish_date(value: Any) -> date | None:
    """Parse dates from legacy Excel representations (e.g. 'abr/22/24', datetime objects)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, time):
        return None

    raw = str(value).strip().lower()
    if not raw or raw in ("n/a", "na", "null", "none", "-"):
        return None

    # Handle 'mmm/dd/yy' or 'mmm/dd/yyyy'
    parts = raw.split("/")
    if len(parts) == 3:
        m_str, d_str, y_str = parts[0].strip(), parts[1].strip(), parts[2].strip()
        month = SPANISH_MONTHS.get(m_str)
        if month:
            try:
                day = int(d_str)
                year = int(y_str)
                if year < 100:
                    current_yy = date.today().year % 100
                    if year > current_yy:
                        year += 1900
                    else:
                        year += 2000
                return date(year, month, day)
            except ValueError:
                pass

    # Try standard ISO 'YYYY-MM-DD'
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        pass

    return None


def normalize_plan_code(name: str) -> str:
    """Produce a deterministic, clean slug for a plan name."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("utf-8")
    # Strip leading number prefixes like '1) ' or '9A) '
    s = re.sub(r"^[0-9]+[a-z]?[\)\.\-]\s*", "", s.strip(), flags=re.IGNORECASE)
    # Replace non-alphanumeric with underscores
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s.strip().lower())
    s = s.strip("_")[:48]
    return s or "plan_general"


def derive_plan_duration(name: str, avg_days: int | None = None) -> tuple[int, str]:
    """Derive duration value and unit ('day', 'month', 'year') from plan name or average days."""
    upper = name.upper()
    if "ANUAL" in upper or "AÑO" in upper:
        return 1, "year"
    if "SEMESTRE" in upper:
        return 6, "month"
    if "TRIMESTRE" in upper or "3 MES" in upper:
        return 3, "month"
    if "BIMESTRE" in upper or "2 MES" in upper:
        return 2, "month"
    if "SEMANA" in upper:
        return 7, "day"
    if "QUINCENA" in upper or "15 DIA" in upper:
        return 15, "day"
    if "VISITA" in upper or "DIA" in upper:
        return 1, "day"

    # Fallback to average days if provided
    if avg_days is not None:
        if avg_days >= 300:
            return 1, "year"
        if avg_days >= 150:
            return 6, "month"
        if avg_days >= 75:
            return 3, "month"
        if avg_days >= 50:
            return 2, "month"
        if avg_days >= 20:
            return 1, "month"
        if avg_days >= 5:
            return avg_days, "day"
        if avg_days >= 1:
            return avg_days, "day"

    return 1, "month"


def build_fallback_phone(member_number: int | str) -> str:
    """Generate a valid, deterministic phone number for legacy members without one."""
    clean_num = int(str(member_number).strip())
    # Format as +5255 followed by 8-digit zero-padded number
    return f"+5255{clean_num:08d}"


def derive_member_name(nombre: Any, ap_paterno: Any, ap_materno: Any) -> str:
    """Combine names cleanly into full_name."""
    parts = []
    if nombre:
        parts.append(str(nombre).strip())
    if ap_paterno:
        parts.append(str(ap_paterno).strip())
    if ap_materno:
        parts.append(str(ap_materno).strip())
    full = " ".join(parts).strip()
    return full if full else "Sin Nombre"


def compute_sha256(text_value: str) -> str:
    """Generate deterministic 64-char hex sha256."""
    return hashlib.sha256(text_value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class StaffImportRow:
    full_name: str
    position: str
    monthly_salary_minor: int
    weekly_salary_minor: int


@dataclass(frozen=True)
class LockerImportRow:
    locker_number: int
    code: str
    status: str  # 'available', 'employee', 'out_of_service'
    occupant_name: str | None
    occupant_until: date | None
    has_objects: bool


@dataclass(frozen=True)
class PlanImportRow:
    raw_name: str
    code: str
    duration_value: int
    duration_unit: str
    price_minor: int


@dataclass(frozen=True)
class MemberImportRow:
    member_number: str
    full_name: str
    preferred_name: str | None
    phone: str
    email: str | None
    birth_date: date | None
    joined_on: date
    is_active: bool
    latest_membership_plan: str | None
    latest_membership_ends: date | None

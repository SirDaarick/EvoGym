"""ETL service for importing legacy Excel datasets into EvoGym.

Supports deterministic dry-run verification and transactional commits.
"""
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
import glob
from pathlib import Path
from typing import Any
from uuid import UUID

import openpyxl
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Branch,
    Member,
    Plan,
    PlanVersion,
    PlanVersionService,
    RentalAsset,
    Service,
    StaffRosterProfile,
    StaffUser,
)
from app.importing.mapping import (
    LockerImportRow,
    MemberImportRow,
    PlanImportRow,
    StaffImportRow,
    build_fallback_phone,
    derive_member_name,
    derive_plan_duration,
    normalize_plan_code,
    parse_spanish_date,
)


@dataclass
class LegacyImportReconciliation:
    """Summary of data read, validated, rejected, and staged/committed."""

    excel_dir: str
    cutover_date: str
    dry_run: bool

    # Staff counts
    staff_read: int = 0
    staff_imported: int = 0
    staff_rejected: int = 0

    # Plans counts
    plans_read: int = 0
    plans_imported: int = 0
    plans_existing: int = 0

    # Members counts
    members_read: int = 0
    members_imported: int = 0
    members_active: int = 0
    members_expired: int = 0
    members_rejected: int = 0
    members_duplicates_skipped: int = 0

    # Lockers counts
    lockers_read: int = 0
    lockers_imported: int = 0
    lockers_staff_reserved: int = 0
    lockers_available: int = 0
    lockers_duplicates_skipped: int = 0

    # Execution status
    committed_to_db: bool = False
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def locate_legacy_workbooks(excel_dir: Path) -> dict[str, Path]:
    """Find the 4 legacy Excel files in the target directory."""
    files: dict[str, Path] = {}
    for p in excel_dir.glob("*.xlsx"):
        name_lower = p.name.lower()
        if "gasto" in name_lower:
            files["staff"] = p
        elif "turno" in name_lower or "casillero" in name_lower:
            files["lockers"] = p
        elif "socio" in name_lower and "lista" in name_lower:
            files["members"] = p
        elif "membres" in name_lower:
            files["memberships"] = p

    missing = [k for k in ("staff", "lockers", "members", "memberships") if k not in files]
    if missing:
        raise FileNotFoundError(
            f"Missing required legacy workbooks in {excel_dir}: {', '.join(missing)}"
        )
    return files


def extract_staff_rows(path: Path) -> list[StaffImportRow]:
    """Extract staff names, positions, and salaries from Control de gastos.xlsx."""
    wb = openpyxl.load_workbook(path, data_only=True)
    if "CONTROL DE GASTOS" not in wb.sheetnames:
        wb.close()
        raise ValueError(f"Sheet 'CONTROL DE GASTOS' not found in {path.name}")

    ws = wb["CONTROL DE GASTOS"]
    rows: list[StaffImportRow] = []

    # Rows 4 to 12 contain the staff members in col K (11) and monthly salary in col Q (17)
    for r in range(4, 13):
        name_raw = ws.cell(row=r, column=11).value
        if not name_raw:
            continue
        full_name = str(name_raw).strip()
        if full_name.upper().startswith("GRAN TOTAL"):
            continue

        weekly = ws.cell(row=r, column=13).value or 0
        monthly = ws.cell(row=r, column=17).value or (weekly * 4)

        try:
            weekly_minor = int(float(weekly) * 100)
            monthly_minor = int(float(monthly) * 100)
        except (ValueError, TypeError):
            weekly_minor = 0
            monthly_minor = 0

        # Assign operational position
        upper_name = full_name.upper()
        if any(front in upper_name for front in ("SILVIA", "SHEILA")):
            position = "Recepción"
        elif "EMIGDIO" in upper_name:
            position = "Head Coach"
        else:
            position = "Coach / Staff"

        rows.append(
            StaffImportRow(
                full_name=full_name.title(),
                position=position,
                monthly_salary_minor=monthly_minor,
                weekly_salary_minor=weekly_minor,
            )
        )

    wb.close()
    return rows


def extract_locker_rows(path: Path) -> list[LockerImportRow]:
    """Extract locker numbers, status, and occupancy from Control de turno Regardles.xlsx."""
    wb = openpyxl.load_workbook(path, data_only=True)
    if "CASILLEROS" not in wb.sheetnames:
        wb.close()
        raise ValueError(f"Sheet 'CASILLEROS' not found in {path.name}")

    ws = wb["CASILLEROS"]
    rows: list[LockerImportRow] = []

    for r in range(4, 50):
        num_raw = ws.cell(row=r, column=1).value
        if num_raw is None:
            continue
        try:
            locker_num = int(num_raw)
        except (ValueError, TypeError):
            continue

        status_raw = str(ws.cell(row=r, column=2).value or "").strip().upper()
        occupant_raw = ws.cell(row=r, column=3).value
        date_raw = ws.cell(row=r, column=4).value
        objects_raw = str(ws.cell(row=r, column=5).value or "").strip().upper()

        occupant = str(occupant_raw).strip() if occupant_raw and str(occupant_raw).strip() not in ("N/A", "None") else None
        occupant_until = parse_spanish_date(date_raw)
        has_objects = objects_raw == "SI"

        # CheckConstraint: status IN ('available', 'employee', 'out_of_service')
        if occupant and "COACH" in occupant.upper():
            db_status = "employee"
        else:
            db_status = "available"

        rows.append(
            LockerImportRow(
                locker_number=locker_num,
                code=f"l-{locker_num:02d}",
                status=db_status,
                occupant_name=occupant,
                occupant_until=occupant_until,
                has_objects=has_objects,
            )
        )

    wb.close()
    return rows


def extract_plans_and_memberships(path: Path) -> tuple[dict[str, PlanImportRow], dict[str, dict[str, Any]]]:
    """Extract distinct plan catalog items and latest memberships per member."""
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active

    plan_stats: dict[str, dict[str, Any]] = {}
    latest_memberships: dict[str, dict[str, Any]] = {}

    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue

        plan_raw = row[1]
        if not plan_raw:
            continue
        plan_name = str(plan_raw).strip()

        member_num_raw = row[8]
        if member_num_raw is None:
            continue
        member_number = str(member_num_raw).strip()

        starts_on = parse_spanish_date(row[9])
        ends_on = parse_spanish_date(row[10])

        price_raw = row[16]  # Costo Final
        price_minor = 0
        if price_raw is not None:
            try:
                price_minor = int(float(price_raw) * 100)
            except (ValueError, TypeError):
                pass

        # Update plan catalog stats
        if plan_name not in plan_stats:
            plan_stats[plan_name] = {"count": 0, "prices": [], "days": []}
        plan_stats[plan_name]["count"] += 1
        if price_minor > 0:
            plan_stats[plan_name]["prices"].append(price_minor)
        if starts_on and ends_on:
            days = (ends_on - starts_on).days
            if days > 0:
                plan_stats[plan_name]["days"].append(days)

        # Track latest membership for member
        if ends_on:
            existing = latest_memberships.get(member_number)
            if existing is None or (existing["ends_on"] is not None and ends_on > existing["ends_on"]):
                latest_memberships[member_number] = {
                    "plan_name": plan_name,
                    "starts_on": starts_on,
                    "ends_on": ends_on,
                    "price_minor": price_minor,
                }

    wb.close()

    # Build PlanImportRow catalog
    plan_rows: dict[str, PlanImportRow] = {}
    for name, stats in plan_stats.items():
        code = normalize_plan_code(name)
        # Ensure code uniqueness if multiple plans normalize to same slug
        orig_code = code
        suffix = 2
        while code in plan_rows:
            code = f"{orig_code[:44]}_{suffix}"
            suffix += 1

        avg_days = sum(stats["days"]) // len(stats["days"]) if stats["days"] else None
        duration_value, duration_unit = derive_plan_duration(name, avg_days)
        # Default price is median or first positive price, or 0
        prices = stats["prices"]
        default_price = sorted(prices)[len(prices) // 2] if prices else 0

        plan_rows[code] = PlanImportRow(
            raw_name=name,
            code=code,
            duration_value=duration_value,
            duration_unit=duration_unit,
            price_minor=default_price,
        )

    return plan_rows, latest_memberships


def extract_member_rows(
    path: Path,
    latest_memberships: dict[str, dict[str, Any]],
    cutover_date: date,
) -> list[MemberImportRow]:
    """Extract 4,337 member rows and determine active status against cutover date."""
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    rows: list[MemberImportRow] = []

    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue

        num_raw = row[0]
        if num_raw is None:
            continue
        member_number = str(num_raw).strip()
        if not member_number:
            continue

        full_name = derive_member_name(row[1], row[2], row[3])
        preferred_name = str(row[4]).strip() if row[4] else None

        phone_raw = str(row[12]).strip() if row[12] else ""
        if len(phone_raw) >= 10:
            phone = phone_raw
        else:
            phone = build_fallback_phone(member_number)

        email_raw = str(row[13]).strip() if row[13] else ""
        email = email_raw if "@" in email_raw else None

        birth_date = parse_spanish_date(row[14])
        joined_on = parse_spanish_date(row[16]) or cutover_date

        # Active evaluation: ends_on >= cutover_date
        mem = latest_memberships.get(member_number)
        is_active = False
        plan_name = None
        ends_on = None
        if mem and mem.get("ends_on"):
            ends_on = mem["ends_on"]
            plan_name = mem.get("plan_name")
            if ends_on >= cutover_date:
                is_active = True

        rows.append(
            MemberImportRow(
                member_number=member_number,
                full_name=full_name,
                preferred_name=preferred_name,
                phone=phone,
                email=email,
                birth_date=birth_date,
                joined_on=joined_on,
                is_active=is_active,
                latest_membership_plan=plan_name,
                latest_membership_ends=ends_on,
            )
        )

    wb.close()
    return rows


def execute_legacy_import(
    session: Session,
    excel_dir: Path,
    cutover_date: date,
    branch_code: str = "central",
    branch_name: str = "Sucursal Centro",
    commit: bool = False,
) -> LegacyImportReconciliation:
    """Run deterministic ETL over legacy Excel workbooks.

    If commit=False (dry-run mode), zero changes are persisted to the database.
    """
    reconciliation = LegacyImportReconciliation(
        excel_dir=str(excel_dir),
        cutover_date=cutover_date.isoformat(),
        dry_run=not commit,
    )

    now_utc = datetime.now(timezone.utc)
    workbooks = locate_legacy_workbooks(excel_dir)

    # 1. Branch setup
    branch = session.scalar(select(Branch).where(Branch.code == branch_code))
    if branch is None:
        branch = Branch(
            code=branch_code,
            name=branch_name,
            timezone="America/Mexico_City",
            is_active=True,
        )
        session.add(branch)
        session.flush()

    # 2. System staff user for provenance
    system_user = session.scalar(
        select(StaffUser).where(StaffUser.login_identifier == "legacy_import_system")
    )
    if system_user is None:
        system_user = StaffUser(
            login_identifier="legacy_import_system",
            is_active=True,
        )
        session.add(system_user)
        session.flush()

    # 3. Base Gym Service setup
    service = session.scalar(select(Service).where(Service.code == "gym"))
    if service is None:
        service = Service(
            code="gym",
            name="Gimnasio",
            status="active",
            created_at=now_utc,
            updated_at=now_utc,
        )
        session.add(service)
        session.flush()

    # 4. Extract and import Staff
    staff_rows = extract_staff_rows(workbooks["staff"])
    reconciliation.staff_read = len(staff_rows)
    for staff in staff_rows:
        existing = session.scalar(
            select(StaffRosterProfile).where(
                StaffRosterProfile.branch_id == branch.id,
                StaffRosterProfile.full_name == staff.full_name,
            )
        )
        if existing is None:
            profile = StaffRosterProfile(
                branch_id=branch.id,
                full_name=staff.full_name,
                position=staff.position,
                monthly_salary_minor=staff.monthly_salary_minor,
                is_active=True,
                created_at=now_utc,
                updated_at=now_utc,
            )
            session.add(profile)
            reconciliation.staff_imported += 1
        else:
            existing.monthly_salary_minor = staff.monthly_salary_minor
            existing.position = staff.position
            existing.updated_at = now_utc

    session.flush()

    # 5. Extract and import Plan Catalog
    plan_rows, latest_memberships = extract_plans_and_memberships(workbooks["memberships"])
    reconciliation.plans_read = len(plan_rows)

    plan_version_map: dict[str, PlanVersion] = {}
    for plan_row in plan_rows.values():
        existing_plan = session.scalar(select(Plan).where(Plan.code == plan_row.code))
        if existing_plan is None:
            new_plan = Plan(
                code=plan_row.code,
                name=plan_row.raw_name,
                kind="membership",
                status="active",
                created_at=now_utc,
                updated_at=now_utc,
            )
            session.add(new_plan)
            session.flush()

            version = PlanVersion(
                plan_id=new_plan.id,
                version_number=1,
                name=plan_row.raw_name,
                price_minor=plan_row.price_minor,
                currency="MXN",
                duration_value=plan_row.duration_value,
                duration_unit=plan_row.duration_unit,
                entitlement_mode="period",
                is_active=True,
                published_at=now_utc,
            )
            session.add(version)
            session.flush()

            link = PlanVersionService(
                plan_version_id=version.id,
                service_id=service.id,
            )
            session.add(link)
            reconciliation.plans_imported += 1
            plan_version_map[plan_row.code] = version
        else:
            reconciliation.plans_existing += 1
            # Retrieve latest version
            ver = session.scalar(
                select(PlanVersion)
                .where(PlanVersion.plan_id == existing_plan.id)
                .order_by(PlanVersion.version_number.desc())
            )
            if ver:
                plan_version_map[plan_row.code] = ver

    session.flush()

    # 6. Extract and import Lockers (Rental Assets)
    locker_rows = extract_locker_rows(workbooks["lockers"])
    reconciliation.lockers_read = len(locker_rows)
    for locker in locker_rows:
        existing_asset = session.scalar(
            select(RentalAsset).where(
                RentalAsset.branch_id == branch.id,
                RentalAsset.locker_number == locker.locker_number,
            )
        )
        if existing_asset is None:
            asset = RentalAsset(
                branch_id=branch.id,
                kind="locker",
                code=locker.code,
                price_minor=0,
                deposit_minor=0,
                status=locker.status,
                locker_number=locker.locker_number,
                created_by=system_user.id,
                created_at=now_utc,
            )
            session.add(asset)
            reconciliation.lockers_imported += 1
            if locker.status == "employee":
                reconciliation.lockers_staff_reserved += 1
            else:
                reconciliation.lockers_available += 1
        else:
            reconciliation.lockers_duplicates_skipped += 1

    session.flush()

    # 7. Extract and import Members
    member_rows = extract_member_rows(workbooks["members"], latest_memberships, cutover_date)
    reconciliation.members_read = len(member_rows)

    # Fetch existing member numbers to prevent unique constraint conflicts
    existing_member_numbers = set(
        session.scalars(select(Member.member_number)).all()
    )

    members_to_insert: list[Member] = []
    for m in member_rows:
        if m.member_number in existing_member_numbers:
            reconciliation.members_duplicates_skipped += 1
            continue

        status = "active" if m.is_active else "expired"
        if m.is_active:
            reconciliation.members_active += 1
        else:
            reconciliation.members_expired += 1

        notes = f"Migración histórica 20261015. Plan anterior: {m.latest_membership_plan or 'N/A'}"
        if m.latest_membership_ends:
            notes += f" (Venció: {m.latest_membership_ends.isoformat()})"

        member_obj = Member(
            member_number=m.member_number,
            full_name=m.full_name,
            preferred_name=m.preferred_name,
            phone=m.phone,
            email=m.email,
            birth_date=m.birth_date,
            joined_on=m.joined_on,
            status=status,
            credit_balance_minor=0,
            notes=notes,
            created_at=now_utc,
            updated_at=now_utc,
        )
        members_to_insert.append(member_obj)
        existing_member_numbers.add(m.member_number)

    # Batch add members
    session.add_all(members_to_insert)
    session.flush()
    reconciliation.members_imported = len(members_to_insert)

    # 8. Dry-run vs Commit outcome
    if commit:
        session.commit()
        reconciliation.committed_to_db = True
    else:
        session.rollback()
        reconciliation.committed_to_db = False

    return reconciliation

"""Unit and integration tests for deterministic legacy data ETL and dry-run protection.

Follows P12 specification (P12-import-and-release-readiness.md).
"""
from datetime import date, datetime, timezone
from pathlib import Path
import tempfile

import openpyxl
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import Branch, Member, Plan, PlanVersion, RentalAsset, StaffRosterProfile
from app.importing.mapping import (
    build_fallback_phone,
    derive_member_name,
    derive_plan_duration,
    normalize_plan_code,
    parse_spanish_date,
)
from app.importing.service import execute_legacy_import, locate_legacy_workbooks


# --- Mapping Unit Tests --------------------------------------------------------------------

def test_parse_spanish_date():
    assert parse_spanish_date("abr/22/24") == date(2024, 4, 22)
    assert parse_spanish_date("ene/05/26") == date(2026, 1, 5)
    assert parse_spanish_date("dic/31/25") == date(2025, 12, 31)
    assert parse_spanish_date(datetime(2026, 3, 16, 10, 0)) == date(2026, 3, 16)
    assert parse_spanish_date(date(2026, 10, 16)) == date(2026, 10, 16)
    assert parse_spanish_date(None) is None
    assert parse_spanish_date("N/A") is None
    assert parse_spanish_date("invalid") is None


def test_normalize_plan_code():
    assert normalize_plan_code("1) GYM") == "gym"
    assert normalize_plan_code("3) GYM DESCUENTO ESTUDIANTE") == "gym_descuento_estudiante"
    assert normalize_plan_code("PESAS Y CARDIO") == "pesas_y_cardio"
    assert normalize_plan_code("6) SEMANA GYM") == "semana_gym"
    assert normalize_plan_code("9A) 3 MESES GYM") == "3_meses_gym"
    assert normalize_plan_code("Visita") == "visita"


def test_derive_plan_duration():
    assert derive_plan_duration("ANUALIDAD") == (1, "year")
    assert derive_plan_duration("SEMESTRE GYM") == (6, "month")
    assert derive_plan_duration("3 MESES GYM") == (3, "month")
    assert derive_plan_duration("BIMESTRE") == (2, "month")
    assert derive_plan_duration("SEMANA GYM") == (7, "day")
    assert derive_plan_duration("VISITA") == (1, "day")
    assert derive_plan_duration("GYM MENSUAL") == (1, "month")


def test_build_fallback_phone():
    assert build_fallback_phone(5606) == "+525500005606"
    assert build_fallback_phone("12") == "+525500000012"
    assert build_fallback_phone(7237) == "+525500007237"


def test_derive_member_name():
    assert derive_member_name("Juan", "Perez", "Lopez") == "Juan Perez Lopez"
    assert derive_member_name("Maria", "Gomez", None) == "Maria Gomez"
    assert derive_member_name("SingleName", None, None) == "SingleName"
    assert derive_member_name(None, None, None) == "Sin Nombre"


# --- Synthetic Fixtures and ETL Integration Tests -----------------------------------------

@pytest.fixture
def synthetic_excel_dir(tmp_path: Path) -> Path:
    """Create miniature synthetic Excel files mimicking the 4 legacy workbooks."""
    # 1. Staff file: Control de gastos.xlsx
    staff_wb = openpyxl.Workbook()
    ws_staff = staff_wb.active
    ws_staff.title = "CONTROL DE GASTOS"
    # Row 4: Silvia
    ws_staff.cell(row=4, column=11, value="SILVIA")
    ws_staff.cell(row=4, column=13, value=2000)
    ws_staff.cell(row=4, column=17, value=8000)
    # Row 5: Emigdio
    ws_staff.cell(row=5, column=11, value="EMIGDIO")
    ws_staff.cell(row=5, column=13, value=3500)
    ws_staff.cell(row=5, column=17, value=14000)
    staff_wb.save(tmp_path / "Control de gastos.xlsx")
    staff_wb.close()

    # 2. Lockers file: Control de turno Regardles.xlsx
    lockers_wb = openpyxl.Workbook()
    ws_lockers = lockers_wb.active
    ws_lockers.title = "CASILLEROS"
    ws_lockers.cell(row=3, column=1, value="LOCKER")
    ws_lockers.cell(row=3, column=2, value="ESTADO")
    ws_lockers.cell(row=3, column=3, value="NOMBRE")
    # Locker 1: Available
    ws_lockers.cell(row=4, column=1, value=1)
    ws_lockers.cell(row=4, column=2, value="DISPONIBLE")
    # Locker 2: Reserved for coach
    ws_lockers.cell(row=5, column=1, value=2)
    ws_lockers.cell(row=5, column=2, value="OCUPADO")
    ws_lockers.cell(row=5, column=3, value="Coach Box")
    lockers_wb.save(tmp_path / "Control de turno Regardles.xlsx")
    lockers_wb.close()

    # 3. Memberships file: Membresías agregadas a socios hoy (17776 Membresías)_20261016.xlsx
    mem_wb = openpyxl.Workbook()
    ws_mem = mem_wb.active
    ws_mem.title = "in"
    ws_mem.append(["ID", "Nombre de Membresía", "Fecha Agregada", "Hora Agregada", "Agregada Por",
                   "Nombre del Socio", "Apellido del Socio", "Teléfono Celular", "Número de Socio",
                   "Comienza", "Termina", "Precio de Membresía", "I.V.A.", "Costo de Inscripción",
                   "Descuento", "Motivo por el descuento", "Costo Final"])
    # Member 101: Active membership ending in 2026-11-15
    ws_mem.append([1, "PESAS Y CARDIO", "oct/01/26", "10:00", "ADMIN", "Juan", "Perez", None, 101,
                   "oct/01/26", "nov/15/26", 500, 0, 0, 0, None, 500])
    # Member 102: Expired membership ending in 2025-05-01
    ws_mem.append([2, "VISITA", "abr/30/25", "10:00", "ADMIN", "Maria", "Lopez", None, 102,
                   "abr/30/25", "may/01/25", 50, 0, 0, 0, None, 50])
    mem_wb.save(tmp_path / "Membresías agregadas a socios hoy (17776 Membresías)_20261016.xlsx")
    mem_wb.close()

    # 4. Members file: Lista de todos los socios (4337 Socios)_20261015.csv.xlsx
    soc_wb = openpyxl.Workbook()
    ws_soc = soc_wb.active
    ws_soc.title = "Lista de todos los socios"
    headers = ["Número de Socio", "Nombre", "Apellido Paterno", "Apellido Materno",
               "Le gusta ser llamado(a) por", "Domicilio", "Colonia", "Ciudad", "Estado", "CP",
               "Tel Casa", "Tel Trabajo", "Teléfono Celular", "Correo Electrónico (e-mail)",
               "Fecha de Nacimiento", "Estado de Cuenta", "Fecha de Registro"]
    ws_soc.append(headers)
    # Row 1: Member 101 (has phone)
    ws_soc.append([101, "Juan", "Perez", "Gomez", "Juanito", None, None, None, None, None,
                   None, None, "+525512345678", "juan@test.com", "ene/15/90", "Activo", "ago/10/24"])
    # Row 2: Member 102 (no phone -> will use fallback)
    ws_soc.append([102, "Maria", "Lopez", None, None, None, None, None, None, None,
                   None, None, None, None, None, "Activo", "mar/12/25"])
    soc_wb.save(tmp_path / "Lista de todos los socios (4337 Socios)_20261015.csv.xlsx")
    soc_wb.close()

    return tmp_path


def test_locate_legacy_workbooks(synthetic_excel_dir: Path):
    found = locate_legacy_workbooks(synthetic_excel_dir)
    assert "staff" in found
    assert "lockers" in found
    assert "members" in found
    assert "memberships" in found


def test_execute_legacy_import_dry_run_vs_commit(synthetic_excel_dir: Path):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)

    cutover = date(2026, 10, 16)

    # 1. DRY-RUN MODE: must write zero records
    with factory() as session:
        recon_dry = execute_legacy_import(
            session=session,
            excel_dir=synthetic_excel_dir,
            cutover_date=cutover,
            commit=False,
        )

        assert recon_dry.dry_run is True
        assert recon_dry.committed_to_db is False
        assert recon_dry.staff_read == 2
        assert recon_dry.plans_read == 2
        assert recon_dry.lockers_read == 2
        assert recon_dry.members_read == 2
        assert recon_dry.members_active == 1  # Member 101 ending in Nov 2026
        assert recon_dry.members_expired == 1  # Member 102 ending in May 2025

    # Verify zero database writes occurred
    with factory() as session:
        assert session.scalar(select(Branch)) is None
        assert session.scalar(select(Member)) is None
        assert session.scalar(select(Plan)) is None
        assert session.scalar(select(RentalAsset)) is None
        assert session.scalar(select(StaffRosterProfile)) is None

    # 2. COMMIT MODE: records are persisted
    with factory() as session:
        recon_commit = execute_legacy_import(
            session=session,
            excel_dir=synthetic_excel_dir,
            cutover_date=cutover,
            commit=True,
        )

        assert recon_commit.dry_run is False
        assert recon_commit.committed_to_db is True
        assert recon_commit.members_imported == 2
        assert recon_commit.plans_imported == 2
        assert recon_commit.lockers_imported == 2
        assert recon_commit.staff_imported == 2

    # Verify persistent records in database
    with factory() as session:
        members = session.scalars(select(Member).order_by(Member.member_number)).all()
        assert len(members) == 2
        m101 = members[0]
        assert m101.member_number == "101"
        assert m101.full_name == "Juan Perez Gomez"
        assert m101.status == "active"
        assert m101.phone == "+525512345678"
        assert m101.birth_date == date(1990, 1, 15)

        m102 = members[1]
        assert m102.member_number == "102"
        assert m102.full_name == "Maria Lopez"
        assert m102.status == "expired"
        assert m102.phone == "+525500000102"  # Deterministic fallback phone

        staff = session.scalars(select(StaffRosterProfile)).all()
        assert len(staff) == 2

        lockers = session.scalars(select(RentalAsset).order_by(RentalAsset.locker_number)).all()
        assert len(lockers) == 2
        assert lockers[0].status == "available"
        assert lockers[1].status == "employee"

    # 3. IDEMPOTENT RE-RUN: zero duplicate errors, duplicate rows skipped
    with factory() as session:
        recon_rerun = execute_legacy_import(
            session=session,
            excel_dir=synthetic_excel_dir,
            cutover_date=cutover,
            commit=True,
        )
        assert recon_rerun.members_duplicates_skipped == 2
        assert recon_rerun.members_imported == 0
        assert recon_rerun.plans_existing == 2
        assert recon_rerun.plans_imported == 0
        assert recon_rerun.lockers_duplicates_skipped == 2
        assert recon_rerun.lockers_imported == 0

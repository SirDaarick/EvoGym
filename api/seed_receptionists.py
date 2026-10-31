"""Seed additional receptionists and staff schedules into dev.db."""
import sys
from datetime import date, time
from pathlib import Path

# Add api directory to sys.path
api_dir = Path(__file__).resolve().parent
if str(api_dir) not in sys.path:
    sys.path.insert(0, str(api_dir))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.staff_schedules import _load_zone
from app.auth.hashing import hash_pin
from app.db.models import (
    Branch,
    RoleGrant,
    StaffCredential,
    StaffRosterProfile,
    StaffScheduleSeries,
    StaffUser,
)
from app.settings import get_settings


def _get_default_factory():
    try:
        db_url = get_settings().require_database_url()
        engine = create_engine(db_url)
        return sessionmaker(engine)
    except Exception:
        db_file = api_dir / "dev.db"
        if db_file.exists():
            db_url = f"sqlite+pysqlite:///{db_file.as_posix()}"
            engine = create_engine(db_url)
            return sessionmaker(engine)
        raise RuntimeError("No valid database configuration found (neither EVOGYM_DATABASE_URL nor dev.db).")


# ISO Weekday reference: 0 = Lunes, 1 = Martes, 2 = Miércoles, 3 = Jueves, 4 = Viernes, 5 = Sábado, 6 = Domingo
RECEPTIONISTS = [
    {
        "login": "valeria",
        "full_name": "Valeria Gómez",
        "position": "Recepción",
        "pin": "123456",
        "expected_entry_time": time(6, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(6, 0),
            "end_time": time(14, 0),
            "weekdays": [0, 2, 4],  # Lunes, Miércoles, Viernes (Turno hoy)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "login": "rodrigo",
        "full_name": "Rodrigo Morales",
        "position": "Recepción",
        "pin": "123456",
        "expected_entry_time": time(14, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(14, 0),
            "end_time": time(22, 0),
            "weekdays": [0, 2, 4],  # Lunes, Miércoles, Viernes (Turno hoy)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "login": "camila",
        "full_name": "Camila Torres",
        "position": "Recepción",
        "pin": "123456",
        "expected_entry_time": time(8, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(8, 0),
            "end_time": time(16, 0),
            "weekdays": [1, 3],  # Martes y Jueves (Descanso hoy -> Modal)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "login": "diego",
        "full_name": "Diego Ramírez",
        "position": "Recepción",
        "pin": "123456",
        "expected_entry_time": time(8, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(8, 0),
            "end_time": time(14, 0),
            "weekdays": [5, 6],  # Sábado y Domingo (Fin de semana -> Modal)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "login": "sheila",
        "full_name": "Sheila Rivera",
        "position": "Recepción",
        "pin": "123456",
        "expected_entry_time": time(7, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(7, 0),
            "end_time": time(15, 0),
            "weekdays": [1, 3, 5],  # Martes, Jueves, Sábado (Descanso hoy -> Modal)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "login": "maho",
        "full_name": "Maho Shizuki",
        "position": "Recepción",
        "pin": "123456",
        "expected_entry_time": time(15, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(15, 0),
            "end_time": time(23, 0),
            "weekdays": [3, 4, 5, 6],  # Jueves a Domingo (Descanso hoy -> Modal)
            "start_date": date(2026, 1, 1),
        },
    },
]

OTHER_STAFF = [
    {
        "full_name": "Emigdio Sánchez",
        "position": "Entrenador",
        "expected_entry_time": time(6, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(6, 0),
            "end_time": time(14, 0),
            "weekdays": [0, 2, 4],  # Lun, Mié, Vie (Turno hoy)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "full_name": "Mikel Arrieta",
        "position": "Entrenador",
        "expected_entry_time": time(14, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(14, 0),
            "end_time": time(22, 0),
            "weekdays": [1, 3, 5],  # Mar, Jue, Sáb (Descanso hoy)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "full_name": "Charly Navarro",
        "position": "Entrenador",
        "expected_entry_time": time(14, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(14, 0),
            "end_time": time(22, 0),
            "weekdays": [0, 2, 4],  # Lun, Mié, Vie (Turno hoy)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "full_name": "Tadeo Lozano",
        "position": "Entrenador",
        "expected_entry_time": time(8, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(8, 0),
            "end_time": time(16, 0),
            "weekdays": [1, 3],  # Mar, Jue (Descanso hoy)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "full_name": "Silvia Morales",
        "position": "Mantenimiento",
        "expected_entry_time": time(6, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(6, 0),
            "end_time": time(14, 0),
            "weekdays": [0, 2, 4],  # Lun, Mié, Vie (Turno hoy)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "full_name": "Alan Castillo",
        "position": "Mantenimiento",
        "expected_entry_time": time(6, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(6, 0),
            "end_time": time(14, 0),
            "weekdays": [1, 3, 5],  # Mar, Jue, Sáb (Descanso hoy)
            "start_date": date(2026, 1, 1),
        },
    },
    {
        "full_name": "Iñaky Paredes",
        "position": "Entrenador",
        "expected_entry_time": time(8, 0),
        "grace_tolerance_minutes": 15,
        "schedule": {
            "start_time": time(8, 0),
            "end_time": time(14, 0),
            "weekdays": [5, 6],  # Sáb, Dom (Descanso hoy)
            "start_date": date(2026, 1, 1),
        },
    },
]


def seed(session_factory=None):
    factory = session_factory or _get_default_factory()
    with factory.begin() as session:
        # Find branch
        branch = session.scalar(select(Branch).where(Branch.code == "central"))
        if branch is None:
            branch = session.scalar(select(Branch))
        if branch is None:
            print("Error: No branch found in database.")
            return

        branch_id = branch.id
        _zone, digest = _load_zone(branch.timezone)

        # Find creator user (admin or first user)
        admin = session.scalar(
            select(StaffUser).where(StaffUser.login_identifier == "admin@evogym.com")
        )
        if admin is None:
            admin = session.scalar(select(StaffUser))
        creator_id = admin.id if admin else None

        # 1. Update existing Recepcionista Centro schedule: Lunes a Miércoles
        recepcion_profile = session.scalar(
            select(StaffRosterProfile).where(
                StaffRosterProfile.branch_id == branch_id,
                StaffRosterProfile.full_name == "Recepcionista Centro",
            )
        )
        if recepcion_profile:
            recepcion_profile.expected_entry_time = time(9, 0)
            recepcion_profile.grace_tolerance_minutes = 15
            sched_row = session.scalar(
                select(StaffScheduleSeries).where(
                    StaffScheduleSeries.profile_id == recepcion_profile.id
                )
            )
            if sched_row:
                sched_row.weekdays = [0, 1, 2]  # Lunes, Martes, Miércoles
                sched_row.start_time = time(9, 0)
                sched_row.end_time = time(17, 0)
                sched_row.timezone_rules_digest = digest
                print(f"Updated schedule for {recepcion_profile.full_name} -> [0, 1, 2] (Lun, Mar, Mié)")
            elif creator_id:
                series = StaffScheduleSeries(
                    profile_id=recepcion_profile.id,
                    branch_id=branch_id,
                    start_date=date(2026, 1, 1),
                    weekdays=[0, 1, 2],
                    start_time=time(9, 0),
                    end_time=time(17, 0),
                    created_by=creator_id,
                    timezone_rules_digest=digest,
                )
                session.add(series)
                print(f"Added schedule for {recepcion_profile.full_name}")

        # 2. Add / Update Receptionists
        for r in RECEPTIONISTS:
            existing_user = session.scalar(
                select(StaffUser).where(StaffUser.login_identifier == r["login"])
            )
            if existing_user is None:
                staff_user = StaffUser(login_identifier=r["login"], is_active=True)
                session.add(staff_user)
                session.flush()
                staff_id = staff_user.id

                # Credential & Grant
                cred = StaffCredential(
                    staff_id=staff_id,
                    method="pin",
                    secret_hash=hash_pin(r["pin"]),
                )
                grant = RoleGrant(
                    staff_id=staff_id,
                    role="receptionist",
                    scope_kind="branch",
                    branch_id=branch_id,
                )
                session.add_all([cred, grant])
            else:
                staff_id = existing_user.id

            # Roster Profile
            existing_profile = session.scalar(
                select(StaffRosterProfile).where(
                    StaffRosterProfile.branch_id == branch_id,
                    StaffRosterProfile.full_name == r["full_name"],
                )
            )
            if existing_profile is None:
                profile = StaffRosterProfile(
                    branch_id=branch_id,
                    staff_user_id=staff_id,
                    full_name=r["full_name"],
                    position=r["position"],
                    expected_entry_time=r["expected_entry_time"],
                    grace_tolerance_minutes=r["grace_tolerance_minutes"],
                    is_active=True,
                )
                session.add(profile)
                session.flush()
                profile_id = profile.id
            else:
                profile_id = existing_profile.id
                existing_profile.staff_user_id = staff_id
                existing_profile.expected_entry_time = r["expected_entry_time"]
                existing_profile.grace_tolerance_minutes = r["grace_tolerance_minutes"]

            # Schedule Series
            sched = r["schedule"]
            existing_sched = session.scalar(
                select(StaffScheduleSeries).where(
                    StaffScheduleSeries.profile_id == profile_id
                )
            )
            if existing_sched:
                existing_sched.weekdays = sched["weekdays"]
                existing_sched.start_time = sched["start_time"]
                existing_sched.end_time = sched["end_time"]
                existing_sched.start_date = sched["start_date"]
                existing_sched.timezone_rules_digest = digest
            elif creator_id:
                series = StaffScheduleSeries(
                    profile_id=profile_id,
                    branch_id=branch_id,
                    start_date=sched["start_date"],
                    weekdays=sched["weekdays"],
                    start_time=sched["start_time"],
                    end_time=sched["end_time"],
                    created_by=creator_id,
                    timezone_rules_digest=digest,
                )
                session.add(series)

            dias_desc = "Lun, Mié, Vie" if sched["weekdays"] == [0, 2, 4] else "Mar, Jue" if sched["weekdays"] == [1, 3] else "Sáb, Dom" if sched["weekdays"] == [5, 6] else "Mar, Jue, Sáb" if sched["weekdays"] == [1, 3, 5] else "Jue a Dom" if sched["weekdays"] == [3, 4, 5, 6] else str(sched["weekdays"])
            print(f"Configured receptionist: {r['full_name']} (@{r['login']}) -> Días: {dias_desc} ({sched['start_time'].strftime('%H:%M')} - {sched['end_time'].strftime('%H:%M')})")

        # 3. Add / Update Other Staff (Trainers, Maintenance)
        for s in OTHER_STAFF:
            existing_profile = session.scalar(
                select(StaffRosterProfile).where(
                    StaffRosterProfile.branch_id == branch_id,
                    StaffRosterProfile.full_name == s["full_name"],
                )
            )
            if existing_profile is None:
                profile = StaffRosterProfile(
                    branch_id=branch_id,
                    full_name=s["full_name"],
                    position=s["position"],
                    expected_entry_time=s["expected_entry_time"],
                    grace_tolerance_minutes=s["grace_tolerance_minutes"],
                    is_active=True,
                )
                session.add(profile)
                session.flush()
                profile_id = profile.id
            else:
                profile_id = existing_profile.id
                existing_profile.position = s["position"]
                existing_profile.expected_entry_time = s["expected_entry_time"]
                existing_profile.grace_tolerance_minutes = s["grace_tolerance_minutes"]

            # Schedule Series
            sched = s["schedule"]
            existing_sched = session.scalar(
                select(StaffScheduleSeries).where(
                    StaffScheduleSeries.profile_id == profile_id
                )
            )
            if existing_sched:
                existing_sched.weekdays = sched["weekdays"]
                existing_sched.start_time = sched["start_time"]
                existing_sched.end_time = sched["end_time"]
                existing_sched.start_date = sched["start_date"]
                existing_sched.timezone_rules_digest = digest
            elif creator_id:
                series = StaffScheduleSeries(
                    profile_id=profile_id,
                    branch_id=branch_id,
                    start_date=sched["start_date"],
                    weekdays=sched["weekdays"],
                    start_time=sched["start_time"],
                    end_time=sched["end_time"],
                    created_by=creator_id,
                    timezone_rules_digest=digest,
                )
                session.add(series)

            print(f"Configured staff: {s['full_name']} ({s['position']}) -> Días: {sched['weekdays']}")

    print("\nDatabase seeding completed successfully.")


if __name__ == "__main__":
    seed()

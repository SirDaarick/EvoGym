"""CLI command for deterministic legacy data migration with dry-run protection.

Follows P12 specification (docs/work-packages/P12-import-and-release-readiness.md).
Defaults to --dry-run (zero database writes). Writes require explicit --commit.
"""
import argparse
from datetime import date, datetime
import os
from pathlib import Path
import sys
import time

# Ensure api directory is in sys.path
api_dir = Path(__file__).resolve().parents[2]
if str(api_dir) not in sys.path:
    sys.path.insert(0, str(api_dir))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.importing.service import execute_legacy_import
from app.settings import get_settings


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="EvoGym Legacy Data Migration Tool (Deterministic ETL)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--excel-dir",
        type=Path,
        default=Path.cwd(),
        help="Directory containing the 4 legacy Excel files",
    )
    parser.add_argument(
        "--database-url",
        type=str,
        default=None,
        help="Target database URL. Defaults to EVOGYM_DATABASE_URL or local dev.db",
    )
    parser.add_argument(
        "--cutover-date",
        type=str,
        default="2026-10-16",
        help="Cutover date (YYYY-MM-DD) used to determine active vs expired memberships",
    )
    parser.add_argument(
        "--branch-code",
        type=str,
        default="central",
        help="Code of branch to associate imported records with",
    )
    parser.add_argument(
        "--branch-name",
        type=str,
        default="Sucursal Centro",
        help="Name of branch if created during import",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        default=False,
        help="Commit mutations to database. By default, executes dry-run with 0 writes.",
    )
    return parser.parse_args(argv)


def get_engine(db_url: str | None):
    if not db_url:
        try:
            settings = get_settings()
            db_url = settings.require_database_url()
        except Exception:
            db_file = api_dir / "dev.db"
            db_url = f"sqlite+pysqlite:///{db_file.as_posix()}"
    return create_engine(db_url)


def print_banner(commit_mode: bool):
    print("=" * 72)
    print("       EVOGYM DETERMINISTIC ETL & DATA MIGRATION ENGINE (P12)       ")
    print("=" * 72)
    if commit_mode:
        print("  MODE: [ COMMIT ] -> PERSISTING MUTATIONS TO DATABASE")
    else:
        print("  MODE: [ DRY-RUN ] -> ZERO PERSISTENT DATABASE WRITES (SAFE REHEARSAL)")
    print("=" * 72)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    start_time = time.time()

    try:
        cutover = date.fromisoformat(args.cutover_date)
    except ValueError:
        print(f"ERROR: Invalid cutover date format '{args.cutover_date}'. Use YYYY-MM-DD.", file=sys.stderr)
        return 1

    excel_dir = args.excel_dir.resolve()
    print_banner(args.commit)
    print(f"Source Directory: {excel_dir}")
    print(f"Cutover Date:     {cutover.isoformat()}")
    print(f"Target Branch:    {args.branch_name} ({args.branch_code})")
    print("-" * 72)

    try:
        engine = get_engine(args.database_url)
        if engine.dialect.name != "postgresql":
            Base.metadata.create_all(engine)
    except Exception as exc:
        print(f"ERROR: Failed to initialize database engine: {exc}", file=sys.stderr)
        return 1

    factory = sessionmaker(bind=engine)
    with factory() as session:
        try:
            recon = execute_legacy_import(
                session=session,
                excel_dir=excel_dir,
                cutover_date=cutover,
                branch_code=args.branch_code,
                branch_name=args.branch_name,
                commit=args.commit,
            )
        except Exception as exc:
            session.rollback()
            print(f"FATAL: Migration failed with exception: {exc}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            return 1

    elapsed = time.time() - start_time

    # Output Reconciliation Report
    print("\n" + "=" * 72)
    print("                 RECONCILIATION AUDIT REPORT                ")
    print("=" * 72)
    print(f" 1. STAFF ROSTER:")
    print(f"    - Read from Sheet:      {recon.staff_read:5d}")
    print(f"    - Profiles Staged:      {recon.staff_imported:5d}")
    print(f" 2. PLAN CATALOG:")
    print(f"    - Distinct Plans:       {recon.plans_read:5d}")
    print(f"    - New Plans Created:    {recon.plans_imported:5d}")
    print(f"    - Existing Reused:      {recon.plans_existing:5d}")
    print(f" 3. LOCKER ASSETS:")
    print(f"    - Total Lockers:        {recon.lockers_read:5d}")
    print(f"    - Available Lockers:    {recon.lockers_available:5d}")
    print(f"    - Reserved for Staff:   {recon.lockers_staff_reserved:5d}")
    print(f"    - Skipped Duplicates:   {recon.lockers_duplicates_skipped:5d}")
    print(f" 4. MEMBERS REGISTER:")
    print(f"    - Total Records Read:   {recon.members_read:5d}")
    print(f"    - Active Members:       {recon.members_active:5d}  (ends_on >= {cutover})")
    print(f"    - Expired Members:      {recon.members_expired:5d}")
    print(f"    - Skipped Duplicates:   {recon.members_duplicates_skipped:5d}")
    print(f"    - Members Staged:       {recon.members_imported:5d}")
    print("-" * 72)

    if recon.committed_to_db:
        print(f" RESULT: SUCCESS -> DATABASE COMMITTED in {elapsed:.2f}s")
    else:
        print(f" RESULT: SUCCESS (DRY-RUN) -> 0 DATABASE WRITES in {elapsed:.2f}s")
    print("=" * 72 + "\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""One-time, operator-run owner bootstrap. Never exposed as an HTTP endpoint."""

import getpass
import os
from urllib.parse import make_url

from sqlalchemy import create_engine

from app.auth.owner import bootstrap_owner
from app.db.session import create_session_factory


def main() -> int:
    if os.environ.get("EVOGYM_ENV") != "test":
        raise SystemExit("Owner bootstrap is disabled unless EVOGYM_ENV=test is explicitly set.")
    database_url = os.environ.get("EVOGYM_BOOTSTRAP_DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("Provide EVOGYM_BOOTSTRAP_DATABASE_URL explicitly; ambient application settings are ignored.")
    parsed = make_url(database_url)
    if parsed.drivername.startswith("sqlite"):
        if parsed.database in {None, "", ":memory:"}:
            raise SystemExit("Use a named disposable test database for owner bootstrap.")
    elif parsed.drivername.startswith("postgresql"):
        if parsed.host not in {"localhost", "127.0.0.1", "::1"} or not parsed.database or "test" not in parsed.database.casefold():
            raise SystemExit("Synthetic bootstrap requires an explicitly named local test database.")
    else:
        raise SystemExit("Synthetic bootstrap supports only local SQLite or PostgreSQL test databases.")
    login = input("New owner login email: ")
    recovery_email = input("Recovery email (unverified until separately confirmed): ")
    password = getpass.getpass("New owner password: ")
    confirmation = getpass.getpass("Confirm owner password: ")
    if password != confirmation:
        raise SystemExit("Password confirmation did not match.")
    engine = create_engine(parsed, hide_parameters=True, pool_pre_ping=True)
    try:
        owner_id = bootstrap_owner(create_session_factory(engine), login, recovery_email, password)
    finally:
        engine.dispose()
    print(f"Owner bootstrap completed for identity {owner_id}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

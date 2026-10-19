from sqlalchemy import Engine, create_engine
from sqlalchemy.pool import Pool

from app.settings import Settings


def create_engine_from_settings(settings: Settings, *, poolclass: type[Pool] | None = None) -> Engine:
    options = {"echo": False, "hide_parameters": True, "pool_pre_ping": True}
    if poolclass is not None:
        options["poolclass"] = poolclass
    return create_engine(settings.require_database_url(), **options)

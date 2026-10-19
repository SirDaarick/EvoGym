from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Metadata registry for application-owned relational models."""

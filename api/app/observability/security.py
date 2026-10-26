"""Allowlisted operational security events stored outside the application database."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
import json
import os
from pathlib import Path
import stat
import time
from contextlib import contextmanager
from threading import RLock
from typing import Iterator
from uuid import UUID

from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.orm import Session


_MARKER = ".evogym-operational-security-log.json"
_LOG = "operational-security.jsonl"
_LOCK_FILE = ".operational-security.lock"
_FORMAT = "evogym-operational-security-log/v1"
_LOCK = RLock()
_LOCK_TIMEOUT_SECONDS = 5.0


class SecurityEventType(StrEnum):
    STAFF_PIN_AUTHENTICATED = "staff_pin_authenticated"
    STAFF_PIN_AUTH_DENIED = "staff_pin_auth_denied"
    STAFF_PIN_LOCKED = "staff_pin_locked"
    STAFF_PIN_CHANGED = "staff_pin_changed"
    STAFF_PIN_RESET = "staff_pin_reset"
    STAFF_DEACTIVATED = "staff_deactivated"
    STAFF_SESSION_ISSUED = "staff_session_issued"
    STAFF_SESSION_REVOKED = "staff_session_revoked"
    DEVICE_PAIRED = "device_paired"
    DEVICE_REVOKED = "device_revoked"
    RECEPTION_STATION_ISSUED = "reception_station_issued"
    RECEPTION_STATION_REVOKED = "reception_station_revoked"
    OWNER_GRANTED = "owner_granted"
    ADMIN_ROLE_GRANTED = "admin_role_granted"
    ADMIN_ROLE_REVOKED = "admin_role_revoked"


class SecurityOutcome(StrEnum):
    SUCCEEDED = "succeeded"
    DENIED = "denied"


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
        raise ValueError("Operational security timestamps must be UTC-aware")
    return value.astimezone(timezone.utc)


@dataclass(frozen=True, slots=True, kw_only=True)
class SecurityEvent:
    event_type: SecurityEventType
    occurred_at: datetime
    outcome: SecurityOutcome
    employee_id: UUID | None = None
    device_id: UUID | None = None
    initiating_actor_id: UUID | None = None
    request_id: UUID | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.event_type, SecurityEventType):
            raise TypeError("Unknown operational security event")
        if not isinstance(self.outcome, SecurityOutcome):
            raise TypeError("Unknown operational security outcome")
        _utc(self.occurred_at)
        for value in (self.employee_id, self.device_id, self.initiating_actor_id, self.request_id):
            if value is not None and not isinstance(value, UUID):
                raise TypeError("Operational security identities must be server-validated UUIDs")

    def as_dict(self) -> dict[str, str | None]:
        return {
            "event_type": self.event_type.value,
            "occurred_at": _utc(self.occurred_at).isoformat(),
            "employee_id": str(self.employee_id) if self.employee_id else None,
            "device_id": str(self.device_id) if self.device_id else None,
            "initiating_actor_id": str(self.initiating_actor_id) if self.initiating_actor_id else None,
            "outcome": self.outcome.value,
            "request_id": str(self.request_id) if self.request_id else None,
        }


def _safe_root(path: str | os.PathLike[str]) -> Path:
    raw = Path(path)
    if not raw.is_absolute() or ".." in raw.parts:
        raise ValueError("Operational security log path must be absolute and traversal-free")
    for part in reversed((raw, *raw.parents)):
        if part.exists() and part.is_symlink():
            raise ValueError("Operational security log path cannot traverse symlinks")
    return raw


@dataclass(frozen=True, slots=True)
class OperationalSecurityLogStore:
    directory: Path
    activated_at: datetime

    @classmethod
    def create_new(cls, directory: str | os.PathLike[str], *, activated_at: datetime | None = None) -> "OperationalSecurityLogStore":
        root = _safe_root(directory)
        if root.exists():
            raise FileExistsError("Operational security log namespace already exists; refusing to adopt existing data")
        root.mkdir(parents=False)
        start = _utc(activated_at or datetime.now(timezone.utc))
        marker = root / _MARKER
        lock_path = root / _LOCK_FILE
        try:
            flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            lock_fd = os.open(lock_path, flags, 0o600)
            try:
                os.write(lock_fd, b"\0")
                os.fsync(lock_fd)
            finally:
                os.close(lock_fd)
            fd = os.open(marker, flags, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                json.dump({"format": _FORMAT, "activated_at": start.isoformat()}, stream, separators=(",", ":"))
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            marker.unlink(missing_ok=True)
            lock_path.unlink(missing_ok=True)
            root.rmdir()
            raise
        return cls(root, start)

    @classmethod
    def open_managed(cls, directory: str | os.PathLike[str]) -> "OperationalSecurityLogStore":
        root = _safe_root(directory)
        if not root.is_dir():
            raise FileNotFoundError("Operational security log namespace is not a managed directory")
        marker = root / _MARKER
        if marker.is_symlink() or not marker.is_file():
            raise ValueError("Operational security log ownership marker is missing or unsafe")
        lock_path = root / _LOCK_FILE
        if lock_path.is_symlink() or not lock_path.is_file() or not stat.S_ISREG(lock_path.lstat().st_mode):
            raise ValueError("Operational security log lock file is missing or unsafe")
        try:
            payload = json.loads(marker.read_text(encoding="utf-8"))
            if set(payload) != {"format", "activated_at"} or payload["format"] != _FORMAT:
                raise ValueError
            activated = _utc(datetime.fromisoformat(payload["activated_at"]))
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            raise ValueError("Operational security log ownership marker is invalid") from None
        store = cls(root, activated)
        with store.locked():
            if marker.is_symlink() or not marker.is_file():
                raise ValueError("Operational security log ownership marker changed during open")
            store._validate_log_path()
        return store

    def _validate_log_path(self) -> Path:
        if self.directory.is_symlink() or not self.directory.is_dir():
            raise ValueError("Operational security log namespace is unsafe")
        log = self.directory / _LOG
        if log.is_symlink():
            raise ValueError("Operational security log file cannot be a symlink")
        if log.exists() and not stat.S_ISREG(log.lstat().st_mode):
            raise ValueError("Operational security log path must be a regular file")
        return log

    @contextmanager
    def locked(self, *, timeout: float = _LOCK_TIMEOUT_SECONDS) -> Iterator[None]:
        """Serialize managed-store reads and writes across threads and processes."""
        if timeout <= 0:
            raise ValueError("Operational security lock timeout must be positive")
        lock_path = self.directory / _LOCK_FILE
        deadline = time.monotonic() + timeout
        if not _LOCK.acquire(timeout=timeout):
            raise TimeoutError("Timed out acquiring operational security log lock")
        try:
            if lock_path.is_symlink() or not lock_path.is_file():
                raise ValueError("Operational security log lock file is missing or unsafe")
            flags = os.O_RDWR
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(lock_path, flags)
            acquired = False
            try:
                info = os.fstat(descriptor)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise ValueError("Operational security log lock file must be a private regular file")
                current = lock_path.lstat()
                if stat.S_ISLNK(current.st_mode) or (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                    raise ValueError("Operational security log lock path changed during open")
                while True:
                    try:
                        if os.name == "nt":
                            import msvcrt

                            os.lseek(descriptor, 0, os.SEEK_SET)
                            msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                        else:
                            import fcntl

                            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        acquired = True
                        break
                    except OSError as error:
                        if os.name != "nt" and error.errno not in (11, 13, 35):
                            raise
                        if time.monotonic() >= deadline:
                            raise TimeoutError("Timed out acquiring operational security log lock") from None
                        time.sleep(min(0.025, max(0.001, deadline - time.monotonic())))
                yield
            finally:
                try:
                    if acquired:
                        if os.name == "nt":
                            import msvcrt

                            os.lseek(descriptor, 0, os.SEEK_SET)
                            msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
                        else:
                            import fcntl

                            fcntl.flock(descriptor, fcntl.LOCK_UN)
                finally:
                    os.close(descriptor)
        finally:
            _LOCK.release()

    def append(self, event: SecurityEvent) -> None:
        if not isinstance(event, SecurityEvent):
            raise TypeError("Only typed operational security events may be stored")
        if _utc(event.occurred_at) < self.activated_at:
            raise ValueError("Operational security event predates this managed namespace")
        encoded = json.dumps(event.as_dict(), ensure_ascii=True, separators=(",", ":")) + "\n"
        with self.locked():
            log = self._validate_log_path()
            flags = os.O_CREAT | os.O_APPEND | os.O_WRONLY
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(log, flags, 0o600)
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise ValueError("Operational security log must be a regular file")
                os.write(descriptor, encoded.encode("utf-8"))
            finally:
                os.close(descriptor)


def queue_security_event(session: Session, event: SecurityEvent) -> None:
    """Queue a record on its owning DB transaction; persist only after commit."""
    if session.info.get("operational_security_log_store") is None:
        return
    events = session.info.setdefault("operational_security_log_events", [])
    events.append(event)


def server_request_uuid() -> UUID | None:
    """Read only the request ID installed by the server middleware."""
    from app.observability.logging import request_id

    try:
        return UUID(request_id())
    except (ValueError, TypeError, AttributeError):
        return None


def make_security_event(
    event_type: SecurityEventType,
    *,
    employee_id: UUID | None = None,
    device_id: UUID | None = None,
    initiating_actor_id: UUID | None = None,
    outcome: SecurityOutcome = SecurityOutcome.SUCCEEDED,
    request_id: UUID | None = None,
    occurred_at: datetime | None = None,
) -> SecurityEvent:
    return SecurityEvent(
        event_type=event_type,
        occurred_at=occurred_at or datetime.now(timezone.utc),
        employee_id=employee_id,
        device_id=device_id,
        initiating_actor_id=initiating_actor_id,
        outcome=outcome,
        request_id=request_id if request_id is not None else server_request_uuid(),
    )


@sqlalchemy_event.listens_for(Session, "after_commit")
def _write_committed_security_events(session: Session) -> None:
    store = session.info.get("operational_security_log_store")
    events = session.info.pop("operational_security_log_events", [])
    if store is not None:
        for event in events:
            store.append(event)


@sqlalchemy_event.listens_for(Session, "after_rollback")
def _discard_rolled_back_security_events(session: Session) -> None:
    session.info.pop("operational_security_log_events", None)


def emit_security_event(
    store: OperationalSecurityLogStore | None,
    event_type: SecurityEventType,
    *,
    employee_id: UUID | None = None,
    device_id: UUID | None = None,
    initiating_actor_id: UUID | None = None,
    outcome: SecurityOutcome = SecurityOutcome.SUCCEEDED,
    request_id: UUID | None = None,
    occurred_at: datetime | None = None,
) -> None:
    """Write one validated event when explicitly enabled; never accepts arbitrary fields."""
    if store is None:
        return
    store.append(SecurityEvent(
        event_type=event_type,
        occurred_at=occurred_at or datetime.now(timezone.utc),
        employee_id=employee_id,
        device_id=device_id,
        initiating_actor_id=initiating_actor_id,
        outcome=outcome,
        request_id=request_id,
    ))

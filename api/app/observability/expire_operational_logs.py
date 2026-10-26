"""Explicit maintenance command for future managed operational security records."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import stat
import tempfile
import argparse

from app.observability.security import OperationalSecurityLogStore, SecurityEvent, SecurityEventType, SecurityOutcome


@dataclass(frozen=True, slots=True)
class RetentionResult:
    expired_records: int
    retained_records: int
    applied: bool


def _parse_event(line: str) -> tuple[dict, datetime]:
    try:
        value = json.loads(line)
        expected = {"event_type", "occurred_at", "employee_id", "device_id", "initiating_actor_id", "outcome", "request_id"}
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError
        occurred_at = datetime.fromisoformat(value["occurred_at"])
        kwargs = {key: value[key] for key in ("employee_id", "device_id", "initiating_actor_id", "request_id")}
        from uuid import UUID
        for key, item in kwargs.items():
            kwargs[key] = UUID(item) if item is not None else None
        event = SecurityEvent(
            event_type=SecurityEventType(value["event_type"]), occurred_at=occurred_at,
            outcome=SecurityOutcome(value["outcome"]), **kwargs,
        )
        return event.as_dict(), occurred_at.astimezone(timezone.utc)
    except (TypeError, ValueError, KeyError, json.JSONDecodeError):
        raise ValueError("Operational security log contains an invalid record; no records were changed") from None


def expire_operational_logs(
    directory: str | os.PathLike[str], *, now: datetime | None = None, apply: bool = False,
) -> RetentionResult:
    store = OperationalSecurityLogStore.open_managed(directory)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() != timezone.utc.utcoffset(current):
        raise ValueError("Retention clock must be UTC-aware")
    cutoff = current.astimezone(timezone.utc) - timedelta(days=90)
    with store.locked():
        log = store._validate_log_path()
        if not log.exists():
            return RetentionResult(0, 0, apply)
        content = log.read_text(encoding="utf-8")
        keep: list[str] = []
        expired = 0
        for line in content.splitlines():
            if not line:
                raise ValueError("Operational security log contains an invalid record; no records were changed")
            payload, occurred = _parse_event(line)
            if occurred < store.activated_at:
                raise ValueError("Operational security log predates its managed namespace; no records were changed")
            if occurred < cutoff:
                expired += 1
            else:
                keep.append(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))
        if apply and expired:
            temp_name: str | None = None
            try:
                fd, temp_name = tempfile.mkstemp(prefix=".operational-security-", suffix=".tmp", dir=store.directory)
                os.chmod(temp_name, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                    stream.write("\n".join(keep) + ("\n" if keep else ""))
                    stream.flush()
                    os.fsync(stream.fileno())
                if log.is_symlink() or not stat.S_ISREG(log.lstat().st_mode):
                    raise ValueError("Operational security log changed to an unsafe path during retention")
                os.replace(temp_name, log)
                temp_name = None
            finally:
                if temp_name is not None:
                    Path(temp_name).unlink(missing_ok=True)
        return RetentionResult(expired, len(keep), apply)


def main() -> None:
    parser = argparse.ArgumentParser(description="Expire records from a managed operational security log store.")
    parser.add_argument("--store", required=True, help="Absolute path to the explicitly managed store directory")
    parser.add_argument("--apply", action="store_true", help="Apply the 90-day expiry; default is dry-run")
    args = parser.parse_args()
    result = expire_operational_logs(args.store, apply=args.apply)
    mode = "applied" if result.applied else "dry-run"
    print(f"{mode}: expired={result.expired_records} retained={result.retained_records}")


if __name__ == "__main__":
    main()

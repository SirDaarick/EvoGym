import json
import multiprocessing
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import pytest

from app.observability.expire_operational_logs import expire_operational_logs
from app.observability.security import OperationalSecurityLogStore, SecurityEvent, SecurityEventType, SecurityOutcome


def _event(when: datetime) -> SecurityEvent:
    return SecurityEvent(
        event_type=SecurityEventType.STAFF_PIN_CHANGED,
        occurred_at=when,
        employee_id=UUID("00000000-0000-4000-8000-000000000001"),
        initiating_actor_id=None,
        outcome=SecurityOutcome.SUCCEEDED,
        request_id=None,
    )


def _retention_paused_before_replace(root: str, now_value: str, replace_ready, allow_replace, results):
    import app.observability.expire_operational_logs as retention

    real_replace = retention.os.replace

    def paused_replace(source, destination):
        replace_ready.set()
        if not allow_replace.wait(10):
            raise TimeoutError("test did not release retention replace")
        return real_replace(source, destination)

    retention.os.replace = paused_replace
    try:
        result = retention.expire_operational_logs(
            root, now=datetime.fromisoformat(now_value), apply=True,
        )
        results.put(("retention", result.expired_records))
    except BaseException as error:
        results.put(("retention-error", repr(error)))


def _append_after_signal(root: str, started, finished, results, now_value: str):
    from app.observability.security import (
        OperationalSecurityLogStore, SecurityEvent, SecurityEventType, SecurityOutcome,
    )
    from datetime import datetime
    from uuid import UUID

    started.set()
    try:
        store = OperationalSecurityLogStore.open_managed(root)
        store.append(SecurityEvent(
            event_type=SecurityEventType.STAFF_PIN_CHANGED,
            occurred_at=datetime.fromisoformat(now_value),
            employee_id=UUID("00000000-0000-4000-8000-000000000001"),
            outcome=SecurityOutcome.SUCCEEDED,
        ))
        results.put(("append", "ok"))
    except BaseException as error:
        results.put(("append-error", repr(error)))
    finally:
        finished.set()


def _hold_store_lock(root: str, started, release):
    store = OperationalSecurityLogStore.open_managed(root)
    with store.locked():
        started.set()
        release.wait(10)


def test_retention_uses_exact_90_day_cutoff_and_dry_run_does_not_mutate(tmp_path):
    root = tmp_path / "owned-security-store"
    now = datetime(2026, 4, 1, tzinfo=timezone.utc)
    store = OperationalSecurityLogStore.create_new(root, activated_at=now - timedelta(days=100))
    store.append(_event(now - timedelta(days=90, microseconds=1)))
    store.append(_event(now - timedelta(days=90)))
    store.append(_event(now + timedelta(days=1)))
    log = root / "operational-security.jsonl"
    before = log.read_bytes()

    preview = expire_operational_logs(root, now=now, apply=False)
    assert preview.expired_records == 1
    assert preview.retained_records == 2
    assert log.read_bytes() == before

    applied = expire_operational_logs(root, now=now, apply=True)
    assert applied.expired_records == 1
    records = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert len(records) == 2
    assert [item["occurred_at"] for item in records] == [
        (now - timedelta(days=90)).isoformat(),
        (now + timedelta(days=1)).isoformat(),
    ]


def test_retention_fails_closed_for_unmanaged_malformed_or_symlinked_paths(tmp_path):
    unmanaged = tmp_path / "unmanaged"
    unmanaged.mkdir()
    with pytest.raises((FileNotFoundError, ValueError)):
        expire_operational_logs(unmanaged, now=datetime.now(timezone.utc), apply=True)

    root = tmp_path / "owned-security-store"
    store = OperationalSecurityLogStore.create_new(root)
    log = root / "operational-security.jsonl"
    log.write_text('{broken\n', encoding="utf-8")
    with pytest.raises((ValueError, OSError)):
        expire_operational_logs(root, now=datetime.now(timezone.utc), apply=True)


def test_retention_rejects_relative_traversal_and_invalid_ownership_marker(tmp_path):
    with pytest.raises(ValueError):
        expire_operational_logs("relative/store", now=datetime.now(timezone.utc), apply=True)
    with pytest.raises(ValueError):
        expire_operational_logs(tmp_path / ".." / "outside", now=datetime.now(timezone.utc), apply=True)

    root = tmp_path / "owned-store"
    OperationalSecurityLogStore.create_new(root)
    marker = root / ".evogym-operational-security-log.json"
    marker.write_text('{"format":"other","activated_at":"2026-01-01T00:00:00+00:00"}', encoding="utf-8")
    with pytest.raises(ValueError):
        expire_operational_logs(root, now=datetime.now(timezone.utc), apply=True)


def test_retention_never_follows_store_or_log_symlinks(tmp_path):
    target = tmp_path / "real-store"
    store = OperationalSecurityLogStore.create_new(target)
    store.append(_event(datetime.now(timezone.utc)))
    link = tmp_path / "linked-store"
    try:
        link.symlink_to(target, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("directory symlinks are unavailable")
    with pytest.raises((ValueError, OSError)):
        expire_operational_logs(link, now=datetime.now(timezone.utc), apply=True)

    log = target / "operational-security.jsonl"
    elsewhere = tmp_path / "outside.jsonl"
    elsewhere.write_text(log.read_text(encoding="utf-8"), encoding="utf-8")
    log.unlink()
    try:
        log.symlink_to(elsewhere)
    except OSError:
        pytest.skip("file symlinks are unavailable")
    with pytest.raises((ValueError, OSError)):
        expire_operational_logs(target, now=datetime.now(timezone.utc), apply=True)


def test_retention_apply_serializes_cross_process_append_before_atomic_replace(tmp_path):
    context = multiprocessing.get_context("spawn")
    now = datetime(2026, 4, 1, tzinfo=timezone.utc)
    root = tmp_path / "locked-store"
    store = OperationalSecurityLogStore.create_new(root, activated_at=now - timedelta(days=100))
    store.append(_event(now - timedelta(days=91)))
    store.append(_event(now - timedelta(days=90)))

    replace_ready = context.Event()
    allow_replace = context.Event()
    writer_started = context.Event()
    writer_finished = context.Event()
    results = context.Queue()
    retention = context.Process(
        target=_retention_paused_before_replace,
        args=(str(root), now.isoformat(), replace_ready, allow_replace, results),
    )
    writer = context.Process(
        target=_append_after_signal,
        args=(str(root), writer_started, writer_finished, results, now.isoformat()),
    )
    retention.start()
    try:
        assert replace_ready.wait(10), "retention did not reach its pre-replace pause"
        writer.start()
        assert writer_started.wait(10), "append process did not start"
        append_was_blocked = not writer_finished.wait(1.0)
    finally:
        allow_replace.set()
        retention.join(10)
        if writer.pid is not None:
            writer.join(10)

    assert retention.exitcode == 0
    assert writer.exitcode == 0
    outcomes = [results.get(timeout=2), results.get(timeout=2)]
    assert ("retention", 1) in outcomes
    assert ("append", "ok") in outcomes
    assert append_was_blocked, "a second process appended during retention's read/replace window"
    records = [json.loads(line) for line in (root / "operational-security.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(records) == 2
    assert {record["occurred_at"] for record in records} == {
        (now - timedelta(days=90)).isoformat(), now.isoformat(),
    }


def test_store_lock_times_out_without_mutating_when_another_process_holds_it(tmp_path):
    context = multiprocessing.get_context("spawn")
    root = tmp_path / "timed-out-lock-store"
    store = OperationalSecurityLogStore.create_new(root)
    started = context.Event()
    release = context.Event()
    holder = context.Process(target=_hold_store_lock, args=(str(root), started, release))
    holder.start()
    try:
        assert started.wait(10), "lock holder did not acquire the store lock"
        with pytest.raises(TimeoutError, match="Timed out acquiring"):
            with store.locked(timeout=0.05):
                pytest.fail("contended lock unexpectedly acquired")
    finally:
        release.set()
        holder.join(10)
    assert holder.exitcode == 0

from threading import BoundedSemaphore

import pytest

from app.auth.hashing import hash_capacity
from app.errors import HttpStatusError


def test_hash_capacity_rejects_with_503_when_full():
    semaphore = BoundedSemaphore(1)
    semaphore.acquire()
    with pytest.raises(HttpStatusError) as caught:
        with hash_capacity(semaphore):
            pytest.fail("body must not run without capacity")
    assert caught.value.status == 503
    assert semaphore._value == 0  # still held by the original owner; no release on rejection


def test_hash_capacity_releases_once_when_body_raises():
    semaphore = BoundedSemaphore(2)
    with pytest.raises(RuntimeError):
        with hash_capacity(semaphore):
            assert semaphore._value == 1
            raise RuntimeError("boom")
    assert semaphore._value == 2  # BoundedSemaphore would also raise on a double release

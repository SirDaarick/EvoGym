import asyncio

import httpx

from app.health import build_health_router


def request(app, path):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.get(path)
    return asyncio.run(run())


def test_liveness_never_depends_on_database():
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(build_health_router(lambda: (_ for _ in ()).throw(RuntimeError("DSN secret"))))
    response = request(app, "/health/live")
    assert response.status_code == 200


def test_readiness_returns_generic_failure_and_accepts_probe():
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(build_health_router(lambda: (_ for _ in ()).throw(RuntimeError("secret DSN"))))
    failed = request(app, "/health/ready")
    assert failed.status_code == 503 and "secret" not in failed.text
    ready = FastAPI()
    ready.include_router(build_health_router(lambda: True))
    assert request(ready, "/health/ready").status_code == 200


def test_slow_readiness_does_not_block_liveness_and_busy_capacity_is_bounded():
    import threading
    from fastapi import FastAPI
    from app.health import BoundedReadinessProbe

    started = threading.Event()
    release = threading.Event()
    active = 0
    maximum_active = 0
    lock = threading.Lock()

    def slow_probe():
        nonlocal active, maximum_active
        with lock:
            active += 1
            maximum_active = max(maximum_active, active)
        started.set()
        release.wait(1)
        with lock:
            active -= 1
        return True

    app = FastAPI()
    app.include_router(build_health_router(BoundedReadinessProbe(slow_probe, max_workers=1, max_pending=1), timeout_seconds=0.03))

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            ready = asyncio.create_task(client.get("/health/ready"))
            await asyncio.to_thread(started.wait, 1)
            live = await client.get("/health/live")
            assert live.status_code == 200
            assert (await ready).status_code == 503
            # The timed-out underlying work still owns a slot, so later calls
            # fail closed rather than queueing unbounded abandoned workers.
            responses = await asyncio.gather(*(client.get("/health/ready") for _ in range(8)))
            assert all(response.status_code == 503 for response in responses)
            release.set()
            await asyncio.sleep(0.05)
            assert (await client.get("/health/ready")).status_code == 200
        assert maximum_active == 1

    asyncio.run(exercise())

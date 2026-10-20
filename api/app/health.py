import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from threading import BoundedSemaphore

from fastapi import APIRouter, Response


class BoundedReadinessProbe:
    """Run synchronous probes off-loop with a hard cap on queued and running work."""

    def __init__(self, probe: Callable[[], bool], *, max_workers: int = 1, max_pending: int = 1):
        if max_workers < 1 or max_pending < 0:
            raise ValueError("readiness worker bounds are invalid")
        self._probe = probe
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="evogym-readiness")
        self._capacity = BoundedSemaphore(max_workers + max_pending)

    async def run(self, timeout_seconds: float) -> bool:
        if not self._capacity.acquire(blocking=False):
            return False
        loop = asyncio.get_running_loop()
        try:
            future = loop.run_in_executor(self._executor, self._probe)
        except Exception:
            self._capacity.release()
            return False

        def release_completed(completed: asyncio.Future[bool]) -> None:
            try:
                # A worker can fail after its HTTP waiter timed out. Retrieve the
                # exception here to prevent the event loop logging its contents.
                completed.exception()
            except (Exception, asyncio.CancelledError):
                pass
            finally:
                self._capacity.release()

        future.add_done_callback(release_completed)
        try:
            return bool(await asyncio.wait_for(asyncio.shield(future), timeout_seconds))
        except (Exception, asyncio.TimeoutError):
            return False

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)


def build_health_router(probe: Callable[[], bool] | BoundedReadinessProbe, *, timeout_seconds: float = 2.5) -> APIRouter:
    router = APIRouter()
    runner = probe if isinstance(probe, BoundedReadinessProbe) else BoundedReadinessProbe(probe)

    @router.get("/health/live", include_in_schema=False)
    async def liveness() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/health/ready", include_in_schema=False)
    async def readiness(response: Response) -> dict[str, str]:
        try:
            ready = await runner.run(timeout_seconds)
        except Exception:
            ready = False
        if not ready:
            response.status_code = 503
            return {"status": "unavailable"}
        return {"status": "ok"}

    return router

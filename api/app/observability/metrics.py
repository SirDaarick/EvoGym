from collections import defaultdict
from threading import Lock

from app.observability.logging import safe_dimensions


class RequestMetrics:
    """In-process bounded counters; intentionally not a durable/multiprocess store."""

    def __init__(self, *, max_series: int = 128) -> None:
        if max_series < 1:
            raise ValueError("max_series must be positive")
        self._lock = Lock()
        self._max_series = max_series
        self._overflow_key = ("OTHER", "series_limit", "other")
        self._counts: dict[tuple[str, str, str], list[float]] = defaultdict(lambda: [0, 0.0])

    def observe(self, method: object, route: object, status: object, duration_ms: object) -> None:
        key = safe_dimensions(method, route, status)
        try:
            duration = float(duration_ms)
        except (ValueError, TypeError, OverflowError):
            duration = 0.0
        if not 0 <= duration <= 3_600_000:
            duration = 0.0
        with self._lock:
            if key not in self._counts and (
                len(self._counts) >= self._max_series
                or (self._overflow_key not in self._counts and len(self._counts) >= self._max_series - 1)
            ):
                key = self._overflow_key
            point = self._counts[key]
            point[0] += 1
            point[1] += duration

    def snapshot(self) -> dict[tuple[str, str, str], dict[str, float | int]]:
        with self._lock:
            return {key: {"count": int(value[0]), "duration_ms_total": value[1]} for key, value in self._counts.items()}

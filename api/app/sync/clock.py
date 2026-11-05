"""Clock classification; mirrors frontend/src/features/checkIns/offlineClock.ts (never rejects or corrects)."""

from datetime import datetime, timedelta
from typing import Literal

ClockClass = Literal["within_tolerance", "clock_skew", "unverified_clock"]


def classify_clock(
    client_recorded_at: datetime,
    anchor_utc: datetime | None,
    monotonic_delta_ms: int | None,
    tolerance_s: int = 300,
) -> ClockClass:
    """Estimate server time as anchor + monotonic delta; |skew| strictly above tolerance is clock_skew."""
    if anchor_utc is None or monotonic_delta_ms is None or monotonic_delta_ms < 0:
        return "unverified_clock"
    if client_recorded_at.tzinfo is None or anchor_utc.tzinfo is None:
        return "unverified_clock"
    estimated = anchor_utc + timedelta(milliseconds=monotonic_delta_ms)
    skew = abs(client_recorded_at - estimated)
    return "clock_skew" if skew > timedelta(seconds=tolerance_s) else "within_tolerance"

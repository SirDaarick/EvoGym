# Package P6 — Staff schedules and occurrence attendance

**Source:** C snapshot, from `67046388d7c46a4c300a305e1a6983585468fed0` plus its captured dirty delta
**Baseline:** `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (`0030_staff_schedules`)

This is a package history, not proof of integrated A/B/C acceptance. Current integrated evidence and limitations are tracked in [the integration record](first-wave-merge-strategy.md).

## Package scope

P6 adds recurring staff schedule series and exceptions, occurrence-linked attendance, checkout, clock-integrity checks, and append-only supervisor corrections. C's original occurrence migration revision was distinct from A's `0031_admin_session_policy`; integration preserves A's `0031`–`0037` chain and uses `0038_staff_occurrence_attendance` after `0037_paired_profile_access`.

## Integrated behavior

- Staff roster/attendance views use the authenticated API request context and real endpoints.
- Configured Admin authorization uses A's signed-session contract; there is no unsigned Admin fallback in the configured path.
- Empty/error responses do not fall back to demo fixtures. Unsupported actions are not claimed as implemented.
- Historical C package test counts are not integrated acceptance.

## Verification

See [the integration record](first-wave-merge-strategy.md) for current integrated results and pending full frontend/build/browser checks. PostgreSQL migration verification remains unavailable until a disposable PostgreSQL target is configured.
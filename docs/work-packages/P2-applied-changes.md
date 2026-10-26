# Package P2 — Member read contracts and reload

**Source:** B snapshot, from `f279ec87c2e4c62cb65e7066aff1c47a11454498` plus its captured dirty delta
**Baseline:** `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (`0030_staff_schedules`)

This is a package history, not proof of integrated A/B/C acceptance. The integrated member views retain the existing list/detail layout and consume the existing authenticated session providers. Current evidence is in [the integration record](first-wave-merge-strategy.md).

## Package scope

P2 supplies member list/detail and read/reload contracts, including membership periods, visits, class samples, notes, and Admin-only debt projections. It adds no exclusive database migration.

The member read/reload operations are read-only. The existing `Mostrador` action is unavailable in API mode because this backend integration has no operational member-counter action contract; it must not be presented as implemented or replaced by fixture/demo data.

## Authorization and UI contract

- The integrated member routes use A's configured signed Admin-session validation and the approved Admin session flow.
- The integrated UI restores the existing member directory and detail sections, including search, sorting, existing tabs, and Admin-only itemized debt display.
- No token globals or DemoProvider fallback are part of the live API route.
- Historical B package test counts are not integrated acceptance.

## Verification

See [the integration record](first-wave-merge-strategy.md) for current integrated results and pending full frontend/build/browser checks.
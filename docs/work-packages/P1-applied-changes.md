# Package P1 — Identity, sessions, devices, and transport

**Source:** A snapshot, from `82fc09b7b88be783ec978da2407a32bad48045c3`
**Baseline:** `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (`0030_staff_schedules`)

This is a package-level history, not proof of integrated A/B/C acceptance. The integration snapshot is `8e9cf7393d149d8a15067e5dbb85b3ea6d107cb7`; integrated test results and outstanding checks are tracked in [the current integration record](first-wave-merge-strategy.md).

## Package scope

P1 adds Admin authentication/session lifecycle, recovery and device approval, employee PIN lifecycle, role bundles, paired profile access, and related audit/security behavior. Its migration lineage is `0031_admin_session_policy` through `0037_paired_profile_access`.

The frontend uses the existing session providers and authenticated product routes. Operational credentials remain in provider-owned memory/request context; consumers must not read window token globals or fall back to Demo mode for live routes.

## Integration contract

- A's configured signed Admin-session validation is authoritative when signing is configured.
- B/C routes use the approved signed Admin-session protocol; there is no unsigned legacy fallback in the integrated configured-signing path.
- The original A package test/browser counts were package-context results and are not represented as integrated acceptance.

## Verification

See [the integration record](first-wave-merge-strategy.md) for current integrated evidence, including pending full frontend/build/browser checks and PostgreSQL limitations.
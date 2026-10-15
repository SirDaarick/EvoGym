# Implement the member detail screen

Deliver a responsive member profile that makes attendance duration and current glove/locker rentals easy to scan, with purchase history available without stacking modals. The authorized scope includes MD-01 through MD-05; it does not expand into preferred-payment policy or backend persistence.

## Quick path

1. Add regression tests for the profile, duration heatmap, rental status, and history view.
2. Implement the profile using existing demo records and operations; do not fabricate attribution for transactions without a member ID.
3. Run the focused member and attendance tests, then inspect the final diff.

## Task checklist

### MD-01 — Build the member profile and purchase history

- [x] Replace the crowded detail layout with a responsive profile layout matching the supplied wireframe and `Design.md`.
- [x] Show visit-day squares with orange intensity derived from observed gym duration; provide a legend and accessible date/duration labels. Exclude open and auto-closed visits from duration intensity while still marking attendance. The GitHub-style reference is interpreted as 365 consecutive trailing dates ending on the demo date, laid out in Monday-start weeks with concise month headings and weekday markers.
- [x] Show glove and locker assignment cards using white for none, green for active, orange for overdue days 1–14, and red after more than 14 days overdue; include the glove/locker identifier and locker expiry date. Do not mutate rental state or imply a recorded eviction that has not occurred.
- [x] Move purchase history into a distinct in-page view (no nested modal) with TanStack table columns for date, product, amount paid, and method. Include only transactions explicitly attributable to this member and preserve paid/pending status in the presentation.
- [x] Preserve existing entry/exit actions, membership facts, accessibility, both themes, and responsive behavior.

**Acceptance criteria**

- Attendance cells have multiple orange intensity levels tied to duration and accessible labels; days with unknown duration remain visibly attended without receiving a fabricated duration.
- Rental color boundaries follow the requested statuses; locker expiry and assignment identifiers are visible.
- History is a separate in-page view, not a modal over the profile modal, and uses the requested TanStack columns.
- No unlinked product sale is shown as belonging to a member.
- Focused tests pass and unrelated working-tree changes remain untouched.

**Route:** delegated direct — multiple non-trivial UI/test files and model-flow research.
**Verification:** Initial RED `npm test -- src/features/members/MemberDetail.test.tsx` — failed because the new test imported the not-yet-implemented `MemberDetail` module. Initial final focused command `npm test -- src/features/members/MemberDetail.test.tsx src/features/members/Members.test.tsx src/features/attendance/AttendanceCalendar.test.tsx src/demo/attendanceOperations.test.ts` — exit 0; 4 test files passed, 19 tests passed. Correction RED `npm test -- src/features/members/MemberDetail.test.tsx` — failed because returned glove and released locker rentals were omitted from purchase history. Correction GREEN, same command — exit 0; 1 test file passed, 4 tests passed. Heatmap RED `npm test -- src/features/attendance/AttendanceCalendar.test.tsx` — failed because the grid still contained only 84 days. Heatmap GREEN, same command — exit 0; 1 test file passed, 1 test passed. Final focused command `npm test -- src/features/members/MemberDetail.test.tsx src/features/members/Members.test.tsx src/features/attendance/AttendanceCalendar.test.tsx src/demo/attendanceOperations.test.ts` — exit 0; 4 test files passed, 20 tests passed.
**Delivery strategy:** ask-on-risk. Forecast: approximately 350 authored changed lines, generated files excluded.
**Commit evidence:** no commit created. The worktree already had 50 modified/untracked paths, including the integration file `Members.tsx`, and the current branch is `codex/component-catalog-extension`; preserving those existing changes took priority over staging a mixed-scope commit. Commit this work only after it can be isolated on the appropriate feature branch.

## Next step

MD-01/02 wireframe work was completed before the MD-03/05 extension. The original two-row placement was the MD-02 checkpoint; the later explicit ordering requirement supersedes that placement for the final screen: membership is the first content section after the profile header, and purchase history is the last section. The remaining rental, attendance, and notes content stays between them. Ordinary sales remain excluded unless attributed to a member. MD-03/05 derive membership history and employee notes from verified available data, without claiming unavailable coverage dates or durable persistence.

### MD-02 — Match the supplied member-detail structure

- [x] Recompose only the member-detail screen to match the wireframe: name/contact and entry action; glove, locker, purchase-history, and previous-attendance sections; membership section with an honest streak badge slot; note. Later authorization changes the final content order: membership first, purchase history last.
- [x] Remove demonstration disclaimers, scenario controls, provisional-policy toggles/questions, balances, and other content not shown in the wireframe from this screen.
- [x] Keep the shared demo-backed application infrastructure intact; this task removes its demo UI from the profile, not the app-wide data adapter or other routes.
- [x] Keep the rental color rules, attendance duration heatmap, and separate purchase-history table already requested.

**Acceptance criteria**

- The profile order and placement follow the supplied sketch, with the contact/name block and entry action first, summary cards in the middle, and membership/history plus note below. This checkpoint placement was superseded by the later explicit instruction: membership follows the header, purchase history is last.
- The profile contains no visible demo-only caveat, fake clock/scenario control, unresolved owner-question widget, or unrelated credit/payment panel.
- Attendance operation errors on the profile do not surface demo, test, scenario, provisional-policy, or Q-number terminology.
- Existing entry/exit operation, attendance visualization, rental status, and purchase-history behavior remain available.
- Focused tests pass without changing unrelated working-tree files.

**Route:** delegated direct — implementation touches multiple non-trivial UI and test files; CodeGraph mapped the current detail component and its dispatch points.
**Allowed edit surfaces:** `src/features/members/Members.tsx`, `src/features/members/Members.test.tsx`, `src/features/members/MemberDetail.tsx`, `src/features/members/MemberDetail.css`, `src/features/members/MemberDetail.test.tsx`, `src/features/attendance/AttendanceCalendar.tsx`, `src/features/attendance/AttendanceCalendar.test.tsx`.
**Verification:** Initial test-first RED `npm test -- src/features/members/MemberDetail.test.tsx` — failed against the old screen because the requested plain `Registrar salida` action was only exposed as `Registrar entrada demo`; the test also observed demo clock and owner-question UI. Layout correction RED `npm test -- src/features/members/MemberDetail.test.tsx` — failed because the wireframe groups were absent. Missing-profile regression RED `npm test -- src/features/members/Members.test.tsx` — failed because the not-found state used demo-specific copy. Attendance-error RED `npm test -- src/features/members/Members.test.tsx` — failed because the profile-level error-message mapper was missing. Final required command `npm test -- src/features/members/MemberDetail.test.tsx src/features/members/Members.test.tsx src/features/attendance/AttendanceCalendar.test.tsx src/demo/attendanceOperations.test.ts` — exit 0; 4 test files passed, 23 tests passed.

**Progress:** MD-02 implementation and focused verification complete. At that checkpoint, the top-left group contained gloves, lockers, and purchase history, previous attendance was to its right, and the lower row placed membership left and note right. A later authorized correction supersedes only this placement: membership is now first after the profile header; rental, attendance, and notes follow; purchase history is a directly visible final section. Profile-only demo copy, the missing-profile demo phrase, attendance-error demo/scenario wording, clock/scenario/policy controls, owner-question panels, balance panel, payment CTA, and the fictional-record disclaimer were removed; shared operation strings, demo provider, payment route, app shell, and other routes were preserved. Profile-level error formatting maps known provisional-policy errors to useful neutral messages and uses a safe generic fallback for other test-only phrases. Attendance actions remain available and retain the existing attendance operation logic.

**MD-02 checkpoint constraints:** The original Member model had no note field or membership-history/streak model. MD-03/05 subsequently added in-memory notes and derives membership history/streak only from paid member-attributed payment records; payment recordedAt is not asserted as an effective date.

**Commit evidence:** no commit was created to preserve the already-dirty mixed-scope worktree and current branch; no files were staged.

### MD-03 — Membership history and renewal streak

- [x] Render membership history in the first content panel after the profile name/contact/header, in a scrollable TanStack table newest first, with a row highlighted only when current membership dates and exact paid lastPaymentId both validate; show membership name/date columns. This later authorized placement supersedes the earlier lower-left wireframe grouping.
- [x] Derive prior membership entries only from member-attributed paid membership payments; use recorded payment dates, never invent effective dates that are unavailable.
- [x] Show the consecutive-month renewal streak with an orange fire icon and its count at the upper-right of the membership card, derived from paid records.
- [x] Preserve accessible status cues and light/dark readability.

### MD-04 — Annual attendance chart and KPIs

- [x] Keep the attendance heading, show total visits and visits in the last 30 days as KPIs beside it, and remove trailing-year copy/legend.
- [x] Add a centered year selector and render the selected calendar year in a Monday-first GitHub-style heatmap using TanStack Charts with orange duration intensity.
- [x] Cover leap years and empty/future days accurately; retain accessible visit-count and measured-duration labels, and visually outline attendance days with unknown duration separately from no attendance without assigning duration intensity.

### MD-05 — Notes attributed to the selected employee

- [x] Retain the selected employee identity only on direct profile selection or after successful PIN verification; role routing alone is insufficient, and an unverified PIN selection must not set the author.
- [x] Add notes to app state with an employee ID/name snapshot and timestamp, then render them with the existing AnimatedList component.
- [x] Provide a new-note input and use the selected employee as author without a second author picker; disable submission when no employee identity is available.
- [x] Do not claim notes survive refresh or are backend-persisted; the application currently uses in-memory app state.

**Authorized scope:** `src/domain/models.ts`, `src/demo/adapter.ts`, `src/demo/DemoProvider.tsx`, `src/demo/memberNotes.ts`, `src/demo/memberNotes.test.ts`, `src/features/members/MemberDetail.tsx`, `src/features/members/MemberDetail.css`, `src/features/members/MemberDetail.test.tsx`, `src/features/attendance/AttendanceCalendar.tsx`, `src/features/attendance/AttendanceCalendar.test.tsx`, `src/features/staff/StaffProfileSelection.tsx`, `src/features/staff/StaffProfileSelection.test.tsx`, `src/features/staff/staffStore.ts`.
**Route:** delegated direct — these coordinated behaviors touch multiple non-trivial model, operation, selector, chart and test files. Test-first applies where deterministic regression checks can establish a meaningful RED case.
**Accepted clarification:** note author is the employee chosen in the existing staff selector; snapshot the author identity on note creation and do not create an author dropdown.
**Known constraints:** Membership effective dates are not represented in payment rows; show recorded dates rather than fabricated coverage. Selected staff identity must not be retained until PIN authentication succeeds. Notes currently live in in-memory app state, not a persistent backend.
**Verification:** Initial MD-03/04/05 RED and first independent-review corrections RED: `npm test -- src/features/members/MemberDetail.test.tsx src/features/attendance/AttendanceCalendar.test.tsx src/features/staff/StaffProfileSelection.test.tsx` — failed on plan-name current-row inference, year-scoped KPIs, absent unknown-duration outline, and missing exported coordinate helper. GREEN `npm test -- src/features/members/MemberDetail.test.tsx src/features/attendance/AttendanceCalendar.test.tsx src/features/staff/StaffProfileSelection.test.tsx src/demo/memberNotes.test.ts` — exit 0; 4 files, 16 tests passed. `npx tsc --noEmit` — exit 0. Added regressions cover same-plan payment without identity, expired linked payment, New Year 30-day window and chart-year independence, Monday-first y coordinates, unknown-duration outline, and PIN/no-PIN selection lifecycle.
**Final order correction verification:** Test-first RED `npm test -- src/features/members/MemberDetail.test.tsx` — exit 1; 3 failures showed membership was not first and purchase history was still hidden behind its tab action. After moving the membership panel to the first content section, rendering purchase history as the final section/table, and updating the order assertions, `npm test -- src/features/members/MemberDetail.test.tsx` — exit 0; 1 test file, 8 tests passed. `npx tsc --noEmit` — exit 0.
**Delivery strategy:** ask-on-risk. Keep prior dirty worktree changes unstaged and do not create a mixed-scope commit.





### MD-06 — Restore two-column layout and show a sample note

- [x] Arrange member details in two explicit columns: left column has membership history first with the current membership visibly highlighted at the top, then glove/locker rental cards; right column has attendance first, then notes.
- [x] Render purchase history as the final full-width section spanning both columns, directly visible rather than hidden behind a tab, with a TanStack Table following the reusable table pattern from the members screen, including adapted dedicated table styling.
- [x] Keep newest membership first and show the active membership from the member's authoritative current membership fields; do not infer a relationship from plan-name equality. Use paid payment rows as history and recorded payment dates only.
- [x] Seed one clearly marked example note for an existing demo member and an existing employee ID/name, with timestamp and note body, so the employee/date/text rendering is visible immediately. Newly submitted notes continue to use the currently selected, successfully authenticated employee.
- [x] Add layout and sample-note tests; verify responsive column behavior and preserve dark/light styling.

**Authorized scope:** `src/features/members/MemberDetail.tsx`, `src/features/members/MemberDetail.css`, `src/features/members/MemberDetail.test.tsx`, `src/demo/adapter.ts`, `odd/tasks/member-detail-implementation.md`.
**Route:** delegated direct — UI re-layout, seed data and regression tests involve multiple non-trivial changes. Reuse the existing TanStack Table pattern; `src/features/members/Members.tsx` is a read-only reference and must not be changed.
**Accepted layout:** left—membership, then rentals; right—attendance, then notes; final full-width purchase table spans both columns.
**Verifier finding / resolved:** independent verification found both member-detail TanStack tables lacked dedicated styling adapted from the existing members-table pattern. Added isolated `.member-detail-table` rules and applied the class to both tables: sticky shaded headers, matching cell spacing, visually hidden accessible captions, divider borders, and theme-token hover colors. No edit to `Members.tsx` or global styles. Browser visual QA is unavailable, and `Members.tsx` was already dirty before this correction, so no baseline hash or unchanged byte identity is claimed.
**Sample note:** explicitly identify it as example data; use an existing seeded member and employee, not an invented staff identity. Preserve selected-employee attribution for newly entered notes.
**Verification:** Test-first layout/sample tests were written before the implementation. The first focused test invocation produced no output beyond the Vitest startup banner for over 90 seconds and was interrupted; after implementation, the exact focused suite first exposed stale layout assertions, then passed after assertions were aligned to the new two-column DOM. Style-correction verification: `npm test -- src/features/members/MemberDetail.test.tsx src/features/attendance/AttendanceCalendar.test.tsx src/features/staff/StaffProfileSelection.test.tsx src/demo/memberNotes.test.ts` — exit 0; 4 files, 18 tests passed. `npx tsc --noEmit` — exit 0. Tests assert both dedicated table classes and captions alongside the section order and sample note; CSS adapts the existing members-table values while using theme variables. No browser visual QA was performed. `Members.tsx` was not edited by this correction, but was dirty before it, so no baseline hash/byte-identity claim is made. The current membership row is built from `member.membership` valid dates, while paid payment history remains recorded-date-only. No commit/staging performed.
**Delivery strategy:** ask-on-risk; preserve existing dirty changes and do not stage/commit mixed scope.

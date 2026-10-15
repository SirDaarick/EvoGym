# Member detail render loop

## Objective
Prevent the membership table from entering a render feedback loop after a parent update.

## Scope and constraints
- Stabilize membership history identity in MemberDetailSections.
- Add bounded regression coverage for a parent rerender while the detail remains mounted.
- Preserve all existing worktree changes; no remote operations.
- Git metadata is read-only in this session; work-unit commit is pending, not authorized through a workaround.
- Delivery strategy: ask-on-risk. Forecast: under 100 authored changed lines.

## Tasks
- [x] MDL-01: Reproduce the failure with a bounded regression, memoize membership history, and observe GREEN. Route: delegated to gpt-6-luna; two non-trivial files and test execution. Code and tests verified; commit pending due read-only Git metadata.
- [x] MDL-02: Independently review the exact delta and rerun focused checks. Route: delegated to gpt-6.1-sol plus parent structural review and focused test spot check. Commit pending due read-only Git metadata.

## Acceptance and checks
- Unchanged payment inputs preserve table data identity across parent/table state updates.
- Changed payments or member identity still update the history.
- Record exact focused test and typecheck commands, RED/GREEN results, and unavailable checks.
- RDD status printed off but command exited with Access Denied; status is unknown and must not be treated as successful proof.

## Progress
MemberDetailSections now memoizes memberPayments on payments/member.id. Final persisted regression wraps the real useReactTable with a scoped 40-call safety guard, awaits async act, and changes member identity while preserving the payments reference. Guard resets in finally.

Verification evidence:
- Final independent `npm test -- --run src/features/members/MemberDetail.test.tsx src/app/App.test.tsx`: 26/26 passed.
- In-memory restoration of original source: persisted regression failed at the 40-call safety bound (1 failed, 12 skipped); no source toggling on disk.
- Parent spot check `npm test -- --run src/features/members/MemberDetail.test.tsx -t 'keeps membership history stable'`: 1 passed, 12 skipped.
- `npm run typecheck`: failed with two TS2345 diagnostics in src/demo/memberNotes.test.ts:12–13. Independent TypeScript virtual-filesystem reversal of fix/test produced identical diagnostics, proving preexisting failures.
- Writer combined run had one App test timeout; final independent run passed. Variability disclosed, not classified as a proven preexisting failure.
- Native assessment unavailable/unassessable due untracked inventory; no native approval claimed. RDD status failed with Access Denied; no preference changed.
- Browser froze on original code; post-fix full-browser retest remains pending.
- Final changed-payment assertion was replaced by changed-member coverage; both dependencies are present in production memo, but payment-update regression coverage remains a minor gap.

## Next step
Reload the previously frozen browser tab and verify detail-to-sidebar navigation. Optional follow-up: restore changed-payment coverage. Commit remains pending; no staging, commits, or remote operations performed.

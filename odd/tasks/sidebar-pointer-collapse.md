# Sidebar pointer collapse

## Objective
Collapse the unpinned sidebar on pointer exit after clicks, without losing keyboard accessibility.

## Scope and constraints
- Allowed source surfaces: src/app/App.tsx and src/app/App.test.tsx.
- Preserve prior modifications, member-detail fix, Spanish UI copy, focus ownership, and explicit pin behavior.
- No CSS redesign, unrelated changes, remote operations, staging or commits.
- Git metadata is read-only; work-unit commit remains pending.
- Delivery: ask-on-risk; forecast under 120 authored changed lines.

## Tasks
- [x] SPC-01: Add pointer-click/exit and real keyboard regressions, observe RED, implement modality-aware expansion, observe GREEN. Route: delegated gpt-6-luna; multi-file logic and tests. Commit pending due read-only Git metadata.
- [x] SPC-02: Independently review pointer/keyboard transitions and rerun focused suites. Route: independent gpt-6.1-sol verifier plus parent spot check. Targeted acceptance passed; broader suite has unresolved intermittent failures, recorded below. Commit pending.

## Acceptance and verification
- Background and navigation clicks do not latch expansion after pointer exit.
- Keyboard focus inside sidebar keeps it expanded and keyboard focus outside collapses it.
- Pointer takeover after keyboard focus does not leave stale keyboard expansion.
- Pin holds expansion until unpinned.
- Do not blur active elements just to hide the sidebar.
- Focused checks: npm test -- --run src/app/App.test.tsx src/features/members/MemberDetail.test.tsx; npm run typecheck.
- Known base failure: two TS2345 errors in src/demo/memberNotes.test.ts:12–13 were proven preexisting during earlier verification.
- RDD status previously printed off but exited Access Denied; no successful native proof or preference changes claimed.

## Progress
Implementation: pointerdown capture clears keyboard expansion, keydown inside restores it, and focus-driven opening only accepts focus-visible. Explicit pinning remains independent; no forced blur.

Observed checks:
- Writer regression RED before source fix; GREEN after fix.
- Final persisted regressions cover navigation click/leave, background click after keyboard use, Shift+Tab exit, and pin/unpin.
- Final writer and parent spot-check `npm test -- --run src/app/App.test.tsx -t 'pointer|collapses'`: 2 passed, 12 skipped each.
- Independent required combined suite: 25 passed, 2 failed. Cross-feature flow timed out at 5027ms; following stale-suggestions case lacked listbox. Scoped rerun of both passed unchanged; preexisting status is not proven and broad suite is not declared green.
- Typecheck: known two TS2345 failures src/demo/memberNotes.test.ts:12–13 remain.
- Independent in-memory transitions: navigation pointer exit, same-element Enter, and keyboard-to-background-pointer takeover passed.
- jsdom focus-visible second-Tab heuristic also failed in a standalone two-anchor control; not classified as a browser bug.
- Parent real Chromium at localhost:5174/reception/home: Tab twice entered brand with focus-visible=true and data-expanded=true; Shift+Tab to skip link yielded data-expanded=false. Temporary tab closed.
- Native risk assessment unassessable due preexisting untracked inventory; no native approval claimed. No preference changed.
- Only App.tsx and App.test.tsx source/test surfaces changed; prior member-detail fix preserved.

## Next step
User validates pointer navigation in their browser. Investigate variable cross-feature suite failures separately if authorized. Work-unit commit remains pending; no staging, commits or remote operations performed.

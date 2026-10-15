# EvoGym Stitch UI prototype

## Objective
Create an editable Stitch prototype for the owner and reception roles using Design.md.

## Scope and constraints
- Authorized destination: https://stitch.googleapis.com/mcp.
- Credential: Windows User STITCH_API_KEY; never log or persist its value.
- Create one new EvoGym project; do not inspect unrelated projects.
- Upload a sanitized copy of Design.md with local machine paths removed.
- Sports identity, light Bento structure, restrained clay depth, purposeful content.
- Only OWNER and RECEPTION; neutral es-MX UI and clearly labeled demo data.
- No backend, database, deployment, implementation framework, or business-rule approvals.
- Preserve handwritten notebook and current Excel reconciliation requirements.
- Grace, transfer verification, refunds, and online payments remain pending.

## Tasks
- [x] S01: Create project, upload design document, and create reusable design system.
- [x] S02: Generate owner overview and inspect returned screen content.
- [x] S03: Generate reception membership/payment screen and inspect returned content.
- [x] S04: Verify project/screens and deliver the project location and returned previews, with observed draft limitations.

## Routing and checks
- Route: delegated direct, one writer, for external multi-step generation and API handling.
- Skill: cognitive-doc-design; Design.md supplies the UI/UX contract.
- Authenticated initialize and tools/list succeeded; protocol 2025-03-26.
- Native Stitch tools are not loaded; use the same authorized MCP endpoint directly.
- Upload must immediately precede create_design_system_from_design_md.
- Reuse returned design-system ID in both screen requests.
- Never blindly repeat timed-out mutations; reconcile only in the created project.
- Do not accept provider-suggested extra generations automatically.
- Validate only observed results; report render/interaction limitations honestly.
- Test-first exception: generated design artifact, no executable behavior implemented.

## Delivery and recovery
- Delivery strategy: single prototype project, not a source-code PR.
- Forecast: under 100 authored tracking lines; external UI generation is not a local code diff.
- Git commits: unavailable; workspace is not a Git repository.
- Engram mirror: pending because project association has failed.
- Project: `projects/10397996297352916657`, titled EvoGym — UI Prototype; creation confirmed PRIVATE.
- Uploaded sanitized design document: instance `15365247593968904199`; source `projects/10397996297352916657/screens/15365247593968904199`.
- Design system: `assets/b9488ed512e8408db12911a7bdfe2701`; upload immediately followed by creation from its exact returned instance.
- Source Design.md remains unchanged; its local logo path was replaced only in the upload copy. No logo image uploaded.
- Owner screen: `projects/10397996297352916657/screens/85f15502f0db4d108b95664b7b9eb760`; generation and get_screen readback confirmed DESKTOP and exact shared system.
- Owner review: browser screenshot and public HTML inspected. Generated content needs correction: unsupported 100% verification, branch label, transfer-confirmation assumptions, notebook folio action, strict-no-tolerance wording, and invented scheduled closure (8 October 2026 mislabeled Sunday). Preview typography also needs review against the sans-serif contract.
- Owner generation is not business approval or accessibility certification. No corrective regeneration authorized in this two-screen batch.
- Reception screen: `projects/10397996297352916657/screens/172f63cadc10421a9c173f5cd24da0f8`; generation and get_screen readback confirmed DESKTOP and exact shared system.
- Reception review: browser screenshot and public HTML inspected. Good separation of payment methods, unapplied credit, calendar dates, and paper/Excel reminder. Generated unsupported additions include biometric identification, immediate turnstile activation, branch/cash register metadata, guaranteed printed/digital receipt, pending-credit controls, and a premature cash-covered assertion; these need correction before acceptance. Preview typography needs review.
- Project readback confirms PRIVATE, two generated desktop screens plus the DESIGN.md upload and design-system board; list_screens independently confirms both source IDs.
- Public preview links were returned but are not persisted here; canonical editable deep link is not yet verified. Stitch home: https://stitch.withgoogle.com/.
- Tool edit_screens accepts selectedScreenIds array and can target both returned source IDs in one request; preservation/version behavior is not established by its schema.
- S04: Parent independently reran list_screens and confirmed both exact DESKTOP IDs. Public screenshot inspection through the web tool was unavailable; worker browser/HTML review remains the visual evidence. No WCAG conformance or functional behavior has been proved.
- Delivery: Open Stitch and select EvoGym — UI Prototype. Project deep link was not returned/verified; returned screenshot URLs are provided in chat only.
- Next step: user reviews the initial designs; correct the recorded unsupported content before accepting business behavior. Any additional generation/edit remains pending. No provider-suggested extra screens were generated.

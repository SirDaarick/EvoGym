# Local Jupyter environment

## Objective
Prepare an isolated, reproducible Python environment for local member-data exploration without modifying the source workbook or existing notebooks.

## Scope and constraints
- Authorized: local virtual environment, notebook dependencies, local kernel, setup documentation, Python ignore rules.
- Preserve all pre-existing changes, source spreadsheets, and `backend/membresias.ipynb`.
- Never upload member data or persist personal records in outputs or logs.
- No server left running, global installs, remote repository operations, or user-level kernel registration.

## Tasks
- [x] JUP-1: Environment configured and functional checks passed; isolated Python virtual environment and dependencies verified.
- [x] JUP-2: VS Code configuration and notebook structural checks passed; portable workspace settings and empty exploration notebook initialized.

## VS Code clarification
- User explicitly wants notebook execution inside VS Code rather than JupyterLab.
- Delegated direct: extension setup and coordinated workspace/notebook/documentation configuration.
- Allowed: `.vscode/settings.json`, `.vscode/extensions.json`, `backend/membresias.ipynb` only while still empty, and `backend/README.md`; local VS Code Python/Jupyter extension installation if missing.
- Preserve user settings and all unrelated work. Never execute source-data cells or expose personal data.
- Verify extension availability, JSON/notebook validity, selected interpreter path and synthetic kernel execution; report UI selection as manual if not observable.
- Implemented `.vscode/settings.json` with portable interpreter folder and `.vscode/extensions.json` recommendations. Installed manifests confirm Python 2026.10.0 and Jupyter 2025.9.1; no extension installation needed.
- Initialized the still-empty notebook with valid metadata and a safe import cell, no member-data reads or saved outputs. Updated README to lead with VS Code.
- Writer, parent and independent verifier passed JSON/notebook validation, interpreter resolution and structural checks; imports passed. Actual VS Code UI execution is unverified because no native UI surface is available.
- User next step: open repository root in VS Code, open notebook, select its backend/.venv Python environment using Select Kernel, and run the diagnostic cell. No JupyterLab server needed.

## Route and checks
- Route: delegated direct; environment installation and multi-file configuration require a bounded worker.
- Test-first exception: environment configuration has no meaningful behavioral RED; check missing environment, then verify installed capabilities.
- Checks: environment Python version; pip check; imports for JupyterLab, ipykernel, pandas, openpyxl and matplotlib; kernelspec resolution; disposable notebook execution without member data.
- Parent spot check: environment imports and pip check.
- Delivery: ask-on-risk; forecast below 150 authored lines, one work unit; no push or PR.
- RDD: status printed off (clone-local), but also reported Git metadata access denied. No review started or mode changed. Assessment was unassessable because unrelated untracked files require a declared inventory; conservatively used independent verification.
- Commit evidence: pending; no stage, commit, push or PR performed.

## Progress
- Initial inspection: Python 3.14 installed; no existing `backend/.venv`, requirements manifest or backend README.
- Installed Python 3.14.5 environment with JupyterLab 4.6.4, ipykernel 7.4.0, pandas 3.0.6, openpyxl 3.1.5 and matplotlib 3.11.2; exact direct pins in `backend/requirements-notebooks.txt`.
- Kernel `Python (EvoGym)` registered inside `.venv` using `--sys-prefix`; no global installation or user-level kernel registration.
- Writer: pip check, imports, kernel path, JupyterLab version and real synthetic notebook execution passed. The synthetic notebook tested pandas aggregation, Excel roundtrip and matplotlib; kernel execution required authorized escalation outside the sandbox.
- Parent: reran pip check and all five imports successfully. Independent verifier confirmed manifest versions, isolation, kernel path and launch documentation.
- Source workbook and notebook hashes unchanged. The existing `backend/membresias.ipynb` is zero bytes and is not a valid notebook yet; intentionally preserved.
- Environment creation needed TEMP/TMP in `.cache/jupyter/tmp`; PyPI downloads needed authorized network escalation. No server left running.
- Added `backend/README.md` and Python ignore rules. Direct dependencies pinned, not a complete transitive lockfile.
- Next: launch JupyterLab and create a new notebook, selecting `Python (EvoGym)`; commit this isolated work unit when repository metadata access and the desired branch are resolved.

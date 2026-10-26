# Package P1 — Applied Changes & Technical Audit

**Worktree:** `front-a-contracts`  
**Package:** P1 (Identity, Sessions, Devices & Transport)  
**Baseline:** `3996c62acfeac8c7f367032a61bf95f331ccf1b8` (Alembic `0030_staff_schedules`)  
**Primary Ownership:** Residuals of BK-010, BK-011, BK-012, BK-058  

---

## 1. Database Migrations Added (Alembic)

Worktree A introduces 7 linear migrations extending schema capabilities:

1. **`0031_admin_session_policy.py`**:
   - Creates `admin_sessions`, `admin_trusted_devices`, `admin_device_approvals`, and `admin_password_recoveries`.
   - Enforces device categories (`computer` vs `phone`), 15-minute access token limit, and 30-day idle / 90-day absolute expiration.
2. **`0032_employee_pin_lifecycle.py`**:
   - Adds `pin_hash`, `pin_failed_attempts`, `pin_locked_until`, `initial_pin_expires_at`, and `must_change_pin` to staff credentials.
3. **`0033_employee_roster_account_link.py`**:
   - Adds nullable foreign key linking `staff_roster_profiles` with `staff_accounts`, preserving legacy unlinked rows.
4. **`0034_owner_admin_role_bundles.py`**:
   - Establishes singleton Owner model, role bundles (`owner`, `admin`, `receptionist`), and explicit permission grant mappings.
5. **`0035_employee_session_purpose_reception_stations.py`**:
   - Creates `reception_stations` table and adds `session_purpose` (`phone` vs `reception`) to `staff_sessions`.
6. **`0036_staff_lockout_alert_acknowledgement.py`**:
   - Creates `staff_lockout_alerts` for in-app global notifications upon 5 consecutive failed PIN attempts; first acknowledgement wins.
7. **`0037_paired_profile_access.py`**:
   - Adds paired phone and profile access mapping, enabling PIN-prompted profile switching on trusted devices.

---

## 2. Backend Modules & API Routers

### A. Authentication & Session Services
- **`api/app/auth/admin.py`**: Implements Admin authentication with JWT rotation, refresh token replay detection (revoking compromised category sessions upon replay), and cookie-backed persistence.
- **`api/app/auth/credentials.py`**: Manages employee PIN verification using Argon2, lockout evaluation (5 failures = 5-minute cooldown), initial PIN 7-day expiration, and forced first-change enforcement.
- **`api/app/auth/devices.py`**: Implements 6-digit pairing code generation, atomic mobile replacement (revoking prior phone sessions without touching Reception/Admin sessions), and lost-phone unlink invalidating pending codes.
- **`api/app/auth/owner.py`**: Singleton owner guarantee, scoped role bundle assignments, and dynamic permission resolution.
- **`api/app/auth/profile_access.py`**: Resolves paired device access and profile selection with PIN confirmation.

### B. Routers Added
- `api/app/api/admin_auth.py`: Sign-in, sign-out, session refresh, approval poll, and password recovery initiation/completion.
- `api/app/api/admin_sessions.py`: Current Admin session listing and explicit revocation.
- `api/app/api/admin_role_management.py`: Admin permissions and role bundle assignment.
- `api/app/api/admin_security_alerts.py`: Staff lockout alert list and acknowledgement.
- `api/app/api/admin_staff_accounts.py`: Employee account directory, roster linking, and PIN reset/reissue.
- `api/app/api/device_pairing.py`: Pairing initiation, code generation, and client completion.
- `api/app/api/profile_access.py`: Profile selection and token exchange.
- `api/app/api/staff_credentials.py`: First PIN change and employee credential management.

### C. Observability & Audit
- **`api/app/observability/security.py`**: Opt-in managed JSONL security logging with OS-level process locking to prevent concurrent append corruption.
- **`api/app/observability/expire_operational_logs.py`**: CLI tool for 90-day security log retention pruning.

---

## 3. Frontend Architecture & Flow Pages

### A. In-Memory Session Architecture (Zero Storage Leaks)
- **`frontend/src/features/auth/AdminSessionProvider.tsx`**:
  - Manages Admin access tokens in memory with automatic background renewal before expiration.
  - Implements single-flight renewal locks to prevent refresh stampedes.
  - Category-bound HTTP-only cookies for refresh tokens.
- **`frontend/src/features/auth/ProductAccessProvider.tsx`**:
  - Exposes in-memory operational tokens (`__EVOGYM_OPERATIONAL_SESSION__`, `__EVOGYM_ADMIN_SESSION__`, `__EVOGYM_TOKEN__`) to the window context for child consumer views.
  - Manages Reception station credentials and employee profile switching.
- **`frontend/src/app/RootApp.tsx` & `ProductRoutes.tsx`**:
  - Top-level application shell mounting authenticated product routes outside DemoProvider, maintaining clean separation between live operational flows and legacy demo screens.

### B. Dedicated Flow Pages
- `AdminAccessApp.tsx`: Admin login, password recovery, and session overview.
- `AdminDeviceApprovalPage.tsx`: Click-only device approval from email links with automatic token URL stripping.
- `AdminRecoveryPage.tsx`: Enumeration-safe password reset with explicit matching confirmation.
- `AdminSecurityAlerts.tsx`: Global lockout notification banner and acknowledge buttons.
- `AdminStaffDevices.tsx`: Admin console for listing paired employee devices and one-click revocation.
- `FirstPinChangePage.tsx`: Public route for newly provisioned employees to set their private PIN upon first login.
- `OwnerManagementPage.tsx`: Owner console for role bundles, Admin provisioning, and permission assignment.
- `StaffAccessPage.tsx`: Unified employee login asking for PIN on every profile entry.

---

## 4. Verification Evidence

1. **Backend Tests**:
   - `test_devices.py`, `test_staff_credentials.py`, `test_admin_auth.py`: **37 passed**.
   - Full SQLite suite: **468 passed, 18 skipped, 0 failed**.
   - PostgreSQL concurrency & audit suite: **17 passed**.
2. **Frontend Tests**:
   - **90 test files, 671 tests passed** (including `AdminSessionProvider.test.tsx`, `DevicePairingModal.test.tsx`, `RootApp.test.tsx`).
   - TypeScript: `tsc --noEmit` exit code 0 on both `tsconfig.app.json` and `tsconfig.node.json`.
3. **Live Browser & Database Verification**:
   - Admin remote device revocation (`POST /api/v1/admin/devices/{id}/revoke`) verified against live SQLite database (`fixture.sqlite3`):
     - Targeted mobile device set to `revoked_at`.
     - Phone sessions revoked.
     - Reception station and Admin sessions remained active.

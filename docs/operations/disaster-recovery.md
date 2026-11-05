# EvoGym Disaster Recovery & Point-In-Time Recovery (PITR) Runbook

## 1. Overview & Service Level Objectives (SLO)

This document establishes the official disaster recovery, backup retention, and point-in-time recovery (PITR) procedures for EvoGym's central infrastructure and edge clients.

| Metric | Target | Description |
| :--- | :--- | :--- |
| **RPO (Recovery Point Objective)** | **< 5 minutes** | Maximum allowable data loss window in the event of catastrophic server or storage failure. Ensured via continuous WAL streaming and `archive_timeout = 300s`. |
| **RTO (Recovery Time Objective)** | **< 30 minutes** | Total elapsed time from disaster declaration to restored, verified read-write production availability. |

### Architecture Context
EvoGym utilizes a hybrid architecture:
1. **Central Database**: PostgreSQL 17 with `pgvector` extension for vector embeddings (`gimi_rag`), partitioned business domains (sales, shifts, memberships, payroll, expenses, rentals), and transactional audit logs.
2. **Edge Reception Terminals**: Local-first PWA running Dexie.js (IndexedDB) with store-and-forward outbox buffers (`evogym-local-db.events`). In the event of central downtime or restore lag, front-desk terminals continue processing sales and check-ins autonomously.

---

## 2. Backup Architecture & PostgreSQL Configuration

### 2.1 Backup Topology
- **Full Base Backups**: Executed weekly (Sunday 02:00 UTC) with offsite encryption to S3-compatible object storage (e.g., AWS S3, Cloudflare R2, MinIO).
- **Differential Backups**: Executed daily (Mon–Sat 02:00 UTC).
- **Continuous Write-Ahead Log (WAL) Archiving**: PostgreSQL archives 16 MB WAL segments immediately upon completion or when `archive_timeout` triggers.
- **Retention Period**:
  - Base and differential backups: **30 days**.
  - Continuous WAL archives: **7 days** (enabling recovery to any precise second within the past week).

### 2.2 PostgreSQL `postgresql.conf` Production Directives

```ini
# Replication and WAL Archiving
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=evogym archive-push %p'
archive_timeout = 300               # Enforces RPO < 5 minutes even during low write traffic
wal_keep_size = 4096MB

# Connection Timeouts & Defensive Resource Guards
statement_timeout = 5000            # Prevent long-running rogue transactions
idle_in_transaction_session_timeout = 10000
```

### 2.3 pgBackRest Stanza Configuration (`/etc/pgbackrest/pgbackrest.conf`)

```ini
[global]
repo1-type=s3
repo1-s3-endpoint=s3.us-east-1.amazonaws.com
repo1-s3-bucket=evogym-backups-production
repo1-s3-region=us-east-1
repo1-s3-key-type=auto
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=ENV[PGBACKREST_CIPHER_PASS]
repo1-retention-full=4
repo1-retention-diff=7
process-max=4
log-level-console=info
log-level-file=detail
start-fast=y
compress-type=zst

[evogym]
pg1-path=/var/lib/postgresql/data
pg1-user=postgres
```

---

## 3. Point-In-Time Recovery (PITR) Procedure

### 3.1 Disaster Declaration & Isolation
1. **Declare Disaster**: Notify Incident Commander and switch DNS / ingress proxy to maintenance page:
   ```bash
   # Route incoming requests to static offline 503 maintenance page
   kubectl scale deployment/evogym-api --replicas=0
   ```
2. **Identify Target Timestamp ($T_{target}$)**: Determine the exact timestamp immediately preceding the corruption, dropped table, or infrastructure breach. For example: `2026-11-04 15:42:18-06`.

### 3.2 Recovery Execution via pgBackRest
1. Stop PostgreSQL service on target database host:
   ```bash
   systemctl stop postgresql
   ```
2. Empty existing corrupted data directory (ensure snapshot is taken if forensics are required):
   ```bash
   mv /var/lib/postgresql/data /var/lib/postgresql/data_corrupted_$(date +%s)
   mkdir -p /var/lib/postgresql/data
   chmod 700 /var/lib/postgresql/data
   chown -R postgres:postgres /var/lib/postgresql/data
   ```
3. Execute restore to target timestamp:
   ```bash
   sudo -u postgres pgbackrest \
     --stanza=evogym \
     --type=time \
     --target="2026-11-04 15:42:18-06" \
     --target-action=promote \
     restore
   ```
4. Confirm `recovery.signal` or auto-generated configuration contains:
   ```ini
   restore_command = 'pgbackrest --stanza=evogym archive-get %f "%p"'
   recovery_target_time = '2026-11-04 15:42:18-06'
   recovery_target_action = 'promote'
   ```
5. Start PostgreSQL service:
   ```bash
   systemctl start postgresql
   ```
6. Monitor log output until recovery completes and primary promotion occurs:
   ```bash
   tail -f /var/log/postgresql/postgresql-17-main.log
   # Expected final message:
   # "redo done at ..."
   # "selected new timeline ID: 2"
   # "database system is ready to accept read-write connections"
   ```

### 3.3 Post-Recovery Database Validation
Execute verification queries against the promoted instance before reopening API traffic:
```sql
-- 1. Check database connectivity and transaction status
SELECT pg_is_in_recovery(), current_timestamp;

-- 2. Validate schema and table row counts against pre-incident benchmarks
SELECT schemaname, relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC
LIMIT 10;

-- 3. Verify sequence alignment
SELECT last_value FROM shift_sequences;

-- 4. Check readiness probe query used by EvoGym health check
SELECT 1;
```

7. Re-enable API deployment and verify readiness probe (`/health/ready`):
   ```bash
   kubectl scale deployment/evogym-api --replicas=2
   curl -f http://api.evogym.internal/health/ready
   ```

---

## 4. Local-First Contingency Recovery & Client Drain

### 4.1 Disaster Impact on Edge Devices
Because EvoGym operates on a local-first store-and-forward architecture (Phase 5), edge terminals continue recording transactions during central server downtime.
If the central database is restored to timestamp $T_{target}$ which is older than recent transactions, client terminals will have:
1. Pending events in their local outbox (`evogym-local-db.events` with `status: "pending"`).
2. Potentially events that were previously acknowledged by the lost server timeline.

### 4.2 Terminal Outbox Structure
The IndexedDB database `evogym-local-db` maintains the `events` table:
```typescript
interface ContingencyEvent {
  eventId: string;             // UUIDv7 primary key (strictly time-ordered)
  eventType: string;           // e.g. "sales.checkout", "check_in.recorded", "shift.opened"
  payload: Record<string, any>;
  occurredAt: string;          // ISO-8601 timestamp
  status: "pending" | "synced";
  clientSequence: number;
}
```

### 4.3 Automated Reconciliation Flow
1. **API Re-connection**: When the central API comes back online, client service workers detect online status via `navigator.onLine` and the `/health/live` probe.
2. **Ingest via Idempotent Ingestion Endpoint**:
   Edge terminals flush their pending queue to `/api/v1/sync/contingency-events`:
   ```bash
   POST /api/v1/sync/contingency-events
   Headers:
     Authorization: Bearer <terminal-device-token>
     Idempotency-Key: <eventId>
   Body:
     {
       "events": [
         {
           "event_id": "018e3a2b-7c1a-7b3c-b26a-9f4a56c7104b",
           "event_type": "sales.checkout",
           "occurred_at": "2026-11-04T15:44:00-06:00",
           "payload": { ... }
         }
       ]
     }
   ```
3. **Database Idempotency Guarantee**:
   The central backend uses `INSERT INTO sync_events ... ON CONFLICT (event_id) DO NOTHING` or updates existing state idempotently. No duplicate charges or duplicate inventory deductions occur.

### 4.4 Manual Client Recovery Drill (Catastrophic Terminal Reset)
If an edge browser cannot auto-sync or has orphaned sessions:
1. Open Reception Terminal browser DevTools -> Console.
2. Run client contingency export helper:
   ```javascript
   (async () => {
     const db = new Dexie('evogym-local-db');
     await db.open();
     const pending = await db.table('events').where('status').equals('pending').toArray();
     const blob = new Blob([JSON.stringify(pending, null, 2)], { type: 'application/json' });
     const url = URL.createObjectURL(blob);
     const a = document.createElement('a');
     a.href = url;
     a.download = `evogym-contingency-${Date.now()}.json`;
     a.click();
     console.log(`Exported ${pending.length} pending events.`);
   })();
   ```
3. Admin imports the JSON payload through the Admin Portal (`/admin/sync/recovery-replay`) or via backend CLI ingestion:
   ```bash
   python -m app.cli.sync replay-events --input evogym-contingency-*.json
   ```
4. Reset client sync cursor to re-sync fresh server roster:
   ```javascript
   localStorage.removeItem('evogym_roster_cursor');
   window.location.reload();
   ```

---

## 5. Semi-Annual Restoration Drill Protocol

To certify production readiness, the operational team conducts a semi-annual PITR drill in a non-production staging environment:

1. **Synthetic Workload Generation**: Insert benchmark transactions into test database.
2. **Simulated Failure**: Trigger unexpected shutdown or table truncation at known time $T_{test}$.
3. **Trigger PITR**: Follow Section 3 to restore to $T_{test} - 30\text{ seconds}$.
4. **Time Tracking**: Clock elapsed time from declaration to `/health/ready` 200 OK (must be $< 30$ minutes).
5. **Data Audit**: Verify row counts match expected pre-disaster snapshot.
6. **Sign-off**: Document drill date, RTO elapsed, RPO delta, and lead engineer signature in `docs/operations/drills-log.md`.

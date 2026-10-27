# Operations Lab background runtime

LAB2 #31 merged normally at `641d9cfd0b435f8a366659b822f48646a5dc6d6f`.
Post-merge main CI
passed before this branch began. The runtime-hardening PR stays Draft until review.
No permanent service or OS boot startup is automatically activated.

## Explicit activation after revision review

From the laboratory checkout, Node 22+, Docker running and a clean shell without
an ordinary DATABASE_URL:

```sh
npm run lab:prepare -- --revision <approved-full-40-character-SHA> --approve-revision
npm run lab:start -- --enable-test-entitlements
npm run lab:status
npm run lab:stop
```

Preparation makes a detached isolated worktree and local web build. It proceeds
only after stopping any existing managed runtime; preparing another revision while
processes are active is refused. Code is pinned
to the approved SHA, PM2 watch is disabled, and the runtime uses its own PM2_HOME.
Staff/private state and the full accumulated archive are copied once into the
stable ignored data directory, without deleting the original files. PostgreSQL
continues using the original guarded persistent volume and port 55439. API and
worker remain in guarded non-production mode; the local web uses a built Next.js
server. Nothing connects to OVH, Neon or paid providers.

`lab:start` exits after independent API/web/worker/monitor processes are ready.
It starts stopped venues with WALL_CLOCK defaults; PAUSED/NEEDS_REVIEW states are
preserved for operator review. Use the existing panel at
`http://127.0.0.1:3400/sq/lab` to Resume or Stop after day. Normal weekday targets
remain DE 80 / AL 100, with bounded LOW/BUSY and weekend variation.
Docker and the computer must stay running. No power-off activity is claimed.

The operator key is in `.operations-lab-runtime/data/.operations-lab/operator.json`.
Protect the runtime directory with owner-only filesystem access. Never publish
private config, backup dumps, credentials, tokens, PM2 environments or raw logs.
The data directory is authoritative after preparation; editing old developer
fixture files does not update the active runtime. Runtime commands delegate to
the pinned controller. A source SHA mismatch or dirty pinned code fails closed.

PM2 permits five unstable restarts with delay/backoff. API, web and worker can
restart independently. `npm run lab:restart -- --service api` also supports web,
worker and monitor. IPC shutdown supports Windows; signals support Linux.
Canonical idempotency, durable leases and NEEDS_REVIEW remain LAB2's authority.
No unsafe financial retry or automatic uncertain-printer reconciliation is added.

## Synthetic renewable test entitlement

The explicit `--enable-test-entitlements` opt-in applies only after the dedicated
instance/marker/system identifier and both registered synthetic scopes are checked.
An existing noncommercial RESTAURANT_PRO/TRIALING subscription is required, with
matching TEST ONLY tenant and .invalid owner. No ACTIVE commercial subscription,
billing provider, invoice, payment confirmation or global plan is created/changed.

The domain grants at most 30 days from actual database time and renews when seven
days remain. Startup renews existing opt-ins before starting the worker; it never
silently opts in an unapproved venue. The monitor checks every six hours and on
process startup. The
canonical `Subscription.trialEndsAt` projection is updated transactionally for the
two opted-in tenants; canonical entitlement checks continue unchanged. Normal plan
definitions and normal real-customer trials stay 14 days. Every opt-in and renewal
has append-only lab evidence; each extension also has a canonical secret-free
AuditEvent with before/after expiry and reason. Update/delete triggers prohibit
rewriting the lab entitlement evidence. There is no silent commercial activation.

## Safe backup and disposable restore

```sh
npm run lab:runtime:backup
npm run lab:runtime:restore:test
```

Backup requests durable pause, drains active jobs, stops all managed writers and
checks the API/web are unreachable. It preserves open register/attendance state;
it does not abandon the business day by inventing closes. PostgreSQL stays up.
The command fingerprints canonical/metadata tables, validates PDF hashes, copies
private state/archive/reports and takes a local custom-format dump. It compares a
second source fingerprint before accepting the backup. The recorded manifest and
dump remain private. This is a quiescent paused/stopped-window backup, not a claim
of fully consistent live backup. `--resume` restarts services with traffic still
paused; use the panel to Resume after checking state.
If the API is unreachable while the worker is active, Stop/backup fail closed:
recover the managed API first so durable pause can be recorded before stopping.

Restore acceptance requires stopped managed writers. It creates a new named local
disposable volume/project at port 55441, database/user exclusively suffixed
`_restore`. It never restores over the primary volume, never uses --clean and never
drops the primary database. The copied old instance identifier must be rejected.
After verifying dump/scopes/data, the explicitly authorized disposable acceptance
enrolls its distinct system identifier with reviewed identity evidence. A separate
fixed-target guard requires that exact reviewed identity; the primary guard is
unchanged and rejects this restore endpoint. Remote/ordinary endpoints are denied.

The test verifies table fingerprints, private/PDF hashes, source identities,
credentials, tenant-scoped receipt authorization and an expired normal-trial
fixture in the disposable database. That authorization fixture never modifies
source financial records. Primary data is fingerprinted again after restore.
The disposable container is stopped and its identified test volume retained for
inspection; no automatic destructive cleanup runs.

## Monitoring and reports

The existing authenticated dashboard adds runtime reachability, process state/
restart counts, test expiry/opt-in and last successful backup. The private monitor
records last successful actions, last closed day, pending/expired leases, browser
incidents, NEEDS_REVIEW and PDF storage/free space. `.runtime/daily-sq.md` is a
compact Albanian observed summary. It reports observations without inventing
causes; process restart alone never proves financial recovery. Business journal
and independent daily JSON/CSV remain the detailed evidence.

Private process logs are bounded; immutable database journal/receipts are never
erased. Notification providers remain disabled. PM2 cloud/APM credentials are
not used. Watch/glob and YAML/PAC/FTP features are not exposed by this fixed JSON
controller. Any remaining upstream optional-feature dependency advisories must
be evaluated separately from the unchanged production dependency gate.

## Optional OS startup — prepared, not installed

The templates under `tools/operations-lab/runtime/startup/` require replacing
absolute approved paths and explicit operator installation. Neither preparation,
start nor acceptance executes PM2 startup, Task Scheduler registration, systemctl
enable, or a Windows service installer. Ordinary `lab:start` needs no Codex,
VS Code or interactive launcher left running.

Temporary acceptance uses `--acceptance-only`; it is explicitly rejected for
permanent activation without approved revision preparation. Multi-day/72-hour
soak is a separate operator activity, with only actual duration reported.

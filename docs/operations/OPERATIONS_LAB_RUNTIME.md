# Operations Lab LAB2 local runtime

LAB1 #30 merged at `79930bce1fa14f2409f7d6291aea2bae309a9a32` after
lab CI and
all 16 release gates.
Post-merge main CI
passed before LAB2 began. The same private directory, database volume and immutable
PDF archive are preserved. LAB2 subsequently merged at
`641d9cfd0b435f8a366659b822f48646a5dc6d6f`; use the reviewed
[background runtime guide](OPERATIONS_LAB_BACKGROUND.md) for autonomous operation.
The terminal commands below remain the development workflow. No reset or deployment
is authorized.

## Start and operate

Use the existing dedicated Compose database; never load an ordinary `.env`.

```sh
npm run lab:init
# In three terminals, from the same workspace:
npm run lab:api
npm run lab:web
npm run lab:worker
```

Open `http://127.0.0.1:3400/sq/lab` (also `de`, `en`, `it`). The local operator key
is in ignored `.operations-lab/operator.json`; individual staff credentials are
in `.operations-lab/DE.json` and `AL.json`. Never publish these files. The operator
session is an HttpOnly, SameSite=Strict, expiring signed cookie. Mutating browser
requests require the exact loopback web origin. CLI access uses the private key
as a Bearer token. Staff cookies do not grant operator access; operator auth does
not replace the canonical staff identity used for business mutations.

Select LOW/NORMAL/BUSY while stopped, then Start independently per business.
Start converts a completed finite acceptance configuration to WALL_CLOCK defaults
(cap 200, five-minute missed-arrival tolerance and weekend variation). Configuration
changes are journaled and never rewrite completed runs. The authenticated `/config`
endpoint also accepts explicit caps/seeds within the documented domain bounds.
The panel links actual POS, Orders, Kitchen, Bar, Workforce and Reports; these
continue to require their normal individual staff login and permissions.
Pause stops new durable jobs between actions; an already running action can finish.
Resume preserves all existing identities. Stop after day drains scheduled traffic,
production and settlement, closes the actual register/attendance and reconciles,
then prevents tomorrow's run. Ctrl+C stops only the process; it does not invent
financial closes or backdate attendance. No OS startup service is installed.

Normal weekday targets are DE 80 and AL 100, capped at 200 by default. LOW halves
demand; BUSY multiplies by 1.25. Configurable weekend busy traffic uses the same
catalog and seed policy. Plans use the published venue-local opening hours and
real IANA calendars, with lunch/dinner bands and varied baskets. Opening setup
starts at most 15 minutes early. Closed periods create no impossible customer
orders. Two future website customers are assigned genuine browser journeys when
a day plan freezes; remaining website demand uses the canonical public API.
Native browser request IDs and private tracking credentials survive restart.

The first runtime uses each venue's eight configured employees for the active
window and two Kitchen/Bar lanes. Attendance records actual spans, not claimed
legal staffing/payroll compliance. Sessions refresh through normal login before
their canonical 12-hour expiry. Trial entitlements are not bypassed: canonical
trials normally last 14 days. The separate background guide documents explicit
bounded LAB-only renewal; ordinary customer behavior stays unchanged.
Capability denial pauses the affected venue for review;
longer operation requires an approved canonical test subscription workflow.

## Durable recovery and operator review

Lab-only control/day/job/journal tables have scoped foreign keys and versioned
contracts. A frozen day/seed and event identity reference canonical source IDs.
Thirty-second venue/job leases renew every five seconds; actor/action leases and
the canonical idempotency/version rules remain authoritative. One active job per
venue, two production lanes and at most eight live scenario orders bound work.
The two venues run independently. Transient transport errors retain the same
action key and bounded retries. A possibly committed browser submission is never
blindly submitted again. Unknown/changed input requires review.

Undispatched arrivals more than five minutes late are marked MISSED in normal
operation, never backdated or flooded after machine downtime. Already dispatched
effects recover by their recorded canonical identity. An unfinished open shift
after a heartbeat gap over two hours requires review. Only actual server/database
time is used. Partial browser coverage remains visible; a financially closed
partial day can be explicitly acknowledged, but is never a full acceptance PASS.

PAPER_OUT uses the same P3 job and explicit retry. UNKNOWN_RESULT pauses the
affected venue. The operator must inspect the simulator result and explicitly
confirm P3's possible-duplicate retry. Existing payments/receipts are reused.
Other manual changes may pause a conflicting job. External orders are reported
separately. External CASH in the active register requires an operator's canonical
count/close; the worker never invents a count for unowned cash. Mixed human table
sessions are preserved. Use real application workflows to resolve core conflicts.

The dashboard shows actual persisted day totals, current run progress, active
tickets, on-duty shifts, receipt/PDF links, P3 incidents, checkpoints and journal.
Polling failure retains the last observed data with a disconnected notice.
Journal pages are indexed and capped at 50 rows. Significant events explain
what/when/actor/action/impact; causal claims only describe directly observed
capacity or configured due times. Expandable details retain evidence IDs.
Daily independent JSON/CSV and runtime daily exports preserve source identities.
Weekly summaries cover observed journal days; missing history is not invented.
Accepted counts combine directly admitted staff/QR records with persisted website
ACCEPTED status events. A later cancellation remains visible separately and does
not erase historical acceptance. Website orders awaiting confirmation are excluded.
The current run's business date is separate from today's venue totals. Receipt
and scoped archive totals use complete counts; the download list is bounded to
the latest 100 receipts of the current day, without truncating summary counts.

## Archive, backup and retention

Stable hashed filenames, source/PDF hashes and print associations remain LAB1's
contract. Async scope storage protects concurrent manual/simulator printing.
Archive byte sizes are backfilled only after hash verification; SQL aggregate
capacity avoids repeatedly scanning historical files. A global archive capacity
lock prevents concurrent new output from exceeding limits. Default limits are
50,000 PDFs, 5GB, warning at 80%, and 250MB free-disk reserve. Reprints verify
existing bytes. Nothing automatically erases immutable history.

After Stop after day and real close, stop API/web/worker and run:

```sh
npm run lab:backup
```

This verifies all archived hashes, copies the archive and private credentials,
takes a local PostgreSQL custom-format dump and writes a hash manifest into
ignored `.operations-lab-backups/`. Protect the directory with the local owner's
ACL and encrypt any off-machine copy. The command refuses open shifts/registers
or reachable lab API/web. Cold archive preparation consists of these verified
manifests/backups; automatic deletion/relocation is deliberately unavailable.

Restore only to a **fresh isolated lab volume**, retaining the original volume
and backup. Verify dump/file hashes and the two synthetic scopes, restore database,
private directory and PDFs together, then explicitly rebind the lab-only instance
marker to that new PostgreSQL system identifier. The guard intentionally refuses
a different instance until this reviewed metadata rebind. Never restore over the
persistent working database, ordinary development, Neon or production. No restore
or marker bypass runs automatically.

## Acceptance and ongoing soak

```sh
npm run lab:runtime:acceptance
```

This finite test uses an explicit short future schedule and actual elapsed
preparation (no server clock override). It creates genuine browser customers in
both venues, crashes after a committed payment, resumes, persists pause across
API/PostgreSQL restart, creates independent operator orders, handles uncertain
print output through explicit P3 consent and verifies final accounting/hashes.
Its tolerance for the finite functional window is one hour; normal missed-arrival
tolerance remains five minutes. The recorded duration includes interruptions.
This is not evidence of multiple days or a 72-hour uptime soak.

During local acceptance, a cold staff-login hydration race exposed synthetic
credentials in a native GET URL. The canonical form now uses POST and disables
submission until hydrated. Both lab manager passwords were changed through the
authenticated self-service API, with previous sessions invalidated and old logins
rejected. Private diagnostics were scrubbed; public evidence excludes credentials,
tracking tokens, raw logs and failed-page dumps. Password changes require the
current password, admit no target user and retain an audit event without secrets.

The LAB2 review distinguishes the completed
functional acceptance from the earlier acknowledged partial day and records the
actual elapsed time, source identities and outstanding soak/restore limitations.

For real ongoing local soak use the three start commands and Start in the panel
with WALL_CLOCK traffic. Keep the computer/processes running. Report only the
duration and events actually observed. Review incidents and daily summaries;
never run daily seed/reset or release fixture scripts against this database.

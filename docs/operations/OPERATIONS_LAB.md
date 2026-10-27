# Operations Lab LAB1

Scope: approved issue #29.
Base: main `3db4bdfd535007821a8724c0ea12144e29bad34d`.
LAB1 runs both a compact smoke and configurable normal-volume day against **actual** RestaurantFlow APIs and
PostgreSQL. LAB2's autonomous worker/operator panel is a subsequent review gate.

## Local setup and persistence

Requirements: Node 22+, Docker Compose, Chromium installed with
`npx playwright install chromium`. Use a clean terminal without an inherited
`DATABASE_URL`, production `NODE_ENV` or provider secrets.

```sh
npm ci
docker compose -f compose.operations-lab.yaml up -d --wait
npm run lab:generate
npm run lab:init
npm run lab:acceptance
```

The dedicated database is `restaurantflow_operations_lab`, user
`operations_lab`, port `127.0.0.1:55439`. The local-only Compose password is
fixture configuration, not a production credential. The named
`restaurantflow-operations-lab_operations-lab-postgres` volume survives process
and machine restarts. `lab:init` verifies the instance before applying existing
canonical migrations and additive **lab-only** scope constraints. It never seeds,
resets or drops this database. Production and ordinary development Compose files,
Neon, OVH and infrastructure PR #18 are unchanged.

Interactive use, in separate terminals:

```sh
npm run lab:api
npm run lab:web
npm run lab:day
npm run lab:normal -- --level=NORMAL --seed=29 --cap=160
# Recheck an already completed run or a reconciliation-only review incident:
npm run lab:day -- --recheck
```

API binds `127.0.0.1:4400`; web binds `127.0.0.1:3400`. Open the normal
`/en/staff/login` screen. Generated individual credentials and QR/guest tokens
live only in ignored `.operations-lab/DE.json` and `AL.json`; do not copy them
into reports. Unix creation permissions are 0700/0600; on Windows protect the
workspace with the local user's ACL. Back up this private directory, database
volume and PDF archive together. Restoring only credentials or only PDFs into a
different database does not constitute a lab restore.

Stop API/web processes normally; Compose `stop` retains the database. Never use
`down -v`, the ordinary seed/reset commands or release fixture runners against
the persistent lab. Run the release regression suite in its existing separate
local/CI fixture database. No background activity happens while the machine or
processes are off.

`lab:acceptance` requires free lab API/web ports, starts the guarded API and web,
runs both smoke and normal days, stops/restarts the API, replays both days, compares source identities and
hashes, runs PostgreSQL/archive tests and the browser tests, then stops its API.
It leaves the persistent database and artifacts intact.
The focused recovery probe replays an already finalized payment through its real
API, loses the first HTTP acknowledgement deliberately, then verifies no new
payment/receipt and rejection of a competing employee session.

## Canonical provisioning and scenarios

Both businesses register through `POST /v1/public/trials`: DE pizzeria,
EUR/Europe-Berlin; AL restaurant, ALL/Europe-Tirane. Public onboarding correctly
creates canonical `REAL` tenant-kind records; the **separate lab venue allowlist**
is the synthetic-environment boundary, not a fork of tenant provisioning.
Each has an owner and eight individually invited/accepted employees: manager,
three service staff, two Kitchen and two Bar staff. Normal domain role permissions
remain authoritative. Workforce profiles/stations and explicit TEST ONLY
contracts are configured through the owner API. Four employees participate in
each smoke day; all eight participate in the normal-volume day.

Menus, variants, modifiers, sample tax categories, scoped tables, service modes,
billing identity, local published website, opening hours and pickup capability
are configured through canonical APIs. Expanded DE has 20 products and six
tables; AL has 26 products and ten tables, including Albanian dishes and grills.
Products have SQ/DE/EN/IT translations. Regular local hours are 10:00–23:30 DE
and 10:00–22:30 AL. Fresh CI fixtures explicitly publish TEST ONLY all-day hours
00:00–23:59 for bounded wall-time acceptance. This is owner configuration, not a
pickup-validation bypass. Existing completed configuration/history is preserved.
All names/addresses are TEST ONLY, emails use `@operations-lab.invalid`, guest
phones use the legacy `TEST-ONLY-0000` or synthetic `0000000000`.

| Scenario per venue        | API actors and actual persisted outcome                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Counter takeaway CASH     | Waiter creates an order with quantity, Large variant and Cheese modifier; Kitchen/Bar prepare and ready tickets; waiter records CASH with change and hands over; P2 final receipt/PDF |
| Staff dine-in manual card | Waiter creates an actual table order; stations prepare; manual CARD_AT_COUNTER confirmation; table handover; P2 final receipt/PDF                                                     |
| Public online pickup      | Anonymous public submission with real pickup lead-time gate; manager accepts; Kitchen/Bar prepare; waiter records manual card; **manager** completes pickup; P2 final receipt/PDF     |
| Public table QR           | Anonymous QR session/order, manager confirmation, station preparation, waiter service and session CASH payment/close; **no fabricated P2 receipt**                                    |
| Open/close day            | Four real operational shifts, separate linked Workforce clock-in/break/clock-out events, manager register opening/count/close and canonical daily report                              |
| Hardware                  | One PAPER_OUT failure/retry, original and reprint of each actual receipt, CASH-only automatic drawer command replay                                                                   |

Staff creation/payment idempotency is exercised by additional real HTTP requests.
No Order, PaymentRecord, Receipt, ticket or cash balance is inserted by the runner.
Its Prisma business access is read-only; writes outside HTTP concern only lab
orchestration/evidence. No fake clock is configured; production timestamps and
all pickup gates use current server/database time.

The normal IP rate policies are unchanged. The two independent synthetic
business clients bind source loopback IPs `127.0.0.2` and `127.0.0.3`, so their
eight invitation acceptances each respect the canonical ten/hour per-IP limit.
The browser uses `127.0.0.1`. Repeated manual logins can still exhaust the normal
quota; wait for its window rather than weakening authentication limits.

## Guardrails

Before startup, migration, scoped lab writes and every HTTP handler, the guard
requires the enabled nonproduction mode, exact local URL/database/user/schema,
an existing dedicated marker and its original PostgreSQL system identifier.
Extra URL options, remote hosts, ordinary databases and provider credentials
fail closed before mutations. The API never loads `.env`.

Only the two precise synthetic registration profiles can create businesses.
Staff/session/invitation/public website/table/guest lookups must belong to a
claimed tenant and venue. Canonical repositories still independently enforce
permissions and tenant scope. Composite lab foreign keys protect run, action
and archive ownership. Mutating routes are explicitly allowlisted; domains,
imports/discovery/AI, media uploads, demo writes, push and external billing
operations are unavailable. Transactional notifications and Workforce provider
workers are disabled. Normal personal inbox evidence may still be persisted.

An action's lease records the real membership and authenticated session. While
it is executing, another session using the same staff identity cannot mutate;
the runner's action header must also match the durable leased event. A PostgreSQL
advisory lock excludes a second day runner. Normal human use of other actors
remains possible; the oracle separately reports external canonical activity.
Table closing is restricted to simulator-owned sessions without external orders.
This protects overlapping actions, not a fully managed LAB2 operator UI.

API logging and lab Next request logging are disabled, browser trace/video/password screenshots are disabled,
and password fields are cleared before assertions. CI uploads only allowlisted
JSON/CSV/PDF/PNG evidence, never private credentials, raw logs or traces.
`node tools/operations-lab/scrub-evidence.mjs` additionally redacts known local
secrets from text failure artifacts.

## Immutable PDF archive and P3 semantics

The lab injects a subclass of the existing P3 `SimulatorAdapter` through the
existing HardwareService. It re-resolves the scoped P2 `FinalReceipt` before
rendering. No receipt amounts/taxes are recomputed in the renderer. The 80mm
Unicode PDF displays receipt number/ID, business/cashier snapshots, item and
tax snapshots, gross/net/tax, payment method, received cash and change.

Every PDF visibly says **SIMULATED TEST ONLY / NOT FISCAL / NOT VALID CUSTOMER
RECEIPT**. Files are under `artifacts/operations-lab/receipts/`.
Filename = SHA-256(tenant:venue:receipt-ID) + `.pdf`, never a business name/path
supplied by a user. The lab-only archive index stores receipt identity, renderer
version, immutable source and byte hashes. Advisory locking, an exclusive
temporary file and atomic hard-link publication prevent competing overwrites.
A crash leaving an orphan file accepts it only when the deterministic hash
matches; otherwise operator review is required. Missing/tampered archived bytes
fail printing and reconciliation; receipts/payments remain finalized.

A simulated success is acknowledged to P3 **only after** the PDF exists and its
hash is verified. PAPER_OUT creates an actual failed PrintJob/command result,
then the existing explicit retry increments that job's attempts. A reprint
creates a P3 job for the same finalized receipt, reuses the same PDF/hash, and
does not call payment creation. CASH drawer requests use P3's receipt/device
identity and five-minute policy; replay cannot add another drawer pulse.
UNKNOWN_RESULT/native uncertain output is not silently retried or claimed
printed; its existing explicit operator reconciliation contract is unchanged
and is not a LAB1 physical-hardware acceptance.

Archive capacity is configurable with `LAB_PDF_MAX_FILES` (default 50,000),
`LAB_PDF_MAX_BYTES` (5GB), `LAB_PDF_WARNING_RATIO` (0.8), and
`LAB_PDF_RESERVE_BYTES` (250MB). It warns before limits and refuses new files at
capacity; existing reprints still verify their existing bytes. Individual output
is limited to 1MB. `operations_lab.archive_print` associates actual P3 jobs with
receipt/file identity and hash, including reprints. No automatic history deletion
or cold-archive relocation is implemented; reserve/backup instructions apply.
Optional visual QA: `python tools/operations-lab/review-pdfs.py` (PyMuPDF).

## Independent daily oracle

The scenario evidence records authored quantities, base prices, variant/modifier
deltas and expected integer minor-unit values **before** the request. The
independent reader takes a repeatable-read snapshot of actual scoped orders,
items, tickets, payments, receipts, print jobs/commands, register sessions,
operational shifts and attendance. It checks IDs/counts, source, terminal state,
station routing, immutable item/money/tax snapshots, archive hashes, drawer
deduplication, closed cash and shift linkage. It compares the result with the
original authenticated daily report. Unresolved actions and discrepancies remain
visible and prevent run completion.

Orders use the venue's IANA **creation day**; payments use their **recording day**.
Direct linked payments and session-only value are separate. Session CASH is not
assigned a made-up per-order share and is not added to a register session it
does not reference. JSON contains source IDs and incidents; CSV exposes compact
minor-unit totals. A full financial/cash ledger is not introduced.

## Durability and the LAB2 boundary

Version-1 run/action domain contracts and lab-only durable tables contain
run/scenario version, seed, IANA date, actor/session, event/request identity,
dueAt, status, attempts, lease/checkpoint, expected input, request hash and result
source IDs. Completed actions return saved outcomes; an interrupted idempotent
action uses the same canonical key or observes the real versioned transition.
Attempts are bounded to three. Ambiguous non-idempotent writes require
NEEDS_REVIEW instead of blind retries. Completed runs recheck evidence without
issuing another operational day.

LAB1 supplies smoke and bounded normal-volume commands and API restart/replay proof.
It does **not** yet implement scheduled autonomous traffic, overnight
resume/catch-up, pause/resume UI, backpressure worker, continuous lease renewal,
full process-kill/lost-response fault coverage or a 72h soak. These are LAB2/LAB3
review gates. A failure across business-day rollover requires review of the
unfinished prior run; it must not manufacture missed historical events.
Reservations, leave/swaps and weekly import/Creative exercises are **SKIPPED in LAB1**.
No production tax/legal/payroll claims, online card processing, TSE,
fiscalization or physical printer acceptance are made.

See LAB1 review evidence.

## Normal-volume acceptance

`lab:normal` generates deterministic LOW/NORMAL/BUSY baskets with caps and seeds.
NORMAL targets DE 80 (35 counter, 15 staff table, 14 QR, 16 website), AL 100
(15 counter, 48 staff table, 25 QR, 12 website). Three website customers per
venue use actual published-site links, product/variant/modifier and basket UI,
pickup selection, contact form and submit button. Request observation records
the native browser key; it never mocks the response or uses API guest submit.
Tracking, real staff Orders dialog and final completion/P2/PDF are verified.
Remaining website traffic uses the canonical public API. A genuine sold-out
UI conflict is rejected server-side with no order created.

Two lanes per station and queued eight-order bursts produce actual backlog.
Preparation uses authored 120–720s targets multiplied by explicit acceptance
`--prep-scale` (default 0.003). Arrival curves are compressed, not a claim of a
real working day. Every timestamp is actual wall time; persisted run duration
includes interruption/recovery. One cancellable order, stale version rejection,
PAPER_OUT/retry/reprint and all eight shifts/attendance are exercised per venue.
Service tables and QR pools are separate because canonical P2 refuses a second
direct order payment in a session with existing payment records. QR session-only
payments remain explicit and produce no invented P2 receipt.

Reports under `artifacts/operations-lab/normal-day` distinguish run-owned results,
other simulation runs and manual activity. The independent day comparison uses
all canonical creation-day orders and recording-day payments. Existing completed
runs recheck without new orders/payments/receipts. Browser uncertainty requires
review: `--recover-pre-submit` requires no native dispatch key;
`--recover-browser-reviewed` observes the original native key, canonical basket
and tracking identity, and never submits another order. Incidents remain visible.

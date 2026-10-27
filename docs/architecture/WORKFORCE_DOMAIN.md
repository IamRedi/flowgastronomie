# Workforce domain and persistence

WF1–WF4 implement issue #23
on existing tenant, venue, user, membership, staff profile, planning, operational
work and notifications. This document distinguishes delivered WF1/WF2 from future WF3/WF4 ledgers.

## Current boundaries

`packages/domain/workforce` owns DTO schemas, profile write permissions, effective
contract selection, calendar/instant conversion, quarter-hour moves/resizes,
duration/past/overlap/publication invariants, suitability warnings and the minimal
publication event contract. It has no framework, database, filesystem or DOM dependency.
The Temporal polyfill is a pure ECMAScript date adapter. [Temporal's authoritative
ZonedDateTime specification](https://tc39.es/proposal-temporal/docs/zoneddatetime.html)
describes explicit ambiguity/offset choices; WF1 rejects gaps and requires a choice
for folds rather than relying on browser-local `Date` parsing.

API routes authenticate existing staff, validate transport input and delegate.
`workforce-repository` owns scoped transaction orchestration; the existing schedule
repository is a compatibility adapter over the same canonical reader/writer.
The web workspace uses one dataset for all three views. Pointer gestures and forms
produce identical DTOs; authorization and overlap decisions remain server-side.

## Additive, preserving migration

`20261009120000_workforce_wf1` adds profile/config/version/assignment metadata,
contract/profile/document/revision/template tables and a published-assignment index.
Assignment membership becomes nullable to represent a genuine open shift; this
relaxes the existing constraint and does not remove a column or record. Existing
assignment IDs, instants, roles and all POS/payment/receipt records remain unchanged.

Old published schedules receive a version-0 snapshot and indexed published entries
from their existing assignments. This is explicitly an imported baseline, not invented
past change history. Old drafts receive no published snapshot. Old legacy clients may
create a new plan, but subsequent writes require expected versions and stable IDs;
unversioned overwrites do not bypass the new writer.

Core aggregates:

- **StaffProfile:** existing membership identity plus operational employment fields
  and optimistic version. No duplicate Employee table. Work email is the existing User.
- **StaffEmploymentContract:** immutable dated contract revision. Append; never update
  a previous version. The first explicitly entered baseline may describe an earlier
  employment start; later contract changes cannot be backdated into a past period.
- **StaffProfileRevision:** purpose-restricted immutable before/after profile history.
- **StaffWorkDocument:** existing profile's private attachment metadata and authenticated
  AES-256-GCM ciphertext, 12-byte random nonce, tag and scope-bound authenticated data.
- **VenueSchedule:** weekly aggregate, current draft version and last published pointer.
- **ScheduleAssignment:** existing stable ID, nullable member, canonical tenant user,
  independent station/qualification and planned break, row version and cancellation.
- **ScheduleRevision:** immutable before/after/diff, actor, version and publication intent.
- **PublishedAssignmentRevision:** ordered immutable per-assignment publication changes,
  including removal tombstones. It indexes the same assignment IDs; it is not another
  shift identity or mutable schedule system. Latest-per-ID resolves transfers without
  leaking drafts or retaining two active published copies.
- **WorkforceShiftTemplate:** scoped rota configuration, not a cloned employee/schedule.

Composite foreign keys bind dependent histories/documents to profile and assignment
scope. Database triggers reject history updates/deletes. Only transaction-local,
explicit synthetic test cleanup permits deleting fixture histories. Employee
termination/deactivation never invokes that switch or cascades historical data.

## Transactions and concurrency

Every mutation authenticates a live tenant/venue/membership. Tenant advisory locks
serialize overlapping-user decisions across venue memberships. Schedule and profile
writes compare expected versions inside the transaction. Serializable schedule writes
map serialization/unique races to an actionable conflict. A cross-week move compares
both versions and updates both drafts atomically using the same writer; late failure
rolls both back. No endpoint accepts a caller's tenant/user authorization scope.

Schedule saves reconcile IDs and cancel removed assignments, retaining history.
Publishing requires explicit review confirmation. It freezes a snapshot, appends
publication changes and event intent, and records actor/audit in the same transaction.
No external provider is called inside the transaction or during WF1 publication.

Readers use a repeatable-read snapshot. Managers see operational draft plans and
history within their venue. Workers see only latest published assignment versions
for their tenant user; coworker profiles, draft revisions and private HR payloads
are excluded from transport, not merely hidden in CSS. The indexed reader uses
parameterized SQL and applies tenant/venue scope before latest-ID resolution.

Week identifiers are venue-local Monday calendar markers stored as UTC date keys,
not actual midnight instants. Assignment instants are UTC, with source local fields,
offset choices and frozen publication timezone. Overnight shifts may end next day;
conflicts compare actual instants, so DST hours and cross-week/venue overlaps remain
correct. New planning edits are in 15-minute steps, up to 24 elapsed hours; breaks
must be shorter than the shift. These are technical planning bounds, not legal limits.

## Purpose-specific privacy and document configuration

Owner holds `WORKFORCE_PRIVATE_MANAGE`; Manager retains rota/operational fields only.
Workers have self access and a limited personal-field write allowlist. Work stations
never alter Membership.role. Derived staffing targets are operational; confidential
contract terms/documents/profile history are Owner/self detail reads with access audit.
No wage/rate, bank/tax ID, medical diagnosis or emergency-contact collection ships in WF1.

Set server-only `WORKFORCE_DOCUMENT_KEY` to base64 for exactly 32 random bytes before
using private document upload/download. Never use a public env prefix or commit a key.
Keep its backup independently from database backups; losing/changing it prevents
reading old ciphertext. Rotation must be a separately audited re-encryption procedure.
Signature/size checks, sanitized attachment names, `nosniff`, attachment disposition
and `private, no-store` apply; no inline execution or external file provider is used.
No malware-scanning service or document-content extraction is claimed.

Contracts and ordinary operational profile fields rely on existing server/DB access
boundaries; production encryption at rest, access monitoring and jurisdiction-approved
retention must be reviewed before real HR rollout. WF1 does not silently purge HR history.
Later retention separates minimizable contacts/files from legally retained contract,
approved-time/monthly records and explicit HR legal holds. Existing customer retention
controls must not be repurposed as employee legal holds without their own review.

## Four ledgers and future interfaces

**PLANNED (WF1):** immutable published assignment revisions and scheduled breaks.
**ACTUAL (WF2):** append-only server clock/break/correction events, optional assignment
revision and operational StaffShift link. POS session timestamps are not an actual ledger.
**APPROVED (WF2/WF3):** actor/reason/version approval of recorded time and deviations.
**MONTHLY (WF3):** user/venue/month target, approved work, separate credited leave/holiday,
unpaid absence, carry/overtime and immutable close plus compensating adjustments.

Future monthly computations reference immutable contract/policy/attendance/publication
versions. Allocate actual UTC intervals to venue-local days/periods with explicit break
positions; never recalculate a closed month from today's mutable profile. WF1 summaries
are net planned shifts by start month and are intentionally not this monthly ledger.

Publication intent v1 contains event ID (`scheduleId:version`), tenant/venue/schedule,
actor/time, affected user IDs and structural before/after changes. It excludes free-text
notes, contract/rate and medical details. WF3 can atomically create per-recipient outbox
rows with a unique `(eventId,userId,channel)` key, localized opt-in delivery, retry and
in-app read/ack. Disabled providers must yield disabled/pending, never delivered.

WF2 leave/swap/open-claim requests use these user/membership/assignment references,
qualifications, overlap/rest decisions and manager approval. Country policies are
explicit effective-dated configuration from business/employment country, not locale.
Legal DE/AL rule values and hospitality exceptions require official-source verification
before implementation; no certified ArbZG/MiLoG/Albanian-law policy ships in WF1.

## WF4 test design and operational limits

Public registration + normal invitations produce two isolated synthetic DE/EUR/Berlin
and AL/ALL/Tirane businesses. A trusted application-clock port (never a public time
parameter or production env toggle) advances 28–31 deterministic days. Record expected
ledger minutes/leave balances up front, then assert corrections, midnight/DST, contract
changes, deactivation, locks/adjustments, scoped notifications/exports and POS statistics.
Real-time staging soak is separately authorized; no real customer/production fixtures.

WF1 requests: at most 93 calendar days, 500 assignments per week, 20 stations,
30 qualifications and 30 private documents per profile. History responses are bounded;
immutable storage remains. Legal retention, actual attendance, approved monthly ledger,
inbox/email/push and certified labor rules remain WF2/WF3 work, not completed WF1 claims.

## WF2 — delivered actual and approved boundaries

`workforce-operations` contains pure actual-state transitions, minute-precision DST
proposal conversion, exact interval/break calculations and local-day clipping,
independent review, effective policy selection, frozen leave slicing, allowance
checks, consent transitions and worker suitability/rest rules. API routes validate
transport and authenticate; `workforce-operations-repository` coordinates scoped
PostgreSQL transactions and the existing WF1 writer.

The application clock port defaults to server `Date`. It can only be supplied by
trusted application construction for isolated acceptance, is rejected in production
and has no runtime HTTP/environment override. The fixture clock route exists solely
inside the separately guarded loopback test executable. Devices never supply punch
timestamps; they provide an action, expected version and idempotency key.

### Actual evidence and approval

`WorkforceAttendance` is a scoped cursor on the existing profile/user/membership,
with frozen timezone, contract/policy and optional publication/POS references.
`WorkforceAttendanceEvent` is the immutable source: server occurrence/recording time,
actor, sequence, retry identity/hash and actual break category. A PostgreSQL partial
unique index prevents two active records for a tenant user, including different
venues. The same tenant advisory lock used by WF1 serializes clock and review races.
Authorization rows are shared-locked during transactions so role/deactivation cannot
race an already checked operation. Deferred guards require each mutable cursor to
match its latest immutable event/decision at commit.

Clock in → Working → Break → Working → Clock out. No duplicate start, unresolved
break clock-out or concurrent venue activity is allowed. Missing punches are not
silently closed. A correction stores proposed UTC intervals and explicit break
positions; approval appends a CORRECTION event and closes the cursor atomically.
Original events and prior approvals never change. Manager recovery can propose work
for an offboarded employee; a different authorized person must approve that proposal.
An active session can finish under its original policy after employment policy/country
changes; a new clock-in requires the currently applicable supported configuration.

`WorkforceAttendanceApproval` freezes the snapshot, exact presence/paid-break/unpaid-
break/worked milliseconds, displayed minutes, source event IDs, correction request,
actor and approval time. Only unpaid evidence is deducted from presence. Calculations
retain milliseconds and round final displayed minute totals once; day windows clip
actual intervals/breaks at venue-local midnight, including 23/25-hour days. Planned
breaks have no actual positions and are never injected into this evidence.

`approved-hours` provides `WorkforceApprovedAttendanceV1` records with immutable
approval/contract/policy/source references and an explicit truncation marker. This is
an approved-source interface for WF3, not a monthly account, closing job, overtime
bank, credited holiday/vacation ledger or payroll output.

### Leave and reviewed shift changes

`WorkforceRequest` retains its original typed proposal; only status/version changes.
`WorkforceRequestTransition` is immutable consent/review/cancellation history.
Sickness has dates/status and required structural identities, with no diagnosis,
medical attachment or free-text medical reason. Owner grants/adjusts annual minutes
through immutable `WorkforceLeaveGrant` entries. Opening balances are explicitly
entered, not reconstructed from mutable `StaffProfile.annualLeaveDays`.

Leave slicing freezes each date's effective contract/policy. The configured uniform
weekday allocation is weekly target divided by the explicit policy working-day count;
it must yield whole minutes. Whole non-working/excluded dates have zero annual debit;
partial dates use elapsed UTC minutes bounded by that daily target. Owners must review
working weekdays, excluded holiday dates and the allocation's fit to each contract
before granting reliable balances. This is a documented configured allocation, not
inferred rota, statutory entitlement, automatic accrual/carry or legal certification.
Balances equal explicit grants minus currently approved annual debits; pending debits
are shown separately. Cancellation retains old decisions and reverses the current
approval effect; WF3 will freeze consumption and compensate changes after closing.

Approved leave does not erase a published assignment. Approval requires explicit
staffing-impact acknowledgement; absence windows feed WF1's existing availability/
coverage warnings. Shift offers/swaps require coworker consent and manager review.
Open claims require manager review. Before approval, the transaction rechecks current
publication IDs and schedule versions, live membership/employment, station/skills,
availability, approved absence, overlap and rest warnings. It calls the existing
`saveScheduleInTransaction` for each affected week in the same transaction. No direct
assignment mutation or independent publishing engine is introduced. WF2 policies
currently require manager approval for every accepted shift change.

### Intents, privacy and limits

`WorkforceEventIntent` persists `WorkforceOperationsIntentV1` with event type/ID,
subject, tenant/venue, actor/time, exact recipients, permission contract and audit ID.
Payloads exclude contacts, contract terms, private documents and medical text. WF3
must recheck live recipient permissions and use `(eventId,userId,channel)` deduplication
before inbox/outbox delivery. WF2 sends no provider message and exposes decisions via
authenticated request history only.

Workers get own attendance/requests plus minimal coworker choice data. Managers see
operational evidence in their authorized venue; Owner/self HR rules remain in WF1.
All dependent identities/actors are bound by database foreign keys. Deactivation
preserves history; runtime deletion is blocked. Retention/legal hold, offboarding
exports, jurisdiction exceptions and real deployment configuration need separate
review. Operational reads are bounded to 93 days and 200 records with a truncation
signal; shortening the period avoids presenting incomplete summaries as complete.

See WF2 official-source configuration and acceptance.

## WF2 final privacy and completeness review

Employee `/operations` returns only the employee's roster entry, personal
attendance/requests and published shifts, plus eligible future open shifts.
Manager operational reads remain venue-scoped; confidential contracts, HR
documents and other workers' allowance histories remain Owner/self-only.
`exchange-options` requires an owned, future published assignment. It returns
qualified recipient names and membership IDs; counterpart shift choices are
returned only for an explicitly selected eligible recipient within 93 days.
It exposes no email, private profile, schedule note or unrelated attendance.
Consent and final publication/eligibility checks still run on the canonical
WF2/WF1 transaction. Reads never substitute for final approval validation.

The 200-attendance/request limit belongs exclusively to the UI listing.
`approved-hours` independently reads every current canonical approval in scoped
500-record batches, including corrections moved into the selected period. It
uses frozen approval timezones and emits `truncated: false`. WF3 must consume
this complete source or an equivalent complete canonical aggregation, never
`workspace().attendance`. Actual PostgreSQL/API acceptance reconciles 251
independently approved one-minute sessions (251 minutes), a visibly truncated
200-row UI, Owner/Manager/self sources and tenant/venue/deactivated-user denial.
JSON privacy assertions and the existing four-language real browser swap journey
exercise the authorized workflow rather than hiding disallowed fields in UI.

## WF3 — canonical monthly projection, immutable close and recipient delivery

`workforce-attendance-projection` is the shared replay/effective interval reader;
`workforce-transaction` shares current actor/tenant locks and append-only audit writes.
Neither creates another identity or actual/leave store. Monthly repositories load
all scoped source IDs in 500-row batches and delegate time/account rules to the pure
domain. Reports never use `workspace().attendance` or its 200-row UI cap.

New additive tables hold only effective account configuration, immutable monthly
close/compensation, personal notices/read receipts, consent revisions, push endpoints
and the delivery/attempt journal. Composite scope/subject/profile/actor references
reject mixed tenant/venue/user/member data. Existing tables/columns/records are not
rewritten. The upgrade proof preserves 25 pre-existing table hashes, including WF2
clock/approval/leave history and a synthetic closed cash/payment/receipt history.

Targets use effective contract revisions for each reporting-calendar date. Weekly
or monthly working-day allocation is explicit; employment bounds do not erase actual
history. Planned breaks have an explicitly confirmed paid/unpaid and proportional
boundary allocation because WF1 stores their duration rather than guessed actual
break timestamps. Actual/Approved clip recorded intervals and each break in UTC,
then sum milliseconds before display rounding. Paid credits follow frozen leave
slices and account policy: lost-target cap or exact recorded-work overlap exclusion.
Confirmed holiday dates must also be excluded in the canonical WF2 leave calendar;
old annual debit on a newly credited holiday requires human ledger reconciliation.
Country/rules are independent of UI language. No national calendar, wages, legal
compensation premium, automatic leave accrual or payroll certification is inferred.

A tenant lock serializes close with canonical writes. Close requires ended month,
complete rules/targets/carry and no unresolved attendance/requests; the actor must
be an authorized venue manager independent of the subject. Version 1 freezes
contracts/policies, daily targets, planning, original employee/venue labels, complete
source evidence, actor/time/audit and the reviewed fingerprint. Corrections append
`WorkforceMonthlyAdjustment` after the source approval/request transition completes,
in the same transaction. Target/planning remain frozen; actual/approved/credited and
linked carry deltas retain their new source hashes and audit. Later closed months
receive carry compensation. Original close rows/old approvals/events never change.

Publication and operation writers enqueue notices/channel rows before commit.
Recipient records bind canonical venue membership; current manager permission is
checked both when reading the inbox and immediately before delivery. Old manager
notices disappear after role downgrade; offboarded recipients are disabled. No email
address, push key, HR term/document or unrelated worker information enters an inbox
DTO. Inbox is mandatory for relevant events; external channels default off.

The outbox uses two-minute leases, `FOR UPDATE SKIP LOCKED`, immutable attempts and
bounded retry. Provider idempotency includes the immutable notice ID; push also uses
a stable topic/tag and browser opaque-ID deduplication. Recovery records expired
leases and rejects stale completion tokens. After the provider deduplication window,
ambiguous attempts become UNCERTAIN rather than blindly resent. DELIVERED means
transport acceptance, distinct from employee read/ack. The disabled adapter is never
classified as delivered, including accidental provider-name overrides.

The worker is a separate optional command, disabled by default, not an API startup
side effect. Due jobs consume immutable publications, emit reminders/missing-punch
notices only for affected workers/managers, suppress resolved/stale signals, and
create no invented attendance. PWA is a push-only extension of the same authenticated
web app: no new native app, cached staff pages or copied tenant directory. Existing
transactional Brevo is reused; private VAPID keys remain in the server process.

Manager month insights are scoped operational projections; staff self views and
exports share their canonical account. Rates absent means Owner-only NOT_CONFIGURED,
with no sales/financial read. PDFKit/Noto reuse existing rendering dependencies.
CSV fields neutralize formula prefixes; printable/PDF/CSV carry immutable version,
closing/compensation and complete source references. Export audit rechecks current
actor and target scope before sending bytes.

## WF4 — full-month proof and shared trusted clock

WF4 uses one real API/PG/browser scenario engine, two public registrations and an
independent input ledger; see review and evidence.
The same trusted construction clock now reaches WF1 profile/contract selection,
past schedule guards and publication, including WF2's canonical writer calls.
The default remains server Date; Production rejects the test clock and exposes
no clock HTTP/environment override. No live parallel accounting system is added.

# Workforce Management V1

Official plan: issue #23.
WF1 is merged through PR #24 (`76b2e1e1e620596e155944f6d32234b5a36c3c1f`).
The CI checkout correction in PR #25 gives verified main
`e4178b4d261579d943287e50bb3dc745dab8b4ac`, with
post-merge CI SUCCESS.
WF2 is the current Draft PR delivery; it is not authorized for merge or deployment.

## Product boundary

One workforce capability on the shared platform: employee profile → plan →
published assignments → recorded work → approved hours → monthly account.
RestaurantFlow remains the active product. Workforce is not payroll, a fiscal
register or a new employee identity system. Guests and public menus are unchanged.

User/Membership/StaffProfile, invitations, staff authentication and permissions,
VenueSchedule/ScheduleAssignment, availability notes, operational StaffShift,
tasks/handover, reports and existing notifications are the canonical foundations.
No real client, employee or pilot is precreated.

## WF1 — implemented profile and premium planning foundation

- Existing staff profiles gain work phone/reference, position, employment dates
  and status, stations/qualifications, recurring weekly availability and annual
  leave allowance configuration. Work email remains the canonical login/invitation
  identity. Workers edit their own name, phone and recurring availability;
  management maintains operational staffing fields.
- Owner-managed employment contracts are append-only, effective-dated versions
  with employment type, weekly/monthly target minutes, country and terms.
  Subsequent changes cannot be backdated into a past period. Historical contracts
  and profile changes remain readable; contract/rate calculations in later
  ledgers must retain the exact contract revision used.
- Owner and the worker themselves can read confidential contract/document/history
  detail. Managers see operational profiles and derived target hours, not another
  person's contract terms or private files. No bank account, tax ID, salary, medical
  diagnosis or unnecessary emergency-contact field is collected.
- Optional work documents/certifications are private encrypted attachments with
  title, kind and expiry, scoped access and access audit. PDF/JPEG/PNG, up to 4 MB,
  30 documents per profile. Upload/download needs an independent server-only key.
- **Team Week** is the manager's default: employee rows, weekday shift cards,
  pointer/touch move/reassignment/resize, keyboard/form equivalents, open shifts,
  templates, copy previous week, station/position filters and comfortable/compact
  density. Edits save a private draft; publication has a distinct review step.
- **Day Timeline** groups the same assignments by work station. It shows coverage,
  elapsed-time positions, overnight shifts and timezone offsets. Its day can have
  23 or 25 hours. It is planned coverage, not a verified attendance ledger.
- **Month / Compact** uses the same data/API, with a monthly calendar, staff hour
  summary and phone-friendly list. WF1 planned summaries allocate a shift's net
  planned minutes to its venue-local start month. They are not payroll or the
  approved monthly account; WF3 has explicit day/period allocation rules.
- Workers get their next published shift, today, own week/month, planned hours,
  location/station, permitted personal profile, availability notes and existing
  operational tasks/handover. They receive no draft or coworker HR payload.
- SQ/DE/EN/IT, visible keyboard focus, native modal focus containment, 44px controls
  and 360/390/768/1440 px browser acceptance.

## Planning invariants

Assignments keep their IDs. Edits update or cancel the existing record; no weekly
bulk delete/recreate remains. Cross-week moves update both drafts in one transaction.
Schedule revisions and published assignment changes are immutable. Workers resolve
only the latest published change of each canonical assignment. Draft saves cannot
change what they see; publishing a moved assignment replaces its previous location,
and later publishing the source week cannot erase the new location.

Every write carries an expected version. A stale manager receives a conflict and
must load the latest data. Overlap is checked by tenant user, including memberships
at other venues and published reservations whose drafts changed. A station or
qualification never grants or changes login permissions.

Changed/new/removed past assignments are rejected; past work is not silently
rewritten. Open shifts, availability and qualification suitability produce explicit
review warnings. Overlap, invalid duration, scope, stale version and missing publish
approval are hard blocks. No national legal rest/break policy is certified in WF1.

Venue-local calendar dates use IANA timezone conversion. Nonexistent DST times are
rejected; repeated times require an explicit earlier/later choice. UTC instants and
frozen timezone metadata back publication/history. Timezone changes elsewhere on the
platform require an explicit review of future plans, not retrospective recalculation.

## WF2 — attendance, breaks, leave and reviewed requests

The same `/{locale}/staff/schedule` workspace includes Today, My Hours, My Leave
and Requests, plus the manager's Workforce Operations/approval queue. All actions
use existing User/Membership/StaffProfile identities and authenticated venue scope.
No worker, business or real pilot is bootstrapped.

- Clock in, break start/end and clock out record server-authoritative immutable
  events. Retries return the original event; one tenant user cannot have active
  attendance at two venues. Invalid transitions and stale versions are blocked.
- Paid and unpaid breaks are actual intervals permitted by a frozen policy.
  Presence, all breaks, unpaid breaks and worked milliseconds remain distinct.
  No planned or assumed break is deducted from actual work.
- Unscheduled work, missing contract, missed clock-out and rest/break exceptions
  remain visible. Interrupted work is recovered through a proposal and an
  independent manager's compensating event, preserving original punches.
- Managers explicitly approve closed actual time or corrections with reason and
  acknowledged exceptions. Employees/managers cannot approve their own adjustments.
  Approved snapshots freeze source event, contract and policy references; earlier
  approvals remain immutable after a later correction.
- Annual, unpaid, personal, sickness and configured other absences support whole
  and partial days. Sickness carries necessary dates/status and structural links;
  diagnoses, ordinary medical attachments and medical notes are not accepted.
- Owner-entered annual opening allowances/adjustments are append-only minutes with
  year, actor, reason and contract/policy references. No automatic accrual, carryover
  or conversion of today's profile allowance into past balances. Debit freezes
  effective daily targets, explicit working weekdays and excluded holiday dates.
  Missing/insufficient allowance prevents annual approval. Approved absence changes
  require a separate reviewed cancellation, retaining every historical decision.
- Offers/swaps need coworker consent and independent manager approval; open claims
  need manager approval. Publication/version, suitability, availability, approved
  absence, overlap and rest warnings are rechecked atomically. Accepted changes
  use WF1's canonical writer/publication path, retaining stable assignment IDs.
- Managers see active work/breaks, late/absent planned workers, request/hour approvals
  and staffing impact. Approved absences feed Team Week/Day Timeline warnings.
  Workers see their own evidence/requests and minimal coworker shift/name choices,
  never private HR fields.
- An explicitly selected POS service session may link to attendance. Starting a
  POS session creates no attendance; clock-out does not end that POS session.
- Durable, scoped event intents record request/decision/clock-exception recipients
  and audit identity. Decisions appear within authenticated requests. Email, SMS,
  push delivery and a notification inbox are not implemented by WF2.

DE/AL rules follow effective employment/business country, never UI language.
All versions remain marked for legal review, including hospitality exceptions,
working-day/holiday allocation, entitlement and collective contract terms. See
WF2 operations and acceptance.

## WF3 — implemented for independent Draft review

WF2 PR #26 is merged at `e2c067d08024a7c10292e84e4bfc91b8ca366912`, after final
privacy/completeness correction and exact-head 13/13 release gates. Its
post-merge main CI
is SUCCESS. WF3 starts from that verified main and remains unmerged for review.

The existing staff workforce workspace adds My Month and a personal Inbox.
Monthly statements distinguish published Planned, recorded Actual, independently
Approved, separately Credited, contract Target, configured Carryover and Balance.
Complete canonical interval queries replace UI-limited sources: every relevant
attendance/approval is processed in 500-record batches, including moved corrections,
long interrupted sessions, midnight/month boundaries and DST. No 200-row cap applies.

Owner-confirmed effective DE/AL account rules select target allocation, planned
break treatment/allocation, paid absence categories, confirmed holiday calendar,
paid-credit overlap treatment, overtime/carry caps and reviewed retention years.
Country comes from employment, never UI language. Missing targets/credit rules are
unconfigured, not invented zero. Historical contracts/policies/source IDs remain
visible. Annual bank charging stays in WF2; account credits are explicit time-account
rules, not wage, tax, entitlement accrual or statutory compensation automation.

An independent manager reviews an ended, fully configured/resolved month and
closes immutable version 1. Future approved corrections or absence cancellation
append audited compensating snapshots without rewriting the close. Changes propagate
through already closed carryover periods. Original and current statements remain
separately exportable; publication, approval, leave decision, policy, actor and audit
references explain every figure. Inactive employees retain their historical statements.

WF1 publish/republish and WF2 event intents persist a personal notice and channel
outbox in the same transaction. Draft changes emit no publication notices. A separate
operator-enabled worker claims durable leases with `SKIP LOCKED`, retains attempts,
backoff/failure/disabled/uncertain states, and deduplicates event/recipient/channel.
Inbox read/important acknowledgment and opt-in preferences are personal and versioned.
Existing Brevo delivery is reused; PWA push uses the same web workspace and private
server VAPID configuration. Provider-disabled is never delivered. No real email/push
or paid provider was used for acceptance.

Manager insights show complete monthly team amounts, deviations, pending reviews,
absence decisions, station coverage/unallocated actual time and three-month trends.
Owner-only labor-to-sales is explicitly not configured while approved rates are absent;
no financial value is invented or queried. Employee views contain only self data.
CSV protects formulas and retains exact milliseconds/source references; PDF reuses
Creative Studio's PDFKit/Noto infrastructure; the printable report uses the same scoped
statement. Every export rechecks actor/target permissions and writes an access audit.

See WF3 review,
[account calculations and exports](../workforce/WF3_ACCOUNTING.md),
[notification operations](../workforce/WF3_NOTIFICATIONS.md) and
[architecture](../architecture/WORKFORCE_DOMAIN.md). WF3 has no merge/deployment
or remote migration authorization. WF4 remains the separate simulation checkpoint.

## WF4 — prepared test design, not production provisioning

Two fresh synthetic businesses use public registration and normal invitations in
isolated schemas or explicitly approved staging: DE/EUR/Europe/Berlin pizzeria and
AL/ALL/Europe/Tirane restaurant, 8–15 synthetic workers each. A server-controlled
fixture clock advances a deterministic 28–31-day sequence through role-specific
plans, drag/drop, publication, late/missing punches, breaks, illness/leave, swaps,
midnight/DST, deactivation, approvals, monthly close and exports.

Expected balance examples are specified before execution: target 160 h, approved
work 144 h, credited leave 8 h, credited holiday 0 h and carry 8 h give closing
balance 0 h; each category remains independent. Assert immutable contract references,
exact leave movements, notification recipients, cross-tenant denial and post-close
compensation. Controlled fixture addresses must never reach an email provider.
No production job, paid AI call or legacy client bootstrap is part of WF4.

See [domain architecture](../architecture/WORKFORCE_DOMAIN.md) and
acceptance and screenshots.

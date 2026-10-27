# WF3 monthly accounts and reports

Open Staff → Schedule → My Month. Employee sees self; venue managers select one
employee or inspect the operational team/station overview. No confidential contract
terms, work documents, private allowance history or salary rates enter this response.
Managers may close another employee's completed month; Owner alone configures rules.

## Complete canonical calculation

All effective attendance intervals are discovered from original clock evidence or the
latest compensating correction, with a current end for interrupted work. Canonical
records are loaded in 500-ID batches, never from the UI's 200 records. The same reader
supports internal cross-venue conflict/reminder suppression without returning another
venue's records. Statements remain per authenticated venue/membership; a shared tenant
user is not copied and one location's work cannot enter another's account. Explicit
per-venue contracts/allocations avoid blindly summing duplicated target assumptions.

- Planned references immutable publication/schedule revisions. Owner confirms whether
  planned breaks are paid or deducted. Because planning stores break duration only,
  its explicitly confirmed proportional allocation splits overnight/month boundaries;
  it never fabricates actual break timestamps.
- Actual replays original/compensating events; Approved reads the current independently
  approved snapshot and its frozen contract/operational policy/source event IDs.
  Every interval and break is clipped to the reporting month in UTC. Exact milliseconds
  are summed before presentation rounding; DST does not assume a 24-hour day.
- Target uses each date's effective contract and confirmed weekly-working-day or
  monthly-working-day allocation. Contract revisions and employment start/end bounds
  remain distinct from actual evidence. No contract/month target means unconfigured.
- Credited leave uses approved frozen slices/decision IDs and explicit paid categories.
  Owner confirms either `LIMIT_TO_TARGET` (lost target time) or
  `EXCLUDE_RECORDED_WORK` (exclude exact approved worked overlaps). The second permits
  approved partial leave outside worked intervals to remain credited even when the
  employee also works their full target. Holidays credit lost target time only, with
  no double annual/holiday credit. Dates must be confirmed in the canonical WF2
  excluded-leave calendar first; an old annual debit on a newly credited holiday
  requires reviewed cancellation/re-request/ledger reconciliation. Paid/unpaid/pending/
  rejected/cancelled absence decisions remain separately reportable, including zero
  credit. No wages, benefit entitlement, automatic holiday/leave accrual or statutory
  compensatory rest/pay premium is guessed from these account rules.
- Carry is disabled or explicitly configured with first month/opening balance and
  positive/negative caps. Thereafter it references the previous immutable close and
  compensations. Missing predecessor/opening rules remain unknown.
- Balance = approved + credited − target + carry. Configured overtime compares
  approved or earned (approved + credited) to target; otherwise it is unconfigured.
  A variance is a working-time measure, not a wage deduction or debt claim.

Country follows effective employment and reviewed policy, not SQ/DE/EN/IT screen
language. Reporting timezone and every close-time policy/contract reference freeze
historical meaning; later changes cannot rewrite a closed target/planning snapshot.

## Independent close and compensation

Close requires an ended month, complete configuration/target/carry, no unapproved
or interrupted attendance and no pending/accepted requests in the period. Manager
must be independent of the subject. A complete-source fingerprint detects concurrent
changes; request key/hash and unique subject/month prevent duplicate close. Version 1
is append-only and freezes original identity/venue labels, target/planning, policies,
source evidence and actor/time/audit. Original print/CSV/PDF remains available.

Approved corrections/absence cancellation append an audited adjustment after the
canonical source decision is final, in its same tenant-locked transaction. Actual,
approved, credited and linked carry changes retain before/after source references;
no raw event, prior approval or close is overwritten. Changes propagate through
later closed carry periods, retaining original statements. Current export identifies
the latest adjustment hash/version separately from original close hash/version.
Inactive employees keep historical manager access; personal access/delivery stops.

## Scope-protected reports

CSV includes exact milliseconds/minutes, targets, break/absence/credit/balance,
status/closing/adjustment and every canonical source reference. String formula
prefixes (including leading whitespace/tab/CR) receive a literal prefix and proper
CSV quoting. PDF reuses PDFKit/Noto from Creative Studio, with paginated source
appendix. Printable report uses the same statement, scoped DOM and print CSS.
Each export rechecks actor/target authorization and records its fingerprint/access
audit before returning private/no-store bytes. Nothing is a payroll-certified payslip.

Team insights include deviations, pending approvals/requests, configured overtime,
absence summaries, published station presence coverage, unallocated actual time and
three-month trends. Approved rates absent means Owner-only NOT_CONFIGURED; no labor
cost, sales query, wage or ratio is invented. Staff receives no team/financial projection.

## Provisional and confirmed presentation

An open statement is explicitly PROVISIONAL / VORLÄUFIG / PROVIZOR / PROVVISORIO.
Its recorded net hours, approved hours, credits and carryover are distinguished from
the full-month contract target. The resulting negative variance is not employee debt.
No separate month-to-date target formula is introduced. UI, print, CSV and PDF
share the localized explanation; canonical milliseconds, approvals, source references
and immutable snapshots are unchanged. Closed views show confirmed balance and
original close version; latest compensations have their own version and original-view switch.

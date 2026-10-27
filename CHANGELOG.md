# Changelog

## 2026-10-10 — Workforce WF3 (Draft review)

- Complete WF2 privacy/251-record source verification, normal PR #26 merge and
  successful exact-main CI before starting WF3.
- Derive full monthly planned/actual/approved/credited/target/carry accounts with
  immutable independent close and source-linked compensation through later closes.
- Persist publication/operation notices and channel outbox atomically; add personal
  inbox/read/ack/consent, leases/retry/failure/disabled/uncertain attempts, reused
  Brevo and opt-in private PWA push. No real provider delivery or startup activation.
- Extend premium workforce views with scope-protected month/team/station trends
  and complete CSV/print/PDF evidence; no invented rates or payroll claim.
- Add local PostgreSQL/API/browser acceptance and 25-table history preservation;
  retain WF1/WF2, POS, Import V2 and Premium regressions. No WF3 merge/deployment.

## 2026-10-09 — Workforce WF2 (final acceptance)

- Integrate WF1 PR #24, then correct shallow main CI checkout through PR #25;
  verify successful post-merge main CI before implementing WF2.
- Add server clock/break evidence, idempotent retry and cross-venue work guards;
  preserve original punches through independently reviewed compensation.
- Add frozen hour approvals, configured annual allowance and whole/partial absence
  requests, audited decisions and canonical swaps/open claims.
- Extend the existing workforce workspace in SQ/DE/EN/IT, with durable recipient
  intents, protected scope and reviewed DE/AL policy versions.
- Add real PostgreSQL upgrade/API/browser gates; retain POS, Premium, Import V2
  and WF1 regressions. Controlled WF2 merge requires exact final release/CI
  acceptance; no deployment or remote data operation.
- Restrict employee operations to personal records and eligible open shifts;
  load minimal coworker exchange choices only for an owned future publication.
- Read canonical approved hours independently in complete scoped batches, with
  251-record JSON reconciliation and tenant/venue/private-profile regression tests.

## 2026-10-06 — M0.1 public order status (pending review)

- Simplify normal Track order to one reference field in sq/de/it/en. Show only
  current status and stored requested time, with manual refresh.
- Add a venue-scoped read-only projection, explicit API allowlist, generic
  failures and a shared ten-check/ten-minute IP limit. No private data or new
  credential is returned; full details and live updates retain the private link.
- Preserve compatibility recovery, ASAP/scheduled ordering, staff confirmation,
  production and payment behavior. No additional migration or SMS integration.
- Add API, PostgreSQL and four-locale responsive browser regression coverage.
  PR #11 awaits review before merge; M1 infrastructure has not started.

## 2026-10-05 ? Online ordering timing and customer tracking (pending review)

- Default pickup to server-resolved ASAP; replace native datetime checkout with
  localized day/slot dialog and mobile bottom sheet.
- Add nullable venue preparation configuration and saved production boundaries;
  keep future accepted pickups out of Kitchen until due.
- Improve existing private tracking with clear progress, READY, products/options,
  requested time, name and latest staff message; retain SSE and polling fallback.
- Add recent-session tracking and venue-scoped reference-plus-phone recovery via
  hashed 30-minute HttpOnly cookie, generic errors and dedicated rate limiting.
- Add domain, PostgreSQL, API and responsive four-locale browser regression tests.
- Preserve payment/receipt/fiscal rules, Marketing and pilot legal/provenance guards.

See [timing, migration and recovery](docs/operations/ONLINE_ORDERING_UX.md).

## 2026-10-05 — Order/payment reconciliation (PR #10 merged)

- Add Active / Today / Paid / Completed views with real methods, linked paid
  amounts and receipt links; preserve completed paid history.
- Separate creation-date count/value/paid/pending from recording-date
  CASH/CARD/OTHER totals in Dashboard and Report.
- Reconcile today's orders, earlier orders, table-session payments, excluded
  orders and unlinked records. Show unknown session allocation apart from pending.
- Preserve existing data, schema and payment/lifecycle writes. Document local
  demo/test artifacts separately from legitimate date differences.
- Add exact PostgreSQL scenarios and localized responsive browser checks.
- Verification: `npm run check` passed (285 tests/build), PostgreSQL 64/64,
  focused production browsers 12/12 and local UI checks 3/3.

See [definitions, audit and verification](docs/operations/ORDER_PAYMENT_RECONCILIATION.md).

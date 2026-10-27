# Changelog

## 2026-10-13 — M2 Frankfurt staging candidate

- Verify Clouvider operator SSH/sudo, hardening, Docker and isolated empty Neon
  recovery. Match staging backup tools to the provisioned PostgreSQL 18 while
  retaining PostgreSQL 17 as the base production default. Public staging remains
  pending DNS ownership/approval, release gates and application acceptance.
- Reconcile current main with the existing staging infrastructure, preserving all
  application/database code and both sets of historical documentation entries.
- Replace the active OVH target with the purchased Clouvider Frankfurt host;
  record completed Ubuntu setup, encrypted operator key and pending host identity.
- Keep deployment, DNS writes, PR merge and public acceptance gated independently.

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

## 2026-10-08 — M2 Madrid execution authorized; access blocked

- Reconcile the existing M2 branch with accepted SI2 main `9b8e043`, preserving
  the earlier OVH planning history and all migrations.
- Prepare the existing M1 package for staging TLS, private persistent Creative
  storage, paired database/media backups, scheduled failure visibility and recovery.
- Focused local Docker checks pass for isolation, TLS/SSE and isolated DB/media
  restore. The current M1 Docker package gate passes including SI2 migrations.
- Remote OVH/Neon/DNS access is unavailable in this session. No server bootstrap,
  Neon resource, public HTTPS, remote migration or deployment has been performed.
  See evidence and remaining dependencies.
- No paid AI call, extra purchase, real customer import or fiscal transaction.

## 2026-10-07 — Germany retained; OVH correction enquiry submitted

- User confirmed Germany only and prohibited bootstrap/deploy on Madrid.
- Submit OVH ticket CS16879987 asking whether the paid order can be corrected
  or replaced with VPS-2 Germany without a second payment or additional cost.
  Request explicit terms; do not authorize cancellation or billing changes.
- Official FAQ rules out direct country migration; support must confirm any
  payment transfer/refund for this order. Ticket is New; answer pending.
- No new order/payment without user confirmation. Technical M2 remains blocked
  until a German VPS is Active; no runtime tests or host changes performed.

## 2026-10-07 — M2 delivered VPS; region decision required

- Verify the delivered VPS is Active with Ubuntu 26.04, 4 vCores / 8 GB / 75 GB
  and Standard automated backup. OVH identifies Madrid, Spain, not Germany.
- Verify SSH port 22 responds without authenticating or modifying the host.
  Host fingerprint, login and sudo remain unverified.
- Pause bootstrap for the user's region decision; preserve the Germany requirement.
  No service replacement, purchase, SSH hardening, Neon resource or deployment.
- Documentation checkpoint only. The single M2 smoke remains NOT RUN; M3,
  fiscal activation and go-live remain excluded.

## 2026-10-06 — M2 order placed; awaiting OVH provisioning

- User reports purchase complete; authenticated OVH order 260984210 is verified.
  Latest tracking state: payment validated, order accepted, product being
  delivered; no active service or IP yet.
- Record the actual VPS-2 LZ / remote-storage order separately from the earlier
  standard-Limburg/local-NVMe proposal. Region and OS must be checked on delivery.
- No additional order/payment action, SSH bootstrap or live M2 gate performed.
  M3, fiscal activation and go-live remain excluded.

## 2026-10-06 — M2 purchase preparation; OVH stock blocker

- Verify M1 PR #13 merged at `f95c579` and resume the existing
  `infra/ovh-staging-deployment` branch.
- Prepare VPS-2 2027 / Germany-Limburg / Ubuntu 26.04 / monthly no-commitment
  configuration with included Standard backup and no paid extras.
- Live configurator marks Limburg unavailable. EUR 8.58/month is the advertised
  12-month offer; a final monthly payable quote is not available without stock.
- Record the approval/payment boundary, post-provisioning sequence and pending
  M2 gate in `docs/operations/OVH_M2_STAGING.md`. No purchase or deployment ran.
- Documentation-only checkpoint; runtime and release tests remain for the M2
  milestone. M3, fiscal activation and go-live remain excluded.

## 2026-10-06 — M0.1 public order status (pending review)

Historical entry below: PR #11 was subsequently merged; M1 is now complete.

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

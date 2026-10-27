# Orders and payment reconciliation

## Three different clocks

- **Active operational queue**: work needing action, regardless of creation date.
  Paid orders remain until handoff; unpaid handoffs remain payable. Cancelled/
  rejected orders, closed table sessions and completed paid orders leave Active.
  Dashboard LIVE cards read the same queue as Orders → Active.
- **Orders created on the selected business day**: all in-venue and online
  orders, including pickup/delivery/catering. Valid count/value excludes cancelled/
  rejected orders. Current direct, non-voided `PaymentRecord.orderId` /
  `onlineOrderId` links determine paid and outstanding amounts for this cohort,
  regardless of the payment recording date.
- **Payments recorded on the selected business day**: current `RECORDED` rows
  whose `recordedAt` falls in that day. CASH, both card methods and OTHER are
  separate. Sum `amountMinor`, not received cash, change or receipt totals.

The existing `businessDayUtcRange` uses inclusive local midnight/exclusive next
midnight, converted to UTC in the venue timezone. DST days need not last 24 hours.
Reports reflect current statuses, not an immutable accounting close. Voided
payments leave recorded totals and remain in the existing void-date projection.

## Reconciliation contract

`GET /v1/staff/reports/daily?date=YYYY-MM-DD` adds `reconciliation` to the existing
report, at VENUE scope under the existing permission/entitlement. SELF reports
return `null` for this venue-wide projection.

`ordersCreated` contains valid count/value, directly linked paid, known pending,
unallocated session-related order value, overpaid and excluded order count.
Pending is calculated per order: an overpayment cannot offset another order.

`paymentsRecorded` contains total, CASH/CARD/OTHER and exclusive categories:

1. Today's eligible orders.
2. Eligible orders created before the selected day.
3. Table-session-only payments, without order allocation.
4. Cancelled/rejected orders.
5. Unlinked/inconsistent records, including a target outside scope or dated after
   the selected day. These stay visible for review.

The categories sum to recorded total. `otherPaymentsMinor` includes every
recording outside today's eligible order cohort. Reads use a repeatable-read
snapshot and tenant/venue scope. Direct payments also linked to a session count
once. No schema migration or monetary write path is added.

### Session-only payments

Legacy table checkout permits `tableSessionId` without a direct order link. There
is no persisted per-order allocation; never invent one, especially across days.
A fully covered session can make an order PAID while its directly linked paid
amount remains zero. Its remaining value is **awaiting session allocation**,
excluded from known pending. The recording stays in the session-only category.
This is an allocation limitation, not a claim that the outstanding amount is zero.

The identity is `order value + overpaid = linked paid + known pending + unallocated`.
Do not force `order value = payments recorded`: creation and recording clocks
differ. €28.70 / €47.50 can reconcile as two orders (€16.50 paid, €12.20 pending),
plus €31.00 recorded for an older order. This is a tested example, not an
attribution claim about a specific pilot snapshot.

## Orders, Dashboard and Report

`GET /v1/staff/pilot/orders` keeps its array response and default Active view.
Optional `view=ACTIVE|TODAY|PAID|COMPLETED` and `date=YYYY-MM-DD` select history.
Historical views default to the venue's current business date. Active ignores
date and remains live. Today includes cancelled/rejected and completed/paid
rows. Paid/Completed filter the selected creation day, not payment recording day.
All in-venue sources and online fulfillment types are included.

Rows expose reference/source/value, separate lifecycle/production states, current
payment status, directly linked paid amount, real methods and receipt link when
available. Session amounts explicitly say they are not allocated to that order.
Historical paid detail does not mount automatic printing. Existing permissions
and payable/handoff conditions remain enforced; no new payment method or online
processing is enabled.

Dashboard shows four creation-day figures and separate Payments recorded today.
An explanatory disclosure links to Report → Reconciliation, which renders the
same projection and relationship breakdown. Channels remain separate with
existing submitted-count/value semantics. All helper/state text supports sq/de/it/en.

## Read-only local audit — 2026-10-05

Local verification databases contain identifiable demo/E2E artifacts, including
`demo-live-order-07` and repeated counter/website test orders. For example,
`restaurantflow_pr8_e2e`, venue `demo-venue`, had 22 in-venue orders worth €336.10
and €195.10 recorded on October 5. Other pilot databases retain October 4 activity.
These are verification data, not real business performance.

The exact 1-active / 2-orders / €28.70 / €47.50 snapshot was not present in inspected
local data. Its venue/date/origin needs identification before attributing the
€31.00 difference to any particular record. Stale test data and legitimate date
differences must not be conflated. No existing pilot/test data was deleted, reset
or rewritten to align totals. Automated verification uses a separate
`restaurantflow_reconciliation_verify` DB; cleanup affects only its own fixtures.

## Verification

Domain tests cover categories, deduplication, voids, overpayment, session
allocation, boundaries and historical semantics. PostgreSQL tests assert exact
values from real relationships, receipts, online payments, CASH/CARD, exclusions,
DST and tenant/venue/self isolation. Browser checks cover four locales on
desktop/mobile, daily figures, live separation, filters, receipt links, focus,
44px controls and no mutations during history review. Existing production,
cash/receipt and website-pickup journeys remain regression checks.

Run `npm run check`, `npm run test:integration --workspace=@flowgastronomie/database`
and `npm run test:e2e -- order-payment-reconciliation.spec.ts pilot-operational-flow.spec.ts simple-pilot-website-pickup.spec.ts`.

Verified on 2026-10-05:

- `npm run check`: format, all workspace typechecks, 285 tests (6 process + 279
  workspace tests) and production build passed.
- All 12 PostgreSQL integration files: 64 tests passed on the isolated DB.
- Focused production browser suite above: 12 passed, including sq/de/it/en at
  1366px and 390px, session allocation and three real operational journeys.
- Local read-only Dashboard smoke at 1366/1024px plus mobile: 1 passed;
  intercepted CASH/CARD UI contract smoke: 2 passed.

Chromium and Node may ship different ICU locale data. Browser currency assertions
use Chromium's formatter, while visible labels/states are checked against the
selected locale. Retained local captures are in `artifacts/reconciliation/`;
browser fixture captures demonstrate presentation, not pilot business data.

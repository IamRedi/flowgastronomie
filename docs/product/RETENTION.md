# Operational data retention

## Scope and decision

This is the default operational retention schedule for RestaurantFlow's German/EU
pilot. It applies to data processed by the platform for service fulfilment and
does not replace a venue's independent tax, accounting, employment, or legal
hold obligations. RestaurantFlow is not a fiscal POS or invoicing system.

The schedule follows the GDPR storage-limitation principle: identifiable data
must not be retained longer than necessary for the stated purpose. Every pilot
venue remains responsible for validating its controller role, legal basis, and
any longer mandatory retention period with its legal adviser before production.

| Data                                                                         | Default limit | Trigger and action                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Reservation and online-order guest contact data, including customer profiles | 90 days       | Erase or irreversibly redact 90 days after the requested fulfilment/reservation time; profiles use the latest linked source time.          |
| Guest messages and free-text requests                                        | 30 days       | Erase 30 days after the request is completed, cancelled, or rejected.                                                                      |
| Anonymous table-session and guest-token hashes                               | 30 days       | Delete 30 days after the table session closes; do not retain raw tokens.                                                                   |
| Staff session hashes                                                         | 30 days       | Delete after session expiry.                                                                                                               |
| Operational order/payment snapshots after personal-data redaction            | 24 months     | Retain only tenant/venue, timestamps, immutable item/total snapshots, status history, and actor references for operational reconciliation. |
| Staff audit events, shifts, and handover records                             | 24 months     | Retain for operational accountability; they are not payroll or attendance records.                                                         |
| Non-identifying daily projections                                            | 24 months     | Retain only after ensuring no direct guest contact data is present.                                                                        |

## Exceptions and controls

- A documented legal hold may pause deletion only for the minimum required
  records. It must name the responsible owner, legal basis, scope, start date,
  review date, and expiry date. It is not an open-ended extension.
- A correction or deletion request is handled without undue delay. It detaches
  or redacts contact data where no overriding legal obligation applies; it does
  not rewrite non-identifying immutable operational totals or audit attribution.
- The scheduled retention worker must run daily, be idempotent, create a
  privacy-safe audit count (never copied contact data), and alert when it has
  not completed for 48 hours.
- Backups are encrypted, access controlled, and expire within 35 days. A
  deleted production record may remain only until the relevant backup expires;
  it must not be restored into production except under the approved recovery
  procedure.

## Implementation status

The daily retention command is `npm run retention:run --workspace=@flowgastronomie/database`.
It writes a `RetentionRun` record containing only completion state and aggregate
counts. It atomically redacts expired reservation and online-order contact data,
addresses and guest notes; deletes expired customer profiles, guest messages and
staff sessions; and irreversibly replaces expired closed-table guest-token
hashes. It intentionally preserves item snapshots, totals, status history, and
actor attribution.

The production scheduler must invoke that command daily and run
`npm run retention:check --workspace=@flowgastronomie/database` as its 48-hour
health check; the check exits non-zero if no successful `RetentionRun` exists.
Owners can create, review, and release an attributed, time-bounded legal hold
for a single online order, reservation, or customer profile. A hold excludes
only that target from the automated redaction run; it does not pause retention
for the whole venue or unrelated source records.

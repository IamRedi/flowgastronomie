> Historical evidence, superseded on 2026-10-09. Real-client preprovisioning,
> local pilot credentials and client-specific preview paths are retired. Use
> registration and synthetic acceptance.
> Commands or client defaults below describe the earlier milestone only.

# Pizzeria pilot readiness (without physical hardware)

This is an operational checklist for the current RestaurantFlow pilot baseline. A
successful local or CI gate is evidence for the software flow, not approval for a
live German fiscal cash register. Do not enable a real cash register until the
device, vendor documentation, fiscal obligations, and operator procedures have
been accepted separately.

## Reproducible local demo profile

Use only a disposable local database. Run the normal migrations and demo seed,
then `npm run db:pilot-profile`. The profile command refuses production mode,
non-local database hosts, and any venue other than the known seeded demo venue.
It is idempotent and does not reset data. It publishes only the seeded pizza
category for this rehearsal. The base seed remains unchanged for
other test journeys.

| Item                                                       | Status | Evidence / pilot action                                                                                                                                                                         |
| ---------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three table QR identities                                  | READY  | The profile keeps seeded table 07 and adds 08 and 09. Demo QR tokens use the matching `demo-table-XX` strings; print and scan each before service.                                              |
| Takeaway counter path                                      | READY  | POS starts in TAKEAWAY; kitchen receives the ticket and the Orders view retains it until pickup/payment.                                                                                        |
| Kitchen active, bar optional/off                           | READY  | Seeded pizza products route to Kitchen. The profile makes bar products unavailable; do not staff the Bar station for this pilot.                                                                |
| Online pickup on; delivery and catering off                | READY  | The local profile enables pickup ordering only. Manager accepts website requests; ready orders can be settled with the existing counter CASH/CARD receipt flow.                                 |
| Reservations off                                           | READY  | Profile disables reservation entitlement and auto-confirm for the demo tenant.                                                                                                                  |
| Hardware simulator off in normal UI                        | READY  | Keep `HARDWARE_SIMULATOR_ENABLED=false` (the `.env.example` default). Hardware settings are collapsed and visible only to Manager/Owner.                                                        |
| Individual Manager, Waiter/Cashier, Kitchen access         | READY  | Use named accounts and check their role permissions. `WAITER` is the current cashier role; no separate Cashier role exists.                                                                     |
| Real venue identity, menu, prices, allergens and tax setup | READY  | Configuration and receipt snapshots exist. The operator must enter and approve the real business data before any live transaction. Do not copy demo credentials or QR tokens into a real venue. |

The demo profile does not change the public website's seeded Osteria copy.
Review/rewrite the website through normal owner publishing before using the
demo profile for a customer-facing rehearsal. The profile is not a production
tenant template.

## Daily operation rehearsal

| Step                                           | Status           | Operator check                                                                                                                                                                                                  |
| ---------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login and start shift                          | READY            | Manager/Waiter sign in; POS Register panel starts each person's shift. Kitchen signs in separately and starts its own shift if required.                                                                        |
| Open register                                  | READY            | Manager/Owner enters opening cash and opens one venue register. Waiter/Cashier can take payments afterward but cannot open or close it; schedule a Manager for opening and closing. CASH is blocked until open. |
| Enter takeaway or table order                  | READY            | Choose pizza/size/options; optional per-line kitchen note is saved in the order snapshot. Verify the kitchen ticket shows quantity, options, note, reference and age.                                           |
| Prepare and hand over                          | READY            | Kitchen or Manager/Owner in Orders marks PREPARING then READY. Orders shows production and payment separately and records pickup or table service.                                                              |
| Take CASH or CARD_AT_COUNTER                   | READY            | Cash requires an open register. Card is a manual confirmation of an independent terminal; no terminal integration exists. A confirmed payment creates one finalized receipt.                                    |
| Receipt and reprint                            | READY            | Check business identity, tax breakdown, per-venue sequential number, payment method, browser print, and reprint of the same receipt. It is an operational receipt, not a TSE fiscal receipt.                    |
| Close register, end shift, review daily report | READY            | Manager/Owner counts cash and closes the register. Each worker can then end their own shift in POS. Manager reviews Staff Reports for the business date and reconciles with the count.                          |
| Printer failure / drawer failure               | PENDING HARDWARE | Simulator and software print-job retries are available; confirm actual paper-out, duplicate prevention, and drawer behavior on the physical device. A payment remains recorded even when print fails.           |

## Failure and recovery checks

| Item                                                                                                             | Status           | Evidence / pilot action                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing shift/register, sold-out product, changed option, stale kitchen ticket, already-paid order, network loss | READY            | Staff-facing messages point to the next action. On an uncertain network submit, check the active order list before retrying.                                                                                                                                                           |
| Backup, restore, migrations                                                                                      | READY            | Follow [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md): daily and pre-migration backups, `prisma migrate deploy`, restore to an isolated database, compare record counts and run readiness checks. `npm run test:backup-restore` rehearses this without altering the source database. |
| Scheduled backup ownership and restore drill for actual pilot host                                               | OPTIONAL LATER   | Assign an operator, retention location, restore target and monitoring when a host is selected. Do not infer this from local rehearsal.                                                                                                                                                 |
| Physical printer, drawer, Android device and GEON adapter                                                        | PENDING HARDWARE | Obtain vendor SDK/protocol documentation and device. Run signed-command, print, reprint, failure/retry and cash-only drawer acceptance on real hardware. No GEON commands are assumed.                                                                                                 |
| German fiscal requirements (TSE, DSFinV-K and related acceptance)                                                | PENDING TSE      | Separate P4 scope. Do not represent the current receipt as fiscal/TSE compliant.                                                                                                                                                                                                       |
| Card-terminal automation, online payment, reservations, delivery/catering and expanded bar flow                  | OPTIONAL LATER   | Website pickup is enabled for this pilot; these other channels and integrations remain out of scope.                                                                                                                                                                                   |

## Gate evidence

Before each rehearsal record the Git SHA, migration status, `npm run
release:verify`, `npm run test:e2e`, viewport checks at 1024×768 and
1366×768, and the date/operator. The release gate includes format, types,
unit/integration tests, build, E2E and backup/restore rehearsal. Keep screenshots
and register reconciliation in local artifacts; never commit real customer data
or secrets.

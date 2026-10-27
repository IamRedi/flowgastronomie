# Cash register and receipt foundation (P2)

P2 is the approved RestaurantFlow counter-sale pilot. Hardware, online payments,
terminal connections, TSE, and fiscal certification are outside its scope.
Existing table-service and online payment reconciliation remain separate. Only
new POS counter payments enter this register ledger.

## Configuration and operation

Deploy additive Prisma migrations and generate the client using the established
database scripts. Existing products and orders are not rewritten. Configure the
tenant's organization billing profile with its legal name, address, postcode,
city, and country. Payment refuses an incomplete profile. Business and cashier
details are copied into each finalized receipt.

Owners/managers configure product taxes through authenticated
`PUT /v1/staff/pos/tax`. This is a **test example, not a statutory rate**:

```json
{
  "code": "TEST_ONLY_10",
  "rateBasisPoints": 1000,
  "dineInRateBasisPoints": 1000,
  "takeawayRateBasisPoints": 1000,
  "productIds": ["your-scoped-product-id"]
}
```

`GET /v1/staff/pos/tax` returns scoped categories and assignments. Rates use
basis points (1000 means 10%). Nullable context overrides fall back to the base
rate. Configuration affects new POS orders only. Actual venue tax policy must
be confirmed by its responsible adviser; demo `DEMO_TEST_*` rates are fixtures.
There is currently no tax configuration editor in the POS UI.

Start a shift and open the register with opening cash. Creating a POS order
sends it to the station without paying it. For CASH, enter received money and
confirm: change is received minus gross total. CASH requires an open register.
For CARD_AT_COUNTER, confirm acceptance by the independent terminal. This only
records a manual payment and does not charge a card or affect expected cash.

The resulting receipt opens on screen and supports browser Print. Same-key
payment retries return the original receipt; an order cannot be paid twice.
A table POS payment refuses a session already reconciled by the existing table
payment workflow. Close the register with counted cash: expected is opening
cash plus recorded counter cash payments, and difference is counted minus
expected. Closing actor, shift, time, notes and amounts remain immutable.

## Financial invariants

Money uses integer minor units. A POS line snapshots its code, effective rate,
quantity, gross unit/line, net and tax at order creation. Net uses half-up
rounding once per line, calculated with integer arithmetic; tax is the residual
gross minus net. Totals and breakdowns sum snapshots. Variants/modifiers are
included in gross unit price. Missing historical snapshots block payment.

Payment, receipt sequence allocation, finalization and audits share one database
transaction. Venue locking serializes register open/close and counter payments.
Each venue starts at `R-000001`. Unique constraints prevent duplicate order
payments and receipt numbers. Finalized receipts cannot be edited/deleted;
paid orders cannot be cancelled and their payments cannot use legacy void.
Refund/correction documents are a future workflow.

Reserved fiscal extension fields remain null. These receipts make no claim of
TSE/DSFinV-K or German fiscal POS compliance.

## Tests and demo cleanup

`npm run db:seed` replaces only the existing demo tenant fixture, including P2
records; it rejects `NODE_ENV=production`. Tests and demo seed enable
`SET LOCAL flowgastronomie.test_cleanup='on'` within their cleanup transaction
to remove fixture receipts. The application never enables this flag. A database
credential with arbitrary SQL access can bypass this guard, so production DB
access must stay restricted. This is not a privileged fiscal archive.

# P3A pilot operational flow

The pizzeria pilot uses the existing order, station ticket, counter payment and
receipt models. No additional state machine, migration or hardware integration
is introduced.

## Production source of truth

POS creates an `Order` and `OrderStationTicket` in `staff-order-repository.ts`.
It does not create a table `ServiceSignal`. Kitchen previously displayed the
signal-driven Radar, which omitted these tickets, including takeaway orders
without a table. Kitchen/Bar now use the tenant/venue-scoped ticket projection in
`pilot-operations-repository.ts`; Radar remains the table/service workspace.
QR orders use the same projection. Online production retains its separate model
and board. Both render stored item snapshots, not current product translations.

## Counter workflow

1. Staff opens POS, starts their shift and opens a register for cash if necessary.
2. Select Takeaway or Dine-in plus a table, configure the pizza and send it.
3. The confirmation, Kitchen and active counter queue display the same final
   eight characters of the order ID. Receipt numbering is independent.
4. Kitchen starts preparing and marks each station ready. Existing assignment,
   role, shift and optimistic-version checks still apply.
5. Staff opens the queue entry to record cash or an externally confirmed card
   payment, reopen its finalized receipt, or complete handoff once all stations
   are ready. Card confirmation does not communicate with a terminal.
6. New order clears the selling cart without losing the stored queue entry.

Payment and production are independent. Paid orders stay visible until handed
over; handed-over unpaid orders remain payable. Takeaway labels map `SERVED` to
picked up/completed; table orders use served. Cancelled orders and closed table
sessions are excluded. A paid and served order leaves the active queue. Table
closure remains a separate existing operation requiring all orders served or
cancelled and the session balance paid. QR orders remain in Tables/Radar rather
than the POS-origin counter queue. Existing table payments count toward their
session's paid state; legacy table reconciliation does not invent a P2 receipt.

Ticket polling refreshes production and counter state every five seconds.
Multi-station handoff delegates each ready ticket to the existing transition
transaction. A conflict can leave some stations served; refreshing and retrying
continues the remaining ready tickets without repeating served transitions.

Orders also provides Today, Paid and Completed views, preserving completed/paid
history. Dashboard LIVE figures use Active; daily order-created and
payment-recorded metrics reconcile separately. See
[the read model, session allocation limitation and audit](ORDER_PAYMENT_RECONCILIATION.md).

## Pilot navigation and layout

Operational navigation follows existing permissions: POS, Kitchen/Bar,
Tables/Radar, and Menu/Reports for management. Kitchen does not show owner setup
modules. Register details collapse once the register and shift are open; selling
products and cart remain primary. The browser journey checks product visibility
at 1024×768 and Kitchen action targets of at least 44 pixels.

## Isolated Windows verification database

When another branch has additional migrations in the normal development DB,
preserve that database and create a separate local database. Never reset it or
remove Docker volumes. Using the existing local Compose service:

```powershell
@'
SELECT 'CREATE DATABASE restaurantflow_p3a' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'restaurantflow_p3a')\gexec
'@ | docker compose exec -T postgres psql -U restaurantflow -d postgres

$pilotDbLine = Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' }
$pilotDbUri = System.UriBuilder.Trim('"'))
$pilotDbUri.Path = 'restaurantflow_p3a'
$env:DATABASE_URL = $pilotDbUri.Uri.AbsoluteUri
npm run db:generate
npm run release:verify
```

The process override derives credentials from the ignored local `.env`, never
from a committed secret. Release verification deploys existing migrations,
checks status, tests and builds, seeds only this demo DB, and runs the browser,
SSE, backup/restore and security gates. The normal `.env` remains unchanged.

Hardware, physical printing, drawer acceptance and fiscal certification are
outside P3A. The existing browser receipt view and print action are retained.

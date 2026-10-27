> Historical evidence, superseded on 2026-10-09. Real-client preprovisioning,
> local pilot credentials and client-specific preview paths are retired. Use
> registration and synthetic acceptance.
> Commands or client defaults below describe the earlier milestone only.

# Local pizzeria pilot: clean start

Run from the repository root against the **existing local demo database**:

```sh
npm run pilot:reset -- --dry-run
npm run pilot:reset
```

The reset is atomic and idempotent. It does not run migrations, reset the schema,
recreate tenants/users, or call the general demo seed. Repeating it restores the
same 31-product menu and zero operational history. Stop using the local UI while
the command runs, then refresh any already-open browser tabs to discard old carts.

## Safety boundary

- Refuses `NODE_ENV` values other than unset/development and refuses CI.
- Accepts PostgreSQL only on loopback (`localhost`, `127.0.0.1`, `::1`), port 5432.
- Database allowlist: `restaurantflow`, `restaurantflow_p3a`,
  `restaurantflow_pos_redesign`. No arbitrary database/tenant/venue arguments.
- Rejects URL options other than `schema=public`.
- Checks the exact `demo-tenant` / `flowgastronomie-demo` /
  `FlowGastronomie Demo` identity, `demo-venue` / `osteria-27`, and local demo
  account email suffixes before writes; checks identity again in the transaction.
- Every deletion is scoped to this tenant and venue, or cascades from their
  scoped parent. Other tenants and venues are untouched.
- Uses the existing transaction-local `flowgastronomie.test_cleanup` fixture
  switch for immutable demo receipts/payments. No trigger or constraint is
  removed or disabled. Failure rolls back the cleanup and menu together.
- Concurrent reset commands serialize through a transaction advisory lock.

This command is for the named disposable local demo, never a database containing
real transactions. Do not forward a remote database through a loopback tunnel.
The command prints only the database name, fixed scope and record counts, not
connection credentials.

## Deleted and retained data

Deletes scoped counter/table orders and their items, modifiers, status events and
production tickets; online orders and their items, tickets, messages and status
events; payments, receipts, print jobs and hardware command history; operational
outbox events; service signals, guests and table sessions; reservation/customer
demo history and legal holds; cash sessions, shifts, table assignments, audit
events, tasks, handover notes, schedules and availability notes. Receipt numbering
restarts from zero. The menu is rebuilt and extra demo tables are removed.

Retains tenant/venue identity, users, memberships, permissions, staff profiles and
login sessions, subscription, website content/brand/domain/publication settings,
tax/business configuration and hardware pairing/settings. Global retention-run
logs and other tenants' data are not deleted. Entitlements/settings are changed
only as required below.

## Restored DEMO menu

| Category                  | Products | Configuration                                                 |
| ------------------------- | -------: | ------------------------------------------------------------- |
| Pizza                     |       15 | 30 cm / 40 cm (+€4.50); 9 optional extras                     |
| Drinks / Getränke / Pije  |        9 | Soft drinks 0.33/0.5 l; water 0.5/1 l; espresso single/double |
| Dessert / Ëmbëlsira       |        4 | Tiramisu, Panna Cotta, Cannolo Siciliano, Gelato              |
| Salads / Salate / Sallata |        3 | Insalata Mista, Insalata Tonno, Caprese                       |

Pizza extras: mozzarella, salami, prosciutto, funghi, olive, cipolla, peperoni,
jalapeño and tonno. All products and categories are available/published, translated
for the four supported locales, and shared by POS and the public website.
Descriptions explicitly identify **DEMO sample prices**. Existing `DEMO_TEST_*`
tax categories remain test fixtures. No AI-suggested allergen claims are published.

Pickup is ON; delivery, catering and reservations are OFF. There are three QR
tables (`07`, `08`, `09`). Register and staff shifts start closed. Configuration
must already exist from the local demo seed; missing required tax/venue data
causes a rollback rather than silently fabricating business settings.

The older `db:pilot-profile` command belongs to the previous three-pizza fixture.
Use `pilot:reset` for this clean-start menu; do not apply the old profile afterward.
The general `db:seed` remains unchanged for the existing automated release suite.

## Focused rehearsal

With the usual local API at `http://localhost:4000` and web at
`http://localhost:3000` already running:

```sh
npm run pilot:reset
npm run test:pilot
npm run pilot:reset
```

The single browser test refuses to proceed without the exact demo identity,
31-product fixture and empty order queue. It checks overview at 1366×768 and
1024×768 without page scroll, language/profile/settings/tooltip interactions,
identical POS/public menu IDs and prices, then creates **one** pizza order through
Kitchen, cash payment and receipt. It writes screenshots to `artifacts/`.
The final reset is intentional: leave the user a clean dataset even if the
rehearsal fails. Reset safety has separate focused unit tests.

During this implementation, the previous local DB was backed up to the ignored
`artifacts/pilot-before-reset.dump`; the backup is not committed or uploaded.

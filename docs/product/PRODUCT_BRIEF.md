# FlowGastronomie — product brief

## One-sentence definition

FlowGastronomie is a modular gastronomy SaaS platform whose specialized products digitize only the workflows a business chooses, without forcing it to replace its staff or operating model.

## Product family

FlowGastronomie owns the shared identity, tenant data, venue configuration,
website/menu source, permissions, billing boundary, audit trail, and operational
core. Businesses subscribe to a focused product built on that platform:

| Product          | Status  | Intended fit                                                                  |
| ---------------- | ------- | ----------------------------------------------------------------------------- |
| `RestaurantFlow` | Active  | Restaurants and full-service venues; this brief and current V1.               |
| `PizzeriaFlow`   | Planned | Pizzerias with product configuration, fast production, pickup and delivery.   |
| `BarFlow`        | Planned | Bars with fast rounds, table service, bar production, and live service needs. |
| `CaféFlow`       | Planned | Cafés with compact menus and mixed counter/table workflows.                   |
| `ImbissFlow`     | Planned | Fast-food and Imbiss venues with quick ordering, production, and pickup.      |
| `DeliveryFlow`   | Later   | Delivery/takeaway-first operations after the shared order engine is complete. |

Future product names require their own validated workflow and acceptance gate.
They must reuse the platform core and cannot fork tenant, menu, order, staff, or
billing foundations into separate applications. The current Website, Smart
Service, and Restaurant Pro subscriptions are tiers of RestaurantFlow; they are
not separate FlowGastronomie products.

During onboarding, a business will choose one active product profile. That
choice will select an onboarding template and product defaults, while plan and
entitlements decide which capabilities are enabled. Templates may configure the
shared core but must not create product-specific copies of core data. Until a
second product passes its acceptance gate, onboarding safely defaults to the
only selectable profile: RestaurantFlow.

## The problem

Restaurants do not all work the same way. A café may need only a multilingual QR menu, a busy bar may need instant drink rounds, and a full-service restaurant may want every guest order confirmed by a waiter. Most products impose one fixed flow or expand into a complex POS.

Guests also face friction: app downloads, account creation, unclear order state, and awkward bill splitting. Staff face fragmented requests, invisible waiting time, and poor coordination between floor, bar, and kitchen.

## The product promise

> Menu, website, tables, and orders in one system — while the restaurant decides how much technology to use.

The staff should understand the system within five minutes. A guest should need no explanation.

## Core differentiators

### Adaptive Service Modes

A venue configures a service mode independently by area, table, and later by schedule:

1. `MENU_ONLY` — browse the menu only.
2. `CALL_AND_REQUEST` — call staff, request water, or request the bill.
3. `ORDER_AND_CONFIRM` — guest orders require staff confirmation.
4. `SELF_ORDER` — accepted orders route directly to production stations.
5. `ORDER_AND_PAY` — self-order and online payment; post-MVP.
6. `BAR` — fast drink ordering and repeat rounds.
7. `TAKEAWAY` — off-premise pickup ordering; post-MVP.

Resolution follows the most specific active configuration: table, then area, then venue default.

### Table Session

Guests at one table join the same session without creating accounts. They can see shared context while retaining individual baskets and, later, separate payments. The session begins when the table is seated or first scanned and closes after checkout/reset.

### Service Radar

Staff see service needs instead of a generic order list: newly seated tables, waiting guests, calls, bill requests, unconfirmed orders, elapsed wait time, and station load. This gives value even to restaurants that do not enable self-ordering.

### AI-assisted onboarding

Later, an owner uploads a menu PDF or photos. AI extracts categories, items, and prices; drafts descriptions and translations; and suggests allergens. The owner must review and approve the result before publishing.

## Users and jobs

- **Guest:** understand the menu, order or ask for service quickly, and know what happens next.
- **Waiter:** see which table needs attention and act with minimal taps.
- **Bar/kitchen:** receive only relevant items and update preparation state.
- **Manager:** control availability, tables, service modes, and the live shift.
- **Owner:** configure the brand, menu, modules, locations, roles, and reporting.

The complete surface hierarchy, role navigation, staff accountability model, subscription boundary, and custom-domain lifecycle are defined in [the platform master plan](PLATFORM_MASTER_PLAN.md).

## Product principles

- Progressive adoption: every module can be enabled independently.
- Human-first automation: technology supports service rather than dictating it.
- Zero guest setup: scan, choose, send — ideally within three steps.
- Operational clarity: time, ownership, and next action are always visible.
- One menu source: edit once and publish consistently everywhere.
- Safe defaults: uncertain AI output and sensitive actions require confirmation.

## Business model hypothesis

- Website: €19/month
- Smart Service: €39/month
- Restaurant Pro: €69/month
- Professional setup: €99–199 one-time
- Agency white-label/source arrangements: separately negotiated

Pricing remains a hypothesis until discovery interviews and pilot usage validate willingness to pay.

## Success metrics

- Median guest time from scan to submitted order.
- Median time from service request to staff acknowledgement.
- Percentage of orders needing staff correction.
- Staff onboarding time and actions per common task.
- Weekly active venues and retained venues after 30/90 days.
- Menu import time from upload to approved publication.

# RestaurantFlow MVP specification

## Objective

Validate the first FlowGastronomie product, RestaurantFlow, by proving that
configurable service modes and a live Service Radar reduce guest waiting and
staff coordination overhead in a real venue.

## In scope

- Multi-tenant foundation with venue and role boundaries.
- Public venue page and menu in English, German, Italian, and Albanian.
- Categories, products, prices, variants, add-ons, allergens, and availability.
- Areas, tables, and revocable per-table QR tokens.
- Guest table sessions without login.
- Guest order submission where the active service mode allows it.
- Waiter call and bill request.
- Staff order acceptance and status updates.
- Item routing to bar, kitchen, or dessert station.
- Cash/card-at-table payment method recorded manually, without processing money.
- Live Service Radar and basic daily summary.
- Feature/module switches per venue.
- Individual staff profiles and active shifts; shared staff identities are not allowed.
- Immutable actor attribution for order, request, payment, and table-close actions.

## Explicitly out of scope

- Online payment processing.
- Fiscal cash register, TSE, DSFinV-K export, or tax reporting.
- POS integrations.
- Reservations, loyalty, delivery, and multi-venue analytics.
- Automated AI publishing without owner approval.
- Native mobile apps.

## Primary guest flow

1. Guest scans a table QR.
2. System resolves the venue, table, language, active session, and effective service mode.
3. Guest browses the available menu.
4. Guest adds items and options to an individual basket.
5. Guest submits the order or requests service.
6. The UI confirms receipt and exposes a simple status.

No account or app is required.

## Primary staff flow

1. Staff opens the authenticated Service Radar.
2. Urgent/oldest actionable table signals appear first.
3. Staff acknowledges a request or accepts an order.
4. Items are routed to their production station.
5. Authorized staff advances status through valid transitions.
6. Staff closes the table session after service and payment recording.

Every step is attributed to the individual staff identity and active shift that actually performed it. Responsibility may transfer during service without rewriting previous actions.

## Order lifecycle

```text
NEW -> ACCEPTED -> PREPARING -> READY -> SERVED
  \       \            \
   +-------> CANCELLED <-+
```

`ORDER_AND_CONFIRM` orders begin as `NEW`. `SELF_ORDER` and `BAR` may be accepted automatically by policy, but this must be visible in the audit log.

## MVP acceptance criteria

- A venue can set a default mode and override it for a table.
- A valid table QR opens the correct published menu.
- An invalid or revoked QR reveals no private venue data.
- A guest can submit an allowed service request without login.
- Order items route to their configured station.
- Invalid status transitions are rejected by the domain layer.
- Staff can identify the oldest unhandled signal at a glance.
- Sold-out items cannot be newly ordered.
- Tenant A cannot access or mutate Tenant B data.
- Core workflows work at 360px width and on a touch screen.

## Delivery phases

1. **Foundation:** domain rules, tenant model, QR/session model, CI.
2. **Pilot slice:** public menu, one order flow, requests, Service Radar.
3. **Operations:** persisted staff auth, station views, daily reporting, audit log.
4. **Content:** owner menu editor, website editor, translations.
5. **Expansion:** AI-assisted import, payments, integrations, reservations.

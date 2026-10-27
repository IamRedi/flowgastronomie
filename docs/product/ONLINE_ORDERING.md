# Online ordering expansion

## Goal

Give a published restaurant website one clear public ordering surface without
turning FlowGastronomie into a payment processor, delivery marketplace, or POS.
The existing QR menu remains the on-premise menu; online ordering is a separate
guest journey addressed by the restaurant's public website.

## First release

### Guest entry points

- **Restaurant menu:** browse the normal published menu at the public venue
  website. This remains editorial and does not require a guest account.
- **Online order:** `/[lang]/order/[publicSlug]` shows the available products
  from the published menu. A later module setting may narrow this to a
  dedicated online catalogue without duplicating product data.
- **Catering request:** the same surface offers a dedicated catering path for
  a future date, guest count, and free-form event requirements.

### Fulfillment types

| Type     | Required guest information                            | Operational outcome                                                                                                                                                              |
| -------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pickup   | name, telephone, ASAP or scheduled time               | Staff confirms or rejects before preparation.                                                                                                                                    |
| Delivery | name, telephone, address, requested time              | An active delivery zone must match the postal code. The server applies its configured fee and minimum order before staff confirms or rejects; driver assignment is not promised. |
| Catering | name, telephone, date/time, guest count, requirements | A catering request awaits Manager/Owner review; it is never auto-accepted.                                                                                                       |

Guests submit a random idempotency key with every request. They receive a short
reference code, a confirmation-pending status, and a high-entropy private
tracking link. They do not need an account or app.

### Private order tracking

The device that creates an order retains its opaque tracking credential. The
tracking view exposes only that request's item and option snapshots, contact
details, requested fulfillment time, current status, status timeline, and
guest/restaurant messages. It never grants access to staff features, the wider
venue, or another guest's order. The guest can send a short question; staff can
reply from the management workflow. The credential is stored only as a hash.

## Explicit boundaries

- No online card processing, cash collection workflow, fiscal receipt, or tax
  export in Commercial V1. A later merchant-owned payment module may connect a
  restaurant's own provider account without RestaurantFlow holding funds or
  card data; it is gated by the legal and technical plan in
  [PAYMENTS.md](PAYMENTS.md).
- No delivery route planning, courier marketplace, availability calendar, or
  automatic capacity promise.
- No automatic catering acceptance.
- The existing QR/table order and Service Radar behavior are not changed.

## Staff workflow

1. The public request arrives as `PENDING_CONFIRMATION`.
2. Manager or Owner accepts, rejects, or cancels it with an optional internal
   note.
3. Accepted pickup/delivery orders become production work only after the venue
   explicitly confirms them; catering remains a reviewed request until a later
   fulfillment workflow is added.
4. Every staff action is tenant-scoped, shift-attributed when it changes an
   operational order, and audit-recorded.

## Acceptance criteria

- A guest can access no data from an unpublished or inactive website.
- Published online products, prices, variants, options, availability, and
  localized names are re-resolved server-side at submission.
- A delivery submission cannot omit its address; catering cannot omit its
  requested date/time or guest count.
- A delivery submission is accepted only when its postal code matches an active
  delivery zone and its items meet that zone's configured minimum. The matching
  zone and delivery fee are stored with the order snapshot.
- A duplicate request with the same idempotency key returns the original
  result.
- The tracking credential reveals only its own order and can show its timeline
  through completion/delivery.
- Tenant A cannot read or mutate Tenant B's online requests.
- Owner and Manager can see and decide requests; staff visibility is later
  limited to accepted production work.

## Implemented foundation (2026-08-08)

- `ONLINE_ORDERING` is an explicit Restaurant Pro entitlement. Both the
  published website and this entitlement must be active before a submission is
  accepted.
- The public order menu uses the same localized product, variant, and modifier
  configuration as the website and QR menu.
- Browser prices are presentation only. Submission sends identifiers; the
  server re-resolves availability, default/selected variant, modifier group
  limits, localized names, and the final minor-unit price before it writes an
  immutable item snapshot.
- The guest can open product options, choose required entries, review a
  calculated basket total, submit a pickup/delivery/catering request, and
  continue to the private tracking link.

Private server-sent live updates and polling fallback are implemented (see
production workflow below). Delivery driver assignment, online payments and
promotion into the long-term canonical order engine remain deferred.

## Delivery zones (2026-08-09)

Owners and Managers configure active delivery zones with postal-code prefixes,
a delivery fee, and a minimum item total. The server selects the most specific
matching prefix, rejects delivery requests outside a configured active zone or
below its minimum, and snapshots the selected zone and fee on the order. This
keeps the public form honest without adding routing, courier assignment, or
payment processing.

## Production workflow (2026-08-09)

An accepted online order creates one `OnlineOrderStationTicket` per required
station. Bar, Kitchen, and Dessert receive separate tickets containing only
their own item snapshots; online orders are never represented as table orders.
Each ticket moves from `NEW` to `PREPARING` to `READY`. The parent request is
`PREPARING` while any station is open and becomes `READY` only when every
station ticket is ready. Owner/Manager then records handover for pickup or
catering, or moves delivery through `OUT_FOR_DELIVERY` to `COMPLETED`.

Accepting/rejecting an operational request and changing station-ticket state
require the acting staff member's open shift. Ticket state, parent state,
customer-visible timeline, and immutable actor/shift audit event are persisted
in one transaction. Optimistic ticket versions reject stale staff actions.

The guest tracking page receives private server-sent updates and therefore sees
the resulting order status without receiving operational station data. Online
order administration and station boards use authenticated streams. Refreshes
never overlap, staff authorization is checked again throughout a connection,
and any change to its tenant, venue, or membership scope closes the stream.
Browsers use scoped HTTP polling while EventSource reconnects, so a temporary
proxy or network failure does not leave a service screen stale.

## Transactional notifications (2026-08-09)

Each online order snapshots the guest's selected platform locale. New-order and
customer-visible status notifications are handed to a provider-neutral service
only after the database mutation commits. Staff invitations use the same
boundary and carry the invitation token only to the delivery adapter; raw
credentials are not logged. A missing or failed provider is operationally
visible in server logs but never rolls back an accepted order, status update, or
staff invitation. Production wires this boundary to the Brevo transactional
email adapter; local and controlled maintenance environments may retain the
disabled adapter. Provider activation, sender-domain authentication, and live
delivery evidence remain operational release requirements. A future durable
outbox may replace the bounded direct delivery without changing domain or
repository rules.

## Customer timing and recovery (2026-10-05, pending review)

Pickup defaults to `timingMode: ASAP`, without a browser timestamp. The server
resolves the earliest pickup after the venue preparation window, using published
opening hours and venue timezone. Scheduled pickup must match an offered slot.
The cream/olive/terracotta picker uses day buttons and 15-minute choices, a compact
desktop dialog and mobile bottom sheet. Delivery/catering retain explicit
scheduled dates through the same picker, without acquiring pickup ASAP semantics.

`Venue.pickupLeadMinutes` is nullable, configurable by Owner/Manager (1?240), and
set to 20 only in demo fixtures. Unconfigured real venues receive a useful
unavailability state; no component invents an estimate. The server stores the
resolved `requestedFor` and `productionNotBefore`. Accepted future pickups
remain outside Kitchen and cannot transition into preparation before that
boundary. Acceptance remains mandatory. Existing active tickets remain persisted
for history; cancelled/rejected/completed parents are absent from production.

Checkout redirects directly to the existing private tracking destination.
Customer progress, products/options, total, name, requested time and latest staff
message reuse existing endpoint, status timeline, messages, SSE and fallback
polling. READY is prominent; rejected/cancelled have distinct terminal states.
All new helper/status labels support sq/de/it/en.

The public website offers Track order. Same-tab recent destinations use
venue-scoped sessionStorage containing only reference and internal destination.
Normal lookup now takes the reference alone and returns only status, stored
requested time and generic venue context. It is a manually refreshed snapshot,
venue-scoped, read-only, generic on failure and limited to ten checks per ten
minutes per IP across venues. It grants no private credential or details.

Compatibility recovery still requires the venue, reference and exact formatting-normalized
phone; a reference alone grants no private access. Success creates a hashed 30-minute
recovery credential in an HttpOnly, SameSite=Lax cookie, Secure in production,
restricted to the private tracking API path. Failed verifiers return one generic
response and use a dedicated rate limit. Phones are POST bodies only, absent from
URLs/storage; original opaque tracking links remain valid. Expired sessions are
deleted by the existing retention job and scoped recovery cleanup.

Operational setup, migration/backfill, compatibility, security and deferred work:
[online ordering UX runbook](../operations/ONLINE_ORDERING_UX.md).

# FlowGastronomie — RestaurantFlow Commercial V1 roadmap

**2026-10-08 expansion checkpoint:** the Business Profile/Demo/Canonical Media
foundation and Creative Studio V1 are merged; Creative passed its media/print
quality gate. SI0 Smart Setup + SI1 reviewed Menu Import = **MERGED** (PR #16,
`ea3f71c`, green CI). SI2 Canonical Media onboarding = **MERGED / accepted**
(PR #17, `eb88c00`, final PR CI green). Batch AI matching and Inventory remain
later work. Next: M2 OVH Madrid Staging, requiring separate deployment approval.
See SI0/SI1 evidence and SI2 evidence.

## Purpose

RestaurantFlow Commercial V1 is the first market-ready product a restaurant can configure
quickly and use every day. It builds on the pilot MVP without changing its
validation goal or expanding FlowGastronomie into a POS, payment processor,
payroll system, accounting suite, or fiscal cash register.

The implementation order is deliberate. Each slice must pass its acceptance
gate before the next dependent slice begins. Small independent UI improvements
may run alongside a slice, but domain and data dependencies must follow this
sequence.

## Product boundary

Commercial V1 includes:

- the existing website, multilingual menu, QR/table service, online ordering,
  delivery/pickup, Service Radar, kitchen/bar workflow, individual staff
  identities, shifts, manual external-payment records, and operational reports;
- recipe management, ingredient costs, food-cost calculation, and basic
  suppliers;
- basic staff scheduling and operational handover tasks;
- confirmation-first reservations;
- a purpose-limited customer timeline based on reservations and online orders;
- a simple operational performance dashboard.

Commercial V1 does not include online payment processing, fiscal POS behavior,
inventory depletion, purchase orders, payroll, automated marketing, AI document
scanning, route planning, or advanced reservation optimization.

## Delivery sequence

### Slice 0 — stabilize the existing product

**Outcome:** the current product is safe enough to extend without carrying
unknown defects into new modules.

Scope:

- add database-backed acceptance coverage for online ordering, delivery-zone
  selection, delivery-fee snapshots, station production, and tenant isolation;
- verify all critical journeys in English, German, Italian, and Albanian;
- finish transactional email boundaries for invitations, order updates, and
  later reservation confirmations without coupling domain rules to a provider;
- replace operational polling with authenticated server-sent events where live
  service needs it, retaining a polling fallback;
- document deployment, migration, backup, restore, logging, and production
  environment requirements.

Acceptance gate:

- the current `npm run check` remains green;
- the guest, staff, owner, delivery, and station happy paths pass against
  PostgreSQL;
- reconnection cannot expose another tenant's events;
- no untranslated keys appear in critical V1 journeys;
- a failed external notification never rolls back a committed order.

Implementation progress:

- database-backed delivery acceptance tests now verify most-specific zone
  selection, fee snapshots, minimum-order enforcement, idempotency, foreign
  product rejection, and tenant isolation;
- CI now provisions PostgreSQL, applies production migrations, and runs the
  integration suite before the standard repository check;
- database-backed mixed-station tests now verify ticket creation, optimistic
  versions, parent-order status and timeline updates, active-shift attribution,
  and cross-tenant production isolation;
- online-order administration, delivery-zone setup, channel settings, and guest
  tracking now use complete status and fulfillment copy in English, German,
  Italian, and Albanian; automated checks keep the shared dictionaries and
  critical online-order labels structurally complete;
- staff invitations, new online orders, and customer-visible order transitions
  now cross a provider-neutral notification boundary only after commit; online
  orders snapshot the guest locale and provider failure cannot roll back the
  business operation;
- guest tracking, online-order administration, and station boards now use
  hardened server-sent streams with non-overlapping refreshes, continuous staff
  scope validation, reconnect hints, cleanup, and client polling fallback;
- the production runbook now defines environment, deployment/migration,
  backup/restore rehearsal, logging/alerts, SSE proxy, incident, and release
  record requirements;
- database-backed core-journey tests now verify private QR sessions, service-mode
  precedence, localized immutable order snapshots, table-order and service-request
  idempotency, production routing, foreign-product/token isolation, atomic Owner
  trial registration, launch readiness, rehearsal, launch, and audit attribution;
- the PostgreSQL suite now covers the guest, staff, Owner, delivery, and station
  happy paths with 10 acceptance tests.

Slice 0 closeout register (updated 2026-08-09):

- [x] run browser-level smoke journeys for QR ordering, staff service, Owner
      launch, online delivery/tracking, and station boards in all four locales;
      the repeatable Playwright suite is wired into CI;
- [x] exercise SSE disconnect/reconnect through the selected production proxy
      and retain evidence that a changed/revoked staff scope closes the stream;
      the pinned NGINX smoke test verifies immediate delivery, reconnect,
      membership-revocation closure, and a rejected revoked reconnect in CI;
- [x] perform and record the first backup/restore rehearsal against an isolated
      production-like database; the automated PostgreSQL 17 rehearsal validates
      the archive and migrations, matches key row counts, and passes restored API
      smoke checks while retaining structured evidence in CI;
- [x] choose and configure the production transactional-email adapter; Brevo is
      wired behind the provider-neutral boundary with localized inline
      templates, deterministic idempotency, bounded retries, startup validation,
      and sanitized delivery errors;
- [ ] activate the production Brevo account before the public pilot: accept the
      DPA, authenticate the sender domain, install the scoped API key in hosting,
      and retain one four-locale delivery smoke record;
- [x] add guest-endpoint rate limiting before a public pilot; public reads,
      guest writes, trial registration, staff login, invitation acceptance, and
      demo mutations now have separate IP-based limits with standard retry
      headers and explicit trusted-proxy configuration;
- [x] add a database-aware readiness probe; `/ready` now runs a bounded
      PostgreSQL query, coalesces parallel checks, returns sanitized `503`
      responses, and is exercised by PostgreSQL integration and restore smoke;
- [ ] connect the documented alert rules to the selected hosting platform and
      retain notification-routing evidence; no hosting provider or production
      alert destination has been selected yet.

The first three items close Slice 0 verification. The production email adapter
is implemented, while account/domain activation and hosted alert wiring remain
tracked operational release requirements and must be complete before the
Commercial V1 release gate.

### Slice 1 — establish the canonical order contract

**Outcome:** table, waiter, pickup, delivery, and future counter channels can be
reported and extended without creating more incompatible order systems.

Progress (2026-08-09): the shared domain contract and protected
`/v1/staff/operational-orders` read model now map table/QR plus online pickup,
delivery, and catering records without changing either write aggregate. New
table orders now persist an initial status event and every valid staff
transition with actor/shift attribution; older records remain explicitly marked
as current-state-only. Creation and customer-visible status changes now append
a compact canonical PostgreSQL outbox event in the same transaction. The first
consumers—reporting and customer timeline projections—remain scheduled for
Slice 5, so Slice 1's contract and publication boundary are complete.

Scope:

- define the canonical source, fulfillment, production, payment, customer-link,
  totals, snapshots, status history, and actor-attribution contract in the domain;
- map existing table and online orders into one protected operational read model;
- migrate behavior incrementally; do not perform a big-bang data rewrite;
- keep table-session rules and online tracking credentials isolated at their
  existing security boundaries;
- publish internal order events for reporting and customer-timeline projections.

Acceptance gate:

- every existing order channel appears once in the unified operational read
  model;
- prices and historical item snapshots remain immutable;
- current QR, tracking, production, and Service Radar routes remain compatible;
- invalid lifecycle transitions and cross-tenant access remain rejected.

### Slice 2 — recipe, ingredient, food-cost, and supplier foundation

**Outcome:** an Owner or Manager can see the estimated direct ingredient cost
and margin of a menu item from maintained purchase prices.

Progress (2026-08-10): canonical unit conversion, venue-scoped ingredient,
supplier, and immutable supplier-price storage, plus protected Owner/Manager
cost-catalog management routes, recipe persistence, tested integer costing
rules, and the protected recipe/cost editor are complete. The editor manages
ingredients, supplier contacts, dated purchase prices, and recipe composition;
it renders only the server-calculated direct-cost, food-cost, and contribution
estimate and clearly marks incomplete estimates when a current price is absent.

Scope:

- ingredients with venue ownership, base unit, allergen links, and active state;
- explicit mass, volume, and piece units with tested conversions;
- suppliers with contact details and active state;
- supplier item prices with pack quantity, unit, currency, effective date, and
  immutable price history;
- recipes linked to existing menu products, including ingredient quantity,
  preparation yield, and optional wastage allowance;
- server-calculated recipe cost, food-cost percentage, and estimated gross
  contribution using the current menu price;
- an Owner/Manager editor and a read-only costing summary.

Acceptance gate:

- one menu product remains the source of truth for its selling price;
- unit conversion, recipe yield, missing price, zero yield, and negative-value
  cases have domain tests;
- changing a supplier price recalculates current estimates without rewriting
  historical price records;
- tenant and venue scope is required for every ingredient, supplier, and recipe
  operation;
- the UI labels results as operational estimates, not accounting profit.

### Slice 3 — staff schedule and operational handover

**Outcome:** each worker knows when they are planned and what operational work
needs attention without introducing payroll complexity.

Progress (2026-08-10): weekly draft/published schedules, overlapping-assignment
validation, personal availability notes, venue-scoped operational tasks, and
handover notes now have a tenant-scoped PostgreSQL foundation and protected
staff API. The touch-friendly planner and personal schedule view are available
at `/[lang]/staff/schedule`. PostgreSQL integration coverage verifies schedule
publication/audit attribution, staff-only views, overlap rejection, and foreign
task-resource rejection; the final touch/mobile review confirms 44px action
targets and a one-column mobile layout. Slice 3 is complete.

Scope:

- weekly draft and published schedules per venue;
- scheduled assignments linked to individual staff profiles, role/station,
  start/end time, and venue timezone;
- a personal schedule view and a touch-friendly Manager planner;
- basic availability notes without leave entitlement calculations;
- venue, shift, table, or order-scoped tasks with assignee, due time, priority,
  completion state, and immutable actor attribution;
- concise shift-handover notes.

Acceptance gate:

- a staff member sees only permitted venue schedules and tasks;
- overlapping assignments and invalid time ranges are detected;
- publishing and later edits are audit-attributed;
- schedule assignments do not create worked-time, payroll, or legal attendance
  claims;
- common task actions meet the 44px touch-target requirement.

### Slice 4 — confirmation-first reservations

**Outcome:** a guest can request a table from the restaurant website and staff
can manage the service day using the areas and tables already configured.

Progress (2026-08-10): the reservation domain lifecycle and request validation,
PostgreSQL model/migrations, public idempotent request API, published-website
and opening-hours guard, capacity/duration guard, protected daily staff inbox,
status transitions, optional venue-scoped table assignment, and staff WhatsApp
shortcut are implemented. Venue auto-confirm defaults to off and may be managed
through the protected API; when enabled, a request is confirmed only after the
same opening-hours and capacity checks pass. The public reservation route also
loads the venue's published phone number and exposes a WhatsApp shortcut.

Remaining before Slice 4 closeout:

- [x] expose the current auto-confirm setting as a fully localized Owner/Manager
      control in the business UI; the staff inbox now links authorized leadership to
      that setting while the protected API remains the authorization boundary;
- [x] add the provider-neutral reservation-confirmed notification and its Brevo
      template, delivered only after the reservation transaction commits; provider
      failure is logged without rolling back the confirmed reservation;
- [x] add focused API and PostgreSQL integration tests for idempotency,
      unpublished/closed venues, capacity, tenant/table isolation, lifecycle
      transitions, audit privacy, and notification-failure isolation;
- [x] run the full Slice 4 acceptance review: the public request, auto-confirm,
      staff lifecycle, notification boundary, authorization, tenant/table scope,
      capacity, opening-hours, audit privacy, and four-locale UI checks pass.

Scope:

- public request form for name, contact, date/time, party size, language,
  requests, and idempotency key;
- lifecycle `REQUESTED -> CONFIRMED -> SEATED -> COMPLETED`, with `REJECTED`,
  `CANCELLED`, and `NO_SHOW` terminal paths;
- Manager/Owner inbox, daily staff list, manual walk-ins, and optional table
  assignment;
- opening-hours validation and configurable booking duration/capacity guard;
- provider-neutral confirmation/reminder notification events;
- no guest account and no automatic table-optimization promise.

Acceptance gate:

- unpublished/inactive venues accept no public reservations;
- duplicate submissions return the original request;
- table assignment reuses existing venue tables and cannot cross tenants;
- invalid transitions, past times, impossible party sizes, and closed periods are
  rejected by domain rules;
- personal data is shown only to authorized staff and is not written to audit
  metadata unnecessarily.

### Slice 5 — customer timeline and operational dashboard

**Outcome:** leadership understands repeat activity and daily performance without
turning anonymous guests into accounts or presenting accounting statements.

Progress (2026-08-10): the first customer-data foundation is complete. Only
contact-bearing public reservations and online orders create a venue-scoped
profile, with exact normalized contacts retained solely for later staff review
(never automatic merging). Owner/Manager staff can list, export, inspect the
source timeline, correct profile contact/locale/internal notes, or delete a
profile through protected tenant- and venue-scoped APIs. Profile deletion
detaches the optional source link while preserving immutable reservation and
order contact snapshots. Exact contact candidates now support a protected
same-venue staff review and label the matching field, without an automatic
merge or source-record mutation. The dashboard projections and retention policy
remain in the next Slice 5 increments. The existing venue-local daily
operations report now also projects source-reconcilable table/pickup/delivery/
catering channel totals and reservation lifecycle/no-show counts; food-cost and
popular-product projections are now included from immutable order-item
snapshots. The daily dashboard now projects estimated direct food cost,
food-cost percentage, and contribution from current active supplier prices and
recipes, withholding a total when coverage is incomplete. The 90-day guest
contact retention policy is decided and its idempotent daily redaction command
is implemented with PostgreSQL coverage. Owner-only, tenant- and venue-scoped
legal-hold administration now protects only named order, reservation, or
customer-profile records and records attributed release. Deploying and monitoring
the daily job with its 48-hour health check remains a production prerequisite.

Scope:

- a purpose-limited customer profile created only from contact-bearing online
  orders or reservations;
- normalized contact lookup, safe duplicate review, preferred locale, internal
  notes, and reservation/order timeline;
- anonymous QR guests remain anonymous unless they explicitly provide contact
  details for a defined purpose;
- retention, export, correction, and deletion workflows;
- operational dashboard projections for channel totals, estimated food cost and
  contribution, popular products, reservations/no-shows, wait times, and staff
  activity;
- venue-local business-day boundaries and clear estimate labels.

Acceptance gate:

- customer access is tenant- and venue-scoped and permission-checked;
- deleting or correcting a customer profile does not corrupt immutable order
  accounting or audit history;
- dashboard totals reconcile with their source records for the selected business
  day;
- no metric claims processed payment, fiscal revenue, tax, payroll, or accounting
  profit;
- the dashboard remains useful when costing, reservations, or customer modules
  are disabled.

### Slice 6 — Commercial V1 release gate

**Outcome:** the complete V1 can be enabled progressively and operated by a pilot
venue without developer intervention during normal service.

Scope:

- entitlement keys and plan presentation for every Commercial V1 module;
- entitlement-aware onboarding, readiness, empty states, and safe downgrade
  behavior;
- full seeded demo, accessibility review, 360px and tablet verification;
- load checks for guest ordering and live operational boards;
- security review of authentication, authorization, tokens, PII, uploads, rate
  limits, and tenant isolation;
- operator documentation, support diagnostics, backup/restore rehearsal, and
  release checklist.

Acceptance gate:

- all Commercial V1 acceptance criteria pass in a production-like environment;
- a new Owner can register, configure, invite staff, publish, rehearse, and launch
  without database edits;
- a restaurant can use only the modules it enables;
- downgrade or module disablement hides actions safely without deleting venue
  data;
- typecheck, tests, format check, build, migrations, and smoke tests pass from a
  clean checkout.

## Current review milestone ? online ordering UX

After correctness PR #10, the separate `ux/online-ordering-tracking` slice adds
server ASAP, published-hours slot selection, due-only Kitchen production and
polished existing tracking with secure recovery. It remains pending review and
unmerged. Nullable real-venue preparation configuration is required before launch.
Dynamic capacity, delivery assignment, online payments and public pilot activation
remain deferred. See [operational scope](../operations/ONLINE_ORDERING_UX.md).

## Business/demo foundation prerequisite

Before post-V1 Creative/Smart Setup/Inventory work is treated as product-ready,
the platform should establish:

- versioned Business Profile Templates;
- clean tenant provisioning from templates;
- explicit Flow Demo tenants;
- canonical venue/product media;
- canonical local pilot pilot identity for interactive review.

This removes preview-skin and hard-coded image dependencies from source-backed
modules. See [Business Profiles, Demo Tenants & Canonical Pilot Foundation](BUSINESS_PROFILE_DEMO_FOUNDATION.md).

## V2 queue

V2 contains optimization, automation, AI, advanced finance, and country-specific
compliance:

- supplier price comparison, advanced inventory, purchasing, and stock movement;
- AI recipe/document/receipt import with mandatory human review;
- budgets, invoices, offers, reconciliation, and advanced financial analysis;
- full time tracking, leave, payroll exports, and country-specific labor rules;
- newsletter, marketing automation, social planner, and AI content assistance;
- automatic reservation allocation, deposits, waitlists, advanced no-show logic,
  events, and expanded catering;
- multi-venue analytics;
- merchant-owned online payments through provider adapters, after the approval
  gates in `PAYMENTS.md`;
- separately enabled and legally reviewed German fiscal/accounting capabilities,
  including applicable TSE/KassenSichV, ZUGFeRD/XRechnung, and DATEV workflows.

## Working rule

For every slice: define the domain behavior first, add domain tests, persist it
with mandatory tenant context, expose a small validated API, then build the
role-focused UI. Update decisions when scope or boundaries change and run the
smallest relevant check followed by `npm run check` before handoff.

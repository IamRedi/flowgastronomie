# FlowGastronomie — platform master plan

## Product structure

FlowGastronomie is one SaaS platform with specialized subscription products and
three deliberately separate surfaces. RestaurantFlow is the first active
product; PizzeriaFlow, BarFlow, CaféFlow, and ImbissFlow are planned, while
DeliveryFlow comes later. They share accounts, permissions, menu data, venue
configuration, and operational infrastructure, while each product adds a
validated workflow for its business type.

```text
FlowGastronomie platform
├── RestaurantFlow (active)
│   └── Website / Smart Service / Restaurant Pro plans
├── PizzeriaFlow (planned)
├── BarFlow (planned)
├── CaféFlow (planned)
├── ImbissFlow (planned)
└── DeliveryFlow (later, after the canonical order foundation)
```

```text
flowgastronomie.com                 Commercial website
        │                          Explain, price, subscribe, sign in
        ▼
app.flowgastronomie.com             Business workspace
        │                          Onboarding, owner/manager administration
        ├── operations             Staff workspaces and live service
        └── website publishing
                 │
                 ▼
venue.flowgastronomie.site          Restaurant website before custom domain
restaurant-domain.com              Restaurant website after domain verification
        │
        └── /menu/{tableQrToken}    Anonymous guest menu and table session
```

The commercial website must never look like a restaurant dashboard. The restaurant website must never expose SaaS administration. The workspaces must prioritize speed and role-specific actions rather than marketing.

## 1. Commercial website

The public FlowGastronomie website is the founder's sales and presentation surface.

### Primary navigation

- Product
- Solutions: restaurant, bar, café, hotel restaurant
- Demo
- Pricing
- Languages
- Sign in
- Start trial

### Conversion flow

1. Visitor understands the adaptive-service promise.
2. Visitor opens the guided showcase.
3. Visitor chooses a plan or starts a trial.
4. Email verification creates a user and organization.
5. The onboarding wizard creates the first venue.
6. The venue receives a temporary FlowGastronomie subdomain.
7. The owner imports/builds the menu, configures service, and invites staff.
8. A launch checklist confirms that the public site, tables, QR links, and staff access work.

The marketing account and workspace account are the same identity. There is no second registration when the customer subscribes.

## 2. Business workspace

The authenticated workspace changes its landing page and navigation by role.

### Owner workspace

- Overview and launch checklist
- Website and brand
- Menu and live availability
- Operations and Service Radar
- Areas, tables, QR, and service modes
- Team, roles, and invitations
- Shifts and staff activity
- Reports
- Locations
- Subscription, invoices, domains, and organization settings

### Manager workspace

- Venue overview
- Menu and availability
- Live operations
- Areas, tables, and service modes
- Team and shift management where permitted
- Venue reports

Billing ownership, organization deletion, ownership transfer, and cross-location access remain Owner-only.

### Staff workspaces

- Waiter: assigned tables, Service Radar, orders, service requests, table checkout, own active shift.
- Bar: only bar tickets, preparation status, sold-out actions where permitted, own shift.
- Kitchen: only kitchen/dessert tickets and preparation status, own shift.

Staff screens use large touch targets and expose no website, billing, domain, or organization complexity.

## 3. Restaurant website and domain

Every venue receives a publishable website backed by the same menu source as QR ordering.

### Website content

- Brand, logo, colors, typography, and theme
- Hero, story, gallery, opening hours, contact, map, and social links
- Published menu
- Optional events, offers, reservations, takeaway, and ordering modules
- SEO title, description, social image, structured venue data, and legal pages

### Domain lifecycle

1. Draft site uses an internal preview URL.
2. Publishing creates `{venueSlug}.flowgastronomie.site`.
3. Owner enters a custom domain.
4. FlowGastronomie shows exact DNS verification records.
5. Domain status moves through `PENDING`, `VERIFIED`, `ACTIVE`, or `FAILED`.
6. TLS is provisioned by the hosting layer after verification.
7. The FlowGastronomie subdomain remains a safe fallback.

Menu data is not copied into the website. Website, QR menu, and staff menu editor read the same published categories and products.

## 4. Modular platform architecture

FlowGastronomie is one modular platform. A business first chooses the product
whose workflow fits it, then the plan and capabilities it needs. Product names
do not create separate deployments or copies of identity, tenant, menu, staff,
order, billing, or audit data.

Onboarding product selection follows this sequence:

```text
business type -> active product profile -> onboarding template -> plan -> entitlements
```

The profile supplies product-appropriate defaults and workflow presentation;
the plan and entitlements remain the server-owned authorization source. A
planned profile is visible for product direction but cannot be selected or
subscribed to until it has domain behavior, migrations where necessary, and an
acceptance gate.

RestaurantFlow is the only active product profile in the current release. Its
Website, Smart Service, and Restaurant Pro choices are plan tiers, not sibling
products. All other profiles remain unavailable until their distinct workflows
have explicit domain rules and acceptance tests. DeliveryFlow additionally
waits for the canonical order engine so delivery logic is not duplicated.

### Core

Every venue receives its business profile, responsive website, menu/catalog,
opening hours, staff and roles, dashboard, notifications, settings, audit
history, and basic operational reporting. Customer records remain consent- and
purpose-driven rather than mandatory for anonymous QR or online guests.

### Modules

| Module                | Scope                                                                   | Current boundary                                    |
| --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| Online ordering       | Basket, pickup, delivery, catering, customer tracking                   | Confirmation-first; no online payment yet.          |
| QR and tables         | QR menu, zones, tables, waiter service                                  | Existing MVP module.                                |
| Restaurant operations | Waiter, kitchen/bar, table order lifecycle                              | Existing MVP module.                                |
| Payments              | Merchant-owned provider connection, checkout, refund and reconciliation | Planned adapter layer; not active in Commercial V1. |
| Fiscal Pro Germany    | TSE, KassenSichV, ZUGFeRD/XRechnung, DATEV                              | Separate country module, subject to legal review.   |

### Canonical order engine

All channels must converge on one canonical order lifecycle. The canonical
record carries `source` (online, QR, waiter, counter), `fulfillment` (table,
pickup, delivery), payment state, production state, immutable item snapshots,
customer/contact data when needed, timestamps, and audit history. Online
requests currently provide a safe confirmation-first intake and tracking flow;
before online production is enabled they will be promoted into the canonical
engine rather than becoming a second operational order system.

Payments remain behind a provider-neutral, merchant-owned payment layer:

```text
FlowGastronomie order engine -> payment adapter -> Stripe Connect / PayPal / future provider
```

Each restaurant must connect its own provider account. RestaurantFlow does not
hold card data or guest-payment funds, and it charges only the restaurant's
separate SaaS subscription. The complete legal/technical gates are in
[PAYMENTS.md](PAYMENTS.md); German fiscal functionality remains a distinct
legally reviewed module.

The workspace exposes a simple module choice to the business (Website, Online
orders, QR menu, Tables, Kitchen, Delivery, Payments, German Fiscal Pro), while
the entitlement and provider details stay server-side.

## Identity, organization, and access

### Hierarchy

```text
User identity
└── Organization membership (Owner)
    └── Organization / tenant
        ├── Subscription and feature entitlements
        └── Venue
            ├── Venue membership (Manager, Waiter, Bar, Kitchen)
            ├── Staff profile
            ├── Shift
            └── Operational actions
```

Each person has an individual user identity. Shared waiter accounts are prohibited because they destroy accountability, audit history, and safe permission revocation.

An invitation creates a pending membership for one email and venue. The invited person activates their own password. Later, a manager-authorized shared device may support fast PIN switching, but the PIN selects an individual identity and never becomes a shared staff identity.

### Role policy

| Capability                   | Owner | Manager  | Waiter    | Bar          | Kitchen      |
| ---------------------------- | ----- | -------- | --------- | ------------ | ------------ |
| Subscription and domains     | Yes   | No       | No        | No           | No           |
| Website and brand            | Yes   | Optional | No        | No           | No           |
| Menu structure and prices    | Yes   | Yes      | No        | No           | No           |
| Live availability            | Yes   | Yes      | Optional  | Optional     | Optional     |
| Areas, tables, service modes | Yes   | Yes      | No        | No           | No           |
| Invite and disable staff     | Yes   | Yes      | No        | No           | No           |
| Accept/serve orders          | Yes   | Yes      | Yes       | Station-only | Station-only |
| Record table payment         | Yes   | Yes      | Yes       | No           | No           |
| Venue reports                | Yes   | Yes      | Own shift | Own shift    | Own shift    |

Optional permissions are explicit venue settings rather than silent assumptions.

## Staff profiles, shifts, and accountability

Every operational action records both the actor and, when relevant, the actor's active shift.

### Staff profile

- Display name and optional avatar
- Role and venue membership
- Active/disabled state
- Preferred platform language
- Optional employee reference; no unnecessary HR data in MVP
- Last sign-in and current shift state

### Shift

A shift belongs to one user and venue and has `OPEN` or `CLOSED` status, start/end time, opening/closing notes, and calculated activity totals. A user may have at most one open shift per venue.

Operational actions requiring an active shift:

- accepting, preparing, readying, serving, or cancelling an order;
- acknowledging a table request;
- recording, correcting, or voiding a manual payment record;
- marking availability where venue policy requires shift attribution.

Owner/Manager configuration changes do not require a shift but always create an audit event.

### Work attribution

An order does not become the private property of a waiter. It remains a venue order, while responsibility is recorded through events:

- `ORDER_ACCEPTED` by user/shift;
- `ORDER_STATUS_CHANGED` by user/shift;
- `TABLE_REQUEST_ACKNOWLEDGED` by user/shift;
- `PAYMENT_RECORDED` by user/shift;
- `TABLE_SESSION_CLOSED` by user/shift.

This supports handovers: one waiter may accept an order and another may serve it, with both actions remaining truthful.

Optional table assignments define who is currently responsible for a table, but authorized colleagues may still assist. The audit event records the actual actor.

## Payment boundary

The MVP records external payment, it does not process or fiscally certify money.

### Manual payment record

- Table session and optional guest/order scope
- Amount and currency
- Method: `CASH`, `CARD_AT_TABLE`, or `OTHER`
- Status: `RECORDED` or `VOIDED`
- Staff user and active shift that recorded it
- Timestamp and optional external terminal reference
- Void reason and author when corrected

The record appears in the employee's shift activity and venue report. It is not an employee wallet, payout balance, bank account, fiscal receipt, or proof that FlowGastronomie processed funds.

Online payment is a later merchant-owned module with provider webhooks, payment
intents, refunds, reconciliation, and country-specific legal review. It must
not collect card data or settle restaurant funds through RestaurantFlow; see
[PAYMENTS.md](PAYMENTS.md).

## Subscription and module access

Subscription belongs to the organization, while plan limits and modules apply through explicit entitlements.

### Initial plans

- Website: public site, custom domain, multilingual menu.
- Smart Service: Website plus QR, requests, tables, and Service Radar.
- Restaurant Pro: Smart Service plus ordering, stations, staff shifts, manual payment records, and reporting.

Data is never deleted immediately on downgrade. Restricted modules become read-only, public behavior falls back safely, and the owner receives a clear resolution path.

Required records:

- `Subscription`: organization, plan, status, trial dates, renewal dates, billing provider references.
- `Entitlement`: feature key, enabled state, and optional numeric limit.
- `Usage`: venues, staff seats, published sites, or other billable limits.

## Recommended route map

```text
/{lang}                              FlowGastronomie marketing
/{lang}/showcase                     Guided product demo
/{lang}/pricing                      Plans and comparison
/{lang}/signup                       Trial/subscription start
/{lang}/login                        Universal business sign-in

/app/{lang}/onboarding               Owner launch wizard
/app/{lang}/overview                 Role-aware business home
/app/{lang}/website                  Website editor
/app/{lang}/menu                     Menu source of truth
/app/{lang}/operations               Manager operations
/app/{lang}/tables                   Areas, tables, QR, service modes
/app/{lang}/team                     People, roles, invitations
/app/{lang}/shifts                   Shifts and staff activity
/app/{lang}/reports                  Daily and staff reports
/app/{lang}/settings/domain          Domain lifecycle
/app/{lang}/settings/billing         Owner-only subscription

/work/{lang}/radar                   Waiter live workspace
/work/{lang}/station/{station}       Bar/kitchen/dessert workspace
/work/{lang}/shift                   Individual work account

/{lang}/menu/{qrToken}               Anonymous table menu
```

Existing `/staff/*` routes remain functional while being migrated behind the new workspace shell. The migration should change navigation and route ownership without rewriting working domain or repository logic.

## Data additions in implementation order

1. `OrganizationMembership` and invitation flow.
2. One venue membership per user with explicit role and optional permissions.
3. `StaffProfile`, `StaffShift`, and `TableAssignment`.
4. Immutable `AuditEvent` with actor user/session/shift and structured metadata.
5. Actor/shift attribution on order transitions and signal acknowledgement.
6. `PaymentRecord` and void workflow outside the fiscal POS boundary.
7. Daily venue and per-shift report queries.
8. `Subscription`, plans, entitlements, and feature guards.
9. `WebsiteSite`, sections, assets, publication revisions, and domains.
10. Signup, onboarding, workspace shell, and final route migration.

## Implementation phases

### Phase A — accountability core

- Individual staff profiles and invitations
- Start/end shift
- Actor and shift on every operational action
- Table assignments and handover-safe activity history
- Manual cash/card-at-table payment records
- Daily and own-shift reports

### Phase B — SaaS entry and onboarding

- Marketing pricing/signup/login flows
- Trial organization creation
- Guided first-venue onboarding
- Plan entitlements and module switches
- Launch checklist

### Phase C — restaurant website

- Theme and section editor
- Preview and published revision
- FlowGastronomie subdomain
- Custom-domain verification lifecycle
- SEO and legal content

Implementation status: editor, authenticated draft preview, immutable publication revisions, FlowGastronomie address, media assets, custom-domain lifecycle, server-rendered SEO/social metadata, and localized Imprint/Privacy pages are complete. Phase C is complete for the MVP; venue-specific legal review remains a production responsibility.

### Phase D — operational depth

- Advanced menu configuration editor
- Station-specific workspaces
- Server-sent live updates
- Scheduling and time-based service modes
- Stronger reporting and exports

Implementation status: the advanced menu editor is complete, including tenant-scoped API routes, domain validation, atomic persistence, audit attribution, configurable prices/availability/selection limits, and English, German, Italian, and Albanian names. Dedicated Kitchen and Bar routes now focus the existing protected board on their station and staff sign-in routes those roles directly there. Next: replace polling with server-sent live updates; add scheduled service-mode rules; then add CSV/PDF operational exports and deeper reporting.

### Phase E — expansion

- AI menu import with mandatory review
- Online payments and reconciliation
- Advanced reservations and offers
- Multi-venue analytics
- POS integrations after market validation

Implementation status: the online-ordering foundation is active for Restaurant
Pro. It provides a published-menu ordering surface for pickup, delivery, and
catering, server-owned configured-item prices, an opaque private tracking link,
guest questions, a Manager/Owner decision workflow, station production tickets,
fulfillment settings, and delivery zones. The ordered Commercial V1 work now
starts with stabilization and an incremental canonical order contract before
new daily-management modules are added.

### Commercial V1 — daily management release

Commercial V1 follows the pilot MVP and does not redefine its validation scope.
Its ordered slices are:

1. stabilize the existing product and live-service delivery;
2. establish the canonical order contract and unified operational read model;
3. add recipes, ingredients, food cost, and basic suppliers;
4. add basic staff schedules, operational tasks, and shift handover;
5. add confirmation-first reservations using existing areas and tables;
6. add a purpose-limited customer timeline and operational dashboard;
7. pass the entitlement, security, accessibility, operations, and release gate.

The complete scope, dependencies, exclusions, and acceptance gates are defined
in [the Commercial V1 roadmap](COMMERCIAL_V1_ROADMAP.md).

## Business profiles, demo tenants and real tenants

FlowGastronomie distinguishes three concepts:

1. **Business Profile Templates** — reusable blueprints/configuration defaults.
2. **Demo Tenants** — synthetic resettable businesses used for product demos and testing.
3. **Self-registered Real Tenants** — fresh canonical businesses with their own identity and data.

Templates never clone operational database history. A real customer starts from a
fresh tenant/venue and receives only deterministic defaults from the selected
profile.

Initial profile families:
Flow Pizzeria, Flow Restaurant, Flow Bäckerei, Flow Döner/Fast Food,
Flow Café, Flow Bar, Flow Imbiss and Generic Gastronomy.

Demo tenants are explicitly named Flow Pizzeria Demo / Flow Restaurant Demo /
Flow Bäckerei Demo and remain visibly synthetic.

Every customer starts from Business Registration → Smart Onboarding → Smart
Import → Review → Draft → Preview. No client tenant is precreated and no
client-specific identity overlay exists. Nine premium families, three styles and
GENERIC remain synthetic demonstrations.

Venue/product media uses one canonical tenant/venue/product source so POS,
Website and Creative Studio resolve the same approved photos.

See [Business Profiles, Demo Tenants & Canonical Pilot Foundation](BUSINESS_PROFILE_DEMO_FOUNDATION.md).

## Marketing / Creative Studio direction

**2026-10-08: Creative Studio V1 = MERGED / accepted foundation + media/print
quality gate.** PR #14 merged as `ed77f3c855c0db6bc0b804fae25650e3eb9ce971`
after green CI on the accepted `cd3f4ca` head. Canonical local pilot evidence is
recorded in foundation review. This acceptance does
not publish sample facts or automatically approve generated product imagery.
Next: SI0 Smart Setup + SI1 Menu Import, reusing
the existing business templates, provisioner and menu/media models. Inventory
and deployment/fiscal work remain separate.

Creative Studio is the design/output layer for existing business data, not a
second menu or promotion source. Owners and Managers can create layered social
and print material using canonical venue branding, menu products/prices, QR
targets and later real Promotion/Gift Card records.

V1 adds:

- a design library and layered editor;
- reusable social/print templates;
- table QR and printed-menu material;
- data bindings with stale-source warnings;
- deterministic PNG/PDF export;
- a provider-neutral conversational AI planner;
- optional provenance-tracked generated image assets.

The runtime AI can suggest layout/copy and apply validated scene patches, but
cannot invent or activate commercial facts. Manual editing/export remains usable
without AI. Full specification and milestones are in
[Creative Studio V1](CREATIVE_STUDIO_V1.md).

## Definition of simple

- Guest: no login, no app, scan–choose–send.
- Staff: sign in, start shift, see only the next relevant action.
- Manager: one venue workspace, operational controls first.
- Owner: one organization workspace, setup/billing/reporting separated from live service.
- One person equals one identity; one action equals one immutable actor record.
- One menu source powers every public and operational surface.

## SI0/SI1 implementation checkpoint

Creative Studio V1 is merged and main CI is green. Smart Setup + reviewed Menu
Import are **MERGED** through PR #16 (`ea3f71c`, green CI), using canonical profile,
provisioning, menu and media models. Four steps end in draft import, never
automatic venue activation. See acceptance evidence.
SI2 canonical media onboarding is **MERGED / accepted** through PR #17
(`eb88c00`, final PR CI green); see SI2 evidence.
Batch AI matching and SI3+ inventory remain later work. The next separately
approved operational task is M2 OVH Madrid Staging; SI2 did not deploy anything.

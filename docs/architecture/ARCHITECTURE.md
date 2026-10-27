# Architecture

## Shape

FlowGastronomie starts as a modular monolith in an npm-workspaces monorepo. This keeps deployment and transaction boundaries simple while allowing later extraction only where operational evidence justifies it. RestaurantFlow is the first product profile on this core; PizzeriaFlow and later profiles must compose the same domain and application capabilities instead of forking the platform.

```text
Browser -> Next.js web -> Fastify API -> application/domain -> PostgreSQL
                                      -> future queue/workers
```

## Components

- `apps/web`: public guest experience now; owner and staff surfaces can be added as route groups.
- `apps/api`: transport validation, authentication boundary, request context, and application orchestration.
- `packages/domain`: pure business types, invariants, state machines, and policies.
- `packages/database`: Prisma schema and future migrations/client adapter.

The platform is exposed through three logical surfaces: the FlowGastronomie commercial/product-family site, the authenticated business/work workspace for the subscribed product, and each venue's public website/custom domain. They share application services and tenant data but use separate route ownership and audience-focused navigation. See [the platform master plan](../product/PLATFORM_MASTER_PLAN.md).

## Product-family boundary

The hierarchy is `FlowGastronomie platform -> subscription product -> plan ->
feature entitlements`. Product identity is a commercial/configuration boundary,
not a reason to duplicate tables, authentication, menus, staff, or order logic.
The domain owns the canonical product catalog and whether a product is currently
selectable during onboarding. The current schema still models RestaurantFlow
plans and entitlements only. A persisted product-family selection and template
activation will be added with the first second-product vertical slice, when its
rules and migration behavior can be tested; it is deliberately not represented
by speculative database flags today.

## Operational accountability

Each staff member uses an individual identity. Operational mutations carry an authenticated actor and, where required, an open venue shift. Immutable audit events record the actor, shift, action, target, timestamp, and structured metadata. Orders remain venue-owned; acceptance and later actions are attributed independently so a handover never falsifies history.

Manual cash/card-at-table records are operational reconciliation records, not processed payments or employee balances. They reference the staff member and shift that recorded them and can only be corrected through an attributed void event.

## Canonical operational orders

Table and online orders remain separate write aggregates during the incremental
migration. A protected, leadership-only operational read model maps each record
once into the shared contract: source, fulfillment, canonical lifecycle state,
immutable item snapshots and totals, table/customer link, payment placeholder,
production tickets, status-history coverage, and available actor attribution.
It never returns online contact details. New table orders persist an initial
event and every later valid transition in the same transaction; online orders
already expose their recorded status-event timeline. Pre-migration table orders
remain explicitly marked as current-state-only rather than being given invented
history. New channels must map to this contract instead of creating another
operational list.

Every new table or online order also writes a compact canonical event to the
PostgreSQL operational outbox in the same transaction: creation and every
customer-visible status change carry tenant/venue scope, source, fulfillment,
normalized status, immutable total/currency, and available actor attribution.
The event intentionally excludes contact details and item notes. It is a durable
input boundary for reporting and the future customer timeline; a consumer or
worker may be added later without changing order write paths.

## Operational retention

A daily database command applies the documented operational retention schedule.
It redacts expired contact-bearing reservation and online-order fields while
preserving immutable totals, item snapshots, lifecycle state, and actor
attribution. It also removes expired customer profiles, messages, staff-session
hashes, and closed-table guest credentials. Each idempotent run writes only a
status and aggregate counts to `RetentionRun`; it must be scheduled and
monitored outside the API process. Owner-managed legal holds are a separate,
time-bounded exception boundary: they can protect only one named online order,
reservation, or customer profile and are checked by the redaction query before
any personal data is changed.

## Ingredient-cost foundation

Ingredients, suppliers, and supplier item prices are venue-scoped aggregates.
Ingredients store only canonical base units (`GRAM`, `MILLILITER`, or `PIECE`),
while purchase packs may use explicit kilogram and liter units. Conversion rules
live in the domain package and reject incompatible or lossy conversions. Supplier
prices are append-only purchase observations with an effective date; recipes will
select their current applicable price without rewriting historical rows.
Only Owners and Managers hold the `COST_MANAGE` permission. Their protected cost
catalog routes resolve all ingredient and supplier references inside the current
tenant and venue; the venue currency is assigned server-side when a new price is
recorded, so a client cannot supply a cross-venue currency or rewrite history.

Recipes are one-to-one with menu products and contain ingredient quantities in
each ingredient's canonical base unit. Yield and wastage use basis points; the
domain calculates direct cost with integer arithmetic and rounds each component
up conservatively. A missing price produces an explicitly incomplete estimate,
never a zero-cost substitute.

## Multi-tenancy

The shared database uses `tenantId` on every tenant-owned aggregate. API authentication must resolve a tenant context, and repository methods must require that context rather than accept an optional filter. Globally unique public QR tokens resolve to an internal tenant/venue/table tuple and can be revoked.

Database-level row security is a possible defense-in-depth layer, but it does not replace explicit application scoping.

## Configuration resolution

Effective service mode is computed using the most specific active rule:

```text
active table override -> active area override -> venue default
```

Schedule-aware rules can be added behind the same domain function without changing consumers.

Owner and Manager venue setup writes use the same precedence model. Areas may override the venue default and tables may override their area. The setup API returns each table's resolved effective mode so the UI does not reimplement precedence rules.

## Localization

Platform copy uses server-side dictionaries and locale-prefixed routes for `en`, `de`, `it`, and `sq`. Browser language negotiation selects the first route and Albanian is the fallback.

Restaurant content separates operational records from translations. `Product` owns price, station, availability, and publication state; `ProductTranslation` owns name and description per locale. The same pattern applies to menu categories. A missing requested translation falls back to the venue's default locale and is never allowed to alter operational data.

The authenticated menu-management API uses the same records as the public menu; there is no second admin copy. Owner and Manager writes require all four platform translations, validate prices in integer minor units, and scope every lookup and mutation by both tenant and venue. Publication and live availability remain separate so a product can be drafted, published, or temporarily sold out without deleting content.

Products may define translated variants, constrained modifier groups, priced modifier options, and EU allergen codes. Public ordering sends identifiers only. The API re-resolves availability, selection limits, translations and every price delta inside the order transaction, then stores immutable names and prices on the order-item snapshot. Later menu edits therefore cannot rewrite historical orders.

## Reliability

- Mutating guest requests use an idempotency key scoped to the table session and anonymous guest.
- Order status updates will use optimistic concurrency/version fields.
- Significant mutations will create immutable audit events.
- Transactional notifications cross a provider-neutral API boundary only after
  their order or invitation mutation commits. Provider failure is logged without
  rolling back or changing the committed business result. The Commercial V1 API
  adapter calls Brevo with localized, versioned inline content, deterministic
  idempotency, a bounded retry deadline, and sanitized errors. Provider
  credentials remain server-side; a future PostgreSQL outbox may replace direct
  delivery without entering the domain package or route business rules.
- Unauthenticated API routes use IP-based limits grouped by risk and workload:
  public reads, private tracking, guest writes, trial registration, staff login,
  invitation acceptance, and demo writes do not consume each other's budgets.
  Fastify trusts forwarding headers only from explicitly configured proxy IPs
  or CIDRs. The single-API pilot uses a bounded in-memory store; horizontal API
  scaling requires a shared rate-limit store before adding another process.
- Guest tracking and service-critical staff boards use server-sent events with
  bounded, non-overlapping refreshes. Staff identity is re-authenticated on
  every refresh and the stream closes if its original tenant, venue, or
  membership scope changes. Clients fall back to scoped HTTP polling while an
  event stream reconnects.
- `/health` proves only that the API process can answer, while `/ready` runs a
  safe `SELECT 1` through the shared Prisma pool before declaring the instance
  eligible for traffic. Parallel readiness requests share one active database
  query and each caller has a bounded response timeout. Database/provider errors
  are reduced to a generic `503` response and a credential-free structured log.
- Timestamps are stored in UTC; venue timezone is used only for presentation and business-day boundaries.

## Anonymous table sessions

Opening a valid table QR creates or joins the table's single active session and issues a high-entropy guest token. Only its SHA-256 hash is persisted. Order and service-request endpoints require the raw token plus an idempotency key. Product availability, localized product names, unit prices, totals, initial status, and production station are resolved server-side; guest-supplied prices are never accepted.

Table QR credentials use the same one-way storage rule. A new raw token is returned only when a table is created or its QR is rotated. Rotation atomically replaces the stored hash, immediately invalidating the previous public link without exposing either token through setup reads.

## Security baseline

- QR tokens are high-entropy opaque identifiers, not sequential table IDs.
- Staff and owner routes require authenticated role checks.
- Guest endpoints are rate-limited and schema-validated.
- Money is stored as integer minor units with an ISO currency code.
- Published menu content is distinct from drafts.
- Logs must not contain secrets, raw payment data, or unnecessary personal data.

## Staff authentication and authorization

Staff passwords are stored as salted scrypt hashes. A successful login creates a high-entropy, server-side session whose raw token is delivered only in an `HttpOnly`, `SameSite=Lax` cookie; PostgreSQL stores its SHA-256 hash. Sessions are scoped to one tenant, venue, user, and membership and expire after 12 hours.

Authorization is checked against domain permissions for every protected action. Repository queries additionally require tenant and venue scope. Order updates use the expected version so simultaneous staff actions fail safely instead of overwriting one another.

## Deployment target

The first production package targets one OVH VPS with Docker Compose: Node 22
web (Next.js standalone), Node 22 API, and the SSE-compatible NGINX proxy.
PostgreSQL stays outside the VPS on Neon. A separate one-shot operations image
applies migrations and runs existing retention commands; host systemd timers
schedule retention and logical backups. The API image contains production
dependencies only, and private configuration is supplied only at runtime.
M1 exposes loopback HTTP for package verification; real HTTPS is the M2 gate.
See [the package runbook](../operations/OVH_PRODUCTION_PACKAGE.md). A background
worker and object storage are added with AI import. Local PostgreSQL is defined
in `compose.yaml`; the M1 gate's ephemeral PostgreSQL exists only in a test override.

## Counter hardware boundary (P3)

P2 payment and receipt transactions remain independent of hardware. The API
creates scoped print jobs and signed version-1 structural commands from the
finalized snapshot; Android consumes them through an origin-restricted WebView
message listener. Device keys authenticate pairing and result acknowledgements.
PrinterAdapter/DrawerAdapter own SDK/transport operations outside the domain and
POS core. A server-side test simulator implements the same command/result
contract without physical output and is prohibited in production.

The durable job/command ledger records attempts, failures, idempotency and
reprints. Native journals persist command identity before physical operations;
uncertain output requires explicit operator reconciliation instead of blind
retry. This is operational print tracking, not fiscal evidence. The existing
web/API/PostgreSQL deployment remains; the physical terminal adds only the local
shell. Configuration and acceptance are in
[HARDWARE_BRIDGE.md](../operations/HARDWARE_BRIDGE.md).

## Pilot production and counter projections

Kitchen/Bar reads `OrderStationTicket` directly through the scoped pilot
operations repository; it does not depend on table `ServiceSignal` creation.
QR table context can be stored only through `TableSession`, while POS dine-in
also stores `Order.tableId`. Both use immutable order item snapshots. Online
orders retain their separate production repository. The counter projection
derives independent production and payment state and delegates handoff to the
existing production transition repository. Domain predicates determine queue
visibility and station selection; no new persistence state machine is added.

The scoped Orders projection also provides creation-day Today/Paid/Completed
views across table, counter and online sources. Domain predicates keep the
Active operational queue separate from history. Daily reconciliation derives
creation-day order value/current directly linked payments and recording-day
payment categories from existing relationships, within a repeatable-read
snapshot. Session-only payments remain unallocated; the UI never invents a
per-order share. Dashboard and Report consume this shared read model, with no
new payment writes or schema. See
[ORDER_PAYMENT_RECONCILIATION.md](../operations/ORDER_PAYMENT_RECONCILIATION.md).

## Shared pilot application shell

The existing `/app/{locale}` root layout and `/{locale}/staff` nested layout
compose the same client `PilotAppShell`. Public routes, staff login and invitation
acceptance remain outside it. The two URL trees are retained; crossing root
layouts can perform a document navigation, with sidebar preference restored from
local storage. One `pilotNavigation` presentation catalog supplies sidebar links
and dashboard shortcuts using existing domain permissions. API authorization
remains authoritative.

Station staff can open the shared Home route, but only receive their permitted
shortcuts and their existing authenticated identity. They do not mount the
management Overview component or request its privileged read model.

## Public order status boundary

Reference-only customer lookup uses `OnlineOrderPublicStatus`, a read projection
of the existing lifecycle: status, requested time and generic venue name/timezone.
The database selects only these fields and scope metadata for a matching published
website; the API validates input, rate-limits across venues and allowlists output.
It never delegates to private tracking/recovery or issues credentials. Full
details, messages, SSE and polling retain their existing opaque-token/cookie
authorization. The UI renders a manually refreshed snapshot. No schema or order,
payment or production transition changes are needed for M0.1.

## Business-profile provisioning and canonical demo/media boundaries

FlowGastronomie uses one provisioning path for new businesses:

```text
BusinessProfileTemplate
→ fresh Tenant
→ fresh Venue
→ fresh Owner/Membership
→ deterministic defaults
→ real business data
```

A template is configuration, never a database snapshot.

Demo tenants are separate scoped businesses with synthetic data and guarded reset
commands. Legacy CI fixtures may remain minimal and generic.

Every real business registers from zero through Business Registration → Smart
Onboarding → Smart Import → Review → Draft → Preview. No real client is
preprovisioned. Synthetic premium demonstrations and isolated fixtures remain.

Canonical venue/product media is resolved through one scoped media source:

```text
MediaAsset
├── VenueMedia (LOGO / HERO / GALLERY / PROFILE)
└── ProductMedia (PRIMARY / GALLERY)
```

Consumers such as POS, Website and Creative Studio resolve this source rather than
maintaining independent image registries. Provenance and public-use approval
remain explicit.

See [Business Profiles, Demo Tenants & Canonical Pilot Foundation](../product/BUSINESS_PROFILE_DEMO_FOUNDATION.md).

### Canonical business and media adapters

`business-provisioner` is the sole creation path for public registration and
explicitly guarded synthetic demo scripts. Tenant kind and profile version are
separate from subscriptions. `BusinessProvision` stores a request hash and frozen
blueprint, never operational data. `DemoWorkspace` selects the current generation.

`canonical-media-repository` validates ownership and explicit approval, stores
immutable normalized assets, and assigns VenueMedia/ProductMedia. Composite
foreign keys prohibit cross-tenant/venue references. UI and Creative adapters
resolve metadata and IDs; storage/decoding is hidden by `media-storage-adapter`.
Private images are served only to authenticated staff in the owning scope.
Public images additionally require publication, approval and website entitlement.
Legacy LOCAL_PILOT rows remain readable for historical compatibility; creation is
rejected by the domain. They are not registration prerequisites.

## Creative Studio design engine

Creative Studio is an authenticated Marketing capability layered on the existing
tenant/venue, website brand, menu and QR data. It does not own duplicate product
or price records.

```text
canonical venue/menu/QR data
        ↓
CreativeContextResolver
        ↓
DesignDocument + source bindings
        ↕
manual editor / AI planner
        ↓
RenderSnapshot
        ↓
PNG/WebP / PDF
```

`DesignDocument` is a versioned platform schema of typed pages/layers. Interactive
canvas libraries are adapters only and their native serialization is not
persisted as domain state.

Source-backed layers record source identity/version and last resolved value.
Before export, the server re-resolves each binding in tenant/venue scope and
surfaces stale values. A confirmed export freezes an immutable render snapshot,
so later price/menu changes cannot rewrite historical material.

AI uses a provider-neutral planning interface and may only produce validated
plans/patches referencing allowed source/asset ids. Model output is never
executed as HTML/CSS/JavaScript, never establishes authorization scope and never
becomes the authority for prices, QR destinations or commercial state.

Generated imagery is stored as a provenance-tracked `CreativeAsset`; logo,
copy, price and QR remain independent structured layers. Manual editing and
export continue to work when AI providers are unavailable.

See [Creative Studio V1](../product/CREATIVE_STUDIO_V1.md),
[implementation and milestone gates](CREATIVE_STUDIO.md), and
review evidence.

## Smart Setup and reviewed menu import

SI0/SI1 reuse canonical provisioning, profiles, menu and media ownership. Private extraction proposals require explicit Owner/Manager review before an atomic, idempotent draft-menu import. Setup completion is separate from launch activation. See [architecture, provenance, consistency and operational limits](SMART_SETUP_MENU_IMPORT.md).

SI2 adds optional, explicitly reviewed canonical media onboarding with immutable
originals and persisted association drafts. See [media ownership, approval and
cross-module consistency](SMART_SETUP_CANONICAL_MEDIA.md).

## Premium business templates and website proposals

BusinessProfileTemplate V3 adds FAST_FOOD/ICE_CAFE; existing V2 snapshots remain
valid. The domain owns one localized sample pack and three style recipes per
profile. The canonical provisioner applies only an explicitly confirmed pack
to newly created records, retaining draft/publication and media boundaries.
VenueWebsite.premiumStyleId is additive and included in publication snapshots.

Website saves carry optimistic timestamps and retain previous content in the
existing audit ledger; scoped draft restoration appends another revision.
URL and optional AI copy adapters return bounded, source-tracked proposals.
The website editor commits reviewed website proposals with explicit
review and expected-version checks. SI1/SI2 and Creative Studio retain their
own canonical ownership; there is no second menu, media or import catalog.
See implementation and operational limits.

### Premium refinement: explicit region and product illustrations

The canonical provisioner accepts optional validated `countryCode` and stores it on
Venue and its creation receipt, separately from billing/legal country. The new
signup wizard requires the field and explicitly confirms currency/timezone. Domain
DE/AL suggestions do not overwrite supplied values or establish fiscal rules.
Curated recipe photo mappings are pure domain data; source/license/hash manifests
travel with database assets and their read-only showcase mirror. Fresh templates
assign private DEMO product photos through existing SI2 storage/assignment APIs.
No second product-image or revision store is created. See
quality refinement.

## Smart Business Import V2

V2 extends SI1 sessions with bounded website discovery and a composite reviewed
business draft. Its atomic repository reuses the canonical menu writer and SI2
media, preserves private before/after receipts and uses the existing premium
preview/publication flow. SSRF/DNS pinning, optional isolated Chromium, unverified
provider proposals, explicit field/price/media decisions and conservative restore
are detailed in [architecture and configuration](SMART_BUSINESS_IMPORT_V2.md).

## Workforce Management WF1

The existing staff identity/profile and VenueSchedule/ScheduleAssignment aggregates
now own effective-dated employment profiles, immutable planning/publication revisions,
stable shift reconciliation, venue-timezone planning and worker published-only reads.
WF1 publication records durable event intent, not delivered notifications or attendance.
The three workforce views share one API and dataset. See
[workforce ledgers, privacy and WF1–WF4 boundaries](WORKFORCE_DOMAIN.md).

## Workforce Management WF2

WF2 extends the same workforce identity/planning capability with immutable actual
clock/break events, compensating corrections, frozen approved source snapshots,
leave grants/requests/decisions and consented canonical shift changes. Tenant-user
locks and a PostgreSQL partial unique index prevent concurrent active attendance;
deferred guards bind mutable cursors to append-only evidence. The existing schedule
writer remains the sole publisher. Versioned operational intents prepare WF3;
no monthly account, payroll or provider delivery is introduced. See
[ledgers and country policy](WORKFORCE_DOMAIN.md) and
WF2 verification.

## Workforce Management WF3

WF3 derives complete monthly statements from canonical publications, actual events,
approvals and leave decisions. Immutable close and compensating snapshots preserve
contract/policy/source versions; no copied employee or attendance catalog is created.
Publication/operation transactions now persist personal notices and durable channel
outbox rows. A separate explicitly enabled worker owns bounded delivery leases,
retry/attempts and provider adapters; it reuses existing Brevo and adds opt-in PWA
Web Push, without startup/deployment activation. The staff workspace adds My Month,
Inbox, scoped statistics and CSV/print/PDF exports. See
[ledger and authorization architecture](WORKFORCE_DOMAIN.md),
[accounting](../workforce/WF3_ACCOUNTING.md) and
[notification operations](../workforce/WF3_NOTIFICATIONS.md).

## Local Operations Lab (LAB1)

A separate loopback-only entrypoint composes the canonical API with fail-closed
instance/tenant/route guards and disabled providers. It uses a dedicated
persistent local PostgreSQL database and its own `operations_lab` schema for
scenario runs/actions and PDF evidence, never duplicate business aggregates.
Public onboarding and invitation acceptance establish both synthetic venues;
all operational mutations use real authenticated/public HTTP workflows.

P3's SimulatorAdapter receives a lab-only PDF output adapter. It re-resolves
immutable P2 FinalReceipt snapshots, publishes a stable hashed file and verifies
its bytes before confirming a simulated print. The independent repeatable-read
oracle compares authored scenario expectations against canonical persistence
and the original daily report. Session payments remain explicitly unallocated.
Versioned leases/checkpoints/source IDs prepare LAB2; the first slice remains a
sequential wall-clock day, with no production/test-clock injection.
See [Operations Lab](../operations/OPERATIONS_LAB.md).

## Local Operations Lab continuous runtime (LAB2)

The local worker schedules frozen, seeded demand against real venue calendars.
Lab-only control/day/job/journal records contain leases, intents, checkpoints and
canonical source references. They introduce no business aggregates or ledger.
The independent venue loops reuse LAB1's authenticated action contracts, P3
SimulatorAdapter and P2 PDF archive. Undispatched missed arrivals are skipped;
uncertain effects retain identities and require review. Production clocks stay
unchanged. Lease renewal, bounded retries and station capacity limit pressure.

The operator API exists only in the separately guarded lab entrypoint. Its private
key, signed cookie and exact loopback-origin checks protect controls, scoped
reports and PDF retrieval. The four-language dashboard reads canonical data and
links the actual staff workspaces. Scoped journal pagination, archive capacity
aggregates and verified cold backups support growth without deleting history.
See [runtime and recovery](../operations/OPERATIONS_LAB_RUNTIME.md).

Staff self-service password change requires the authenticated identity and current
password, uses a tenant-scoped compare-and-swap transaction and invalidates all
sessions for that user. The login form submits POST and waits for hydration to
prevent credentials entering a native GET URL. These are canonical authentication
fixes; the lab has no private password mutation or privileged staff bypass.

## Operations Lab background continuity

An isolated pinned checkout/build and dedicated PM2 daemon supervise API, web,
LAB2 worker and a small monitoring/renewal process. Stable private/archive data
is separate from mutable development files; no watch or automatic code update
is enabled. The existing queue/idempotency contracts remain the operational core.

Opted-in synthetic validity is bounded by pure domain policy. A guarded local
adapter transaction updates only the two existing TRIALING expiry projections
and appends immutable approval/renewal evidence plus canonical audit, without
commercial status, plan, invoice or payment changes. Normal trials stay 14 days.

Paused-window backups stop writers without fabricating financial closes. Restore
verification uses a fresh disposable cluster with its own reviewed identity and
a separate fixed-target guard; it does not relax the primary instance guard.
See [background continuity](../operations/OPERATIONS_LAB_BACKGROUND.md).

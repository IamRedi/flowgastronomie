# Product and architecture decisions

> Historical log, newest first, carried over from the private working repository. Issue and pull-request numbers refer to that repository. Current status: [PROJEKTSTAND.md](../PROJEKTSTAND.md).

## 2026-10-11 — Operations Lab LAB1 and review boundary

Issue #29 authorizes a
separate synthetic local operations environment. LAB1 exercises the existing
order/Kitchen/POS/manual payment/immutable receipt/Workforce/reporting systems
through normal public onboarding and authenticated APIs. Dedicated persistent
PostgreSQL, instance identity, strict synthetic scope and disabled providers are
mandatory. No pilot, remote database operations, production configuration,
OVH/PR #18 changes, merge or deployment are authorized.

Receipt PDFs are immutable non-fiscal test views of actual P2 snapshots,
confirmed through the existing P3 simulator/retry contracts. Scenario evidence
is an independent oracle, not a competing financial ledger. Session-only
payments retain their known allocation and register limitations. Domain
run/action contracts and durable lab-only leases/checkpoints precede the LAB2
continuous worker; full time acceleration is not verified or enabled.

Canonical menu creation takes currency from the scoped venue, fixing the EUR
default for normal AL/ALL onboarding. LAB1 remains a working Draft for review;
continuous runtime/operator UI and broader exception/soak coverage are later
phases. See [implementation and acceptance](../operations/OPERATIONS_LAB.md).

## 2026-10-08 — SI2 accepted and merged

PR #17 merged as `eb88c004c437a629347dd19d27b21b28210b238e` after final
CI `37757779953` passed on accepted head `a85d5f2`. The merge retains that exact
tree and the existing canonical media approval/provenance boundaries. Migration
`20261008110000_setup_canonical_media` is included, not deployed to OVH/Neon.
No additional local full check or paid AI call was needed. M2 OVH Madrid Staging
is the next separate task and requires deployment approval; SI3 remains deferred.

## 2026-10-08 — SI0/SI1 merged; SI2 reuses canonical media

PR #16 merged as `ea3f71c` after green CI; post-merge main CI is also green.
Menu Skip records only MENU while preserving explicit earlier skips.
SI2 adds a separately resumable media review to SmartSetup, not a second media
system. Upload originals are immutable/hash-addressed MediaAssets; only explicit
review Save changes VenueMedia/ProductMedia associations. Public approval is
explicit, DEMO remains private, and generated imagery retains its existing
promotion/provenance boundary. POS, Website preview and Creative resolve the
same canonical IDs. Batch AI matching and Inventory are deferred; no paid AI
calls. See [SI2 architecture](../architecture/SMART_SETUP_CANONICAL_MEDIA.md).

## 2026-10-08 — SI0/SI1 reviewed setup and menu import

Reuse the canonical business provisioner and eight BusinessProfileTemplates. Persist setup progress separately from launch readiness; completing setup never activates ordering or publication. ImportSession/source/item records hold private extraction proposals, not a parallel catalog. Explicit Owner/Manager approval commits only canonical draft products in one tenant-scoped transaction. Missing prices and unreviewed allergens cannot become facts; duplicates require a separate-product decision and never auto-merge. Same-session import retries return the durable product receipt. Provider adapters stay server-side, disabled by default, with no automatic retries. Source text fallback and canonical hundredths are explicit; see [architecture and operational limits](../architecture/SMART_SETUP_MENU_IMPORT.md). Inventory and M2/M3/fiscal remain outside this branch.

## 2026-10-08 — Creative accepted; Smart Setup and Menu Import are next

PR #14 was explicitly accepted and merged into main as
`ed77f3c855c0db6bc0b804fae25650e3eb9ce971`, with expected head
`cd3f4caea0abd51667323c034c59eccdf9bd6291`, green final CI and clean mergeability.
Creative Studio V1 is **MERGED / accepted foundation + media/print quality gate**.
The approved four-step UX remains unchanged. Internal sample-price and generated
image disclosures are not public-business approval.

The next implementation is SI0 + SI1 only: resumable Smart Setup and reviewed,
idempotent Menu Import. Existing BusinessProfileTemplate, canonical provisioner,
menu and media models remain authoritative. Inventory and M2/M3/fiscal are not
part of this lane. The earlier no-merge/stacked-PR notes below are historical.

## 2026-10-05 — Separate active queues, order cohorts and payment recordings

Daily order counts/value use creation date in the venue timezone; payment totals
use recording date. Reconciliation uses real order/online-order relationships,
excludes cancelled/rejected value and voided payments, and retains older-order,
session-only and unlinked categories. Session-only payments have no per-order
allocation: related order value is unallocated, not known pending. Orders history
retains completed paid records; live cards use Active only. No monetary write,
schema or lifecycle change. See
[operational definitions and audit](../operations/ORDER_PAYMENT_RECONCILIATION.md).

## 2026-08-06 — Begin outside the fiscal POS boundary

The MVP records service and an external payment method but does not process payments or claim to be a fiscal cash register. This keeps validation focused and avoids prematurely entering country-specific fiscal compliance.

## 2026-08-15 — Future online payments remain merchant-owned

Online payments are a post-Commercial-V1 expansion, not a change to the current
no-payment boundary. Each restaurant will connect its own payment-provider
account; the intended first integration is hosted Stripe Connect checkout.
RestaurantFlow must neither receive/settle restaurant guest funds nor handle or
store card data. The restaurant remains responsible for its food sale, prices,
taxes, refunds, disputes, customer contract, and fiscal duties; RestaurantFlow
charges only a separate SaaS subscription.

The selected Connect charge configuration, roles under GDPR, and German
consumer/fiscal obligations require written legal, tax, provider, and pilot
approval before implementation. The detailed product boundary, technical rules,
and acceptance gates are maintained in `PAYMENTS.md`.

## 2026-08-06 — Build a vertical slice before the full back office

The repository starts with executable guest and staff-facing concepts plus tested domain rules. Full CRUD, authentication, and persistence wiring follow after the service workflow is validated.

## 2026-08-06 — Framework-free domain package

Service-mode resolution and order transitions live in a pure TypeScript package so every UI, API, worker, and future integration shares the same rules.

## 2026-08-06 — Four first-class platform locales

The platform and restaurant content support English (`en`), German (`de`), Italian (`it`), and Albanian (`sq`) from the foundation. Public routes carry the locale in the URL, the first visit respects the browser language, and Albanian is the fallback. Translatable restaurant content is stored separately from operational fields so price and availability never diverge by language.

Owner and Manager menu edits require a value for every platform language before the API accepts the write. Availability and publication are independent operational controls: sold-out changes take effect immediately on public menus, while drafts remain private until explicitly published.

## 2026-08-06 — Public QR tokens are stored as hashes

The raw opaque token exists only in the QR URL. PostgreSQL stores a SHA-256 lookup hash, allowing a token to be revoked without exposing usable QR credentials through database reads or backups.

## 2026-08-06 — Anonymous guests receive scoped session credentials

A scan does not create an account. The guest receives an opaque token scoped to one active table session, and PostgreSQL stores only its hash. Every order and table-service request requires that credential and a separate idempotency key. Prices, totals, availability, station routing, and initial status are calculated on the server.

## 2026-08-07 — Staff authentication uses opaque server-side sessions

Staff credentials create a 12-hour venue-scoped session in an `HttpOnly` cookie. The raw session token is never stored in PostgreSQL or returned in the JSON login response. Role permissions are domain rules, while every database operation also enforces tenant and venue scope.

## 2026-08-07 — Active orders stay visible until terminal status

Accepting a new order acknowledges its alert but does not remove it from Service Radar. The order remains visible through `ACCEPTED`, `PREPARING`, and `READY`, and disappears only after `SERVED` or `CANCELLED`.

## 2026-08-07 — QR rotation is explicit and one-way

Owner and Manager roles can create or rotate a table QR credential. The raw value is shown only in that write response and PostgreSQL stores only its SHA-256 hash. Rotation immediately invalidates the previous public link; ordinary setup reads reveal only whether a QR is configured or revoked.

## 2026-08-07 — Configured item prices are server-owned snapshots

Guests select product, variant and modifier identifiers but never submit prices. The API validates required and maximum selections, availability and venue scope, calculates the unit price from persisted minor-unit values, and snapshots localized variant/modifier names with the order. This preserves financial and historical integrity when a menu changes later.

## 2026-08-07 — Every worker has an individual operational identity

Shared staff accounts are prohibited. Every order transition, request acknowledgement, manual payment record, and table close is attributed to the user and active shift that performed it. Orders remain venue-owned so responsibility can transfer without overwriting history.

## 2026-08-09 — Transactional notifications run after the business commit

Staff invitations, new online-order receipts, and customer-visible order status updates cross one provider-neutral API service boundary after their repository mutation succeeds. Online orders snapshot the guest locale so later updates remain localized. Delivery-provider failures are logged without changing the committed business result, and raw invitation or tracking credentials are never included in logs. The default adapter is disabled until production email or queue credentials are configured.

## 2026-08-09 — Brevo is the Commercial V1 transactional-email adapter

The German/EU pilot uses Brevo through its HTTPS transactional-email API because the provider documents EU data storage and supports an idempotency header. The API owns reviewed inline HTML and plain-text copy in all four platform locales, so product copy remains versioned and testable without coupling business rules to provider template IDs. Identical events use a deterministic SHA-256 idempotency key; transient delivery retries share one five-second default deadline, and sanitized failures still occur only after commit. Production must choose a provider explicitly and fail fast on incomplete configuration. An explicit `disabled` mode remains available for local development and controlled maintenance, but it does not satisfy the release gate.

The pilot sends directly within a bounded request window. It does not claim durable asynchronous delivery after process loss; a PostgreSQL outbox and worker become mandatory before volume, recovery objectives, or additional notification channels require guaranteed redelivery. Production activation still requires vendor/DPA review, an authenticated sender domain, hosting secrets, deliverability alerts, and retained four-locale smoke evidence.

## 2026-08-09 — Unauthenticated rate limits are risk-grouped and proxy-aware

The Commercial V1 API limits unauthenticated traffic by normalized client IP with separate budgets for public reads, order tracking, online-order writes, QR sessions, table orders, service requests, trial creation, staff login, invitation acceptance, and demo mutations. A limit returns HTTP `429`, standard rate-limit and `Retry-After` headers, and a stable `RATE_LIMIT_EXCEEDED` code before transport validation or repository work. This protects scarce work without making normal menu browsing consume the smaller mutation or authentication budgets.

Forwarded client addresses are accepted only from exact proxy IPs or CIDRs configured through `TRUST_PROXY`; `true` is rejected, an omitted production decision fails at startup, and `disabled` explicitly means the API is reached directly. The documented single-process pilot keeps counters in bounded process memory. Restarts may reset those counters, and adding a second API process is prohibited until a shared Redis-compatible store is configured and tested. Edge/WAF limits remain a complementary hosting control, not a replacement for application limits.

## 2026-08-09 — Liveness and database readiness are separate signals

`GET /health` confirms only that the Fastify process can respond and must not fail because PostgreSQL is temporarily unavailable. `GET /ready` executes a safe `SELECT 1` through the application Prisma pool, coalesces concurrent checks, and applies a configurable two-second default timeout. Success returns `200`; timeout or connection failure returns a generic `503` without serializing the database error, URL, host, or credentials. This lets the hosting layer stop routing business traffic during a dependency failure without turning that failure into a process restart loop.

The PostgreSQL integration suite and backup/restore rehearsal exercise the real readiness query. Hosted probe configuration, alert creation, notification destinations, and test-alert evidence remain an operational activation step because the production hosting provider has not been selected.

## 2026-08-09 — Live streams retain their original authorization scope

Guest tracking uses its opaque private token, while online-order and station streams require a staff session. Staff identity is re-authenticated during the connection; a revoked session or any tenant, venue, or membership mismatch closes the stream. Refresh scheduling is non-overlapping and backpressure-aware, and clients temporarily fall back to the same scoped HTTP reads while EventSource reconnects.

## 2026-08-07 — Separate commercial, workspace, and restaurant surfaces

FlowGastronomie marketing/subscription, authenticated business operations, and the restaurant's public website are separate user experiences over shared tenant data. This prevents marketing complexity from entering staff workflows and prevents SaaS administration from leaking into the restaurant brand.

## 2026-08-07 — Daily reports follow the venue business day

Operational reports use the venue timezone to convert a selected local calendar date into an exclusive UTC range, including daylight-saving transition days. Owners and managers may view venue-wide activity; other staff may view only their own attributed work account. Order value and manually recorded cash/card amounts are operational reconciliation figures, not fiscal receipts, processed funds, payroll balances, or accounting statements.

## 2026-08-07 — Subscription plans have one server-owned catalog

Website (€19/month), Smart Service (€39/month), and Restaurant Pro (€69/month) are defined once in the domain package with progressive features and explicit limits. PostgreSQL stores each organization's subscription, materialized entitlements, and usage counters. Public pricing reads the same catalog, while protected modules must check the persisted entitlement and an active or unexpired-trial subscription. Downgrades can therefore restrict access without deleting venue data.

## 2026-08-07 — Trial registration is one atomic workspace operation

Starting a trial creates the organization, first venue, Owner identity and venue membership, staff profile, selected subscription, materialized entitlements, initial usage counters, audit event, and 12-hour authenticated session in one PostgreSQL transaction. A failure therefore leaves no partial customer workspace. The raw session credential is returned only as an `HttpOnly`, `SameSite=Lax` cookie. No card is collected and no online payment is processed during the trial. Email delivery and verification remain a separate integration step; the interface does not claim that an address is verified before that service exists.

## 2026-08-07 — Leadership enters a separate business workspace

Owners and Managers authenticate with the same individual account as operational staff but land at `/app/{locale}/overview`. The overview is a tenant- and venue-scoped orchestration read model containing subscription state, launch readiness, content counts, and live operational counts. Waiter, Bar, and Kitchen roles cannot access this read model and continue directly to their focused work surface. Existing `/staff/*` management routes remain active during migration and link back to the business workspace, avoiding a risky rewrite of working operational flows.

## 2026-08-07 — Restaurant websites publish reviewed multilingual content

Each venue has one website aggregate with server-owned publication status, globally unique FlowGastronomie public slug, brand colors, optional image URLs, contact/social fields, structured weekly hours, and four required translations. Drafts may be incomplete, but publication requires valid branding, at least one contact method, and complete hero, story, and SEO copy in English, German, Italian, and Albanian. Published pages read the venue's existing published menu records rather than copying menu data. Public access also requires an active `PUBLIC_WEBSITE` entitlement; unpublishing hides the page without deleting its content. Custom-domain verification and asset upload are separate lifecycle components described below.

## 2026-08-07 — Custom domains use explicit DNS ownership and safe fallback

Only the organization Owner can configure a custom domain. A normalized, globally unique hostname receives an exact TXT ownership record and a CNAME routing target, then moves through `PENDING`, `FAILED`, `VERIFIED`, and `ACTIVE` states. DNS verification is performed server-side and activation is impossible before ownership is verified. Public host resolution additionally requires a published website, an active subscription, and the `CUSTOM_DOMAIN` entitlement. The FlowGastronomie public address remains available if verification fails or the custom domain is removed. TLS certificate issuance remains the responsibility of the production hosting layer and is not simulated by application state.

## 2026-08-07 — Website media uploads are validated persisted assets

Owners and Managers can upload a logo and hero image directly from the website editor. The API accepts only signature-validated JPEG, PNG, or WebP files up to 5 MB, stores the active asset with tenant and venue scope, updates the website reference atomically, and records the actor in the audit log. Public delivery requires the parent website to be published and its subscription entitlement to remain active. PostgreSQL byte storage provides a deployment-safe first adapter for the small two-image MVP; an object-storage adapter can replace it later without changing the editor contract.

## 2026-08-08 — Billing workspace is owner-only and does not simulate payment

Only the organization Owner can read or change legal billing details, invoice history, subscription usage, or plan-change requests. A plan request is tenant-scoped, immutable in its original current/requested plan pair, limited to one pending request per organization, and audit-attributed to the requesting Owner. It never changes entitlements or claims payment success; activation requires a later billing-provider confirmation workflow. Invoice rows are subscription records and links supplied by a future billing provider, not fiscal receipts or evidence that FlowGastronomie processed restaurant guest payments. Organization display and legal billing identity remain separate fields.

## 2026-08-08 — Launch readiness is entitlement-aware and server-owned

Onboarding and Go-Live display one readiness result computed from persisted workspace data, never client-side checkboxes. Required checks adapt to the subscription entitlements: table QR, team access, and the Service Radar rehearsal block launch only when their modules are enabled. A Manager may record the operational rehearsal, but only an Owner may activate the venue. Both actions are tenant-scoped, persisted, and audit-attributed. The launch timestamp records the decision; it does not bypass subscription, publishing, access, or readiness rules.

## 2026-08-08 — Public websites render immutable publication revisions

The website editor remains the mutable draft. Every publish action creates a numbered, tenant-scoped snapshot attributed to the acting staff identity, and the public restaurant site renders the newest snapshot while continuing to read the live published menu. Saving later draft changes therefore cannot alter public brand, contact, hours, or translated content until the next explicit publish. The authenticated preview intentionally combines the current draft with the live menu so leadership can review that next revision before release.

## 2026-08-08 — Public SEO reads the published website revision

The public venue route generates title, description, canonical language alternates, Open Graph, and Twitter metadata from the same published website payload shown to guests. Missing SEO fields fall back to the published venue name and hero subtitle. Draft editor values are never used by public metadata, keeping search previews consistent with the visible site.

## 2026-08-08 — Legal pages use the public organization billing identity

Published venue websites expose localized Imprint and Privacy pages. The Imprint reads the legal name, address, country, and VAT identifier from the organization billing profile already controlled by the Owner; it does not invent legal business data in the website editor. The Privacy page provides platform-level baseline copy and directs responsibility questions to the restaurant. This is presentation support, not country-specific legal advice, so venues must review their legal text before production use.

## 2026-08-08 — Product configuration is replaced atomically and remains historically safe

Owners and Managers manage variants, modifier groups, and modifier options from the advanced menu editor in all four platform languages. The domain requires one default whenever variants exist, non-negative resulting variant prices, complete translations, selectable options, and coherent minimum/maximum selection rules. A save replaces the product configuration in one tenant- and venue-scoped transaction and writes an audit record. Existing guest orders retain their server-calculated prices and localized snapshots, so later menu edits never rewrite order history.

## 2026-08-08 — Production staff open a station-focused board

Bar and Kitchen staff are directed after sign-in to dedicated station routes. Those boards reuse the protected operational source of truth but filter the live work list to BAR or KITCHEN tickets respectively; Kitchen includes dessert tickets under the existing station permission rule. The actions and shift requirements remain identical to Service Radar, so a station worker can only start and mark ready the tickets their role is allowed to handle, while a ready ticket continues to be handed back to service.

## 2026-08-08 — Online orders begin as restaurant-confirmed fulfillment requests

Pickup, delivery, and catering are an expansion beyond the QR-table MVP, but they use the same published menu and server-side pricing rules. They are deliberately confirmation-based: guests submit no payment details, and the system makes no automatic promise about delivery coverage, capacity, or catering availability. Pickup and delivery can become production work only after an authorized restaurant decision; catering begins as a reviewed request because its scheduling and quotation need human approval. The full scope and acceptance criteria live in `ONLINE_ORDERING.md`.

## 2026-08-08 — Online order tracking is private to the ordering device

An online-order submission returns one high-entropy tracking credential. Its hash is the only persisted form, and it permits a guest to read only that order's localized snapshots, personal contact details, requested time, status timeline, and messages. This provides transparent progress through pickup or delivery without forcing an account or exposing venue data. Staff messages are explicitly attributed; the guest may ask a short question, but cannot modify the order after submission in the first release.

## 2026-08-08 — FlowGastronomie evolves as one modular platform with one order engine

Website, QR/table service, staff-entered orders, counter sales, pickup, delivery, and catering are channels of one platform, not separate applications. The shared core owns venue configuration, menus, staff, audit, and reporting. The canonical order engine will own channel source, fulfillment, payment state, production state, item snapshots, and history; the new confirmation-first online order intake is an intentional bridge until it is promoted into that engine. Payments use a provider-neutral adapter boundary (Stripe Connect, PayPal, then future providers) and German fiscal/accounting requirements remain a separately enabled, legally reviewed Pro module. This preserves a simple MVP while keeping the SaaS and white-label architecture extensible.

## 2026-08-09 — Existing order channels first share a protected read contract

Table/QR and online pickup, delivery, and catering orders keep their tested
write paths while a new Owner/Manager-only operational read model maps each
record once into a common order contract. The projection exposes source,
fulfillment, normalized status, immutable totals and item snapshots, production
state, table/customer linkage, payment placeholder, available actor attribution,
and explicit status-history coverage. It deliberately excludes online contact
details. New table orders persist an `INITIAL` event and each later valid
transition with its staff actor and active shift; online orders already return
their recorded event history. Older table orders remain marked
`CURRENT_STATE_ONLY` rather than receiving invented history. This incremental
boundary prevents a risky data rewrite and gives reporting and the future
customer timeline one stable input contract.

## 2026-08-09 — Canonical order events use a transactional PostgreSQL outbox

Order creation and customer-visible order-status changes now append a compact,
tenant- and venue-scoped event in the same PostgreSQL transaction. The event
contains the canonical order kind, source, fulfillment, normalized status,
total/currency, timestamp, and available actor/shift attribution; it excludes
contact details and item notes. This is distinct from the audit log: audit
events record administrative accountability, while the canonical outbox is the
stable input for future reporting and customer-timeline projections. No worker
is introduced until a consumer needs asynchronous delivery, so the existing
order write paths remain synchronous and atomic.

## 2026-08-09 — Ingredient costs use canonical base units and append-only prices

Ingredient stock quantities are expressed in grams, milliliters, or pieces.
Supplier packs may be recorded in kilograms or liters, but conversion is a
tested domain rule and only permits exact conversions within the same dimension.
Ingredients, suppliers, and purchase prices are tenant- and venue-scoped. A
supplier price is a new dated record, never an update to an older observation;
this preserves the price history needed for later recipe-cost estimates without
claiming accounting inventory valuation.

## 2026-08-11 — Default operational retention is 90 days for guest contact data

The German/EU pilot uses a 90-day default for reservation and online-order guest
contact data, measured from the requested service time (or the latest linked
source for a customer profile). This gives venues enough time to resolve a
service follow-up while remaining deliberately short for a system that is not a
fiscal POS, invoice archive, or marketing CRM. Guest messages use 30 days;
non-identifying operational snapshots and staff accountability records use 24
months. A documented, time-bounded legal hold is the only exception.

This is an operational product decision grounded in GDPR storage limitation, not
legal advice or a substitute for a venue's independent statutory duties. The
full schedule, redaction boundary, backup expiry, and production prerequisites
are in [RETENTION.md](RETENTION.md). Automation is a release requirement before
contact-bearing reservations or online ordering may be enabled for a live pilot.

## 2026-08-11 — Retention redacts personal data instead of deleting operational evidence

The daily retention command removes expired guest contact fields, addresses,
notes, messages, customer profiles, expired staff-session hashes, and closed
table-session guest credentials. It preserves immutable item snapshots, totals,
status history, and attributed audit evidence so daily operational reports
continue to reconcile. The command is idempotent and records only aggregate
counts in `RetentionRun`; it never copies contact data into job logs. Owner-only,
time-bounded, target-specific legal holds are now enforced before redaction;
production scheduling and 48-hour monitoring remain explicit release
requirements.

## 2026-08-08 — Online ordering is entitlement-gated and reuses configured menu items

`ONLINE_ORDERING` is a distinct persisted entitlement, enabled in Restaurant
Pro, and is checked alongside the public website entitlement at submission.
The web order form reuses the published menu's product, variant, and modifier
configuration but never trusts client price data: it submits only identifiers
and the server validates scope, availability, defaults, selection limits, and
localized snapshots before calculating and persisting each item. This keeps QR,
website, and online ordering aligned without creating a second menu source.

## 2026-08-09 — Online production is station-scoped without table semantics

Accepted pickup, delivery, and catering requests create separate online station
tickets instead of synthetic table sessions. Each ticket contains only the
items routed to its Bar, Kitchen, or Dessert station and has its own production
state. The parent online order is a customer-facing aggregate: it becomes ready
only once all station tickets are ready, then moves through handover or delivery
completion. This permits mixed bar/kitchen orders without corrupting table,
waiter, payment, or fiscal workflows.

## 2026-08-09 — Delivery eligibility is configured per venue zone

Owners and Managers configure active delivery zones using postal-code prefixes,
fees, and minimum item totals. The server chooses the most specific matching
prefix and snapshots the selected zone and delivery fee on an online order.
Delivery outside an active zone or below its minimum is rejected before the
request is created. This provides clear venue-owned delivery boundaries without
introducing route planning, driver assignment, or a delivery marketplace.

## 2026-08-09 — Commercial V1 expands through ordered daily-management slices

The pilot MVP remains focused on configurable table service and Service Radar.
Commercial V1 builds on that validated core in an explicit sequence: stabilize
current operations, establish a canonical order contract, add recipe costing and
basic suppliers, add staff scheduling and handover tasks, add confirmation-first
reservations, then derive a purpose-limited customer timeline and operational
dashboard. These capabilities remain entitlement-controlled modules in the
modular monolith. Online payments, inventory depletion, payroll, accounting,
marketing automation, AI document processing, advanced reservation optimization,
and fiscal/POS behavior remain outside Commercial V1. The detailed acceptance
gates are maintained in `COMMERCIAL_V1_ROADMAP.md`.

## 2026-08-09 — NGINX is the reference reverse proxy for SSE verification

Commercial V1 uses a pinned NGINX container as its production-like reference
proxy, without requiring the eventual hosting platform to run NGINX. The
reference configuration forwards staff cookies, disables response buffering,
cache, compression, and connection-header rewriting, and keeps upstream reads
open beyond the API heartbeat interval. An automated operational smoke test
must prove the initial event, client disconnect/reconnect, stream closure after
membership revocation, and `401` on a revoked reconnect through that proxy. A
different production edge is acceptable only when it provides equivalent
settings and passes the same observable checks.

## 2026-08-09 — Backup restorability is an executable release check

A logical backup is not accepted only because `pg_dump` exits successfully.
FlowGastronomie restores the custom-format archive into a separate, empty
PostgreSQL 17 instance, checks the committed migration state and key row counts,
then exercises database-backed public and authenticated API paths. The
repository reference target is temporary and memory-only so local and CI runs
cannot overwrite the source or be mistaken for retained backup storage. A
managed-provider restore rehearsal is still required before the first live
pilot and after material database or provider changes.

## 2026-08-09 — FlowGastronomie is the platform brand above product families

FlowGastronomie owns the shared account, tenant, venue, menu, staff, order,
billing, audit, website, and operational core. RestaurantFlow is the first
active subscription product on that platform; Website, Smart Service, and
Restaurant Pro remain its plan tiers. PizzeriaFlow, BarFlow, CaféFlow, and
ImbissFlow are planned product profiles, while DeliveryFlow comes after the
canonical order foundation. None may be advertised as subscribable until its
distinct workflow has domain rules and acceptance coverage. Product families
compose one modular monolith and must not fork shared data or services into
separate apps.

The domain catalog is the source of truth for product names, lifecycle status,
and onboarding selectability. Future onboarding maps an active product to a
template, then a plan to entitlements. Planned products remain non-selectable;
the current onboarding therefore continues safely with RestaurantFlow only.

Public branding, package scope, demo identity, managed subdomains, DNS
verification records, and the primary staff cookie use the FlowGastronomie
name. The API temporarily accepts and clears the legacy RestaurantFlow cookie,
the web edge recognizes legacy platform hosts, and custom-domain validation
reserves both old and new managed-domain namespaces. Physical local PostgreSQL
credentials and the repository directory remain unchanged to avoid destroying
developer data; they are non-customer-facing compatibility identifiers.

## 2026-08-10 — Customer profiles are purpose-limited and never identify anonymous QR guests

Commercial V1 customer profiles may originate only from a reservation or online
order that carries guest contact details. A table QR session, its guest token,
and table orders never create or enrich a customer profile. Contact comparison
normalizes trimmed/lowercase email addresses and formatting-only phone
differences, but does not infer country codes or automatically merge profiles.
Exact contact matches are candidates for authorized staff review only. Existing
reservation and order snapshots remain immutable operational records, so a
future customer correction or deletion can remove profile data and links
without rewriting those source records, audit history, or financial estimates.

## 2026-10-04 ? P2 counter cash sessions and immutable receipt foundation

The explicitly approved counter-sale pilot extends the operational MVP with a
scoped cash register, gross-price tax snapshots, manual counter card recording,
and immutable on-screen/print receipts. Hardware and fiscal certification remain
outside P2. Existing table and online reconciliation are retained. Financial
rules live in the domain package; payment, numbering and audit finalize in one
database transaction. Rates are venue-configured, never inferred as legal policy.
See [counter receipt operations](../operations/COUNTER_RECEIPTS.md) for setup,
rounding, immutable-record rules and concrete limitations.

## 2026-10-04 ? P3 local hardware bridge, independent of financial semantics

The approved counter pilot extends P2 through a thin Android WebView shell and
an explicit development simulator. Versioned structured commands come only from
scoped finalized receipts; native results are authenticated with paired device
keys. Hardware failures affect durable print jobs, never payments or finalized
receipts. Printer/drawer adapters stay outside the business core. Vendor-neutral
capabilities are detected by a confirmed adapter, not inferred from marketing.
GEON NB11 remains a skeleton until its SDK and physical acceptance are supplied.
No undocumented ESC/POS, voltage/pin guess, fiscal integration or terminal payment
integration is included. See [hardware operations](../operations/HARDWARE_BRIDGE.md).

## 2026-10-04 — P3A production tickets drive the operational pilot

Kitchen reads scoped stored station tickets directly instead of requiring table
service signals. POS takeaway, POS dine-in and QR share this projection while
online production retains its existing model. Counter queue visibility derives
from existing production/payment/session states; payment does not imply pickup
or table closure. `SERVED` retains its domain meaning and gets a pickup label
for takeaway. See [pilot operations](../operations/PILOT_OPERATIONAL_FLOW.md).

## 2026-10-04 — Small pizzeria pilot profile and staff-facing notes

The takeaway-first rehearsal uses an optional local demo profile rather than
changing the shared seed or introducing a separate product fork. It keeps three
table QR identities and kitchen production while disabling online fulfillment,
reservations and bar products for that demo tenant. POS item notes use the
existing immutable order-item snapshot and appear on Kitchen tickets. The
normal counter path stays compact; notes are opened only when needed. Hardware
settings remain available to Manager/Owner, and real printer, fiscal and card
terminal acceptance remain separate. See
[pilot readiness](../operations/PILOT_READINESS.md).

## 2026-10-04 — Simple Pilot Mode V1

The daily staff navigation is Kasa, Orders, Kitchen and Website/Menu, filtered by
existing permissions. The Orders view reads counter/table and online pickup
orders together while production and payment remain separate dimensions. It
reuses the existing ticket transition endpoints and optimistic versions. Online
pickup retains the `OnlineOrder` write model and Manager/Owner acceptance; it is
not converted into a staff order. A ready pickup may be paid at the counter with
the existing venue register, tax-snapshot, receipt sequence and audit workflow.
`PaymentRecord` and `Receipt` link directly to the online order. No online
payment processor, card terminal, fiscal or hardware vendor behavior is added.
Pickup handoff requires a recorded payment; a failed payment leaves the order
ready and unpaid.

## 2026-10-04 — Simple Pilot visual and interaction polish

The counter adopts a warm ivory/green/terracotta visual system with compact
permission-aware tabs. Product configuration and order/payment detail use
accessible modal dialogs; search and register/hardware details open on demand.
Product quantity and kitchen notes are entered before adding, using the existing
order payload. This is a presentation change with no new POS, fiscal, payment or
domain capabilities. See the UI guide.

## 2026-10-04 — Compact pilot overview and isolated local rehearsal

The overview prioritizes operational shortcuts and existing order/register
projections. Setup, launch, account and venue detail remain available through
drawers or popovers instead of occupying the daily workspace. No API or domain
contract changes are needed.

The clean-start pizzeria dataset is an explicit guarded local command, separate
from the general CI seed and from production onboarding. It atomically clears
only the fixed demo venue's operational history and installs 31 published demo
products. User identities and website configuration survive; pickup is enabled
and delivery/catering/reservations are disabled. See
[local reset safety and menu](../operations/LOCAL_PILOT_RESET.md).

## 2026-10-04 — One pilot sidebar across workspace and staff routes

Pilot Home, Counter, Orders, Kitchen, Menu, Website, Report and Settings use one
shared shell/navigation catalog. Menu and Website have separate direct links in
the same sidebar so both remain one click away. The rail starts collapsed on
Counter and production boards when there is no saved preference; an explicit
choice persists across routes. Below 761px the same navigation becomes a modal
drawer that closes after selection.

Home is visible to every authenticated staff role. The existing privileged
Overview API remains Owner/Manager-only; restricted staff instead see a small
home composed of already-permitted shortcuts. Profile menus contain identity,
role, profile details and logout only. Setup and Go Live now live at the direct
Settings destination. No operational permissions, data or domain rules change.

## 2026-10-04 ? Unpublished pilot public presentation preview

The supplied pilot identity and visual concept are reviewed through an explicit
loopback-only development preview on the existing demo slug. This avoids
publishing unconfirmed catalog, photographs or legal identity. The public
homepage and ordering route compose the same order controller and API; only the
presentation changes. Selection persistence is session-scoped and resolves
current menu IDs/prices after navigation. API/domain rules, the approved pilot
shell and other venues remain unchanged. See preview activation, verification
and asset limitations.

## 2026-10-05 — Pilot panel information and area-local navigation

This refinement supersedes the earlier global sidebar preference and Home quick
actions. Home defaults expanded; other areas default collapsed. Manual choice is
preserved within the current area, including locale changes, and reset when the
area changes. One shared shell remains the only primary navigation source.

Home presents existing live projections and the authorized venue daily report,
with separate production/payment state. It does not synthesize daily revenue
from active orders or substitute service/payment timestamps for production and
handoff duration. Unsupported duration metrics remain outside this UI task.
pilot branding reuses the existing local preview identity guard for the fixed
demo profile only. No API/domain, public checkout, tenant data or permission
changes are introduced. See panel behavior and
navigation.

## 2026-10-05 — Menu translations on demand

Menu forms show the panel locale as their primary editing language. Other
translations are collapsed and retained, with explicit copying of primary text
to all languages. This reduces repeated entry for size labels without changing
venue language settings, translation requirements or API contracts. Variant
controls remain together in compact cards. See [menu editing](../operations/MENU_EDITOR.md).

## 2026-10-05 — Restaurant visual identity and honest product imagery

The authenticated application shares a cream/olive/terracotta restaurant theme,
sans-serif operational controls and editorial headings. Product media preserves
existing ordering behavior. Approved photographs are scoped by tenant, venue and
product; generated illustrations are limited to the existing explicit local demo
guard and visibly labeled. Missing images use lightweight decorative artwork.
This adds no API, domain or persistence capability. Public venue presentation is
unchanged. See [the visual system](../operations/RESTAURANT_VISUAL_SYSTEM.md).

## 2026-10-05 — One controlled POS overlay

POS tools, product configuration and checkout share native PilotDialog top-layer
placement and one mutually exclusive presentation state. This removes absolute
cart dropdowns and competing legacy overlay CSS without altering operational
rules. Accepted order, payment entry and receipt result remain in one dialog;
focus follows receipt results and returns to the New order heading after checkout.
See [overlay ownership](../operations/POS_OVERLAYS.md).

## 2026-10-05 ? Server-authoritative pickup and private recovery

Pickup timing belongs in the framework-free domain and is configured once per
venue. Nullable lead minutes avoid inventing production promises for real venues;
20 minutes is demo configuration only. Persist resolved pickup and preparation
boundary on the existing OnlineOrder; both Kitchen reads and production writes
enforce that boundary after staff acceptance. Published opening hours remain
authoritative, including timezone and DST.

Manual reference-plus-phone recovery creates a hashed short-lived credential
with a scoped HttpOnly cookie and reuses existing private tracking, SSE, timeline
and messages. SessionStorage holds a recent destination only. No parallel status
system, payment write or Marketing behavior is introduced. See
[operations and deployment](../operations/ONLINE_ORDERING_UX.md).

## 2026-10-06 — OVH VPS-2 + Neon is the first real multi-tenant pilot deployment

The selected first internet deployment is one **OVHcloud VPS-2 in Germany**
running the existing Next.js web and Fastify API, with **Neon managed
PostgreSQL** outside the VPS. The application remains one modular monolith and
one multi-tenant deployment; independent restaurants receive separate tenants
and venues rather than separate app copies.

The production package uses Docker images and Docker Compose with the existing
SSE-compatible reverse-proxy behavior. Do not introduce Kubernetes, Redis,
message queues, object-storage migration, or horizontal app nodes before real
load requires them. The initial target is the first 2–4 restaurants.

The first two real pilot accounts are a pizzeria in Germany and a separate
restaurant tenant in Albania. Country fiscal providers remain disabled until
their own acceptance milestone passes. The full rollout is documented in
OVH multi-tenant rollout.

## 2026-10-06 — Testing is milestone-gated during deployment work

Deployment work should use focused checks while code is changing and one
defined gate at the end of each milestone. The full repository/release suite is
not rerun after every small edit. Package, server, tenant-isolation, hardware,
fiscal and final go-live each have their own acceptance gate; the complete
release verification runs once on the exact release revision before live use.

This keeps feedback fast without weakening the final release evidence.

## 2026-10-06 — Public reference lookup exposes status only

A customer may use only an order reference to see non-sensitive status and
pickup timing. Reference-only lookup must not expose customer identity,
contacts, items, total, messages, or private timeline. The existing opaque
tracking link remains the full-detail path.

Phone-only recovery is a future SMS-verification flow and is not required for
the first VPS deployment. Reference-only lookup stays venue-scoped,
rate-limited and uses generic failures to reduce enumeration risk.

M0.1 implements this as a minimal database projection with an explicit API
response allowlist, not reuse of the private tracking DTO. Ten requests per ten
minutes per IP are shared across references and venues. The UI offers manual
refresh and no LIVE claim. Lookup creates no credentials, cookies or recovery
rows. Existing private link/SSE/polling and compatibility recovery remain intact.

## 2026-10-06 — M1 separates application runtime from release jobs

The OVH package uses Node 22 multi-stage Docker builds, Next.js standalone output
and bundled internal API workspaces with external production dependencies.
Prisma CLI and one-shot migration/retention execution belong to a separate
operations image. Host systemd timers schedule retention and nightly direct-Neon
logical backups, initially retained for seven days in a protected host directory.
One fixed-address NGINX proxy is the only trusted forwarding source; API/web have
no published ports. M1 remains loopback HTTP until the M2 HTTPS/staging gate.
The reproducible package gate uses a clean source snapshot and a disposable
PostgreSQL target, never production/demo credentials or seed identities. See
[M1 package operations](../operations/OVH_PRODUCTION_PACKAGE.md).

## 2026-10-07 — Business profiles are blueprints, not tenant clones

Flow Pizzeria, Flow Restaurant, Flow Bäckerei, Flow Döner/Fast Food, Flow Café,
Flow Bar, Flow Imbiss and Generic Gastronomy are profile templates that apply
deterministic defaults to a newly created tenant/venue. They never carry customer,
order, receipt, payment, QR, audit or other operational history into a new business.

## 2026-10-07 — Demo tenants are explicit synthetic businesses

Interactive/sales demos use named synthetic tenants such as Flow Pizzeria Demo,
Flow Restaurant Demo and Flow Bäckerei Demo. They are resettable and visibly DEMO.
They are not cloned to customer tenants.

Legacy Osteria 27 may remain temporarily for old automated fixtures, but new
source-backed product work must not use it as the identity behind another real
pilot brand.

## 2026-10-07 — the pilot pizzeria requires a canonical local pilot tenant

Interactive local review for the pilot pizzeria must use a dedicated local-only,
guarded tenant/venue with pilot identity/menu/media. The existing `preview=<pilot>`
overlay becomes a compatibility preview only and is deprecated as a source-of-truth
mechanism.

## 2026-10-07 — Venue and product media use one canonical source

POS, Website and Creative Studio must resolve the same approved venue/product
media records. Demo/generated images preserve provenance and cannot be silently
presented as real business photography. Creative-generated assets become
canonical product/venue media only through explicit approval/promotion.

## 2026-10-07 - Canonical business/demo/media foundation

Business workflow profiles are versioned configuration, independent of commercial
product activation. A single idempotent transaction provisions fresh scopes;
interactive demo tenants and the guarded local pilot pilot never clone business
history. Demo reset retires generations and revokes access instead of deleting
financial or operational records. Osteria is marked LEGACY_CI.

Canonical media uses immutable normalized raster snapshots with composite scoped
foreign keys. POS, website and Creative resolve the same associations. DEMO media
is private; generated media retains provider provenance and requires explicit
approval. Initial bytea storage and Sharp decoding sit behind adapters. Website
legacy bytes remain only for compatibility, with explicit hash-versioned bridges.

The pilot's supplied identity/logo is canonical, with one local-review Margherita.
Its EUR 9.50 price is an unconfirmed sample and its image a DEMO illustration. Both
remain identified as review data. Bootstrap is local-only, never CI/production.
The user's no-merge instruction takes precedence over the planning sequence:
PR #14 is stacked on the foundation branch for review, with no merge performed.

## 2026-10-07 — Creative Studio persists its own layered scene graph

Creative Studio stores a versioned FlowGastronomie `DesignDocument` made of
typed pages, layers and source bindings. It does not persist Fabric/Konva/editor
library JSON as the product contract and does not store a flattened generated
poster as the editable source.

The editor library is an implementation detail behind a canvas adapter. Export,
AI planning and future editor engines consume the same versioned design schema.

## 2026-10-07 — Business facts remain source-backed and exports are immutable

Venue identity, menu products, prices, promotion state and QR destinations are
re-resolved from their canonical tenant/venue records. Bound layers keep the
source id and source version used for the current design. If a source changes,
Creative Studio warns the user and offers update/keep; it never silently rewrites
an earlier export.

Each export is rendered from an immutable resolved snapshot. AI may suggest copy
and layout, but it cannot invent or authorize commercial facts.

## 2026-10-07 — Creative AI is provider-neutral and patch-based

The AI assistant is a planner/editor, not the renderer. Providers must return
strictly validated `DesignPlan` or `DesignPatchSet` structures; model output
cannot execute arbitrary HTML, CSS or JavaScript.

The default runtime should favor a low-cost structured-output planner and allow
a stronger fallback only when useful. Image generation is a separate provider
adapter and creates provenance-tracked assets rather than complete flattened
designs. Provider/model identifiers are configuration/provenance, not domain
logic.

## 2026-10-07 — Marketing PR #9 is a reference, not the Creative Studio base

PR #9 contains useful presentation-only Marketing navigation and starter ideas,
but it is based on an older main. Creative Studio V1 starts from current accepted
`main`, recreates the useful Marketing shell concepts, and keeps unfinished
Promotions/Gift Cards visibly non-operational. PR #9 can be superseded only after
its useful foundation behavior exists on the new branch.

## 2026-10-07 — Creative Studio adapter and rendering implementation

Fabric 7.4 provides interactive selection and transforms behind a canvas adapter.
Only validated FlowGastronomie fields cross that boundary. Fabric serialization
never enters persistence. Canonical geometry uses 96-dpi pixels, with millimetres
retained for physical formats; groups bake transforms into child geometry.

Fontkit shapes controlled Noto fonts into vector glyph paths shared by SVG/raster
and PDFKit. Sharp renders exact social dimensions or 300-dpi print rasters. PDF
text is outlined and portable, but not searchable; full CMYK/PDF-X remains out of
scope. Export snapshots freeze fonts, source values, assets and renderer version.
Private content-addressed file storage is replaceable through its adapter and
requires a persistent private deployment volume. Scoped authenticated content
routes are used instead of public storage URLs.

## 2026-10-07 — Conservative AI copy and explicit paid requests

The first planner adapter uses OpenAI strict structured responses. Provider/model
configuration stays server-side. Low-cost planning is the default; choosing the
quality model is an explicit user action. There are no automatic paid retries or
fallbacks. Venue-serialized job admission enforces shared export/generation budgets.

The V1 validator permits localized neutral campaign phrases, existing custom copy,
and canonical bound facts. Arbitrary new AI-written commercial copy is rejected;
custom wording is manually editable. This deliberately narrow policy needs product
review before a broader copy/translation workflow is approved. Generated images
require approval for public export and cannot be inserted as the real logo.

## 2026-10-07 — Existing source limits remain explicit

Menu names, prices, variants, venue/contact/hours and table/venue QR destinations
are resolved and fingerprinted from existing records. Raw table tokens must be
supplied from an existing QR link because only hashes are recoverable in storage.
Revoked/unpublished/missing sources block new export; a saved draft can still be
edited. Keeping changed values requires explicit export confirmation.

Website-library assets are imported into immutable CreativeAsset snapshots with
their canonical source id/version. Theme colours are copied as editable design
choices. These imported visual snapshots do not automatically track subsequent
brand changes; users reimport assets or select the updated theme. Product has no
canonical photo field, so Studio does not create an independent product-photo
catalog. Review these limits before calling brand/photo freshness complete.

## 2026-10-07 — Four-step Creative workspace and automatic working-copy refresh

The restaurant-facing default is now Material → Brief → Review → Download.
Sticker (60 × 60 mm), menu (A4) and brochure (single A4 page) are the three starting
choices. A source-backed composition is saved before a paid AI edit is requested;
AI failure leaves a usable draft. The full layer editor remains available through
Advanced editor. No global application navigation or operational module changes.

The archive distinguishes drafts, current exports, changed-since-export designs
and archived work. Opening a working design, or keeping the archive open, reconciles
canonical bound facts. Reconciliation runs on entry and every 60 seconds while the
workspace is visible; it is not a background publication service. Changed facts
create a SYSTEM revision with optimistic version checking. Archived designs,
manual edits in progress, pending AI proposals and exported files are not silently
rewritten. Missing/unpublished/revoked sources require review and block new export.
Restoring a version restores its layout with current facts, never obsolete prices
or revoked destinations. Downloaded files remain immutable.

Explicit percentage-discount requests authorize only the corresponding localized
visual wording. Staff can supply other exact campaign wording in the brief. This
does not change product prices or activate a Promotion Engine offer. Generated
commercial claims remain restricted by the domain validator.

Studio assets can now carry a staff-maintained name and provenance.catalog
classification (venue, product, logo, artwork), with a scoped canonical product ID
for product photos. This supersedes the earlier absence of product-photo
associations; it does not add a second product/price catalog. Original generation
provenance is preserved. Website assets are imported by source ID/version; existing
design image snapshots remain unchanged. AI receives up to four approved, reduced
image references and the current layered document. It cannot see unuploaded photos.

Pending AI proposals survive reload and can be accepted or dismissed. Acceptance
still checks the base version, sources and asset ownership. Provider-specific JSON
schema conversion stays inside the OpenAI adapter: Zod's discriminated oneOf unions
become equivalent anyOf branches supported by strict structured output. No editor
JSON or provider response is used as the persisted design format.

## 2026-10-07 — Localized profile categories and explicit venue region

BusinessProfileTemplate v2 stores category translations for all four platform
locales (`en/de/it/sq`) under stable category keys. Provisioning copies the
appropriate translation into each locale row. Existing menus and frozen v1
snapshots remain unchanged; templates are defaults for new businesses only.

Canonical provisioning and public trial registration require explicit `timezone`
and `currency`. Domain validation uses the runtime's IANA timezone and ISO 4217
currency data; neither UI language nor database defaults determine venue region.
Albania (`Europe/Tirane`, `ALL`) is supported alongside Germany
(`Europe/Berlin`, `EUR`).

## 2026-10-07 — Creative image output policy and internal print proofs

Image output quality is domain policy derived server-side from the persisted
DesignDocument: A4 uses a 1536×1024 high-quality landscape hero; square formats
use 1024×1024 medium. No model, dimensions or quality controls are added to the
restaurant workflow. The provider adapter translates that policy into request
parameters, makes exactly one attempt and never automatically retries, including
429, 5xx and ambiguous timeouts. Unexpected output dimensions fail without a
second paid request. Provider usage, request ID, latency, policy, dimensions and
job ID join the generated asset's immutable provenance. The live acceptance used
`gpt-image-2.5-flare`; model selection remains server configuration behind the
provider-neutral interface. Supported image request parameters were verified
against the [official Images API](https://developers.openai.com/api/reference/resources/images/methods/generate).

LOCAL_PILOT and DEMO may render unapproved generated artwork as internal proofs
with mandatory AI-generated/not-actual-food disclosure and sample-price markers.
This does not set public approval or promote an asset to canonical ProductMedia;
real tenants retain the explicit approval gate. Canonical product truth remains
separate from a project's illustrative image selection.

Canonical logo cleanup is a guarded LOCAL_PILOT maintenance operation behind a
Sharp adapter. It creates an immutable transparent PNG using only edge-connected
black-to-alpha masking and records its algorithm version, original asset ID and
both source hashes. It never mutates the original or erases enclosed black
artwork. No new public endpoint or editor/provider representation is persisted.

## 2026-10-08 - Premium profiles and reviewed website proposals

Extend BusinessProfileTemplate to V3 with FAST_FOOD and ICE_CAFE, retaining V2
parsing and all stable IDs. One canonical sample pack and three visual recipes
per profile feed read-only preview and the existing fresh-business provisioner.
Styles persist on VenueWebsite and publication snapshots; old snapshots keep
the legacy renderer. Sample prices remain EUR and draft-only; no implicit
conversion, publication or service activation.

Use existing canonical media storage for private DEMO heroes, existing SI1/SI2
for menus/product photos, and the immutable audit ledger for website draft
revisions and proposal evidence. URL import initially reads only title/meta
description over bounded, pinned public-IPv4 HTTPS. AI copy remains opt-in,
bounded, idempotent and review-first, with no direct canonical writes.
See implementation boundaries.

## 2026-10-08 — Explicit venue region and premium sample media refinement

- The signup wizard requires an owner-selected country. DE/AL may suggest currency
  and timezone, which remain editable; other countries require validated choices.
  UI locale does not imply region. `Venue.countryCode` is optional for older callers
  and is separate from legal/billing country. No region-based taxes/prices/hours.
- Curated product illustrations use canonical SI2 DEMO assets, initially private,
  and exact recipe matching. Missing photos stay visibly unfilled. Template upgrades
  never replace an existing venue's menu/media automatically.
- Continue using the three shared premium composition systems and existing draft
  history; expose advanced owner controls progressively. See
  refinement evidence.

## 2026-10-08: Text-first premium menus and controlled V1 acceptance

Missing SAMPLE product photography is a valid text-first presentation, not an
incomplete card. The shared renderer omits missing-image figures, keeps names,
descriptions and prices readable, and varies density by Editorial/Urban/Heritage.
Page/menu-level SAMPLE disclosure replaces repeated item badges in showcases;
canonical DEMO media keeps its disclosure outside showcase mode. The 25 matching
photo placements and 116 text-only entries do not require full stock coverage to
accept V1. No menu/media data or publication behavior changes.

The owner authorizes PR #21 to become ready and merge using the normal repository
workflow only after exact-commit release/CI, visual acceptance and blocking-review
checks pass. Post-merge main CI must pass; no deployment or remote migration is
authorized. See acceptance evidence.

## 2026-10-09: Smart Business Import V2 and controlled canonical restore

- Extend existing SI1 import sessions for URL/files → unified review → canonical
  private draft. Reuse the SI1 product writer, SI2 assets/associations, premium
  renderer, publication revisions and existing audit ledger.
- Deterministic observed facts precede optional provider proposals. Source hashes,
  method/status/evidence and explicit field/price/configuration/media approvals
  remain mandatory. No guessed legal/tax/allergen/hour facts or paid calls by
  default. Partial observed weekdays remain partial in the website editor.
- Use HTTPS DNS pinning, conservative robots/reuse checks and server budgets.
  Optional JavaScript runs in an isolated, sandboxed, network-disabled container
  through the same validated GET broker. Unsupported input retains manual fallback.
- Commit uses serializable canonical snapshot/version checks and a private
  before/after receipt. Restore only an unchanged private draft unused by orders;
  archive new products instead of deleting canonical IDs/history. Existing draft
  updates require an exact selected target and renewed approvals after conflict.
- Keep website/media publication separate. No operational mode, payment, fiscal
  behavior, customer pilot data, remote infrastructure or deployment is activated.
  Deliver this task as a Draft PR only. See
  [architecture and operational limits](../architecture/SMART_BUSINESS_IMPORT_V2.md).

## 2026-10-09 - Registration-only customers and retired real-client pilots

Remove real-client preprovisioning and identity overlays. All customers register
from zero using Business Registration → Smart Onboarding → Smart Import → Review
→ Draft → Preview through the existing shared provisioner and import workflow.
Domain provisioning rejects LOCAL_PILOT; the enum and old-row protections remain
for compatibility. Retire pilot bootstrap, client assets/preview, default login
credentials and obsolete destructive pilot reset/profile commands.

Keep nine premium families, three styles and GENERIC synthetic showcases. Technical
fixtures use synthetic identities/assets in isolated schemas; V2 acceptance starts
empty and uses the public registration route before reviewed import/preview.

Local cleanup requires exact identity/provisioning evidence. Preserve financial,
fiscal and audit history. No remote modification, merge, deployment or history rewrite
is authorized. See inventory and acceptance.

## 2026-10-09 - WF1 workforce profile and stable premium planning

Implement issue #23 WF1 on the existing User/Membership/StaffProfile and weekly
schedule aggregates. Preserve assignment IDs, cancel instead of bulk delete, append
immutable schedule/profile/contract/publication histories, and resolve worker reads
from the last published per-assignment version. Cross-week moves update both drafts
atomically; optimistic versions and tenant-user overlap checks cover multiple venues.

Use explicit IANA wall-time/instant conversion and DST choices through a pure Temporal
adapter. Separate station/qualification from RBAC. Owner/self private HR access,
manager operational projections and encrypted optional document attachments are
purpose-specific; no bank/tax/medical/rate data is collected by default.

WF1 ships Team Week, Day Timeline and Month/Compact from one API, with real pointer,
touch and keyboard writes. Attendance, approved hours, leave balances, monthly close,
email/push/inbox and verified country labor rules remain later reviewed WF2/WF3 work.
WF4 is a prepared isolated synthetic simulation design, not production provisioning.
See [product scope](WORKFORCE_MANAGEMENT_V1.md) and
[domain architecture](../architecture/WORKFORCE_DOMAIN.md).

## 2026-10-09 — WF2 actual/approved evidence and reviewed absence/shift requests

WF1 is integrated before WF2 begins; main CI must be green. Actual work is an
append-only evidence ledger and never inferred from POS StaffShift. Approved time
is an immutable snapshot referencing source events and effective contract/policy;
corrections append compensation with independent reviewer attribution. No monthly
account or provider delivery is built before WF3.

Leave allowance uses explicit audited opening/adjustment minutes and frozen daily
targets/working weekdays/excluded dates, with no invented accrual or carry. Sickness
has dates/status, not medical descriptions. Accepted swaps/open claims revalidate
current publication, suitability and absence/availability and call the existing
canonical schedule writer. DE/AL configuration remains reviewed operational warning
policy, not certified labor-law enforcement or payroll.

### WF2 final privacy and complete approved-hours source

Employee operations must not return a coworker roster or bulk published rota.
Exchange discovery is a separate purpose-bound read requiring the employee's
owned future published shift; counterpart choices require an eligible selected
recipient. Confidential HR remains Owner/self-only. Monthly accounting must
never use the 200-row visual attendance list: the approved-hours source is a
complete scoped canonical query with frozen revisions and timezones.

### 2026-10-10 — WF3 complete accounts and personal transactional notifications

WF2 may merge only after its exact final privacy/release CI, and WF3 starts only
after successful main CI. PR #26/main satisfied this checkpoint; WF3 remains a
separate unmerged Draft deliverable. Canonical effective interval sources are
complete; UI limits cannot supply balances. Explicit contract/calendar account
rules precede credit/target/carry; unconfigured values remain unknown. Independent
immutable close freezes original identity, planning, target/policies and sources;
new approval/absence/carry changes append compensation in the same source transaction.

Inbox is personal and mandatory for relevant published/operation events. Email/PWA
channels default off and use explicit consent; provider-disabled is never delivered.
Existing Brevo is the email boundary, PostgreSQL is the durable outbox, and the same
web workspace owns push/inbox. No native app, parallel identity/time ledger or automatic
provider/deployment activation. Current recipient role is revalidated before delivery.
Worker leases/attempts/provider idempotency/opaque push dedup retain uncertainty rather
than claiming impossible exactly-once provider delivery. Read/ack is separate from
transport acceptance. Missing-punch notices never create clock evidence.

Monthly operational insights/exports retain tenant/venue/user permissions and source
references. Missing pay rates produce NOT_CONFIGURED, not invented labor-to-sales.
No wage/tax calculation, statutory accrual/compensation automation or legal certificate.
Paid-credit overlap is an explicitly reviewed policy (lost target or excluded recorded
work); every paid/unpaid absence decision remains reportable independently of credit.

### 2026-10-10 — WF3 provisional meaning and scalable personal inbox

An unclosed monthly variance compares approved/credited hours recorded so far plus
carryover with the full-month target; it is explicitly provisional and never described
as an employee debt. Confirmed original close and later compensation remain distinct.
Unread count stays in PostgreSQL through an authorized anti-join; page limits must
not force an unbounded historical receipt collection into application memory.
WF4 starts only after controlled WF3 merge and successful post-merge main CI.

### 2026-10-10 — WF3 merged and WF4 independent operational acceptance

WF3 #27 merged at 871e4a39ef1e6365539a9fc07b03fd5c21df9327 with green post-merge
main CI before WF4 began. WF4 is a separate unmerged Draft. Full-month proof must
use fresh public registrations, canonical employee lifecycle and independent
fixture inputs, not platform calculations as the expected oracle. The trusted
workforce clock is shared with planning so acceleration does not bypass past edits
or dated contract selection. This port remains unavailable through production
HTTP/environment configuration. Real providers/legal/soak acceptance is separate.

### 2026-10-10 — WF4 final independent carry and controlled integration

April expectations must never use a March balance returned by the platform.
The independent fixture oracle derives the prior balance from explicit input
ledger facts, applies the configured carry caps, and verifies the complete next
month before and after retroactive compensation. Stale or corrupted carry must
fail reconciliation; original closes and source evidence remain immutable.
No production accounting behavior changes in this correction.

The WF4 acceptance record defines the resulting
WF1–WF4 MERGED status on main after normal controlled PR #28 merge and green
exact-head/post-merge CI. Workforce V1 is complete in code with synthetic
end-to-end verification; real providers/devices, legal configuration and staging
acceptance remain pending. Integration authorizes no deployment or real data use.

### 2026-10-11 — Operations Lab normal-volume vertical slice

The isolated lab reuses canonical workflows and immutable P2 receipts. Distinct
DE/AL menus and deterministic traffic use independent fixture expectations;
genuine browser checkout remains alongside public API demand. Compressed
acceptance preserves truthful timestamps and interruption durations. The oracle
distinguishes run-owned, other simulation and external activity, with explicit
QR allocation limits. PDF storage records P3 print associations and bounded
capacity without deleting history. Autonomous scheduling/operator controls
require separate LAB2 review after controlled LAB1 merge and green main CI.

### 2026-10-11 — LAB2 persistent local runtime and operator review

LAB1 merged at 79930bce1fa14f2409f7d6291aea2bae309a9a32 and post-merge main CI
passed before the separate LAB2 branch began. LAB2 uses frozen wall-clock plans,
scoped leases/jobs/journal and canonical source identities. Two independently
operated venues retain history, skip missed undispatched arrivals and require
explicit review of uncertain browser/print results. A financially clean partial
day with insufficient browser coverage cannot become a full acceptance PASS.
The operator dashboard is authenticated and local-only; it opens existing staff
workflows. No OS service installation, subscription bypass or multi-day uptime
claim is introduced. The canonical trial remains limited to 14 days.

Cold browser testing exposed a login hydration race: native GET submission could
put synthetic credentials in the URL. POST and hydration gating correct it.
Authenticated current-password self-service change provides the canonical
rotation path, rejects target identity fields and invalidates all user sessions.
Both affected lab manager credentials were rotated; no raw business SQL was used.
Read LAB2 acceptance for evidence and limits.

### 2026-10-11 — Reviewed background runtime and synthetic test validity

LAB2 #31 merged at 641d9cfd0b435f8a366659b822f48646a5dc6d6f with successful
post-merge main CI before this separate hardening branch. Background operation
uses an explicitly approved pinned revision, isolated data and standard local
process supervision. Startup templates are optional and never automatically enabled.
Only the exact guarded synthetic DE/AL scopes can opt into bounded renewable test
validity. Canonical trial authorization remains intact; normal trials stay 14 days
and no paid/commercial events are invented. Backup/restore acceptance preserves
the original volume and enrolls only a separately identified disposable target.

## 2026-10-18 — Isolated CI and narrow dependency remediation

Owner-only self-hosted CI keeps the full existing acceptance gates and executes
one job at a time in an isolated VM. Fresh run/attempt-specific synthetic Lab
databases prevent stale credential/state reuse; within-run restart and restore
checks retain their state. Resource/log/cache bounds protect existing services.
Local allowlisted evidence and SHA256 indexes remain mandatory. Cloud upload is
explicit while provider storage accounting is blocked; functional failures fail
the job. No raw credentials, cookies or browser traces are published.

Vitest4.1.12 plus narrow PM2/js-yaml4.3.2 and get-uri/basic-ftp6.2.3 overrides
reduce the8High/2Moderate development findings to3High/0Moderate. Production
audit and two malformed-input regression tests PASS. The remaining unpatched
development PM2/chokidar/braces chain stays open; PM2 is unchanged. Full local
and exact-head CI acceptance remain required before merge. No release-only V2
application files are copied into this older main UI.

## 2026-10-19 — PM2 development watcher dependency

Keep PM2 7.0.4 and override only its Chokidar dependency to 4.0.3, removing the
unpatched braces chain without a PM2 downgrade. Operations Lab keeps watch
disabled. Exact-path watch compatibility is tested; Chokidar 3 glob semantics
are intentionally unsupported by this override. See
[watcher security](../operations/PM2_WATCHER_SECURITY.md) for validation and rollback.

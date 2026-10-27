# Lokaler Betrieb und Prüfungen / Local operation and checks

> Developer reference: local setup, seeded demo routes, quality gates and the repository map. The overview lives in the [README](../README.md).

FlowGastronomie is the shared SaaS platform for specialized gastronomy products.
RestaurantFlow is its first active product. PizzeriaFlow, BarFlow, CaféFlow, and
ImbissFlow are planned; DeliveryFlow follows later. Every profile reuses the
same accounts, venue data, operational core, and module system rather than
becoming a separate application.

The current RestaurantFlow product lets a venue enable only the digital
workflows it needs, per area, table, or schedule, without replacing its existing
service model.

The first vertical slice includes:

- a guest-facing QR menu demo;
- configurable service modes;
- a shared table-session domain model;
- a staff Service Radar API;
- safe order-status transitions;
- a multi-tenant-ready database model.

## Quick start

Requirements: Node.js 22+ and Docker (only needed for PostgreSQL).

```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:web
```

Open `http://localhost:3000`. The API runs on `http://localhost:4000`.

The seeded guest menu is available at `http://localhost:3000/sq/menu/demo-table-07`. Replace `sq` with `en`, `de`, or `it` to verify every supported locale.

For a guided presentation, open `http://localhost:3000/sq/showcase`. The seeded
restaurant–bar contains five categories, fifteen products, kitchen/bar/dessert
routing, EU allergen data, product variants, priced extras, and a configured
order ready in Service Radar.

The authenticated staff workspace is available at `http://localhost:3000/sq/staff/login`. The form starts empty. Disposable technical fixture credentials (after `db:seed`) are:

```text
Organization: flowgastronomie-demo
Venue:        restaurant-olive
Email:        manager@flowgastronomie.local
Password:     Demo1234!
```

Owner-only settings such as custom domains use
`owner@flowgastronomie.local` with the same organization, venue, and password.
The same Owner account opens organization billing, usage, plan requests, and
seeded invoice history at `http://localhost:3000/app/sq/settings/billing`.

The guided Owner setup is available at
`http://localhost:3000/app/sq/onboarding`. It reads the real subscription,
organization, website, menu, table QR, team, and rehearsal state. The final
Go-Live control is at `http://localhost:3000/app/sq/launch`; Managers can record
the service rehearsal, while only the Owner can activate the venue.

Website drafts can be saved and reviewed privately at
`http://localhost:3000/app/sq/website/preview`. Publishing creates an immutable
revision, so later draft edits do not leak into the public restaurant site.

The demo's public website includes localized SEO metadata and legal pages:
`http://localhost:3000/sq/venue/restaurant-olive-demo/imprint` and
`http://localhost:3000/sq/venue/restaurant-olive-demo/privacy`.

Owner and Manager roles can open the multilingual menu editor at
`http://localhost:3000/sq/staff/menu`. Category and product changes,
publication state, prices, production stations, and live availability are
persisted in PostgreSQL and immediately reflected in the guest menu.

Service Radar now uses an individual work shift. Staff must start their own
shift before accepting orders, acknowledging requests, recording a cash/card
at-table payment, or closing a table. These actions are written to an immutable
audit trail with the user and shift that performed them.

Venue configuration is available at `http://localhost:3000/sq/staff/setup`.
Owner and Manager roles can manage areas, tables, inherited service modes, and
secure QR-link rotation from this workspace.

The public, read-only pilot route remains at `http://localhost:3000/sq/demo/radar` while the authenticated workflow is being developed.

## Quality checks

```bash
npm run check
```

Database-backed acceptance tests cover online delivery/station behavior plus
the core guest QR/table and Owner launch journeys. They require the local
PostgreSQL service and the current migrations:

```bash
docker compose up -d postgres
npm run db:migrate
npx dotenv -e .env -- npm run test:integration
```

Browser smoke tests exercise the seeded QR, online delivery/tracking, staff
production, Owner launch, and the keyboard/semantic/44px touch-target baseline
at 360px and tablet width:

```bash
npm run db:seed
npx playwright install chromium
npm run test:e2e
```

Static repository security checks reject tracked runtime environment files and
unexpected browser-exposed environment variables, then run the production
dependency audit:

```bash
npm run test:security
```

The browser suite starts the API and web development servers itself. CI runs it
after the standard and PostgreSQL-backed checks.

The production-like SSE proxy check uses the seeded Manager account and an
isolated NGINX Compose profile:

```bash
npm run test:sse-proxy
```

It covers immediate event delivery, disconnect/reconnect, live membership
revocation, stream closure, and rejection of the revoked reconnect.

The isolated backup/restore rehearsal creates a temporary PostgreSQL 17 target,
validates and restores a custom-format dump, compares key row counts, and runs
database-backed API smoke checks:

```bash
npm run test:backup-restore
```

To reproduce the complete release gate from a clean checkout, run:

```bash
npm run release:verify
```

It applies and verifies migrations, runs integration, repository, browser,
SSE-proxy, backup/restore and production dependency checks, and writes the
machine-readable `artifacts/release-evidence.json` summary. CI retains that
file even when a gate fails.

The target uses port `55432` and memory-only storage. The command removes the
temporary dump and restore container after both success and failure; it never
writes to the source database.

## Repository map

```text
apps/web             Guest experience and future owner/staff UI
apps/api             HTTP API and first Service Radar endpoints
packages/domain      Framework-free business rules and tests
packages/database    Prisma schema for the multi-tenant data model
docs/product         Product definition, scope, and roadmap
docs/architecture    Technical decisions and system boundaries
```

Start with [the platform master plan](product/PLATFORM_MASTER_PLAN.md),
[the product brief](product/PRODUCT_BRIEF.md),
[the MVP specification](product/MVP.md),
[the Commercial V1 roadmap](product/COMMERCIAL_V1_ROADMAP.md), and
[the project status](PROJEKTSTAND.md),
[the merchant-owned payments plan](product/PAYMENTS.md),
[the architecture](architecture/ARCHITECTURE.md). Deployment operators
should also follow the
[production runbook](operations/PRODUCTION_RUNBOOK.md).

## Current status

This is a professional foundation in Commercial V1 release readiness, not yet a
production release. Core operations, online ordering, reservations, reports,
retention and entitlement behavior are implemented; remaining release gates and
the post-V1 merchant-owned payments plan are tracked in
[PROJEKTSTAND.md](PROJEKTSTAND.md).

P2 counter-sale pilot configuration and financial invariants are documented in
[Cash register and receipt foundation](operations/COUNTER_RECEIPTS.md).

P3 simulator, Android debug builds, secure device pairing and real-device
acceptance are documented in [Hardware bridge](operations/HARDWARE_BRIDGE.md).
GEON NB11 is pending vendor documentation and physical acceptance.

Real businesses register from zero; no client pilot is precreated. Smart Import V2
acceptance exercises public registration from an empty database.

The separately guarded local [Operations Lab LAB1](operations/OPERATIONS_LAB.md)
exercises two synthetic venues through real APIs/PostgreSQL and archives
watermarked immutable receipt PDFs. Its persistent database and commands are
independent of ordinary development, release fixtures and deployment.

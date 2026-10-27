# FlowGastronomie · RestaurantFlow

**Restaurant software that digitises only what the venue actually needs.** Guests scan the table QR code, read the menu in their language, order or call for service. Staff see in Service Radar where to go first, the kitchen receives only its own items, and the owner reads the daily report in the evening. The venue decides per area, table or time of day how much of this it switches on. Waiters are not replaced.

RestaurantFlow is the first product of the FlowGastronomie platform. PizzeriaFlow, BarFlow, CaféFlow and ImbissFlow are planned on the same core.

**[Deutsche Version](README.md)** · **As of 27 October 2026** · **[Project status and history (German)](docs/PROJEKTSTAND.md)** · **[Verification record](EVIDENCE.md)**

## What is implemented today

| Status                             | Meaning and scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Implemented and tested**         | Table QR menu in 4 languages (DE, EN, IT, SQ) with EU allergens, variants and extras; configurable service modes per area and table (menu only, call service, order with staff confirmation, self-order); Service Radar; counter sales with cash/card payment and receipts; kitchen and bar stations; online pickup and delivery orders with tracking; reservations; menu editor; website builder with three designs, live preview and publishing; venue website with basket, custom domain, imprint and privacy page; recipes and food cost; daily report and payment reconciliation; staff schedule, time clock, leave and monthly accounts; roles and tenant isolation; subscriptions with module entitlements |
| **Verified**                       | Type check, format check, 718 unit tests, 77 PostgreSQL integration tests and production build locally on 27 Oct 2026, on the same code line that runs in production. Browser tests, SSE proxy and backup rehearsal run in CI. See the [verification record](EVIDENCE.md).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **In pilot use**                   | The platform runs on its own server with a separate production database. A pilot restaurant uses the public website with menu and pickup ordering; the fiskaly cash-register integration is tested only against the free sandbox and is not in this repository yet.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Implemented, not accepted live** | Transactional email (Brevo), AI menu and website import (OpenAI), Creative Studio for posters and social images, web push, Android bridge for receipt printers and cash drawers. The code exists and is tested with test doubles; it has not run against real accounts.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Not included**                   | Online payment, fiscal cash register with TSE, accounting, delivery marketplace. RestaurantFlow is deliberately not a cash register under German KassenSichV.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Vision**                         | Pilot venues in Germany and Albania; further venue types (pizzeria, bar, café, snack bar) as profiles on the same core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Why this project?

Many small restaurants choose between a paper pad and a large POS system that reshapes their whole service. Something is missing in between: a system that helps only where it gets busy. On the terrace guests may order themselves, in the dining room the waiter stays, and at lunchtime only the counter runs. That is exactly what a venue configures in RestaurantFlow.

> **Digitise only what you need, without changing how your restaurant works.**

## Screenshots

All images come from the running application with the fictitious demo venue "Restaurant Olive" from `npm run db:seed`. None are mockups. The UI language shown is German.

| Venue website                                                                                                | Templates for nine venue types                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| ![Public website of Restaurant Olive with navigation and order button](docs/assets/screenshots/website.webp) | ![Template picker with nine venue types and three styles](docs/assets/screenshots/vorlagen.webp) |

| Counter sales                                                                                       | Service Radar                                                                                                 |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ![Counter sales with product tiles by category and a new order](docs/assets/screenshots/kasse.webp) | ![Service Radar sorts tables by waiting time and required action](docs/assets/screenshots/service-radar.webp) |

| Menu editor                                                                                                               | Kitchen                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ![Menu editor with categories, allergens, variants and availability](docs/assets/screenshots/speisekarte-verwaltung.webp) | ![Kitchen view with an open order from table 07](docs/assets/screenshots/kueche.webp) |

| Website builder                                                                                   | Daily report                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ![Website builder with three designs for the venue](docs/assets/screenshots/website-builder.webp) | ![Daily report with order value, recorded payments and reconciliation](docs/assets/screenshots/tagesbericht.webp) |

### At the table (phone, 390 px)

| Menu after scanning the QR code                                                                                                    | Website                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| <img src="docs/assets/screenshots/mobil-speisekarte.webp" alt="Menu for table 07 on a phone with allergens and price" width="300"> | <img src="docs/assets/screenshots/mobil-website.webp" alt="Restaurant Olive website on a phone" width="300"> |

## Architecture

```text
Browser (guest, staff, owner)
   │
   ▼
Next.js 16 web ──► Fastify API ──► domain (pure rules, state machines) ──► PostgreSQL
                      │
                      ├─► server-sent events for kitchen, radar and order tracking
                      └─► optional services: Brevo, OpenAI, web push, Android bridge
```

- **Modular monolith in an npm workspace.** `apps/web` (Next.js), `apps/api` (Fastify), `packages/domain` (framework-free business rules), `packages/database` (Prisma schema, migrations, repositories), `apps/android-pos-bridge` (Android app for printers and drawers).
- **Multi-tenant from day one.** Every tenant-owned record carries `tenantId`, and repository methods require tenant and venue scope as mandatory parameters.
- **Rules live in the domain.** Order status, service modes, prices and permissions live in `packages/domain` and are not duplicated in UI or routes. The server always computes prices; money is stored in minor units.
- **Stack:** TypeScript strict, Next.js 16, React 19, Fastify 5, Prisma 6, PostgreSQL 17, Zod, Vitest, Playwright, Docker Compose, NGINX, GitHub Actions.

More in [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

## Quality and security

- **CI on every pull request:** format check, type check, unit tests, integration tests against a fresh PostgreSQL, browser tests of the core journeys in four languages, SSE proxy test, backup and restore rehearsal, Android build, gitleaks.
- **Security:** scrypt passwords, server-side sessions with only a hashed token in the database, table QR codes as unguessable tokens, rate limits on every public write, SSRF protection in the website import. The threat model and known residual risks are documented openly in [SECURITY.md](SECURITY.md) (German).
- **No real data.** The repository contains no real guests, staff or venues. The demo venue, its address, phone number and team are invented.

## Run it yourself

Requirements: Node.js 22, npm 10, Docker (for PostgreSQL).

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api      # http://localhost:4000
npm run dev:web      # http://localhost:3000
```

Then open:

- Guest at the table: `http://localhost:3000/en/menu/demo-table-07`
- Venue website: `http://localhost:3000/en/venue/restaurant-olive-demo`
- Templates: `http://localhost:3000/en/showcase`
- Staff login: `http://localhost:3000/en/staff/login` with `owner@flowgastronomie.local` and the local test password `Demo1234!`

```bash
npm run check              # format, types, unit tests, build
npm run test:integration   # needs the local PostgreSQL
npm run test:e2e           # browser tests
npm run release:verify     # full release gate as in CI
```

More demo routes, checks and the repository map: [docs/OPERATIONS.md](docs/OPERATIONS.md). Running on a server: [docs/operations/PRODUCTION_RUNBOOK.md](docs/operations/PRODUCTION_RUNBOOK.md).

## How this project is built

FlowGastronomie is developed by Redion Cekrezi with AI agents as tools: the human decides what gets built, reviews every result and approves it; the agents write code, tests and documentation in small pull requests that are merged only with green CI. Every major decision is recorded with its date in the [decision log](docs/product/DECISIONS.md).

## License

Source code for reading and evaluation, not for production use: see [LICENSE](LICENSE). For use or collaboration, please get in touch via [GitHub](https://github.com/IamRedi).

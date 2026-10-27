# FlowGastronomie · RestaurantFlow

[![CI](https://github.com/IamRedi/flowgastronomie/actions/workflows/ci.yml/badge.svg)](https://github.com/IamRedi/flowgastronomie/actions/workflows/ci.yml)

**Restaurant software that digitises only what the venue actually needs.** Table QR menus in four languages, Service Radar, counter sales, kitchen and bar stations, online ordering and the venue's own website run on one core. The venue decides per area, table or time of day how much of this it switches on. Waiters are not replaced.

![Counter sales with photos of every dish and an open basket, next to the menu on a phone after scanning the table QR code](docs/assets/screenshots/hero.webp)

**[Deutsche Version](README.md)** · **As of 27 October 2026** · **[Project status and history (German)](docs/PROJEKTSTAND.md)** · **[Verification record](EVIDENCE.md)** · **[Run it yourself](#run-it-yourself)**

## At a glance

- **At the table:** guests scan the QR code, read the menu in their language with EU allergens, order or call for service.
- **In service:** Service Radar sorts tables by waiting time and required action. Counter sales cover the counter, pickup and cash or card payment.
- **In the kitchen and bar:** each station sees only its own items and marks them ready.
- **For the owner:** daily report with payment reconciliation, menu editor, website builder, staff schedule and time clock.
- **Status:** in pilot use on a dedicated server. A fiscal POS with TSE is not included. What exactly is tested is listed [below](#what-is-implemented-today) and in the [verification record](EVIDENCE.md).

RestaurantFlow is the first product of the FlowGastronomie platform. PizzeriaFlow, BarFlow, CaféFlow and ImbissFlow are planned on the same core.

### 30-second walkthrough

Venue website, sign-in, owner home, an order for table 06 at the counter, the same order on the kitchen board, Service Radar and the daily report. Recorded against the local production build with the fictitious demo venue.

![Walkthrough: website, owner home, an order at the counter, kitchen board, Service Radar and daily report](docs/assets/video/rundgang.webp)

[As a video (MP4, 1.3 MB)](docs/assets/video/rundgang.mp4)

## Screenshots

All images come from the running application with the fictitious demo venue "Restaurant Olive": `npm run db:seed` creates it, and `npm run demo:showcase` plays through an evening of service via the real API (a menu with a photo for every dish, tables, an open register, orders in every kitchen state, payments, calls from the table). None are mockups. The UI language shown is German.

| Owner home                                                                                               | Counter sales                                                                                                           |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ![Owner home with live queue, today's revenue and open actions](docs/assets/screenshots/startseite.webp) | ![Counter sales with photos of every dish, table 06 and three pizzas in the basket](docs/assets/screenshots/kasse.webp) |

| Service Radar                                                                                                    | Kitchen                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ![Service Radar with a new order, a bill request and a service call](docs/assets/screenshots/service-radar.webp) | ![Kitchen board with orders in the states new, preparing and ready](docs/assets/screenshots/kueche.webp) |

| Menu editor                                                                                             | Daily report                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ![Menu editor with photos, allergens and variants](docs/assets/screenshots/speisekarte-verwaltung.webp) | ![Daily report with nine orders, recorded payments and reconciliation](docs/assets/screenshots/tagesbericht.webp) |

| Venue website                                                                                           | Website builder                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ![Public website of Restaurant Olive with hero photo and gallery](docs/assets/screenshots/website.webp) | ![Website builder with three designs for the venue](docs/assets/screenshots/website-builder.webp) |

![Template picker with nine venue types and three styles](docs/assets/screenshots/vorlagen.webp)

### At the table (phone, 390 px)

| Menu after scanning the QR code                                                                                                                        | Website                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| <img src="docs/assets/screenshots/mobil-speisekarte.webp" alt="Stone-oven pizzas for table 07 on a phone with size, extras and allergens" width="300"> | <img src="docs/assets/screenshots/mobil-website.webp" alt="Restaurant Olive website on a phone" width="300"> |

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
npm run demo:showcase  # optional: play through an evening of service
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

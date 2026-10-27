> Historical evidence, superseded on 2026-10-09. Real-client preprovisioning,
> local pilot credentials and client-specific preview paths are retired. Use
> registration and synthetic acceptance.
> Commands or client defaults below describe the earlier milestone only.

# Online ordering timing, tracking and recovery

Status: separate review milestone on `ux/online-ordering-tracking`, based on
`main` after PR #10. Do not merge without review.

## Configure and deploy

Apply `20261005180000_online_pickup_timing_recovery` before starting the new API.
It adds nullable venue preparation minutes, an online-order preparation boundary
and hashed short-lived recovery sessions. There is no monetary ledger or payment
migration. Existing pickup boundaries are backfilled from requested time minus
configured lead; absent a real configuration the boundary is the requested time.
Order totals, events, payments and receipts are preserved.

Owner/Manager configures Online orders ? Settings ? Pickup preparation time
(1?240 minutes). Null means not configured, not zero. Only demo seed/profile sets
20 minutes; confirm the real venue's preparation time and published hours before
customer launch. Later setting changes apply to new requests; existing orders
retain their saved preparation boundary. Do not seed/reset an existing pilot to
configure this field.

## Server timing rules

The domain is the sole timing source. Pickup availability receives server time,
venue timezone, published hours and venue preparation minutes. It scans real UTC
minutes for seven days, requiring the entire preparation window and pickup to
fit a continuous open interval. ASAP resolves the first valid minute. Scheduled
choices are local quarter hours and must exactly match the server list at submit.
Closing time is exclusive. Overnight hours, closed days, UTC/local date boundaries
and daylight-saving gaps are respected. Repeated autumn hours include GMT offsets
so both real instants are distinguishable. Slots are availability by hours, not
capacity reservations or guaranteed production duration.

The browser shows server-derived earliest time/day/slots, refreshes availability,
and never calculates business time from its own clock. If a selected slot becomes
unavailable, submission returns 409 with current availability; the picker refreshes
and the guest chooses again. Missing preparation configuration or no opening in
the seven-day window produces an honest localized unavailable state. Closed
venues show the next valid pickup after opening plus preparation.

Timestamp-only legacy pickup clients retain non-quarter-hour compatibility but
must respect configured lead and the full open preparation window. An unconfigured
legacy venue retains the former future/open timestamp acceptance with production
held until requested time. Delivery/catering keep explicit scheduled timestamps;
the picker offers future quarter hours inside published hours, without promising
pickup lead or new delivery/catering production behavior.

## Confirmation and production

Submission ? PENDING_CONFIRMATION ? staff Accept ? due Kitchen ticket ? Preparing
? Ready ? existing payment/handoff. Unaccepted orders never enter production.
Accepted pickup tickets are persisted immediately but hidden from the board until
`productionNotBefore`; direct-order and ticket mutation paths enforce the same
domain predicate server-side. Future orders remain visible for staff confirmation
in Orders. Terminal parent orders do not leave stale visible Kitchen work.

## Tracking and recovery security

The polished customer page uses existing `/track/:trackingToken`, its `/events`
SSE stream and messages. Polling at five seconds is the existing fallback.
The shared SSE helper preserves Fastify?s validated CORS headers when hijacking
the response, including credentials required by recovery cookies. Browser
regression checks establish the real stream and observe staff-driven updates.
The original opaque token remains hashed server-side and continues to authorize
only its order. Both public and private views reuse the existing lifecycle.

### M0.1 public status lookup

Track order first offers a same-tab private recent link, otherwise one order-code
field. `POST /v1/public/online-orders/:publicSlug/status` accepts only
`referenceCode`. It returns an explicit allowlist: `status`, the stored
`requestedFor`, and generic venue `name`/`timezone`. It never reads the private
tracking graph or returns identity, contacts, items, money, messages, history or
credentials. No estimate is invented. The result is a snapshot with a manual
Refresh status button, not a LIVE indicator or another polling stream.

The database projection requires the matching published website, tenant/venue
consistency and an order whose personal data has not been redacted. Missing,
malformed, unknown, cross-venue and unavailable lookups use the same generic 404.
Ten checks per ten minutes per client IP are shared across references and venues;
successes and refreshes also count. A localized 429 response asks the guest to
wait. The response is `no-store`; no cookie, recovery row or recent-link storage
is created. This is a read-only boundary with no new schema or domain transition.

### Private compatibility recovery

The existing reference-plus-phone API remains for compatibility; it is no longer
the normal website lookup form. The private link still opens full details and
messages without extra input. Phone-only recovery requires future SMS verification
and is deferred.

Phone normalization strips formatting and converts international 00 to +; it
never infers a country or matches suffixes. Recovery scopes the site,
tenant and venue and excludes redacted contact data. Wrong code, phone and venue
share one generic response. Dedicated limit: five attempts per ten minutes.

A successful POST creates a random 32-byte credential stored only as a hash and
sets a venue-specific cookie: 30 minutes, HttpOnly, SameSite=Lax, Secure under
production, path `/v1/public/online-orders/track`. Response contains the reference
only. The `recovered?venue=?` route reads that cookie and reuses tracking/SSE/
messages after checking venue scope and expiry. Reference alone, expired sessions
and absent cookies cannot read private order details. Retention removes expired session rows.
Use HTTPS in production and the configured trusted web/API origin; do not weaken
cookie or CORS settings for cross-site deployment.

SessionStorage is convenience only: venue-scoped reference and internal tracking
destination, without phone/customer contact. It grants no authorization itself.
Phones appear only in the verification POST body; no phone query string,
localStorage entry or repeated phone authorization is required. Recovery expiry
shows a generic unavailable state. The website code lookup still exposes only
public status; it cannot renew a private session.

## UI and verification

Four locales: sq, de, it, en. Time picker: compact desktop dialog, mobile bottom
sheet, one-click slot commit, Escape and contained/restored focus, touch targets
of at least 44px. Tracking separates progress from secondary messages/timeline;
READY has explicit text and prominent styling, not color alone. Nested picker
cancel/Tab events stay in the top dialog, so Escape restores focus inside the
remaining basket rather than closing both dialogs. No customer
checkout development banner was added; existing demo image/catalog provenance
remains visible. pilot branding remains guarded by the existing local preview.

Coverage includes real PostgreSQL public DTO privacy, cross-tenant/venue scope,
unpublished/redacted orders and read-only behavior; ASAP/open/closed/lead/timezone/invalid-slot,
confirmation/production gating, original/recovered tokens, cross-venue verifier,
TTL and retention; API cookie/rate/generic-error tests; four-locale browser timing,
recent/private links, reference-only lookup and refresh, every status, SSE and polling fallback; and the existing
website ? Orders ? Kitchen ? cash ? receipt journey with real recovery.

For M0.1 run focused online-order repository/API/browser checks with an isolated
PostgreSQL database, responsive pilot review, then one `npm run check`. Stop for
review before merge; M1 packaging is a later milestone. Browser fixtures label mocked transport scenarios in
source; they do not claim production delivery or synthetic business performance.

## M0.1 review evidence (2026-10-06)

- `npm run check`: passed (format, all typechecks, 303 tests and production builds).
- Focused public-status/private-recovery API tests: 7/7. The first parallel run
  hit the existing private SSE test's five-second timeout; the serial run passed.
- Online-order PostgreSQL integration: 14/14 on the disposable local
  `restaurantflow_m01_verify` database; the running pilot database was untouched.
- Production browser checks: 13/13, including four locales, desktop/tablet/mobile
  scheduling, minimal public lookup/refresh/errors, private SSE/polling and the
  real website → Orders → Kitchen → cash → receipt → private recovery journey.
- Additional pilot desktop/tablet/mobile public-status checks are authored but
  not rerun in M0.1: automatic approval review blocked starting the separate
  local API on port 4600 (`blocked by policy`). Previous pilot screenshots are
  not evidence of this revision. Keep this visual review item open before merge.

## Deferred and documentation sync

Deferred: capacity planning, dynamic preparation estimation, delivery assignment,
online payment, fiscal/TSE, Marketing activation, verified pilot photography/legal
identity and public pilot activation. Existing payment/receipt rules are unchanged.

Repository docs are the reviewable milestone source. Sync the final accepted
milestone to the existing project Drive documentation after acceptance; this PR
remains unmerged and is not recorded as an accepted production release.

## Public website and ordering V3 (2026-10-16)

Both public venue and bookmarked order routes render the same published website,
with one canonical catalog and the existing ordering client. The public renderer
adds a swipe gallery of approved canonical media, compact categories/products,
a native-modal desktop basket/mobile sheet, and a direct address-based Maps link
(no embedded third-party request). Hidden sections stay hidden; missing photos
use decorative artwork. Sample/generated media keep their disclosure. Builder
editing, preview and publication documents remain separate from this public UI.

Public catalog responses are no-store; an open visible page refreshes every 30
seconds and on reconnect/visibility changes. Only published, non-archived products
in published categories are exposed/accepted. Changed basket prices or selections
require review. A read-only `/quote` endpoint shares the submission resolver;
an optional `expectedQuote` fingerprint rejects a changed price/options/fee before
creation. Older identifier-only clients remain compatible. Product resolution and
order creation now share one repeatable-read transaction. No schema change.

The existing tenant/venue idempotency constraint and phone-verified HttpOnly
recovery handle lost replies. A confirmed request is frozen in venue-scoped
sessionStorage before transmission, with its original key and required contact
fields; ambiguous failures lock edits and retry that exact request, including
after refresh. Success clears request/contact data and the basket. Basket storage
contains identifiers, quantities, notes and a presentation-price checkpoint;
server prices are always authoritative. No contact data enters URLs or recent-
order storage. Unavailable session storage prevents unsafe submission.

Tracking retains existing private URLs, SSE, messages and polling fallback. A
late HTTP response cannot overwrite a newer SSE state; polling does not overlap.
Delivery shows its actual OUT_FOR_DELIVERY step, while cancellation/rejection
have separate terminal views. Motion respects reduced-motion. No courier ETA,
map telemetry, online payment, fiscal integration or provider activation is added.

Staging acceptance, 2026-10-16: API/web `a480e2c` are healthy with zero restarts;
the existing 64 migrations and protected configuration are unchanged. Exact-release
`npm run check` passed (661 workspace tests, 15 Node checks; 98 environment-dependent
skips), plus 28 focused domain/database/basket checks. The 12 V3/Builder/import
browser journeys passed; the final header regression additionally checks readable
navigation at all four widths/languages. Live bakery and pizzeria fixtures verified
32 responsive views, canonical POS/public photo identity, quote review, lost-response
replay with one order each, Kitchen/Bar READY, staff messages, polling and SSE
reconnect. Builder/import/Menu/POS/QR/Creative smoke passed. Licensed illustrative
photos were explicitly disclosed. Fixture sites/categories are now unpublished and
POS disabled; two unpaid READY orders remain as synthetic history. No payment was
recorded. GitHub CI was not used as passing evidence; PR #18 remains Draft/unmerged.
The paired rollback is `/var/lib/flowgastronomie/website-builder-rollbacks/20261015T232409Z/rollback.sh`;
the pre-V3 pair remains available under `20261015T231327Z/rollback.sh` in the same directory.

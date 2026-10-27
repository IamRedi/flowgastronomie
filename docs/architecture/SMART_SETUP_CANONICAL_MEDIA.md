# SI2 — Canonical media onboarding

SI0/SI1 merged through PR #16 (`ea3f71c`), with green PR and post-merge main CI.
SI2 adds `/app/{locale}/onboarding/media`: Restaurant → Products → Review → Save.
It reuses the existing media models and canonical menu; it does not extract,
generate, recognize, duplicate or publish products.

## Ownership and transactions

`setup-media.ts` owns valid photo positions, explicit progress, replacement and
review/conflict rules. The API validates transport and authenticates an active
Owner/Manager. The repository rechecks membership, tenant and venue on every
operation, including upload before decoding. Composite foreign keys protect
canonical associations. The web app only calls authenticated APIs.

`SmartSetup.mediaStep`, `mediaStatus` and `mediaDraft` persist the optional media
journey. The draft contains only canonical asset/product IDs, roles/order and a
fingerprint of the starting associations. It is neither a media library nor a
second catalog. Existing and newly imported draft products appear directly from
`Product`; their publication and availability are unchanged.

Uploads create immutable `MediaAsset` records. Draft edits never change current
`VenueMedia` or `ProductMedia`. Final review and explicit Save atomically replace
associations and record their before/after IDs in an audit event. The previous
assets remain accessible to their owning scope. Optimistic SmartSetup versions
reject stale tabs; a canonical-media advisory lock and fingerprint reject changes
made through another module while the draft was open. Reset discards only the
draft and reloads current associations. A lost Save response can be resolved by
reload; a stale repeat returns conflict without duplicating associations.

MEDIA is completed or skipped only through this journey. Completion removes its
own skip; skipping adds only MEDIA and preserves other explicit choices. Menu
Skip still adds only MENU. Overall menu-setup readiness remains separate from
optional media progress and launch readiness. No website/menu publication,
ordering activation, promotion or fiscal configuration is written.

## Storage, approval and provenance

The existing storage adapter validates static JPEG/PNG/WebP (5 MB / 25 MP).
SI2 retains the exact original upload bytes and SHA-256 hash; full raster decoding
validates input. Existing normalized assets remain valid. The initial storage is
the same scoped database bytea backend. IDs and hashes hide provider/storage
details from consumers. A database trigger prohibits rewriting any MediaAsset
snapshot; a replacement or different approval snapshot is a new asset.

Public approval defaults off. A real upload can receive approval only when the
Owner/Manager explicitly confirms actual business imagery, rights and public
use. Approval alone never publishes a venue or menu. DEMO uploads are private,
including uploads made in a DEMO tenant. Existing demo/generated/derivative
content recognized by original or normalized hash retains its canonical
provenance. A recognized unpromoted Creative generated asset must use Creative's
existing approval/promotion flow; it cannot be relabelled as an upload here.
This is hash recognition, not AI image detection. Provenance still depends on
truthful declarations for previously unknown files.

Product uploads start in GALLERY. PRIMARY is a visible manual choice. Replacing
a primary with a known generated image returns it to GALLERY until that choice
is made explicitly. Review shows DEMO/AI disclosures and public approval state.
The asset library and provenance details are secondary UI. No AI calls occur.

Uploads deduplicate by scope/source/approval/content hash. The upload budget is
100 new SI2 assets per venue per rolling day. Review supports 500 associations,
100 gallery positions per target, and the 200 most recent library assets plus
all selected historical assets. There is no automatic deletion of old uploads.

## Shared consumers and checks

POS and Creative already resolve canonical PRIMARY/venue media. Authenticated
Website preview now calls that same resolver instead of using only legacy URL
fields; public website approval/publication rules remain unchanged. No Product
URL fields or consumer-specific media registries are introduced.

Focused gates:

```sh
npx vitest run --root packages/domain src/setup-media.test.ts src/canonical-media.test.ts
dotenv -e .env -- node tests/setup/run-db-gate.mjs si2
dotenv -e .env -- node tests/setup/run-browser-gate.mjs --media
```

`--media` provisions isolated synthetic DEMO/REAL fixtures and drops only its
generated test schema. `--local` is retired; no customer identity or asset is
needed. CI's `test:setup` includes SI0/SI1/SI2 and browser journeys. See
cleanup acceptance.

Rollout: apply `20261008110000_setup_canonical_media`, regenerate Prisma Client,
then deploy API/web together. No provider keys or new paid services are needed.

## Direct product photography (2026-10-15)

Menu Management now opens a compact photo editor directly from each product.
Upload and camera capture share a local preview, center crop or full-image fit,
and a maximum 1200px WebP derivative. Input is bounded to static JPEG/PNG/WebP,
10 MB and 25 MP; the existing API independently validates its 5 MB raster limit.
Camera tracks and blob previews are released on replacement, cancellation and
unmount. Permission denial offers the normal file picker.

Explicit Save reuses `PUT /v1/workspace/products/:productId/media?approved=true`:
canonical normalization, scoped content identity, active Owner/Manager checks,
PRIMARY assignment and audit all remain in the existing repository transaction.
Retrying identical bytes reuses the asset. Prior assets remain historical;
product, price, publication and POS activation fields do not change. Menu, POS,
QR menu and online catalog resolve the same canonical media. POS refreshes its
catalog when returning to the tab without clearing the basket.

The product AI tab has an editable proposed prompt and explicitly disabled
Generate action. It makes **no provider request**, even if Creative Studio has
credentials. This release does not implement or enable product image generation.
A future activation must reuse the existing provider-neutral Creative image
adapter and job/provenance contracts, with reviewed selection before canonical
assignment; setting a provider key alone must not bypass that boundary.

Focused browser gate: `node tests/import-v2/run-browser-gate.mjs --grep
'product photography'` with a disposable loopback PostgreSQL DATABASE_URL.
It covers seven category illustrations, upload/preview, lost response/retry,
camera MediaStream simulation, denied permission, invalid content, tenant
isolation, unchanged menu state, shared POS images and 1440/768/360px layouts.
A physical phone/tablet camera remains an owner acceptance check.

### Verified staging delivery - 2026-10-15, 15:15 Europe/Berlin

Web `d9b7309233e6043c4e0bd5c7148bd2eaa6787b1e`; API stays
`120fecda9b410adb025a25eda3ba75bfbde1a3a0`. Web image:
`sha256:b0530d3df6320ddd1650723e56df4e9148bc7865278e8e0c5e00750502127385`.
Web-only rollback (prior image retained):
`/var/lib/flowgastronomie/product-photo-rollbacks/20261015T131509Z/rollback.sh`.
No migration, API restart or configuration/provider activation.

Full local `npm run check` passed: 646 workspace tests + 15 Node checks;
93 environment-dependent API tests skipped. The focused PostgreSQL/browser
journey passed locally and against real staging, including camera simulation,
canonical replacement/retry, 1-5 MB acceptance and >5 MB rejection, tenant
isolation, responsive layouts and POS focus refresh retaining the basket.
Staging API/web/proxy are healthy with zero restarts. Protected configuration
hashes are unchanged. Only synthetic businesses were written; their POS channel
was disabled after testing, with no orders/payments/fiscal actions. PR #18 stays
Draft and unmerged; CI credit constraints were not bypassed.

Local evidence: `artifacts/product-photo-final-verification.json`,
`artifacts/product-photo-staging-proof.json`, and
`artifacts/product-photo-staging-{menu,pos}-{1440,768,360}.png`.

## Staging AI activation and product images (2026-10-15)

Product photo generation uses the existing OpenAI Creative image adapter and a stable, tenant/venue/product-scoped Creative project. One explicit action generates one image; the editor displays the latest three results. GET history recovers completed/pending jobs after refresh. No transport failure automatically starts another generation. Approval promotes the selected asset through canonical media as PRIMARY, preserving GENERATED, provider/model, prompt hash and generatedAt; menu publication is unchanged.

Creative image attempts share a rolling 24-hour limit of 10 per venue across Studio and product photos. PLAN/PATCH share 30 attempts. Failed/uncertain attempts count; existing request keys return their recorded result before quota checks. Existing per-minute limits and PostgreSQL advisory locking remain in effect. Smart Import retains its hourly/session guards and only sends unresolved/scanned PDF sources to AI; missing optional business fields alone do not send a complete readable menu for paid enrichment.

Staging credentials belong in a root-only `/etc/flowgastronomie/ai-staging.env`, injected using the API release override. Override `MENU_IMPORT_PROVIDER=openai` explicitly because the base staging Compose disables it. Enable `BUSINESS_IMPORT_ALLOW_PAID_AI=true` and the existing `WEBSITE_COPY_AI_ENABLED=true` only alongside the existing OpenAI key. Planner/image model names come from the existing project configuration. Creative assets use the existing persistent mount. Deployment rollback restores both release overrides, disconnecting the AI env file, without changing the database, customer menus or backup configuration.

### Verified staging evidence — AI activation, 2026-10-15 16:42 Europe/Berlin

API and web source: `d6fe124f7ea0b6457f2ec13649c9d907995aea35`. API image `sha256:4e616f606305aa8e912d755ddc360f7cfff6fab62731e65d62f7b3fdc99e5573`; web image `sha256:544bc60b28495798b8f1ff02af86aada334f75bfefda475abde8330170c2a7e9`. Paired rollback: `/var/lib/flowgastronomie/ai-activation-rollbacks/20261015T144134Z/rollback.sh`. The earlier `/var/lib/flowgastronomie/ai-activation-rollbacks/20261015T142224Z/rollback.sh` restores the pre-AI release and removes AI configuration from the active container. No schema migration.

Real provider results (exactly four successful calls): Smart Import scan with OpenAI `gpt-5-mini`; one product image and one Studio image with `gpt-image-2.5-flare`; one Studio planner proposal with `gpt-6-luna`. Complete readable PDF: zero calls. Existing Website copy AI is configured with its existing approval/quota guards, but was not called within this test budget. No new provider/subscription.

Verification: full `npm run check` PASS; focused PostgreSQL tests cover unpublished product generation, repeat request/approval, tenant denial and shared daily image quota; browser test covers lost response, refresh and approval. Real staging: scan review -> canonical Draft -> confirmed POS; generated PRIMARY media shared by Menu/POS/QR/online/Creative; cross-tenant reads/writes denied. Final image preview checked at 1440/768/390 after full load, without another generation. A pre-provider rejection of unpublished products was corrected and retested; it made zero image-provider calls. Generated media retains provider/model, prompt hash, generatedAt and approval. Synthetic publication/POS retired; zero orders and payments. Protected configuration/backup hashes unchanged; PR #18 remains Draft/unmerged. Physical camera/printer and fiscal pilot acceptance remain separate.

### Universal website documents (2026-10-15)

The existing VenueWebsite gains one nullable, version-1 JSON document. Typed
Hero/About/Menu/Gallery/Contact sections hold stable IDs, four-language copy,
controlled layouts, visibility, immutable canonical media references and reviewed
AI provenance. NULL retains the legacy renderer. Existing audit revisions and
publication snapshots carry the document; restoring a draft never unpublishes or
rewrites a public snapshot. Public menu prices/publication remain canonical.

The existing website AI proposal endpoint supports SITE and localized SECTION
operations with write/improve/shorten/expand/tone/translate/regenerate actions.
It reuses the Creative OpenAI credential and structured output adapter, with a
60-second text deadline, at most 6500 output tokens for a full multilingual plan,
10 requests per venue/24 hours (including failed/pending requests), fingerprinted
idempotency and explicit acceptance. Full-site generation can request one hero
illustration when approved venue/section media is absent. Images use the existing
Creative image provider, durable jobs, shared 10-image budget and canonical
promotion; image failure preserves the text proposal. No automatic retry.

Product and website-section image controls share upload/camera/crop/generation
components and the parameterized Creative image route. WEBSITE promotion stores
an approved canonical asset without changing a global HERO assignment. Only
references in the current published snapshot expose that asset publicly. Media
source disclosure is rendered for generated illustrations. Legacy assignments
remain compatible. Draft changes to a modular site's hero do not replace the
published image. The existing AI text controls are also used by Creative's
selected-layer assistant. There is no additional provider, media store or CMS.

Manual editing, language-specific proposals, visible preview, reorder/hide/show,
image selection/repositioning and revision restore use the same editor. PDF and
controlled URL imports link directly from reviewed canonical Draft to this editor;
no menu or POS publication is implied. Minimal modular websites may omit public
contact details, and empty menu/contact/gallery sections do not create dead CTAs.
The additive column is retained during application rollback.

Acceptance on the initial integrated release `66f26fa`: two publicly provisioned
synthetic profiles (BAKERY/CAFE), six bounded real OpenAI calls (two multilingual
plans, two hero illustrations, one localized section rewrite, one section image).
Explicit acceptance, replay without another generation, refresh recovery,
manual photo replacement/crop, section reorder/visibility/layout, draft restore,
cross-tenant media rejection, four-language publication and unchanged public
snapshot after draft edits passed on staging. Synthetic publication was retired.
PDF and controlled-URL onboarding passed against real local PostgreSQL with
controlled AI responses; nine focused database tests and the full local check
passed. No remote CI pass is implied.

Visual acceptance found intrinsic image heights overriding responsive sizing;
the follow-up constrains editorial hero proportions and tests actual uploaded
media at desktop/tablet/mobile widths. Shared photo controls now name the website
section when that is their target. The AI instruction explicitly separates
requested visual mood from unverified claims about the physical venue; proposals
still require review. Physical camera hardware remains a device acceptance task.

Follow-up acceptance: one additional real EN-to-DE section translation passed
with explicit review and unchanged other languages/sections (seven provider calls
in this workstream, within the eight-call cap). Both synthetic profiles passed
real public pages in all four languages, SEO metadata, image delivery, keyboard
focus, 44px editor controls and 1440/768/390 layouts. Menu/POS/Creative smoke
confirmed one canonical product image and price, repeated POS activation without
publishing the menu, and clean deactivation with zero orders/payments. Visual
review also caught inherited platform serif headings overriding SANS; headings
now inherit the selected document font, with computed-font browser assertions.

#### Historical release — 2026-10-15 19:16 Europe/Berlin

API/web source: `3eb85c8e81b7fca94977f0cbe03c4fe14e840335` on
`feat/universal-ai-website`. API image
`sha256:f3ca984a1d5178a0e3e7512d0745302911021b658141cc9f7bf227bbe7bb824c`;
web `sha256:51a6029ee9ca83b1eb71d5ed5e0be6caf567f85a027302c79800558670c1b08c`.
Both and the unchanged proxy are healthy, zero restarts; 63 completed migrations.
Paired rollback to `c4bfd38`:
`/var/lib/flowgastronomie/website-builder-rollbacks/20261015T171558Z/rollback.sh`.
The earlier `20261015T164208Z/rollback.sh` in that directory restores pre-builder
`d6fe124`; the additive document column and saved content remain intact. New and
rollback images were exercised against an isolated migrated database before cutover.

Exact-release `npm run check` PASS: formatting, typechecks, 652 workspace tests,
15 Node checks and build. The default suite skipped 97 environment-dependent
API tests; the nine relevant PostgreSQL tests ran separately. Five PDF/URL entry
journeys and the corrected builder browser journey passed with controlled AI;
live provider acceptance used four text calls (`gpt-6-luna`) and three image
calls (`gpt-image-2.5-flare`). Final live browser checks on both profiles verified
computed typography, four public languages/SEO/media, keyboard focus, touch
controls, no horizontal overflow and no page errors. Main text contrast was
9.13:1 and 6.89:1. Synthetic sites were unpublished and synthetic POS activation
disabled afterward. No customer edits, orders or payments.

Local evidence: `artifacts/website-check-exit.json`,
`artifacts/website-final-runtime-proof.json`,
`artifacts/website-canonical-smoke-proof.json`,
`artifacts/website-call-ledger.json` and `artifacts/website-final-1-1440.png`.
Production, fiscal and protected backup/R2 configuration hashes are unchanged.
GitHub's latest run still reports a billing/spending-limit block; no remote CI
PASS is claimed, no credits purchased, and PR #18 remains Draft/unmerged.

### Premium website experience V2

New websites open three real previews from the registered Business Profile,
with the first selected. Creating a draft requires no AI. Existing approved
media takes precedence; sample menu/photos decorate authenticated previews only.
Template changes retain confirmed copy, media and visibility. The additive
`20261015220000_website_design_version` migration separates presentation version
from the unchanged document contract. Publication snapshots pin that version;
old snapshots default to V1. Application rollback retains the column and data.

The same renderer supports inline text, photo controls and contextual section
editing. Autosave serializes writes with `expectedUpdatedAt`, caches pending work
by authenticated venue, reconciles lost responses and requires an explicit choice
after concurrent edits. Undo/redo and the existing revision history are available.
AI proposals appear on the website before acceptance; style-only proposals retain
copy/media. No new provider, storage or deployment configuration is required.

The menu studio uses canonical product/category/media APIs. Optional product
revision guards reject concurrent content changes. Embedded Smart Import rejects
business-field/style changes and compares existing/new/price/variant/duplicate
and absent rows before the existing controlled commit. Menu-only commits do not
touch the website, even when published. Absent products are retained; active
products are never silently replaced. POS activation and publication stay separate.

#### Verified V2 release — 2026-10-15 23:06 Europe/Berlin

API/web source `d1f64df000283de889b1dadc3a54f37eb619125b` is deployed to
Clouvider staging from `feat/premium-website-v2`. Both containers are healthy,
with zero restarts and 64 completed migrations. Immutable images:

- API: `sha256:7c48c5c82eb85f1d30ecc15a90b8309a53bb1ed770aab23b33447c167af75836`
- Web: `sha256:1bc245f355bb6f14cec7d4e476becb43a300259d104ec86443b71761e06c19c5`

Exact-release `npm run check` PASS with `VITEST_MAX_WORKERS=2`: format,
typechecks, 656 workspace tests, 15 Node checks and build. Two PDF tests timed
out under unrestricted local concurrency; all nine tests in those two files
passed independently, then the complete gate passed without changing test
timeouts or assertions. The standard suite reports 98 environment-dependent
API skips; ten relevant PostgreSQL tests ran separately. Four V2 browser tests
cover recovery/conflicts, canonical editing/import, publication and languages;
five existing PDF/URL self-service journeys also passed during this workstream.

Live synthetic Bakery/Pizzeria/Bar/Cafe/Restaurant registrations created drafts
without AI or operational DEMO products. Real acceptance used four text calls
and one image call; repeated request keys returned the same proposals, and PDF
extraction used zero provider calls. Live checks covered canonical product/photo
editing, reviewed PDF commit, confirmed publication, Menu/POS/QR/online/Creative
smoke and two-tenant isolation. Synthetic sites remain Draft, POS disabled, with
zero orders/payments. Physical camera capture remains untested.

Desktop/tablet/mobile screenshots were inspected at 1440/768/360px. Corrections
include preview contrast, canonical content in style previews, stale product
load protection, 44px touch controls and no overlap with editable headings.
Four languages, lazy images, basic SEO and no horizontal overflow/page errors
passed; main text contrast measured 6.58:1, 6.88:1 and 10.50:1.

Rollback: `/var/lib/flowgastronomie/website-builder-rollbacks/20261015T210440Z/rollback.sh`
restores the preceding API/web pair. The full pre-V2 `3eb85c8` rollback remains
at `20261015T202423Z/rollback.sh` in the same directory. Both retain saved data.
Protected production/backup/R2 configuration hashes are unchanged. PR #18 is
still Draft/unmerged; no remote CI PASS is claimed (latest workflow blocked by
billing). Owner visual acceptance is pending.

Local evidence: `artifacts/website-v2-check-exit.json`,
`website-v2-runtime-proof.json`, `website-v2-provider-proof.json`,
`website-v2-final-browser.log`, `v2-live-template-4.png`,
`v2-live-full-preview-0.png`, `v2-live-inline-0.png` and
`v2-live-editor-{0,1,2}-{1440,768,360}-screen.png` under `artifacts/`.

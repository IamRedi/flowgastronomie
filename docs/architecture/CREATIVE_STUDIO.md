# Creative Studio implementation

Creative Studio is isolated from ordering, fiscal, payment and publishing work.
The canonical version-1 document lives in `packages/domain/src/creative.ts`.
Strict parsing rejects unknown fields (including editor-native serialization),
unsupported versions, unsafe geometry, fonts and unbound semantic prices/QRs.
Canonical units are 96-dpi design pixels; print formats also retain exact mm sizes.

## CS0

Six additive scoped tables store projects, immutable revisions, assets, exports,
minimal conversations and attributed provider jobs/usage. Composite foreign keys
prevent a revision or export from linking across venues. Working saves use a
version-conditional update and revision insert in one transaction. Revision
numbers track meaningful debounced saves, never individual pointer movements.
Owner/Manager permissions are checked at repository and API boundaries.

Gate: five domain tests and three scoped repository tests passed; database
TypeScript passed and Prisma formatted/generated the schema successfully.
Repository unit tests inspect scope predicates and stale-write behavior; they do
not substitute for PostgreSQL integration acceptance in CS6.

## Adapter boundaries

Canvas, source resolution, asset storage, rendering and AI providers are separate
adapters. Neither provider output nor canvas serialization is persistence authority.
Model or renderer migrations must never rewrite immutable exported snapshots.

## Source policy

Table QR raw credentials cannot be recovered from existing hashes. A user must
supply an existing token for server validation; the Studio never rotates table
credentials implicitly. Promotions and gift-card visuals remain template drafts.

## CS1

Fabric 7.4 is isolated in `canvas-adapter.ts`; only controlled document fields
cross the boundary. The editor is dynamically loaded and saves meaningful edits
with a bounded 60-command undo history. Uploads are decoded, size-limited and
normalized to PNG, with authenticated storage reads and explicit approval.

Gate: focused browser journey passed at desktop/tablet/mobile, including creation,
manual text, shapes, undo/redo, adaptation and version save. History and API role/
transport tests passed; API and web typechecks passed. The first browser locator
was corrected to use the textarea's accessible role/name. Browser API persistence
is mocked here; actual PostgreSQL acceptance remains in CS6. QR content is wired
with its authoritative source resolver in CS2.

## CS2

Source resolution reads canonical published products/categories, variants, venue,
website brand/contact and approved QR routes. Field fingerprints supply stable
versions even where legacy source tables have no `updatedAt`. Save validation
accepts only current resolved facts or an authenticated previous design snapshot.
Locale changes require source re-resolution. Templates share the canonical schema;
promotional and gift-card artwork does not activate commercial behavior.

Gate: two source-policy tests, two resolver tests and the printed-menu browser
journey passed. An isolated local PostgreSQL schema also passed migration,
concurrent-save, cross-tenant/venue, real price-change and table-QR revocation
acceptance. The temporary schema was removed afterward. API/web typechecks passed.
No existing operational data was changed.

## CS3

A renderer-versioned snapshot freezes document, source values, approved asset
content hashes, font hashes and print options. Canonical sorted JSON determines
its hash. Export review binds confirmation to both project version and freshly
resolved sources; keeping stale values requires explicit confirmation. Export
creates an immutable revision before rendering. Failure leaves that revision safe.

The independent renderer shapes controlled Noto Sans/Serif glyphs into vector
outlines with Fontkit. SVG/PNG/WebP and PDFKit consume the same vector primitives;
QR modules are vector rectangles with a four-module quiet zone. PDFs use outlined
text (portable fonts, not searchable text), physical page dimensions and explicit
TrimBox/BleedBox. PNG/WebP use Sharp, exact social dimensions and 300 dpi for print.
The file-storage adapter serves artifacts only through scoped authenticated routes.
Persist `CREATIVE_STORAGE_DIR` on a private volume and back it up with metadata.

Gate: three renderer tests passed (deterministic raster/hash, dimensions, PDF
structure, overflow/font-version rejection). API/web typechecks passed. PyMuPDF
rendered the A4 fixture for visual review: 595.276 x 841.890 points, 61 vector paths,
zero raster images. Fixtures are in `docs/creative/fixtures`. Full CMYK/PDF-X and
searchable PDF text are intentional V1 limitations; the editable source remains
structured in every case.

## CS4

`CreativePlannerProvider` separates structured createPlan/createPatch from the
OpenAI Responses adapter. GPT-6 Luna is the configurable default; GPT-6 Sol is an
explicit quality option. There is no automatic paid fallback or regeneration.
The model receives selected source facts, scoped approved asset references,
controlled brand/style and the current design; raw table QR credentials are
redacted. Provider output is strictly parsed and validated again by domain rules.

AI may select from localized neutral campaign phrases or preserve existing custom
copy. It cannot synthesize a new commercial claim into a design. Custom campaign
wording remains manually editable. This conservative copy policy is an explicit
product-review item. A reviewed proposal is accepted with optimistic concurrency
and creates an AI-attributed revision; the client records it as one undo command.
Minimal conversations and attributed usage are persisted, never hidden reasoning.
Venue-serialized PostgreSQL job admission enforces user/venue budgets.

Gate: three planner-domain and three mocked OpenAI contract tests passed; API/web
typechecks passed. No live provider credentials were intentionally configured, so
no billed planner request was made. Current provider reference:
[structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
and [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

## CS5

`CreativeImageProvider` exposes generateAsset/editAsset. The OpenAI adapter uses
one explicitly requested image, a configured model (default GPT Image 2.5 Flare),
bounded timeouts, an idempotency header and binary/base64 output only. It never
fetches provider-supplied URLs. Image edits accept an existing scoped image layer,
not a complete composition, logo or QR layer. Generated PNGs are decoded and
validated before private storage. Provenance retains prompt, provider/model,
source asset, generation time and attributed job. Assets start unapproved.

Gate: four provider/service mock tests passed, including generate/edit, response
validation, idempotent replay, provenance, failure and invalid target denial.
API/web typechecks passed. The single intentionally billed acceptance sample is
pending server-side credentials; no provider credits have been spent.
Reference: [image API](https://developers.openai.com/api/reference/resources/images/methods/generate).

## CS6

Three browser journeys passed together: manual editor/history/responsive behavior,
canonical printed menu and stale-price update, and reviewed AI proposal/manual
edit/Story/A4/export flows. Their transport is mocked explicitly. Both isolated
PostgreSQL tests passed with real saves, conditional-write races, canonical source
changes, vector/raster exports, idempotent replay, immutable hashes, table QR
revocation, image concurrency and role/tenant/venue denial. The temporary schema
was removed after acceptance; existing data was untouched.

Final hardening adds canonical group transforms/duplication/removal, inherited
visibility/locks/opacity, QR safe-area/overlap rejection, generated-logo rejection,
bounded total text, shared transactional export/AI admission, category/variant and
hours selection, library templates and recent exports. Manual editing can retain
an authenticated previous source snapshot while an unavailable source blocks
new export. Group invariants and approval restrictions have domain coverage.

`npm run check` initially passed formatting/typechecks and all but one test: the
existing order-recovery SSE test exceeded its five-second timeout under parallel
load. A focused rerun passed, but the full retry reproduced the failure. Explicitly
closing that fixture's test-server connections before shutdown reduced its tests
from about 4.6 seconds to 0.6 seconds. Only test cleanup changed; no application
transport or operational behavior changed. All 333 tests passed after this fix.
The production build also passed separately; see the final project-gate result in
review evidence. `npm audit --omit=dev --audit-level=high`
reported zero vulnerabilities. Live provider requests remain pending credentials.

# Four-step workspace refinement (2026-10-07)

The default route now uses `CreativeWorkspace`. Creation, archive, assets and
downloads are separate components; the Fabric editor is dynamically loaded only
for advanced editing or a proposal preview. Existing designs remain compatible.

- Domain: `creative-workspace.ts` validates the brief, matches exact normalized
  product names, composes source-bound sticker/menu/brochure layers and derives
  archive state. One A4 menu supports up to 40 products in two columns. A brochure
  supports 12 products with a photograph, or 24 without. These limits fail clearly
  rather than dropping products or overflowing print content.
- Database: `syncCreativeProject` resolves existing bindings and writes one SYSTEM
  revision only when facts change. Archived work is excluded. Optimistic saves also
  reject archived projects. Restoration appends a new revision with current facts.
  Archive state compares the latest export revision number with the project version.
- API: `/compose`, scoped `/sync`, `/archive`, `/restore`, `/proposal` and
  `/ai/dismiss` orchestrate those rules. `/assets/:id/catalog` validates the product
  association and preserves image provenance. Preview/export adapters are unchanged.
- AI: PATCH receives a real initial document, avoiding guessed template-layer IDs.
  Existing layer copy and explicitly requested discount wording are allowed. Four
  approved thumbnails (512 px, JPEG) provide visual context without public URLs.
  No automatic paid retry or image generation occurs during archive reconciliation.
- Frontend: source reconciliation pauses around advanced edits and pending proposals.
  Download preflight still blocks stale/missing data. An interrupted AI proposal is
  recovered from the scoped conversation record without another provider request.

The OpenAI schema adapter follows the supported `anyOf` subset in the
[Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).
The previous Zod `oneOf` encoding caused provider rejection; one real configured
planner request for an Albanian 10%-discount sticker succeeded after this correction.

No migration is required for this refinement: project status already exists and
asset classifications live alongside immutable provenance in the existing JSON
metadata. The archive currently lists the latest 100 designs and 50 revisions per
design. Brochures are single-page V1 materials, not multi-page publishing projects.
The new simplified UI is available in Albanian and English (English fallback for
German/Italian); document content and canonical price formatting retain all four
locales. Theme/image snapshot changes remain explicit design choices.

`NEXT_DIST_DIR` optionally isolates Next development output. The focused Creative
Playwright config uses `.next-creative`, allowing verification alongside the user's
running `.next` server. Production retains the normal `.next` default.

# FlowGastronomie — Creative Studio V1

**Status:** CS0–CS6 implementation on the feature branch; review and live-provider acceptance pending. See handoff.

**Branch:** `feature/creative-studio-v1`  
**Updated:** 2026-10-07

## 1. Product goal

Creative Studio is an in-platform design workspace for restaurant owners and
managers. It is deliberately simpler than a generic design suite because
FlowGastronomie already owns the business data that normally has to be copied
manually into Canva or another editor.

The user should be able to say, for example:

> Make an elegant A4 poster for Pizza Tuesday, use our logo, the current pizza
> price, the venue colors and a QR code to order.

The result must be an **editable layered design**, not a flattened AI image.
Every important element remains individually selectable and editable inside the
platform.

The core flow is:

```text
Venue/Menu/Promotion/QR/Brand data
        ↓
Creative Context Resolver
        ↓
AI Creative Planner
        ↓
Validated DesignPlan / DesignPatch
        ↓
DesignDocument (our schema, layered)
        ↓
Editor
        ↓
Preview / PNG / PDF / print
```

The AI proposes design and copy. FlowGastronomie remains the source of truth for
prices, products, business identity, QR destinations, promotion state and
published business data.

## 2. Product principles

1. **One source of truth.** Do not copy menu prices, business data or QR targets
   into a second marketing database as free text when a canonical source exists.
2. **Layered, editable output.** AI may never be the only renderer. Designs are
   stored as structured data with editable layers.
3. **Source-backed commercial facts.** AI cannot invent a product price,
   discount, address, opening hour, QR destination or legal claim.
4. **Simple by default.** Restaurant owners should not need design expertise.
   Advanced controls appear only when requested.
5. **Provider-neutral AI.** Domain and persisted design data never depend on one
   LLM or image provider.
6. **Reproducible exports.** Every exported file is rendered from an immutable
   resolved snapshot, so a future menu edit cannot silently rewrite an old PDF.
7. **Human approval.** AI suggestions and generated imagery remain draft until
   explicitly accepted/exported by an authorized user.
8. **Tenant and venue isolation.** All designs, assets, source bindings and AI
   context are scoped by tenant and venue.
9. **Honest imagery.** Uploaded/approved real images and AI-generated assets have
   explicit provenance. Generated food imagery is never silently represented as
   a real venue photograph.
10. **Future-safe schema.** The editor library is replaceable; its native JSON is
    never the database contract.

## 3. Where it lives

Authenticated navigation:

```text
Marketing
├── Overview
├── Promotions
├── Gift Cards
├── Creative Studio
└── Analytics
```

Creative Studio itself has two levels.

### Library

- Create design
- Recent designs
- Templates
- Brand kit summary
- Export history
- Search/filter by format/status

### Editor

Desktop/tablet layout:

- **Top bar:** design name, format, locale, undo/redo, preview, export
- **Left rail:** add content, layers, templates/source items
- **Center:** design canvas
- **Right inspector:** properties for the selected layer
- **AI panel:** compact conversational assistant, collapsible

On small screens, panels become drawers/sheets; the user is not shown four
permanent panes.

## 4. V1 output formats

### Digital

- Instagram / social portrait 4:5
- Story / vertical 9:16
- Square 1:1
- custom social size from a controlled preset list

### Print

- A4 poster
- A5 flyer
- A6 flyer
- Window poster
- QR sticker
- Table QR card
- Table tent
- promotion card
- come-back coupon
- printed menu A4/A5

Later: multi-page menus, tri-fold brochures, business cards, Google/Meta ad
families and custom professional print profiles.

Every format owns an exact output specification: aspect ratio, physical size
where applicable, safe area, optional bleed and supported export targets.

## 5. DesignDocument — canonical scene graph

The database stores our schema, not Fabric/Konva/editor-native serialization.

Conceptual structure:

```ts
DesignDocument {
  schemaVersion
  format
  locale
  canvas
  theme
  pages[]
  bindings[]
}

Page {
  id
  background
  layers[]
}

Layer =
  | TextLayer
  | ImageLayer
  | ShapeLayer
  | LogoLayer
  | QrLayer
  | ProductLayer
  | PriceLayer
  | PromotionLayer
  | DividerLayer
  | GroupLayer
```

Shared layer properties:

- stable id
- x/y/width/height in canonical design units
- rotation
- opacity
- z-order
- visible/locked
- optional clipping/mask
- semantic name
- accessibility/editor label
- source binding where applicable

Text:

- editable content
- font family from a controlled font registry
- size/weight/style
- line height / letter spacing
- alignment
- fill
- optional text box/background
- overflow policy

Images:

- asset id, never arbitrary untrusted remote HTML
- crop/focal point
- fit mode
- border radius
- opacity
- provenance badge available in editor metadata

The schema is versioned. Migrations upgrade old documents forward without
rewriting exported snapshots.

## 6. Persisted aggregates

Recommended V1 records:

### CreativeProject

- id
- tenantId
- venueId
- title
- format preset
- locale
- status: DRAFT / READY
- currentRevisionId
- createdBy / updatedBy
- timestamps

### CreativeRevision

Immutable design snapshot:

- projectId
- revision number
- DesignDocument JSON
- source-resolution summary
- actor: USER / AI
- optional parent revision
- timestamp

Create revisions for meaningful saves, AI transformations and exports. Do not
create a database revision for every pixel of dragging.

### CreativeAsset

- tenantId / venueId
- kind
- source: VENUE_LIBRARY / UPLOADED / GENERATED / SYSTEM
- content hash
- mime type
- dimensions
- storage location
- provenance metadata
- generated provider/model identifier when applicable
- approvedForPublicUse
- timestamps

### CreativeExport

- projectId / revisionId
- output type
- resolved render snapshot/hash
- dimensions / print specification
- storage location
- createdBy
- timestamp

### CreativeConversation

Minimal user-visible conversation history for the project:

- user message
- assistant summary
- applied patch reference
- timestamp

Do not store hidden reasoning or provider-internal traces.

## 7. Source bindings and stale-data protection

The strongest FlowGastronomie advantage is source binding.

Supported V1 source classes:

- venue identity
- website brand/logo/colors
- contact/address/website
- menu category
- product
- product image
- current product price
- variant/size
- promotion
- QR target
- table QR
- opening hours where explicitly selected

A bound layer stores:

- source type
- source id
- requested field
- source `updatedAt` / revision marker at resolution time
- last resolved display value

Example:

```text
PriceLayer
source = PRODUCT
sourceId = product_123
field = currentPrice
resolvedValue = €10.50
resolvedSourceVersion = ...
```

When the product later changes to €11.00, Creative Studio shows:

> Source changed: €10.50 → €11.00  
> Update / Keep this design version

It must never silently mutate an exported design.

### Export snapshot

Before export, the server resolves every binding again. The user sees any stale
commercial values. After confirmation, an immutable render snapshot freezes the
actual values used in that export.

## 8. Brand Kit

Do not build a second unrelated branding system.

Creative Studio derives a venue brand kit from existing website/venue data:

- logo
- primary / secondary / accent colors
- approved typography
- venue name
- optional short style/tone description
- approved image library

Creative-specific overrides are allowed but remain explicit.

Future: multiple named brand themes per venue.

## 9. Templates

Templates use the same DesignDocument schema with typed slots, not separate
hard-coded pages.

A template defines:

- format
- initial layers
- editable/locked layers
- source-compatible slots
- text constraints
- safe zones
- optional image slot
- intended use
- locale-aware default copy

Initial V1 templates:

- Product spotlight
- Promotion poster
- Menu price card
- Pizza/food offer
- Event/opening announcement
- QR table card
- QR sticker
- Come-back coupon
- Minimal printed menu
- Gift-card visual placeholder only until Gift Card domain is operational

Templates never contain fake active promotions or fake balances.

## 10. AI Creative Planner

AI is a planner/editor assistant, not the renderer and not business truth.

### Runtime model strategy

Use a provider-neutral interface:

```ts
CreativePlannerProvider
  createPlan(context, instruction): DesignPlan
  createPatch(context, document, instruction): DesignPatchSet

CreativeImageProvider
  generateAsset(request): CreativeGeneratedAsset
  editAsset(request): CreativeGeneratedAsset
```

The persisted schema stores provider/model metadata only as provenance, never as
domain behavior.

### Current recommended default

For short planning/copy/layout requests, start with a low-cost structured-output
model such as **OpenAI GPT-6 Luna**. Keep **GPT-6 Sol** as an optional quality
fallback for unusually complex requests. Do not use Astra as the default runtime
model; reserve expensive models for exceptional quality cases if evidence shows
a benefit.

For image assets, begin with one provider implementation to avoid unnecessary
integration complexity, but keep the adapter contract from day one. Candidate
benchmarks: OpenAI GPT Image and Google Gemini image generation. Provider choice
is configuration, not a schema migration.

### Structured output only

The planner does not return HTML/CSS or arbitrary code.

It returns a strictly validated schema:

```text
DesignPlan
- creative intent
- selected source ids
- template/preset
- layers
- copy suggestions
- optional generated-asset requests

DesignPatchSet
- add layer
- remove layer
- move/resize layer
- change style
- change editable copy
- replace image asset
- switch template/layout
```

Every patch is validated server-side against:

- tenant/venue scope
- source ownership
- allowed layer types
- geometry limits
- text length
- font registry
- asset ownership
- QR policy
- commercial fact rules

### AI context

Give the model only the minimum relevant context:

- requested format
- venue brand kit
- explicitly selected product/promotion
- allowed image assets
- locale
- design summary
- current selected layers for an edit

Do not dump an entire tenant database into the prompt.

### Example conversations

- “Make this more minimal.”
- “Use our green, make the product photo bigger.”
- “Turn this into a Story.”
- “Create an A4 version for the window.”
- “Use the current Margherita price.”
- “Make a table QR card for table 4.”
- “Translate the campaign copy to German.”
- “Remove everything except logo, offer, QR and CTA.”

The model edits the scene through validated patches.

## 11. AI image generation

Image generation is optional. The normal priority is:

1. approved venue photograph
2. approved uploaded graphic
3. system decorative assets
4. generated promotional visual, only when requested/allowed

AI-generated images are assets, never the complete final poster.

Rules:

- logos remain real logo layers, not regenerated by an image model;
- prices/text/QR remain structured layers;
- generated food imagery is marked as generated in internal provenance;
- prompt, provider/model and generation timestamp are retained;
- the user approves an asset before it becomes public/exported where policy
  requires approval;
- generation failures never destroy the current design;
- retry is explicit and idempotent.

## 12. Editor technology boundary

The interactive editor may use a mature canvas library such as Fabric.js, but
the choice is hidden behind an adapter. Fabric is attractive for V1 because it
supports object selection/transforms, editable text, serialization helpers and
SVG export.

Hard rule:

> Never persist raw Fabric/Konva/native editor JSON as the product contract.

Implement:

```text
DesignDocument
    ↕
DesignCanvasAdapter
    ↕
interactive editor library
```

This lets us replace the editor library later without migrating business data.

Required editor behavior:

- select / multi-select
- drag / resize / rotate
- alignment guides and snapping
- layer order
- lock/hide
- inline text editing
- crop/fit image
- color / typography controls
- duplicate/delete
- keyboard nudging
- undo/redo
- zoom / fit-to-screen
- safe-area / bleed guides
- responsive panel layout

## 13. Autosave, undo and revisioning

- Client undo/redo uses a bounded command history.
- Dragging does not write continuously to PostgreSQL.
- Debounced autosave persists the working revision with optimistic concurrency.
- A stale tab receives a conflict response and must reload/merge explicitly.
- AI changes are one undoable transaction.
- Export creates an immutable revision/snapshot first.
- Manual “Save version” creates a named revision.

Future: visual revision comparison and restore.

## 14. Rendering and export

Rendering must be independent from the editor implementation.

Recommended pipeline:

```text
DesignDocument
    ↓
source resolver
    ↓
RenderSnapshot
    ↓
SVG/print renderer
    ├── browser preview
    ├── PNG/WebP social export
    └── vector-oriented PDF print export
```

### Social export

- exact target pixel dimensions
- PNG/WebP/JPEG as appropriate
- high-quality image resampling
- deterministic output from the revision

### Print export

- correct physical page size
- vector text/shapes/QR where possible
- embedded/controlled fonts
- high-resolution raster assets
- optional 3 mm bleed preset
- safe margin guides
- crop marks as an export option, not shown in design content
- A4/A5/A6 exact dimensions
- multi-page-ready architecture even if V1 starts with one page

Do not create a PDF by taking a low-resolution browser screenshot.

## 15. QR layers

QR is a semantic layer, not an uploaded bitmap.

A QR layer references an approved FlowGastronomie destination:

- venue website/menu
- ordering page
- campaign link
- table token

The server generates the actual code from the approved target. The editor can
change size/style within safe constraints but cannot rewrite the destination
through arbitrary text without explicit permission.

Print validation checks minimum physical size, quiet zone and contrast.

## 16. Localization

A CreativeProject owns a target locale.

Source-backed menu/product names come from canonical translations.

AI-generated campaign copy is editable and clearly treated as copy, not source
truth. “Adapt language” creates another design revision, not a silent overwrite.

Future: one project with linked locale variants.

## 17. Permissions

V1:

- Owner: full Creative Studio
- Manager: full venue Creative Studio
- Waiter/Bar/Kitchen: no Creative Studio access

Suggested permissions:

- `CREATIVE_VIEW`
- `CREATIVE_EDIT`
- `CREATIVE_EXPORT`
- `CREATIVE_AI_USE`

Do not rely only on hidden navigation. API/repository authorization is
authoritative.

## 18. Security and isolation

Every lookup and mutation requires tenantId + venueId context.

Security requirements:

- never accept a tenant/venue id from AI output as authority;
- re-resolve every referenced product/asset/QR server-side;
- signed-in session is the only scope authority;
- validate image MIME/signature/size;
- sanitize SVG or generate SVG only from our renderer;
- never execute model-generated HTML/JS/CSS;
- no arbitrary server-side URL fetching from model output;
- rate-limit AI and export endpoints;
- provider API keys stay server-side;
- prompts must not contain unnecessary guest/customer PII;
- AI provider errors are sanitized before user display/logging;
- audit meaningful AI/export actions without storing secrets.

## 19. Storage

V1 may keep metadata in PostgreSQL.

Large images/exports should use an asset-storage abstraction:

```ts
CreativeAssetStorage
  put()
  read()
  delete()
  signedReadUrl()
```

For the first pilot, the implementation may use the simplest supported storage
that fits the deployment, but the database must store only metadata/location
rather than making large generated/export files permanent DB blobs.

This is a justified object-storage boundary for Creative Studio; do not rewrite
existing website media just to introduce it.

## 20. Cost controls

AI cost is tenant-attributed and observable.

Record non-sensitive usage:

- provider/model
- request category: PLAN / PATCH / IMAGE
- input/output usage when returned by provider
- number of generated images
- duration
- success/failure

V1 protections:

- per-user/venue rate limits
- one image generation at a time per design
- explicit Generate/Regenerate action
- no automatic regeneration on every chat message
- cached brand/source context where provider/API supports it
- default to the low-cost planner model
- image generation only when needed

The UI can later expose monthly AI usage without treating provider billing as
restaurant payment data.

## 21. Failure behavior

- Planner unavailable: manual editor continues to work.
- Image generator unavailable: design remains intact.
- Export failure: revision remains intact; retry is safe.
- Source binding unavailable: show unresolved source, block misleading export.
- Product deleted/unpublished: warn; do not silently substitute another product.
- Price changed: stale-value warning before export.
- QR revoked: block export until regenerated/resolved.

Creative Studio must remain usable without AI.

## 22. Relationship to Promotions and Gift Cards

Creative Studio consumes source records; it does not own commercial behavior.

### Promotions

Once Promotion Engine V1 exists, Creative Studio may bind to a real promotion
record and display its approved rule/copy.

Until then, starter promotion concepts remain DRAFT/template material and must
not be represented as active discounts.

### Gift Cards

Creative Studio may design a Gift Card presentation/template.

It must never issue a redeemable card, create a balance or alter the Gift Card
ledger. Those belong to the future Gift Card domain.

## 23. Relationship to menu design/print

Menu print is a Creative Studio output backed by the canonical menu.

The owner selects:

- categories/products
- locale
- price display
- style/template
- logo/brand
- optional images
- A4/A5/table format

The system creates bound Product/Price layers. Price or product changes produce
the same freshness warning as other creative materials.

This avoids maintaining a separate print menu.

## 24. Handling existing Marketing PR #9

PR #9 is useful as a visual/information-architecture prototype but is based on
an older main and contains presentation-only starter catalogs.

Do **not** merge PR #9 as-is just to begin Creative Studio.

Implementation on `feature/creative-studio-v1` should:

1. start from current accepted `main`;
2. reuse/recreate the good Marketing shell/navigation concepts from PR #9;
3. preserve the clear Promotions / Gift Cards / Creative Studio / Analytics
   separation;
4. replace Creative Studio placeholders with source-backed V1 behavior;
5. keep unfinished Promotion/Gift Card behavior visibly non-operational;
6. close/supersede PR #9 only after its useful foundation behavior is present on
   the new branch.

## 25. Delivery milestones

Do focused tests during work; run one defined gate at each milestone.

### CS0 — contracts and persistence

- CreativeProject / Revision / Asset / Export schema
- DesignDocument versioned domain schema
- permissions
- repositories and tenant scope
- no editor yet

Gate: domain/schema/repository tests including cross-tenant denial.

### CS1 — manual layered editor

- Creative Studio library
- create/open/rename design
- format presets
- layer canvas
- text/image/shape/logo/QR
- move/resize/rotate
- layer list
- inspector
- undo/redo
- autosave/revisions
- responsive desktop/tablet

Gate: focused browser + persistence tests.

### CS2 — source bindings

- venue/brand/menu/product/price/QR bindings
- source picker
- stale-data detection
- update/keep workflow
- minimal printed menu and table QR card

Gate: price-change/source-revision tests + one print material journey.

### CS3 — export

- deterministic RenderSnapshot
- social PNG/WebP
- vector-oriented PDF
- print sizes/safe area/bleed
- export history

Gate: dimension/hash/PDF structure checks + visual fixtures; no pixel-perfect
brittle suite.

### CS4 — AI planner

- provider-neutral planner adapter
- structured plan/patch schemas
- compact AI conversation panel
- create design from instruction
- targeted edits
- strict server validation
- cost/usage records

Gate: provider mocked contract + one controlled live/sandbox acceptance if API
credentials are intentionally configured.

### CS5 — generated assets

- image provider adapter
- generate/edit image asset
- provenance/approval
- replace image without flattening design
- failure/retry behavior

Gate: provider mock + one intentionally billed acceptance sample, not dozens of
wasteful generations.

### CS6 — V1 acceptance

User journeys:

1. create social post from a real menu product;
2. AI makes it more minimal;
3. user edits text manually;
4. convert/adapt to Story;
5. create A4 poster;
6. create table QR card;
7. create A4/A5 menu from canonical menu;
8. change a product price and observe stale warning;
9. update the bound price and export;
10. export PNG + PDF;
11. verify Manager allowed / restricted staff denied;
12. verify another tenant cannot read asset/project/source ids.

Run `npm run check` once at milestone completion plus the Creative Studio gate.

Stop for review before merge.

## 26. Explicit V1 non-goals

- free-form Photoshop-class raster editing
- video editor
- direct Meta publishing
- automatic campaign activation
- autonomous posting
- loyalty
- Gift Card balance/issuance
- AI-created legal claims
- arbitrary fonts from the internet
- arbitrary external URL import
- real-time collaborative multi-user canvas
- full CMYK color-management/prepress suite
- complex multi-page magazine publishing

The architecture must allow these later without making them prerequisites.

## 27. Future evolution

Later additions can fit without replacing the core:

- linked locale variants
- multi-page menu/booklet
- reusable components/symbols
- advanced masking/path editing
- background removal
- image upscaling
- product-photo studio
- batch format adaptation
- campaign collections
- scheduled publishing
- Meta/Instagram connectors
- verified analytics attribution
- AI Marketing Agent
- brand consistency scoring
- template marketplace
- collaboration/comments
- professional CMYK/prepress service

## 28. Definition of done for Creative Studio V1

Creative Studio V1 is done when an Owner/Manager can create a source-backed
layered design, edit it manually or conversationally, bind trusted venue/menu/QR
data, safely detect source changes, and export a professional social image or
print PDF without leaving FlowGastronomie.

The AI must be optional, replaceable and unable to alter authoritative business
facts.

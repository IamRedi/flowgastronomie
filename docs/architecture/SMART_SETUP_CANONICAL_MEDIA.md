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

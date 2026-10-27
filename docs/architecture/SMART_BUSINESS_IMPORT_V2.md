# Smart Business Import V2

## Ownership and journey

`/app/{sq|de|en|it}/onboarding/business-import` provides Website / Files → Analyze
→ Review → Save Draft → Premium Preview. Owner/Manager authentication, active
membership and tenant/venue scope apply to every source, session and canonical
operation. SI0's active import resumes here, including navigation from the older
menu-only wizard. No guest credentials or tenant IDs from request bodies establish
staff authority.

The additive migration extends SI1 `ImportSession` with `businessData` and
`businessReceipt`, and `ImportSource` with source URL/method. Existing
`ImportItem`, `MenuCategory`, `Product`, variants, modifiers, `VenueWebsite`, SI2
`MediaAsset`/associations and `AuditEvent` remain authoritative. The shared SI1
product writer is reused. `Product.archivedAt` retains reverted additions and
their import references while excluding them from menus and editing. No second
catalog, image library, provisioning path or publication workflow exists.

## Discovery and evidence

- Public HTTPS HTML and Schema.org JSON-LD: identity, observed business type,
  address/contact, structured hours, social links, SEO, theme color, menu sections,
  products, prices and named offer variants. Common WordPress menu rows, Wix
  microdata and static tables have deterministic adapters.
- Relevant same-origin menu/contact/about links and linked PDF menus are crawled
  within a bounded queue. Text PDFs are read with PDF.js and conservative menu-row
  parsing. Uploaded PDF/JPEG/PNG/WebP reuse SI1 document inspection.
- Missing or contradictory prices/currencies remain unresolved. Taxes and
  allergens are never inferred. Multiple shifts, complex PDF layouts and unknown
  formats require correction or manual entry. A partially known week retains only
  its observed days; the website editor also preserves these partial hours.
- Business evidence records method, observed/unverified status, source ID/URL/hash,
  excerpt and nullable confidence. Menu fields retain SI1 per-field/page evidence;
  each item's original proposal includes its method/status and source-hash map.
  JSON-LD/HTML observations are distinguished from unverified AI proposals.
- Conflicting business values remain alternatives. Overlapping menu products
  remain separate review rows. Category names can share one proposed category;
  this never silently merges products. Review capacity retains the earliest valid
  rows and warns when more content requires another import.

## Network and renderer boundary

The API uses its own HTTPS transport, with TLS certificate/hostname verification
enabled and no inherited credentials, cookies, authenticated browser state or
proxy. URLs reject credentials, non-443 ports, non-HTTPS schemes and internal
names. All A/AAAA answers must be public. The chosen address is pinned in the
socket lookup, including Node's `all` lookup mode. Each redirect and resource
repeats validation; cross-origin redirects require a separate authorized import.
IPv4 variants, mapped/transition IPv6, loopback, private, link-local, metadata,
multicast and special-use networks are rejected before transport.

Robots authorization precedes page fetches, with crawler-specific groups,
decoded path checks and conservative wildcard handling. Missing robots (404/410)
allows ordinary public fetches; policy failures, forbidden paths, login errors,
CAPTCHA and reuse restrictions produce manual fallback. `noai`, `noindex`,
`noarchive` and `none` directives prevent automated reuse. Compressed transfers
are rejected. Response size, concurrent byte reservations, redirects, DNS and
total time are bounded. Interrupted transfers conservatively consume their byte
reservation. Source strings never become executable server actions or AI tools.

JavaScript rendering is optional and disabled unless
`BUSINESS_IMPORT_RENDERER_IMAGE` names a prebuilt immutable digest. Build the
reviewed worker with `docker build -t flow-import-renderer tools/import-renderer`
and use `docker image inspect flow-import-renderer --format '{{.Id}}'` as the
server-side setting. The trusted host needs a Docker runtime and kernel support
for Chromium user namespaces. Do not mount the Docker socket or host directories
inside the worker. Production installation is a separate operator action.

Each render runs as `pwuser`, network disabled, root filesystem read-only, all
outer capabilities dropped, no-new-privileges, bounded tmpfs, 768 MB, one CPU and
256 PIDs. Chromium's sandbox stays enabled. The checked-in Playwright seccomp
profile additionally allows `chroot` for Chromium's inner user-namespace sandbox;
it does not add an outer container capability. Same-origin GET scripts/CSS/JSON
pass through the parent's validated network broker. Other methods, WebSockets,
service workers, downloads, external CDN origins and images are denied. The
worker has no application secrets. Renderer failure retains readable HTML.

This follows the [Playwright Docker sandbox guidance](https://playwright.dev/docs/docker)
and Chromium's [user-namespace credential implementation](https://chromium.googlesource.com/chromium/src/sandbox/+/refs/heads/main/linux/services/credentials.cc).
The final gate runs the actual container; it does not substitute a DOM mock.

## Budgets and recovery

Server configuration lives in `businessImportLimits`, with invalid values rejected.

| Setting                           |    Default | Hard maximum |
| --------------------------------- | ---------: | -----------: |
| `BUSINESS_IMPORT_REQUESTS`        |         30 |           60 |
| `BUSINESS_IMPORT_PAGES`           |          8 |           15 |
| `BUSINESS_IMPORT_DEPTH`           |          2 |            3 |
| `BUSINESS_IMPORT_TOTAL_BYTES`     | 24,000,000 |   48,000,000 |
| `BUSINESS_IMPORT_FILE_BYTES`      | 10,000,000 |   10,485,760 |
| `BUSINESS_IMPORT_PAGE_BYTES`      |  1,000,000 |    2,000,000 |
| `BUSINESS_IMPORT_TIMEOUT_MS`      |     60,000 |      120,000 |
| `BUSINESS_IMPORT_REQUEST_MS`      |      8,000 |       15,000 |
| `BUSINESS_IMPORT_PROVIDER_MS`     |    150,000 |      150,000 |
| `BUSINESS_IMPORT_USER_PER_HOUR`   |         10 |           20 |
| `BUSINESS_IMPORT_TENANT_PER_HOUR` |         30 |           60 |

SI1 additionally bounds document input to four files/20 pages, 150 reviewed items,
20 created sessions per venue/day and three deliberate analysis attempts per
session. Sources persist within 30 records/48 MB per session. Review supports at
most 50 categories and 50 image candidates; media downloads are at most 5 MB.
Snapshot/revert is bounded to 1,000 canonical products and 500 categories.
Only one analysis per tenant runs at a time. Hourly accounting counts started
attempts, including cancelled attempts, under a tenant database lock.

Analysis has a 210-second outer deadline, a 240-second durable lease, 15-second
PDF decoding and 20-second renderer timeout. There is no automatic provider retry.
Server restart or lease expiration makes saved sources resumable; a deliberate
retry receives a new request key. Cancel invalidates the running claim before
aborting work. Late completion/failure from an old claim cannot cancel or commit
a newer attempt. Session creation, analysis replay, manual additions, commit and
restore have durable idempotency. Saved reviews survive reload; unsaved edits
remain browser-local and warn on leaving.

Sources and receipts are private database records backed up with PostgreSQL.
This change does not introduce automatic source purging: retention/legal-hold
operations must continue treating these as tenant business records. Raw HTML is
served only as an authenticated attachment with restrictive content headers.

## Review, canonical commit and restore

All proposed field types need a decision. Owners correct or reject fields, review
prices, variants/modifiers and human-approved allergens, and choose ADD/UPDATE/SKIP.
UPDATE requires an exact unpublished, unarchived target. Prices and configuration
require separate explicit approval; duplicate candidates require acknowledgement.
Photos start as metadata-only candidates. Rights confirmation precedes downloading
through the network boundary; SI2 stores immutable bytes/hashes and provenance.
Reapproving a private imported original creates a new approval record linked to
the original. DEMO/GENERATED provenance cannot be relabelled into real photography.
Product PRIMARY/GALLERY and venue LOGO/HERO/GALLERY use the existing associations.

The transaction locks setup, website and canonical media, checks active authority,
website entitlement, session version and a hash of the canonical snapshot, then
writes only approved fields. Before/after snapshots, source references and audit
events are committed with the canonical changes. A failure rolls back all catalog,
website and association writes. Existing publication revisions remain intact;
V2's private composite receipt provides its controlled restore. Publication is
still performed by the existing website/menu workflow. An already published
website must be deliberately unpublished before this import can commit.

New products/categories stay unpublished; products are unavailable. Existing draft
updates retain tax category and do not rewrite order snapshots. Source text is
copied as a clearly documented four-locale fallback, not claimed as translated
copy. All nine premium families and GENERIC, each with three styles, use the same
canonical preview. Profile changes are allowed only for single-venue tenants;
a shared multi-venue profile must be managed separately.

Restore requires the exact unchanged after-snapshot, an unchanged set of tenant
venues (tracked through an opaque revision), no affected published products
and no affected order usage. It restores updated products/configuration, approved
website fields, profile and media associations, and archives newly added products.
New empty draft categories, immutable originals, canonical IDs and receipts remain
as history. Changed, published or used data blocks restore. On canonical conflict,
reload retains saved corrections and resets approvals against the new snapshot.

## Optional AI and known limits

The existing provider-neutral `MenuExtractionProvider` accepts only unresolved
documents. Output is schema/evidence validated and unverified until human review;
malformed output, timeout and cancellation cannot write canonical records.
Request key, call count, provider/model, source hashes and returned usage are
retained. `BUSINESS_IMPORT_ALLOW_PAID_AI=false` is the default even when an existing
SI1 provider key is present. Enabling it requires separate cost authorization.
No paid calls were used for acceptance. Existing optional reviewed website-copy
assistance remains available separately; this change does not claim real OCR or
translation accuracy or generate descriptions automatically.

Arbitrary websites, authenticated pages, cross-origin CDNs, scanned/complex menus
without an authorized provider and multi-shift hours are not guaranteed imports.
Unavailable information stays unresolved with manual entry. This is deliberately
more conservative than executing source instructions or guessing business facts.

See acceptance and screenshot evidence.

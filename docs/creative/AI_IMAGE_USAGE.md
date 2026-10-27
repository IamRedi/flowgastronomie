# AI image providers and usage

## Existing flow

Product Photo and Website section image editors use a stable scoped Creative
project and durable CreativeJob history. Creative Studio stores uploaded and
generated CreativeAssets, previews them, and requires explicit public-use
approval. Promotion creates a new canonical MediaAsset; the original remains
unchanged. Product and Website images use the same approval/promotion path.
The layered Creative document retains editable copy, prices, logo and QR.

## Configuration

Set server-side `CREATIVE_OPENAI_API_KEY`, `CREATIVE_FAL_API_KEY` and/or
`CREATIVE_IDEOGRAM_API_KEY`. The existing Meta selector now routes ONLY through
fal.ai Muse Image with `CREATIVE_FAL_API_KEY`; `CREATIVE_META_API_KEY` is a
historical direct API credential and is never used for this route. Revoke the
direct Meta key previously disclosed in tool output. Never place secret values
in Git, logs, chat, or the browser. The connected ChatGPT fal plugin does not
supply the application's server key.

fal endpoints: `meta/muse-image/text-to-image` and
`meta/muse-image/edit` via `https://fal.run/`. Both return a private data URI
with `sync_mode: true`, consumed in-process and normalized into the existing
canonical private asset storage. No additional image storage is introduced.
Both modes have an estimated price of $0.01 per returned image (subject to
provider pricing). A missing fal key disables Meta; the direct Meta API is
NEVER silently selected as a fallback. The model is recorded as
`muse-image-1.0-via-fal`; `provider=meta` stays the same for the current
tenant quota, image provenance, approval and administration. No automatic
retry of paid calls is made. The existing `CREATIVE_IMAGE_MODEL` controls
OpenAI only, while Ideogram stays pinned to `ideogram-4-5` medium.

The platform-only view is `/app/sq/platform/ai-usage` (replace `sq` with
`de`, `en` or `it`). Set both `PLATFORM_ADMIN_TENANT_ID` and
`PLATFORM_ADMIN_USER_ID` to the exact existing authenticated Owner identity on
the API server. If either is empty, access is denied. Changes also require the
configured `WEB_ORIGIN`. No business Owner can see another business through the
tenant image routes. The view displays provider attempts, limits, estimated
cost, history and status; it can set a limit to 0, enable/disable individual
providers and toggle the global emergency stop. It is the initial platform AI
control surface because no pre-existing central finance panel was found in the
current release source. It does not modify subscriptions, credits or payments.

## Quotas and accounting

One new CreativeJob image attempt reserves one unit in a PostgreSQL transaction
before a provider request. Counting is tenant-wide across venues, Product Photo,
Website AI images and Creative Studio. The UTC calendar month is computed from
timestamps; no reset job runs. Default limits are Meta 100, OpenAI 30, Ideogram 30. Overrides are per tenant/provider. The existing 10 image attempts per
rolling 24 hours and minute guards also apply. A replay of the same request key
returns its completed asset or its recorded uncertain/conflict state, without a
second provider call. Different content with a reused key conflicts.

Job state is distinct from provider outcome. A completed provider response may
still fail local validation/storage and retain its cost estimate. An ambiguous
timeout is UNCERTAIN; the interface tells the user to inspect history before
explicitly requesting a new variant. Provider expenses are USD estimates in
usage metadata, not invoices. Missing OpenAI usage details remain unknown.

Price catalog as verified on 23 October 2026:

- [Meta Muse Image via fal pricing](https://fal.ai/models/meta/muse-image/edit/api):
  $0.01 per returned image, deducted from fal.ai prepaid credits. The owner
  purchases credits and creates a separate fal API key outside of this repo.
- [Ideogram 4.5 API pricing](https://ideogram.ai/models/4.5):
  medium generation or Precise Edit $0.06 per image. Low and high differ; the
  implementation fixes medium.
- [OpenAI GPT Image 2.5 Flare pricing](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare):
  text input $5, image input $8 and image output $30 per million tokens at
  Standard rates. Cost depends on reported usage. Change the pure price catalog
  after provider price revisions; the historical estimate is kept with each job.

The adapter contracts follow [fal Muse generation](https://fal.ai/models/meta/muse-image/text-to-image/api),
[fal Muse editing](https://fal.ai/models/meta/muse-image/edit/api),
[Ideogram generation](https://developer.ideogram.ai/api-reference/images/generate/ideogram-4-5)
and [Ideogram Precise Edit](https://developer.ideogram.ai/api-reference/images/precise-edit/ideogram-4-5).
fal Muse receives aspect ratio rather than exact dimensions. Ideogram Precise
Edit returns the source dimensions. The saved metadata records actual dimensions;
the OpenAI exact-output check is retained.

## fal.ai rollout notes

The Meta selector is disabled until `CREATIVE_FAL_API_KEY` exists on the server.
Use the same root-owned `/etc/flowgastronomie-public/production.env` and the
existing Compose release flow; only the affected API/web services may require
recreation. No database migration or new UI is required for this routing.
Keep Ideogram running and preserve backup/rollback. Confirm the paid fal account
credit balance separately: ChatGPT's connected fal app and the VPS API credential
are distinct connections. Never enable direct Meta fallback while its account is
blocked or its old key is exposed. One user-approved capped real request may
confirm routing after the prepaid credit arrives.

## Activation boundary

The additive migration creates only image limit/control state and a job request
fingerprint. Apply it in a reviewed staging or production release, never against
live data as part of local development. Provider keys, paid test calls and
production activation require the owner's separate cost and release approval.
Mock tests do not incur provider cost.

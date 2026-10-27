> Historical evidence, superseded on 2026-10-09. Real-client preprovisioning,
> local pilot credentials and client-specific preview paths are retired. Use
> registration and synthetic acceptance.
> Commands or client defaults below describe the earlier milestone only.

# Authenticated restaurant visual system

Dashboard, Counter, Orders, Kitchen and menu editing share a premium trattoria
palette scoped to `.pilot-app-shell` in `globals.css`. Public pilot pages,
API/domain/database, permissions, payments, receipts and workflow are unchanged.

## Visual language

`--restaurant-*` tokens define cream, paper, dark/muted olive, parchment,
terracotta, espresso, secondary text, border, surface and shadow. Georgia is used
for editorial headings; Arial/Helvetica for operational content, controls,
product names and tabular prices. No external font requests or animation are
introduced. The compact platform header remains title + RF/RestaurantFlow.

The deep olive sidebar retains the original local pilot logo/name/city, route
defaults, manual state, hidden scrollbars and mobile drawer. Selection uses a
quiet light olive pill and parchment edge. Light popovers keep dark text and
keyboard focus remains visible on both light and dark surfaces.

Cream backgrounds combine visible, gentle olive/beige/terracotta gradients.
Custom olive/wheat line art spans 120–210px corner areas at 8.5–9% opacity;
an organic SVG shape supplies a soft parchment wash. Cards remain opaque,
including kitchen tickets and editor forms. Reading strips mask decoration
behind category labels and the dashboard footer. Decorations have no DOM
semantics, pointer interaction or animation and disappear in print/forced colors.

## Product media

POS cards reserve a 4:3 media region, then show a sans-serif name, tabular price
and circular add affordance. The entire card is the existing accessible button
(well above 44px); there is no nested button or change to configuration/cart flow.
The selected state reflects the cart as before. Failed or missing photography
falls back to a lightweight inline SVG place setting, glass or dessert.

`resolveProductImage` looks up approved local WebP/AVIF paths by
`tenantId/venueId/productId`, then considers the explicit local demo registry.
To install a confirmed photograph, place an optimized asset in `public`, add its
exact ownership/product key to `approvedProductImages`, and review the crop.
No schema/API additions or name-based image guesses are needed. Approved images
take precedence and never receive a demo badge.

The repository had no genuine pilot food photographs. Eight generated raster
illustrations are restricted to the existing local demo guard, with a localized
notice and badge. Production and other venues get the elegant fallback until
approved photography is supplied. See asset provenance and complete prompts.

## Responsive behavior and verification

Desktop/tablet use an efficient image grid with independently scrolling catalog
and cart items; totals/submission remain in the visible cart footer. Mobile uses
two columns, a bounded scrolling catalog and the order panel immediately below.
No horizontal page overflow or oversized full-width food images are introduced.
The menu editor retains current-language-first fields, collapsed translations,
one-click copying and compact variants.

- `npm run test:pilot -- navigation.spec.ts panel-refinement.spec.ts panel-flow-fixture.spec.ts restaurant-visual.spec.ts`
- the pilot public regression spec guards the unchanged public surface.
- `npm run test:e2e -- pilot-pos-ui.spec.ts menu-editor.spec.ts` uses the configured disposable regression database and real save/reload endpoints.
- `npm run check` covers formatting, typechecks, unit tests and builds.

Image resolver unit tests cover explicit demo gating, tenant/venue isolation and
approved-image precedence. The visual browser review checks media loading,
failed-image fallback, overflow and visible desktop submission. Existing checks
cover touch/navigation/dialog focus and CASH/CARD-to-receipt UI contracts.

Before/after review: screenshots.
Original PNGs and a local side-by-side HTML review are under the ignored
`artifacts/restaurant-redesign/`. Baseline: `6a928f3`. Dashboard/Orders data is
live and may change between captures; Kitchen tickets are explicitly labeled
read-only fixtures. UI contract payment tests intercept writes; the separate
E2E run verifies real isolated persistence.

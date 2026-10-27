# Compact menu editor

Category, product, variant, modifier group and option editors show the current
panel language first (SQ, EN, DE or IT). This is an editing preference derived
from the route, not a change to the venue's language settings or guest menu.

The other three languages remain mounted inside the native **Translations**
disclosure. Closing it retains every value. Existing translations are never
replaced automatically. **Copy primary text to all languages** explicitly
replaces names and, for products, descriptions in all four languages. It works
without opening translations and announces completion to assistive technology.
This makes repeated labels such as “30 cm” a single entry plus one click.

Required translated names still participate in native form validation. Invalid
hidden fields open the disclosure and receive focus. Variants keep name, price
adjustment, availability and default selection together in a compact card.
Editing one variant only changes that row; selecting the default updates the
radio group, and adding a variant retains the current default.

Sidebar and mobile drawer scrollbars are visually hidden; scrolling, focus,
keyboard navigation, Escape and focus return remain available. Horizontal
overflow is contained in both navigation surfaces.

## Verification

`npm run test:e2e -- tests/e2e/menu-editor.spec.ts` runs against the configured
E2E database. Use a disposable local database, as the test creates unpublished
categories/products. It checks real create/save/reload for products, independent
variants and modifier options at 1366×768, 1024×768 (expanded sidebar) and
390×768; all four primary locales;
collapsed validation; translated values retained after closing; keyboard
disclosures; and desktop/mobile scrolling with no visible scrollbars.

Screenshots are untracked under `artifacts/menu-editor/`. `npm run check` is the
format, type, unit-test and production-build gate. API payloads, persistence,
permissions, pricing and publishing rules are unchanged.

# POS overlay ownership

The POS owns one discriminated presentation state: closed, Register, Hardware,
product configuration, or checkout. Register's data/form state stays mounted,
while its dialog visibility is controlled by the POS. An asynchronous accepted
order replaces any open tool/configuration dialog. A late tool-close callback
only closes its own overlay kind.

All four surfaces use `PilotDialog` and native `showModal()`. Native top-layer
placement escapes the cart's sticky/scrolling/border-radius clipping while
preserving inherited restaurant tokens. No portal, absolute tool dropdown or
increased z-index is required. Page and ordinary shell popovers stay below the
native modal/backdrop; background controls are inert. Legacy full-screen
`.pos-confirmation`, `.pos-config-overlay`, standalone `.pos-config` container
and absolute `.pos-secondary-content` rules have been removed.

Dialogs remain centered and bounded by the viewport, with internal scrolling.
Tool dialogs are at most 480px wide; the existing product/checkout dialog width
is retained. The same responsive dialog works on desktop, tablet and mobile.

POS dialogs close with X, Escape or a pointer gesture that both starts and ends
on the backdrop. Clicking blank content or dragging out of a field does not
dismiss the dialog. The shared dialog's backdrop dismissal is opt-in, so other
workspaces keep their existing dismissal behavior. Keyboard focus remains inside
the modal and returns to the tool/product trigger on close.

Checkout is one dialog throughout accepted order, CASH/CARD entry and receipt
result. `CounterPayment` retains its existing request, validation, idempotency
and hardware/receipt behavior. Its receipt heading receives focus when payment
controls disappear. On checkout dismissal, focus moves to the New order heading:
the original submit button is disabled because the accepted cart has been cleared.
Closing an unpaid confirmation still leaves the existing order available in
Orders; no payment is implied by closing a dialog.

## Verification

- `npm run test:pilot -- pos-overlays.spec.ts panel-refinement.spec.ts navigation.spec.ts panel-flow-fixture.spec.ts`
- `npm run test:e2e -- counter-receipt.spec.ts hardware-bridge.spec.ts pilot-operational-flow.spec.ts pilot-pos-ui.spec.ts`
- `npm run check`

The new local browser scenarios cover 1366×768, 1024×768, touch tablet 1180×820,
and touch mobile 390×844. They assert viewport bounds, inert background, keyboard
containment, focus restoration, X/Escape/backdrop dismissal, and exactly one open
dialog across Register, Hardware, configuration, accepted order, CASH/CARD and
receipt. A delayed order response deliberately arrives while Register is open.
Receipt rendering must retain the same checkout dialog DOM node. All operational
writes in these local scenarios are intercepted; real register, payment, receipt
and simulator persistence is verified separately in the disposable E2E database.

Desktop and mobile screenshots use these
clearly named overlay fixtures. They do not represent actual payments.

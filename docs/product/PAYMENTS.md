# Merchant-owned online payments

## Status

**Planned after the Commercial V1 release gate; not implemented and not enabled
in production.** RestaurantFlow currently accepts online pickup, delivery, and
catering requests without collecting payment details. It records only manual
at-table payment reconciliation and is not a fiscal POS.

This document is the product and implementation boundary for the future online
payment module. It is a delivery plan, not German legal or tax advice. A German
payments/fiscal adviser must approve the selected provider flow and the live
venue responsibilities before activation.

## Product decision

RestaurantFlow is a SaaS platform, not the seller of a restaurant's food and
not the holder of its guest-payment funds.

For online payments, each restaurant must connect and operate its own payment
provider account. The intended first provider is Stripe Connect with a hosted
Stripe checkout surface. The restaurant remains the merchant for its menu,
fulfilment, taxes, refunds, disputes, and customer contract. RestaurantFlow
charges the restaurant only its separate SaaS subscription.

```text
Guest -> restaurant website/order -> hosted provider checkout
                                      |
                                      v
                             restaurant provider account
                                      |
                                      v
                           settlement, refund, dispute handling

RestaurantFlow: order software, webhook verification, operational status only
```

The final Connect charge type and contract configuration must be selected with
Stripe and legal counsel. It must preserve the above boundary: no RestaurantFlow
account receives, pools, transfers, or settles restaurant guest funds.

## Responsibilities

| Area                                                         | Restaurant                                    | RestaurantFlow                                                                        |
| ------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Menu, food, allergens, delivery and guest contract           | Owner and responsible party                   | Provides configurable software only                                                   |
| Prices, VAT, delivery fee, invoice/receipt and fiscal duties | Owner and responsible party                   | Preserves order/payment integration records only as agreed                            |
| Stripe onboarding and payout account                         | Owns and completes account verification       | Guides the connection; never obtains bank or card secrets                             |
| Card data                                                    | Must not receive or store it                  | Must not receive or store it                                                          |
| Refunds and chargebacks                                      | Decides and carries commercial responsibility | Offers a restricted operational action only after provider confirmation               |
| Guest order/contact data                                     | Controller for restaurant fulfilment          | Processor or independent controller only where documented by the applicable agreement |

The restaurant's public website must present its own legal identity, ordering
terms, privacy notice, delivery terms, final price including delivery charges,
and required food information. Germany's general provider-information duty is
in [DDG §5](https://www.gesetze-im-internet.de/ddg/__5.html); final-price and
delivery-cost disclosure for distance sales is defined in
[PAngV §§3 and 6](https://www.gesetze-im-internet.de/pangv_2022/BJNR492110021.html).
The restaurant must obtain its own German legal and tax review, including the
applicability of KassenSichV/TSE and record-retention duties. A card payment
does not by itself settle that question.

## Non-negotiable technical rules

- Use provider-hosted Checkout or provider-hosted components. Browser or API
  code must never handle raw PAN, CVV, or card expiry values.
- Store only provider-safe identifiers needed for support and reconciliation:
  connected-account ID, payment/checkout ID, provider event ID, amount,
  currency, payment status, and timestamps. Never store card data or bank
  credentials.
- Webhook signature verification, event-idempotency, tenant/venue ownership,
  amount/currency matching, and an auditable state transition are mandatory.
- A browser redirect is not payment proof. Only a verified provider webhook may
  persist a successful, failed, refunded, or disputed payment state.
- Payments require a distinct entitlement. Disabling it blocks new checkout
  sessions but preserves historical order and provider-reference records.
- The payment adapter stays outside `packages/domain`; pure domain rules may
  model payment state but cannot import Stripe, Fastify, Prisma, or browser code.
- Provider secrets and webhook signing secrets remain server-side. Logs, audit
  metadata, URLs, analytics, and support exports must not contain payment or
  card data.

Stripe states that Checkout/Elements integrations support PCI validation, but
PCI compliance remains a shared responsibility. See Stripe's
[security guide](https://docs.stripe.com/security/guide?locale=de-DE) and
[service agreement](https://stripe.com/de/legal/ssa/gr).

## Delivery sequence and acceptance gates

### Gate 0 — legal and commercial approval

Before coding or enabling a venue:

1. Confirm the restaurant's merchant-of-record, Stripe connected-account,
   refund, dispute, invoice, VAT, consumer-information, GDPR/DPA, and
   subprocessor responsibilities.
2. Obtain written German tax/fiscal assessment for the proposed online-payment
   and in-venue order flow, including KassenSichV/TSE and retention boundaries.
3. Confirm Stripe's current Connect availability, chosen charge configuration,
   prohibited-business policy, onboarding/KYC responsibility, and supported
   payment methods for the pilot.
4. Approve customer-facing legal/checkout copy in German and retain the review
   record outside the source repository.

### Gate 1 — provider boundary

- Define a provider-neutral `PaymentProvider` application interface.
- Connect one restaurant account through an Owner-only flow.
- Create a checkout session only from a server-recalculated, tenant-scoped
  immutable order snapshot.
- Show a pending-payment state; do not begin paid fulfilment from a client
  redirect.
- Verify signed webhooks and persist every event exactly once.

### Gate 2 — operational lifecycle

- Model `PENDING`, `SUCCEEDED`, `FAILED`, `REFUNDED`, and `DISPUTED` payment
  outcomes separately from order/production status.
- Allow only authorized restaurant roles to request refunds; update the local
  state only from a verified provider result.
- Provide venue-scoped reconciliation of provider-safe totals without claiming
  fiscal accounting or creating a fiscal receipt.

## Provider-neutral contract proposal

This is a proposal only; it must not be implemented before Gate 0.

```ts
type PaymentProvider = {
  createHostedCheckout(input: {
    tenantId: string;
    venueId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ providerCheckoutId: string; redirectUrl: string }>;
  verifyWebhook(input: {
    signature: string;
    payload: Uint8Array;
  }): Promise<VerifiedPaymentEvent>;
  requestRefund(input: {
    providerPaymentId: string;
    amountMinor?: number;
  }): Promise<void>;
};
```

`VerifiedPaymentEvent` must contain only a provider event ID, the restaurant's
connected-account ID, provider payment ID, immutable amount/currency and one
normalized outcome. The application first resolves every referenced order and
connected account inside the current tenant/venue, then records an idempotent
event. The provider client, signing secret and raw payload remain server-side.

```text
NOT_STARTED -> PENDING -> SUCCEEDED
                   |          |\
                   v          | +-> REFUNDED
                 FAILED        +----> DISPUTED
```

This lifecycle is independent from `NEW -> ACCEPTED -> PREPARING -> READY ->
SERVED`; a paid order may still be cancelled and a fulfilment state never
proves payment.

## Webhook test matrix and migration sequence

| Case                       | Required assertion                                          |
| -------------------------- | ----------------------------------------------------------- |
| Valid event                | Exact tenant/venue/order/account and amount/currency match. |
| Duplicate event            | One persisted event and no repeated side effect.            |
| Forged signature           | Rejected before parsing or persistence.                     |
| Out-of-order event         | Cannot regress a terminal payment state.                    |
| Cross-tenant account/order | Rejected without disclosure.                                |
| Redirect without webhook   | Remains `PENDING`.                                          |
| Refund/dispute             | Status changes only after verified provider result.         |

After Gate 0, migrations must be forward-only: provider connection first,
then payment record/event tables with tenant and venue scope, unique provider
event IDs, immutable order amount/currency snapshots and indexes for scoped
reconciliation. They must never alter existing manual at-table payment records.
Fixtures begin with signed synthetic payloads and a fake provider; provider SDK,
database tables, checkout routes and payment UI remain prohibited until the
approved implementation slice.

### Gate 3 — production evidence

- Test another tenant's connected account, order, webhook, or refund cannot be
  accessed or used.
- Test duplicated, delayed, forged, and out-of-order webhooks.
- Test price, currency, delivery-fee, refund, cancellation, and failure paths.
- Complete a controlled live payment/refund/dispute exercise using the selected
  pilot account and retain the outcome in the release record.
- Complete accessibility and mobile checkout hand-off tests without exposing
  payment data in support logs or browser telemetry.

## Explicit exclusions

- RestaurantFlow does not become a wallet, marketplace, escrow service, payout
  manager, acquirer, or merchant of record for restaurant food sales.
- German fiscal POS/TSE, DSFinV-K, tax reporting, accounting exports, and
  electronic fiscal receipts remain a separately enabled, legally reviewed
  country module.
- The initial payment module does not include saved cards, split payments,
  subscriptions paid by guests, tips, cash-on-delivery reconciliation, or
  multi-venue settlement.

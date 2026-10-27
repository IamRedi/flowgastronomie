"use client";

import {
  SERVICE_MODE_CAPABILITIES,
  type GuestServiceRequest,
  type PublicMenu,
} from "@flowgastronomie/domain";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";

type GuestCredentials = {
  sessionId: string;
  guestToken: string;
};

type Feedback = {
  tone: "success" | "error";
  message: string;
};

type Properties = {
  categories: PublicMenu["categories"];
  currency: string;
  labels: Dictionary["menuPage"];
  locale: Locale;
  qrToken: string;
  serviceMode: PublicMenu["table"]["serviceMode"];
  staffOrder: boolean;
};

function formatPrice(amount: number, currency: string, locale: Locale) {
  const numberLocale: Record<Locale, string> = {
    // Chromium and Node currently disagree on Albanian EUR placement. German
    // uses the same decimal/currency convention and keeps SSR deterministic.
    sq: "de-DE",
    en: "en-GB",
    de: "de-DE",
    it: "it-IT",
  };
  return new Intl.NumberFormat(numberLocale[locale], {
    style: "currency",
    currency,
  }).format(amount / 100);
}

export function GuestMenuClient({
  categories,
  currency,
  labels,
  locale,
  qrToken,
  serviceMode,
  staffOrder,
}: Properties) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [variantSelections, setVariantSelections] = useState<
    Record<string, string>
  >({});
  const [modifierSelections, setModifierSelections] = useState<
    Record<string, string[]>
  >({});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [staffAvailable, setStaffAvailable] = useState(false);
  const credentials = useRef<GuestCredentials | null>(null);
  const capabilities = SERVICE_MODE_CAPABILITIES[serviceMode];
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  useEffect(() => {
    if (staffOrder) return;
    void fetch(`${apiUrl}/v1/staff/me`, { credentials: "include" }).then(
      (response) => setStaffAvailable(response.ok),
      () => setStaffAvailable(false),
    );
  }, [apiUrl, staffOrder]);

  const products = useMemo(
    () => categories.flatMap((category) => category.products),
    [categories],
  );
  const cartItems = products
    .map((product) => ({ product, quantity: quantities[product.id] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const cartCount = cartItems.reduce((total, item) => total + item.quantity, 0);
  function selectedVariant(product: (typeof products)[number]) {
    const selectedId = variantSelections[product.id];
    return (
      product.variants.find((variant) => variant.id === selectedId) ??
      product.variants.find(
        (variant) => variant.isDefault && variant.available,
      ) ??
      product.variants.find((variant) => variant.available)
    );
  }

  function configuredPrice(product: (typeof products)[number]) {
    const variantDelta = selectedVariant(product)?.priceDeltaMinor ?? 0;
    const selectedOptions = modifierSelections[product.id] ?? [];
    const optionDelta = product.modifierGroups
      .flatMap((group) => group.options)
      .filter((option) => selectedOptions.includes(option.id))
      .reduce((total, option) => total + option.priceDeltaMinor, 0);
    return product.priceMinor + variantDelta + optionDelta;
  }

  function configurationValid(product: (typeof products)[number]) {
    const selected = modifierSelections[product.id] ?? [];
    return product.modifierGroups.every((group) => {
      const count = group.options.filter((option) =>
        selected.includes(option.id),
      ).length;
      return count >= group.minSelect && count <= group.maxSelect;
    });
  }

  const cartTotal = cartItems.reduce(
    (total, item) => total + configuredPrice(item.product) * item.quantity,
    0,
  );

  function changeQuantity(productId: string, change: number) {
    setFeedback(null);
    setQuantities((current) => {
      const next = Math.max(
        0,
        Math.min(20, (current[productId] ?? 0) + change),
      );
      return { ...current, [productId]: next };
    });
  }

  function toggleModifier(
    productId: string,
    optionId: string,
    groupOptionIds: string[],
    maxSelect: number,
  ) {
    setModifierSelections((current) => {
      const selected = current[productId] ?? [];
      if (selected.includes(optionId)) {
        return {
          ...current,
          [productId]: selected.filter((id) => id !== optionId),
        };
      }
      const selectedInGroup = selected.filter((id) =>
        groupOptionIds.includes(id),
      );
      const withoutGroup = selected.filter(
        (id) => !groupOptionIds.includes(id),
      );
      const nextGroup =
        maxSelect === 1
          ? [optionId]
          : [...selectedInGroup, optionId].slice(0, maxSelect);
      return { ...current, [productId]: [...withoutGroup, ...nextGroup] };
    });
  }

  async function ensureSession(): Promise<GuestCredentials> {
    if (credentials.current) return credentials.current;

    const response = await fetch(
      `${apiUrl}/v1/public/tables/${encodeURIComponent(qrToken)}/sessions`,
      { method: "POST" },
    );
    if (!response.ok) throw new Error("SESSION_FAILED");

    const session = (await response.json()) as GuestCredentials;
    credentials.current = session;
    return session;
  }

  async function submitOrder() {
    if (cartItems.length === 0 || busy) return;

    setBusy(true);
    setFeedback(null);

    try {
      if (staffOrder) {
        const [identity, work] = await Promise.all([
          fetch(`${apiUrl}/v1/staff/me`, { credentials: "include" }),
          fetch(`${apiUrl}/v1/staff/shift`, { credentials: "include" }),
        ]);
        const shift = work.ok
          ? ((await work.json()) as { shift: unknown | null }).shift
          : null;
        if (!identity.ok || !shift) {
          setFeedback({ tone: "error", message: labels.staffOrderAuthError });
          return;
        }
      }
      const session = await ensureSession();
      const response = await fetch(
        `${apiUrl}/v1/public/sessions/${encodeURIComponent(session.sessionId)}/orders`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-guest-token": session.guestToken,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            locale,
            items: cartItems.map(({ product, quantity }) => ({
              productId: product.id,
              quantity,
              ...(selectedVariant(product)
                ? { variantId: selectedVariant(product)?.id }
                : {}),
              modifierOptionIds: modifierSelections[product.id] ?? [],
            })),
          }),
        },
      );

      if (!response.ok) throw new Error("ORDER_FAILED");
      const order = (await response.json()) as {
        id: string;
        status: "NEW" | "ACCEPTED";
      };
      if (staffOrder) {
        const attribution = await fetch(
          `${apiUrl}/v1/staff/orders/${encodeURIComponent(order.id)}/tablet-attribution`,
          { method: "POST", credentials: "include" },
        );
        if (!attribution.ok) {
          setFeedback({ tone: "error", message: labels.staffOrderAuthError });
          return;
        }
      }
      setQuantities({});
      setFeedback({
        tone: "success",
        message: staffOrder
          ? labels.staffOrderLinked
          : `${labels.orderSent} ${
              order.status === "NEW"
                ? labels.orderStatusNew
                : labels.orderStatusAccepted
            }`,
      });
    } catch {
      credentials.current = null;
      setFeedback({ tone: "error", message: labels.error });
    } finally {
      setBusy(false);
    }
  }

  async function createServiceRequest(type: GuestServiceRequest) {
    if (busy) return;

    setBusy(true);
    setFeedback(null);

    try {
      const session = await ensureSession();
      const response = await fetch(
        `${apiUrl}/v1/public/sessions/${encodeURIComponent(session.sessionId)}/requests`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-guest-token": session.guestToken,
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ type }),
        },
      );

      if (!response.ok) throw new Error("REQUEST_FAILED");
      setFeedback({ tone: "success", message: labels.requestSent });
    } catch {
      credentials.current = null;
      setFeedback({ tone: "error", message: labels.error });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!staffOrder && staffAvailable && (
        <div className="staff-order-entry shell">
          <a
            href={`/${locale}/menu/${encodeURIComponent(qrToken)}?staffOrder=1`}
          >
            {labels.switchToStaffOrder}
          </a>
        </div>
      )}
      <section className="public-menu-content shell">
        {categories.map((category) => (
          <div className="public-category" key={category.id}>
            <h2>{category.name}</h2>
            <div className="public-product-grid">
              {category.products.map((product) => {
                const quantity = quantities[product.id] ?? 0;

                return (
                  <article
                    className={`public-product ${product.available ? "" : "is-sold-out"}`}
                    key={product.id}
                  >
                    <div className="product-visual" aria-hidden="true">
                      <span>✦</span>
                    </div>
                    <div className="public-product-copy">
                      <span
                        className={`availability ${product.available ? "available" : "sold-out"}`}
                      >
                        {product.available ? labels.available : labels.soldOut}
                      </span>
                      <h3>{product.name}</h3>
                      <p>{product.description}</p>
                      {product.allergens.length > 0 && (
                        <div
                          className="allergen-list"
                          aria-label={labels.allergens}
                        >
                          {product.allergens.map((allergen) => (
                            <span key={allergen}>
                              {labels.allergenLabels[allergen]}
                            </span>
                          ))}
                        </div>
                      )}
                      <strong>
                        {formatPrice(
                          configuredPrice(product),
                          product.currency,
                          locale,
                        )}
                      </strong>
                    </div>
                    {capabilities.canOrder && product.available && (
                      <div className="product-customization">
                        {product.variants.length > 0 && (
                          <label>
                            <span>{labels.chooseVariant}</span>
                            <select
                              onChange={(event) =>
                                setVariantSelections((current) => ({
                                  ...current,
                                  [product.id]: event.target.value,
                                }))
                              }
                              value={selectedVariant(product)?.id}
                            >
                              {product.variants.map((variant) => (
                                <option
                                  disabled={!variant.available}
                                  key={variant.id}
                                  value={variant.id}
                                >
                                  {variant.name}
                                  {variant.priceDeltaMinor
                                    ? ` (+${formatPrice(variant.priceDeltaMinor, product.currency, locale)})`
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {product.modifierGroups.map((group) => (
                          <fieldset key={group.id}>
                            <legend>
                              {group.name} ·{" "}
                              {group.minSelect > 0
                                ? labels.required
                                : `${labels.chooseUpTo} ${group.maxSelect}`}
                            </legend>
                            {group.options.map((option) => {
                              const checked = (
                                modifierSelections[product.id] ?? []
                              ).includes(option.id);
                              return (
                                <label key={option.id}>
                                  <input
                                    checked={checked}
                                    disabled={!option.available}
                                    name={`${product.id}-${group.id}`}
                                    onChange={() =>
                                      toggleModifier(
                                        product.id,
                                        option.id,
                                        group.options.map((entry) => entry.id),
                                        group.maxSelect,
                                      )
                                    }
                                    type={
                                      group.maxSelect === 1
                                        ? "radio"
                                        : "checkbox"
                                    }
                                  />
                                  <span>{option.name}</span>
                                  {option.priceDeltaMinor > 0 && (
                                    <small>
                                      +
                                      {formatPrice(
                                        option.priceDeltaMinor,
                                        product.currency,
                                        locale,
                                      )}
                                    </small>
                                  )}
                                </label>
                              );
                            })}
                          </fieldset>
                        ))}
                      </div>
                    )}
                    {capabilities.canOrder && product.available && (
                      <div className="quantity-control">
                        {quantity > 0 && (
                          <>
                            <button
                              aria-label={`${labels.decrease}: ${product.name}`}
                              onClick={() => changeQuantity(product.id, -1)}
                              type="button"
                            >
                              −
                            </button>
                            <strong aria-live="polite">{quantity}</strong>
                          </>
                        )}
                        <button
                          aria-label={`${labels.add}: ${product.name}`}
                          disabled={!configurationValid(product)}
                          onClick={() => changeQuantity(product.id, 1)}
                          type="button"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {capabilities.canRequestService && (
        <section className="guest-service-actions shell">
          <button
            disabled={busy}
            onClick={() => createServiceRequest("WAITER_CALL")}
            type="button"
          >
            {labels.waiterCall}
          </button>
          <button
            disabled={busy}
            onClick={() => createServiceRequest("WATER_REQUEST")}
            type="button"
          >
            {labels.waterRequest}
          </button>
          <button
            disabled={busy}
            onClick={() => createServiceRequest("BILL_REQUEST")}
            type="button"
          >
            {labels.billRequest}
          </button>
        </section>
      )}

      {feedback && (
        <div
          className={`guest-feedback ${feedback.tone}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </div>
      )}

      {capabilities.canOrder && cartCount > 0 && (
        <aside className="guest-cart" aria-label={labels.cart}>
          <div>
            <span>
              {labels.cart} · {cartCount}
            </span>
            <strong>
              {labels.total}: {formatPrice(cartTotal, currency, locale)}
            </strong>
          </div>
          <button disabled={busy} onClick={submitOrder} type="button">
            {busy ? labels.sending : labels.sendOrder}
          </button>
        </aside>
      )}
    </>
  );
}

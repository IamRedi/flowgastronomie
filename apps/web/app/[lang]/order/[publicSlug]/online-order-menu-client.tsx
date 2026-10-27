"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { formatCurrency } from "../../../../lib/format-currency";
import { rememberRecentOrder } from "../../../../lib/recent-order";
import { formatVenueTime } from "../../../../lib/venue-time";
import { orderingUxCopy } from "../../../../lib/ordering-ux-copy";
import {
  PickupTimePicker,
  type PickupChoice,
} from "../../../../components/pickup-time-picker";
import { TrackOrderEntry } from "../../../../components/track-order-entry";
import type { Locale } from "../../../../lib/i18n";

type Variant = {
  id: string;
  name: string;
  priceDeltaMinor: number;
  available: boolean;
  isDefault: boolean;
};
type ModifierOption = {
  id: string;
  name: string;
  priceDeltaMinor: number;
  available: boolean;
};
type ModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
};
export type Product = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  available: boolean;
  variants: Variant[];
  modifierGroups: ModifierGroup[];
};
export type Website = {
  venue: { name: string; currency: string };
  pickupEnabled?: boolean;
  deliveryEnabled?: boolean;
  cateringEnabled?: boolean;
  menu: Array<{ id: string; name: string; products: Product[] }>;
};
export type CartItem = {
  key: string;
  product: Product;
  quantity: number;
  notes?: string;
  variant: Variant | null;
  modifiers: Array<{ group: ModifierGroup; option: ModifierOption }>;
};
const text: Record<Locale, Record<string, string>> = {
  sq: {
    loading: "Po ngarkohet menuja…",
    missing: "Menuja online nuk është aktive.",
    cart: "Shporta",
    empty: "Shporta është bosh.",
    pickup: "Marrje në lokal",
    delivery: "Dërgesë",
    catering: "Catering",
    name: "Emri",
    phone: "Telefoni",
    email: "Email (opsional)",
    time: "Koha e kërkuar",
    address: "Adresa",
    postal: "Kodi postar",
    city: "Qyteti",
    guests: "Numri i të ftuarve",
    notes: "Shënim ose pyetje",
    send: "Dërgo porosinë",
    sending: "Po dërgohet…",
    total: "Totali",
    unavailable: "Nuk disponohet",
    add: "Shto",
    order: "Porosit online",
    choose: "Zgjidh opsionet",
    options: "Opsionet e produktit",
    confirm: "Shto në shportë",
    cancel: "Anulo",
    required: "Kjo zgjedhje është e detyrueshme.",
    remove: "Hiq",
    from: "Nga",
    requestError:
      "Porosia nuk u dërgua. Kontrollo të dhënat dhe provo përsëri.",
    closed: "Lokali nuk pranon porosi në këtë orë.",
    deliveryUnavailable:
      "Delivery nuk është i disponueshëm për këtë adresë ose total.",
  },
  en: {
    loading: "Loading menu…",
    missing: "Online ordering is not active.",
    cart: "Basket",
    empty: "Your basket is empty.",
    pickup: "Pickup",
    delivery: "Delivery",
    catering: "Catering",
    name: "Name",
    phone: "Phone",
    email: "Email (optional)",
    time: "Requested time",
    address: "Address",
    postal: "Postcode",
    city: "City",
    guests: "Guest count",
    notes: "Note or question",
    send: "Place order",
    sending: "Submitting…",
    total: "Total",
    unavailable: "Unavailable",
    add: "Add",
    order: "Order online",
    choose: "Choose options",
    options: "Product options",
    confirm: "Add to basket",
    cancel: "Cancel",
    required: "This selection is required.",
    remove: "Remove",
    from: "From",
    requestError:
      "The order could not be sent. Check your details and try again.",
    closed: "The restaurant is not accepting orders at this time.",
    deliveryUnavailable:
      "Delivery is not available for this address or order total.",
  },
  de: {
    loading: "Menü wird geladen…",
    missing: "Online-Bestellung ist nicht aktiv.",
    cart: "Warenkorb",
    empty: "Ihr Warenkorb ist leer.",
    pickup: "Abholung",
    delivery: "Lieferung",
    catering: "Catering",
    name: "Name",
    phone: "Telefon",
    email: "E-Mail (optional)",
    time: "Gewünschte Zeit",
    address: "Adresse",
    postal: "Postleitzahl",
    city: "Stadt",
    guests: "Anzahl Gäste",
    notes: "Notiz oder Frage",
    send: "Bestellung senden",
    sending: "Wird gesendet…",
    total: "Gesamt",
    unavailable: "Nicht verfügbar",
    add: "Hinzufügen",
    order: "Online bestellen",
    choose: "Optionen wählen",
    options: "Produktoptionen",
    confirm: "In den Warenkorb",
    cancel: "Abbrechen",
    required: "Diese Auswahl ist erforderlich.",
    remove: "Entfernen",
    from: "Ab",
    requestError:
      "Die Bestellung konnte nicht gesendet werden. Bitte Daten prüfen.",
    closed: "Das Restaurant nimmt zu dieser Zeit keine Bestellungen an.",
    deliveryUnavailable:
      "Lieferung ist für diese Adresse oder diesen Bestellwert nicht verfügbar.",
  },
  it: {
    loading: "Caricamento menu…",
    missing: "L'ordine online non è attivo.",
    cart: "Carrello",
    empty: "Il carrello è vuoto.",
    pickup: "Ritiro",
    delivery: "Consegna",
    catering: "Catering",
    name: "Nome",
    phone: "Telefono",
    email: "Email (facoltativa)",
    time: "Orario richiesto",
    address: "Indirizzo",
    postal: "CAP",
    city: "Città",
    guests: "Numero ospiti",
    notes: "Nota o domanda",
    send: "Invia ordine",
    sending: "Invio…",
    total: "Totale",
    unavailable: "Non disponibile",
    add: "Aggiungi",
    order: "Ordina online",
    choose: "Scegli opzioni",
    options: "Opzioni prodotto",
    confirm: "Aggiungi al carrello",
    cancel: "Annulla",
    required: "Questa selezione è obbligatoria.",
    remove: "Rimuovi",
    from: "Da",
    requestError: "L'ordine non è stato inviato. Controlla i dati e riprova.",
    closed: "Il ristorante non accetta ordini in questo orario.",
    deliveryUnavailable:
      "La consegna non è disponibile per questo indirizzo o totale.",
  },
};
function itemPrice(item: Pick<CartItem, "product" | "variant" | "modifiers">) {
  return (
    item.product.priceMinor +
    (item.variant?.priceDeltaMinor ?? 0) +
    item.modifiers.reduce(
      (total, entry) => total + entry.option.priceDeltaMinor,
      0,
    )
  );
}
export function OnlineOrderMenuClient({
  locale,
  publicSlug,
  initialWebsite,
}: {
  locale: Locale;
  publicSlug: string;
  initialWebsite?: Website | undefined;
}) {
  const [website, setWebsite] = useState<Website | null>(
    initialWebsite ?? null,
  );
  const [loaded, setLoaded] = useState(!!initialWebsite);
  const [cart, setCart] = useState<CartItem[]>([]);

  const timingWords = orderingUxCopy[locale];
  const [pickupChoice, setPickupChoice] = useState<PickupChoice>({
    timingMode: "ASAP",
    requestedFor: "",
  });
  const [timingRefresh, setTimingRefresh] = useState(0);
  const [scheduledChoice, setScheduledChoice] = useState<PickupChoice>({
    timingMode: "SCHEDULED",
    requestedFor: "",
  });

  const [mode, setMode] = useState<"PICKUP" | "DELIVERY" | "CATERING">(
    "PICKUP",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productToConfigure, setProductToConfigure] = useState<Product | null>(
    null,
  );
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );
  const [selectedOptionIds, setSelectedOptionIds] = useState<
    Record<string, string[]>
  >({});
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const labels = text[locale]!;
  const requiredMessage = labels.required ?? "A required selection is missing.";
  const requestErrorMessage =
    labels.requestError ?? "The order could not be sent. Please try again.";
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `${apiUrl}/v1/public/websites/${encodeURIComponent(publicSlug)}?locale=${locale}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const data = response.ok ? ((await response.json()) as Website) : null;
        if (controller.signal.aborted) return;
        setWebsite(data);
        if (data && !data.pickupEnabled)
          setMode(data.deliveryEnabled ? "DELIVERY" : "CATERING");

        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoaded(true);
          setError(requestErrorMessage);
        }
      });
    return () => controller.abort();
  }, [apiUrl, locale, publicSlug, requestErrorMessage]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + itemPrice(item) * item.quantity, 0),
    [cart],
  );
  const price = (value: number) =>
    formatCurrency(value, website?.venue.currency ?? "EUR", locale);
  function addToCart(
    product: Product,
    variant: Variant | null,
    modifiers: CartItem["modifiers"],
    quantity = 1,
    notes = "",
  ) {
    const key = [
      product.id,
      variant?.id ?? "default",
      ...modifiers.map((item) => item.option.id).sort(),
      notes.trim(),
    ].join(":");
    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      return existing
        ? current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  quantity: item.quantity + quantity,
                }
              : item,
          )
        : [
            ...current,
            { key, product, quantity, variant, modifiers, notes: notes.trim() },
          ];
    });
  }
  function beginAdd(product: Product) {
    setError(null);
    const defaultVariant = product.variants.find(
      (variant) => variant.isDefault && variant.available,
    );
    if (product.variants.length === 0 && product.modifierGroups.length === 0) {
      addToCart(product, null, []);
      return;
    }
    setProductToConfigure(product);
    setSelectedVariantId(defaultVariant?.id ?? null);
    setSelectedOptionIds({});
  }
  function toggleOption(group: ModifierGroup, optionId: string) {
    setSelectedOptionIds((current) => {
      const selected = current[group.id] ?? [];
      const next = selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId];
      return { ...current, [group.id]: next };
    });
  }
  function confirmConfiguration() {
    if (!productToConfigure) return;
    const variant = productToConfigure.variants.find(
      (item) => item.id === selectedVariantId && item.available,
    );
    if (productToConfigure.variants.length > 0 && !variant) {
      setError(requiredMessage);
      return;
    }
    const modifiers: CartItem["modifiers"] = [];
    for (const group of productToConfigure.modifierGroups) {
      const selected = group.options.filter((item) =>
        (selectedOptionIds[group.id] ?? []).includes(item.id),
      );
      if (
        selected.length < group.minSelect ||
        selected.length > group.maxSelect ||
        selected.some((item) => !item.available)
      ) {
        setError(requiredMessage);
        return;
      }
      modifiers.push(...selected.map((option) => ({ group, option })));
    }
    addToCart(productToConfigure, variant ?? null, modifiers);
    setProductToConfigure(null);
    setError(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!website || cart.length === 0) return;
    const requestedFor =
      mode === "PICKUP"
        ? pickupChoice.requestedFor
        : scheduledChoice.requestedFor;
    const requestedDate = new Date(requestedFor);
    if (
      !(mode === "PICKUP" && pickupChoice.timingMode === "ASAP") &&
      Number.isNaN(requestedDate.getTime())
    ) {
      setError(requestErrorMessage);
      return;
    }
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `${apiUrl}/v1/public/online-orders/${encodeURIComponent(publicSlug)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            locale,
            idempotencyKey: crypto.randomUUID(),
            fulfillmentType: mode,
            contact: {
              name: data.get("name"),
              phone: data.get("phone"),
              email: data.get("email") || undefined,
            },
            ...(mode === "PICKUP"
              ? { timingMode: pickupChoice.timingMode }
              : {}),
            requestedFor:
              mode === "PICKUP" && pickupChoice.timingMode === "ASAP"
                ? undefined
                : requestedDate.toISOString(),
            deliveryAddress:
              mode === "DELIVERY"
                ? {
                    line1: data.get("address"),
                    postalCode: data.get("postal"),
                    city: data.get("city"),
                  }
                : undefined,
            cateringGuestCount:
              mode === "CATERING" ? Number(data.get("guests")) : undefined,
            guestNotes: data.get("notes") || undefined,
            items: cart.map((item) => ({
              productId: item.product.id,
              quantity: item.quantity,
              ...(item.notes ? { notes: item.notes } : {}),
              variantId: item.variant?.id,
              modifierOptionIds: item.modifiers.map((entry) => entry.option.id),
            })),
          }),
        },
      );
      const result = response.ok
        ? ((await response.json()) as {
            trackingToken: string | null;
            referenceCode: string;
          })
        : null;
      if (result?.trackingToken) {
        const destination = `/${locale}/order/track/${encodeURIComponent(result.trackingToken)}?venue=${encodeURIComponent(publicSlug)}${""}`;
        rememberRecentOrder(publicSlug, {
          referenceCode: result.referenceCode,
          destination,
        });
        window.location.assign(destination);
        return;
      }
      if (!response.ok) {
        const failure = (await response.json()) as {
          code?: string;
          availability?: {
            earliest: string | null;
            timezone: string;
          };
        };
        if (failure.code === "PICKUP_TIME_UNAVAILABLE") {
          setTimingRefresh((n) => n + 1);
          setError(
            failure.availability?.earliest
              ? `${timingWords.earliest}: ${formatVenueTime(locale, failure.availability.earliest, failure.availability.timezone)}`
              : timingWords.unavailable,
          );
          return;
        }
        setError(
          failure?.code === "ONLINE_ORDERING_UNAVAILABLE"
            ? (labels.closed ?? requestErrorMessage)
            : failure?.code === "DELIVERY_UNAVAILABLE"
              ? (labels.deliveryUnavailable ?? requestErrorMessage)
              : requestErrorMessage,
        );
        return;
      }
      setError(requestErrorMessage);
    } catch {
      setError(requestErrorMessage);
    } finally {
      setBusy(false);
    }
  }
  if (!loaded)
    return (
      <main className="online-order-page">
        <p>{labels.loading}</p>
      </main>
    );
  if (
    !website ||
    ![
      website.pickupEnabled,
      website.deliveryEnabled,
      website.cateringEnabled,
    ].some(Boolean)
  )
    return (
      <main className="online-order-page">
        <p>{labels.missing}</p>
      </main>
    );
  const checkout = (
    <>
      {<h2>{labels.cart}</h2>}
      {cart.length === 0 ? (
        <p>{labels.empty}</p>
      ) : (
        cart.map((item) => (
          <div className="online-cart-item" key={item.key}>
            <p>
              {item.quantity}× {item.product.name} ·{" "}
              {price(itemPrice(item) * item.quantity)}
            </p>
            {item.variant && <small>{item.variant.name}</small>}
            {item.modifiers.map(({ group, option }) => (
              <small key={option.id}>
                {group.name}: {option.name}
              </small>
            ))}
            {item.notes && <small>{item.notes}</small>}

            <button
              onClick={() =>
                setCart((current) =>
                  current.filter((entry) => entry.key !== item.key),
                )
              }
              type="button"
            >
              {labels.remove}
            </button>
          </div>
        ))
      )}
      <strong>
        {labels.total}: {price(total)}
      </strong>
      <form onSubmit={submit}>
        {
          <select
            onChange={(event) => setMode(event.target.value as typeof mode)}
            value={mode}
          >
            {website.pickupEnabled && (
              <option value="PICKUP">{labels.pickup}</option>
            )}
            {website.deliveryEnabled && (
              <option value="DELIVERY">{labels.delivery}</option>
            )}
            {website.cateringEnabled && (
              <option value="CATERING">{labels.catering}</option>
            )}
          </select>
        }
        <input
          name="name"
          aria-label={labels.name}
          placeholder={labels.name}
          required
        />
        <input
          name="phone"
          aria-label={labels.phone}
          placeholder={labels.phone}
          required
        />
        <input
          name="email"
          aria-label={labels.email}
          placeholder={labels.email}
          type="email"
        />
        {
          <PickupTimePicker
            locale={locale}
            publicSlug={publicSlug}
            apiUrl={apiUrl}
            value={mode === "PICKUP" ? pickupChoice : scheduledChoice}
            onChange={mode === "PICKUP" ? setPickupChoice : setScheduledChoice}
            fulfillmentType={mode}
            refresh={timingRefresh}
          />
        }
        {mode === "DELIVERY" && (
          <>
            <input
              name="address"
              aria-label={labels.address}
              placeholder={labels.address}
              required
            />
            <input
              name="postal"
              aria-label={labels.postal}
              placeholder={labels.postal}
              required
            />
            <input
              name="city"
              aria-label={labels.city}
              placeholder={labels.city}
              required
            />
          </>
        )}
        {mode === "CATERING" && (
          <input
            min="2"
            name="guests"
            aria-label={labels.guests}
            placeholder={labels.guests}
            required
            type="number"
          />
        )}
        <textarea
          name="notes"
          maxLength={500}
          aria-label={labels.notes}
          placeholder={labels.notes}
        />
        <button disabled={busy || cart.length === 0} type="submit">
          {busy ? labels.sending : labels.send}
        </button>

        {error && <p role="alert">{error}</p>}
      </form>
    </>
  );
  const configuration = productToConfigure ? (
    <section aria-label={labels.options} className="online-product-options">
      {<h2>{productToConfigure.name}</h2>}

      {productToConfigure.variants.length > 0 && (
        <fieldset>
          <legend>{labels.options}</legend>
          {productToConfigure.variants.map((variant) => (
            <label key={variant.id}>
              <input
                checked={selectedVariantId === variant.id}
                disabled={!variant.available}
                name="variant"
                onChange={() => setSelectedVariantId(variant.id)}
                type="radio"
              />
              {variant.name} (
              {price(productToConfigure.priceMinor + variant.priceDeltaMinor)})
            </label>
          ))}
        </fieldset>
      )}
      {productToConfigure.modifierGroups.map((group) => (
        <fieldset key={group.id}>
          <legend>
            {group.name}
            {group.minSelect > 0 ? " *" : ""}
          </legend>
          {group.options.map((option) => (
            <label key={option.id}>
              <input
                checked={(selectedOptionIds[group.id] ?? []).includes(
                  option.id,
                )}
                disabled={!option.available}
                onChange={() => toggleOption(group, option.id)}
                type="checkbox"
              />
              {option.name}
              {option.priceDeltaMinor
                ? ` (+${price(option.priceDeltaMinor)})`
                : ""}
            </label>
          ))}
        </fieldset>
      ))}

      <div className="online-option-actions">
        <button onClick={confirmConfiguration} type="button">
          {labels.confirm}
        </button>
        <button
          className="button-secondary"
          onClick={() => setProductToConfigure(null)}
          type="button"
        >
          {labels.cancel}
        </button>
      </div>
    </section>
  ) : null;

  return (
    <main className="online-order-page">
      <header>
        <a href={`/${locale}/venue/${publicSlug}`}>{website.venue.name}</a>
        <h1>{labels.order}</h1>
        <TrackOrderEntry locale={locale} publicSlug={publicSlug} />
      </header>
      <div className="online-order-layout">
        <section>
          {website.menu.map((category) => (
            <section className="online-category" key={category.id}>
              <h2>{category.name}</h2>
              {category.products.map((product) => (
                <article key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <p>{product.description}</p>
                    <span>
                      {product.variants.length > 0 ? `${labels.from} ` : ""}
                      {price(product.priceMinor)}
                    </span>
                  </div>
                  <button
                    disabled={!product.available}
                    onClick={() => beginAdd(product)}
                    type="button"
                  >
                    {product.available
                      ? product.variants.length > 0 ||
                        product.modifierGroups.length > 0
                        ? labels.choose
                        : labels.add
                      : labels.unavailable}
                  </button>
                </article>
              ))}
            </section>
          ))}
        </section>
        <aside>{checkout}</aside>
      </div>
      {productToConfigure && configuration}
    </main>
  );
}

"use client";
import { CatalogPhoto } from "../../../../components/catalog-photo";
import type { CanonicalMediaReference } from "@flowgastronomie/domain";

import {
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
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

import { PilotDialog } from "../../staff/pilot-dialog";
import { publicOrderCopy } from "../../../../lib/public-order-copy";
import { reconcilePreviewCart } from "../../../../lib/public-preview-cart";
import "../../../../components/public-ordering.css";

type Quote = {
  fingerprint: string;
  totalMinor: number;
  deliveryFeeMinor: number;
  currency: string;
  requestedFor?: string;
  timezone?: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    variantName: string | null;
    modifiers?: Array<{ optionName: string }>;
  }>;
};
type Pending = { body: string };
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
  media?: CanonicalMediaReference | undefined;
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
  render,
  onWebsiteChange,
}: {
  locale: Locale;
  publicSlug: string;
  initialWebsite?: Website | undefined;
  render?: (catalog: ReactNode, basket: ReactNode) => ReactNode;
  onWebsiteChange?: (website: Website) => void;
}) {
  const [website, setWebsite] = useState<Website | null>(
    initialWebsite ?? null,
  );
  const [loaded, setLoaded] = useState(!!initialWebsite);
  const [cart, setCart] = useState<CartItem[]>([]);

  const words = publicOrderCopy(locale);
  const [drawer, setDrawer] = useState(false);
  const [step, setStep] = useState<"basket" | "details" | "review">("basket");
  const [changed, setChanged] = useState(false);
  const [restored, setRestored] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [review, setReview] = useState<{ body: string; quote: Quote } | null>(
    null,
  );
  const [productNote, setProductNote] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const submitting = useRef(false);
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const onWebsiteRef = useRef(onWebsiteChange);
  onWebsiteRef.current = onWebsiteChange;
  const storageKey = `online-basket:v1:${publicSlug}`;
  const pendingKey = `online-pending:v1:${publicSlug}`;
  useEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
      if (
        value &&
        typeof value.body === "string" &&
        JSON.parse(value.body).idempotencyKey
      )
        setPending(value);
    } catch {
      /* An unreadable record is never submitted. */
    }
  }, [pendingKey]);
  useEffect(() => {
    if (!website || restored) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
      const result = reconcilePreviewCart(saved, website);
      setCart(result.items);
      setChanged(result.changed);
    } catch {
      /* No stored basket. */
    }
    setRestored(true);
  }, [website, restored, storageKey]);
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify(
          cart.map((item) => ({
            productId: item.product.id,
            variantId: item.variant?.id,
            optionIds: item.modifiers.map((m) => m.option.id),
            quantity: item.quantity,
            notes: item.notes ?? "",
            priceMinor: itemPrice(item),
          })),
        ),
      );
    } catch {}
    if (!cart.length && !pending) setDrawer(false);
  }, [cart, restored, storageKey, pending]);
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
    let active = false;
    async function refresh() {
      if (active || document.visibilityState === "hidden") return;
      active = true;
      try {
        const response = await fetch(
          `${apiUrl}/v1/public/websites/${encodeURIComponent(publicSlug)}?locale=${locale}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) {
          if (response.status === 404) setWebsite(null);
          return;
        }
        const data = (await response.json()) as Website;
        if (controller.signal.aborted) return;
        setWebsite(data);
        onWebsiteRef.current?.(data);
        setMode((current) =>
          (
            current === "PICKUP"
              ? data.pickupEnabled
              : current === "DELIVERY"
                ? data.deliveryEnabled
                : data.cateringEnabled
          )
            ? current
            : data.pickupEnabled
              ? "PICKUP"
              : data.deliveryEnabled
                ? "DELIVERY"
                : "CATERING",
        );
        if (cartRef.current.length && !pendingRef.current) {
          const saved = cartRef.current.map((item) => ({
            productId: item.product.id,
            variantId: item.variant?.id,
            optionIds: item.modifiers.map((m) => m.option.id),
            quantity: item.quantity,
            notes: item.notes,
            priceMinor: itemPrice(item),
          }));
          const result = reconcilePreviewCart(saved, data);
          if (result.changed) {
            setChanged(true);
            setReview(null);
            setStep("basket");
          }
          setCart(result.items);
        }
      } catch {
        if (!controller.signal.aborted) setError(requestErrorMessage);
      } finally {
        active = false;
        if (!controller.signal.aborted) setLoaded(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
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
    const key = crypto.randomUUID();
    setStep("basket");
    setReview(null);
    setDrawer(true);
    setCart((current) => {
      const existing = current.find(
        (item) =>
          item.product.id === product.id &&
          item.variant?.id === variant?.id &&
          (item.notes ?? "").trim() === notes.trim() &&
          JSON.stringify(item.modifiers.map((m) => m.option.id).sort()) ===
            JSON.stringify(modifiers.map((m) => m.option.id).sort()),
      );
      return existing
        ? current.map((item) =>
            item.key === existing.key
              ? {
                  ...item,
                  quantity: Math.min(20, item.quantity + quantity),
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
    if (pending) {
      setDrawer(true);
      return;
    }
    setProductNote("");
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
    addToCart(productToConfigure, variant ?? null, modifiers, 1, productNote);
    setProductToConfigure(null);
    setError(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !website || !cart.length || changed || pending)
      return;
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
    const data = new FormData(event.currentTarget);
    const body = JSON.stringify({
      locale,
      idempotencyKey: crypto.randomUUID(),
      fulfillmentType: mode,
      contact: {
        name: data.get("name"),
        phone: data.get("phone"),
        email: data.get("email") || undefined,
      },
      ...(mode === "PICKUP" ? { timingMode: pickupChoice.timingMode } : {}),
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
    });
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/public/online-orders/${encodeURIComponent(publicSlug)}/quote`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
      );
      if (!response.ok) {
        await showFailure(response);
        return;
      }
      const quote = (await response.json()) as Quote;
      setReview({
        body: JSON.stringify({
          ...JSON.parse(body),
          expectedQuote: quote.fingerprint,
        }),
        quote,
      });
      setStep("review");
    } catch {
      setError(requestErrorMessage);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function showFailure(response: Response) {
    const failure = (await response.json()) as {
      code?: string;
      availability?: { earliest: string | null; timezone: string };
    };
    if (failure.code === "PICKUP_TIME_UNAVAILABLE") {
      setTimingRefresh((n) => n + 1);
      setError(
        failure.availability?.earliest
          ? `${timingWords.earliest}: ${formatVenueTime(locale, failure.availability.earliest, failure.availability.timezone)}`
          : timingWords.unavailable,
      );
    } else
      setError(
        failure.code === "ONLINE_ORDER_QUOTE_CHANGED" ||
          failure.code === "ONLINE_ORDER_PRODUCT_INVALID"
          ? words[18]
          : failure.code === "DELIVERY_UNAVAILABLE"
            ? labels.deliveryUnavailable!
            : failure.code === "ONLINE_ORDERING_UNAVAILABLE"
              ? labels.closed!
              : requestErrorMessage,
      );
  }
  async function sendOrder() {
    if (submitting.current) return;
    const intent = pending ?? (review ? { body: review.body } : null);
    if (!intent) return;
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(intent));
    } catch {
      setError(words[19]);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setPending(intent);
    setError(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/public/online-orders/${encodeURIComponent(publicSlug)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: intent.body,
        },
      );
      if (!response.ok) {
        // Only explicit pre-commit validation failures permit a new attempt.
        if ([400, 404, 409].includes(response.status)) {
          sessionStorage.removeItem(pendingKey);
          setPending(null);
          setReview(null);
          setStep("details");
          await showFailure(response);
        } else setError(words[8]);
        return;
      }
      const result = (await response.json()) as {
        trackingToken: string | null;
        referenceCode: string;
      };
      let token = result.trackingToken;
      if (!token) {
        const recovery = await fetch(
          `${apiUrl}/v1/public/online-orders/${encodeURIComponent(publicSlug)}/recover`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              referenceCode: result.referenceCode,
              phone: JSON.parse(intent.body).contact.phone,
            }),
          },
        );
        if (!recovery.ok) {
          setError(words[8]);
          return;
        }
        token = "recovered";
      }
      const destination = `/${locale}/order/track/${encodeURIComponent(token)}?venue=${encodeURIComponent(publicSlug)}`;
      rememberRecentOrder(publicSlug, {
        referenceCode: result.referenceCode,
        destination,
      });
      sessionStorage.removeItem(pendingKey);
      sessionStorage.removeItem(storageKey);
      window.location.assign(destination);
    } catch {
      setError(words[8]);
    } finally {
      submitting.current = false;
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
    (!render &&
      ![
        website.pickupEnabled,
        website.deliveryEnabled,
        website.cateringEnabled,
      ].some(Boolean))
  )
    return (
      <main className="online-order-page">
        <p>{labels.missing}</p>
      </main>
    );
  const orderingEnabled = [
    website.pickupEnabled,
    website.deliveryEnabled,
    website.cateringEnabled,
  ].some(Boolean);
  const checkout = (
    <>
      {changed && (
        <div role="alert">
          <p>{words[5]}</p>
          <button onClick={() => setChanged(false)}>{words[6]}</button>
        </div>
      )}
      {pending && (
        <div role="status">
          <p>{words[8]}</p>
          <button disabled={busy} onClick={() => void sendOrder()}>
            {words[9]}
          </button>
        </div>
      )}
      <div hidden={step !== "basket"}>
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

              <div className="public-quantity">
                <button
                  disabled={!!pending || busy}
                  aria-label={`− ${item.product.name}`}
                  onClick={() =>
                    setCart((current) =>
                      current.flatMap((entry) =>
                        entry.key === item.key
                          ? entry.quantity > 1
                            ? [{ ...entry, quantity: entry.quantity - 1 }]
                            : []
                          : [entry],
                      ),
                    )
                  }
                >
                  −
                </button>
                <span>{item.quantity}</span>
                <button
                  disabled={!!pending || busy || item.quantity >= 20}
                  aria-label={`+ ${item.product.name}`}
                  onClick={() =>
                    setCart((current) =>
                      current.map((entry) =>
                        entry.key === item.key
                          ? { ...entry, quantity: entry.quantity + 1 }
                          : entry,
                      ),
                    )
                  }
                >
                  +
                </button>
              </div>
              <details className="public-item-note">
                <summary>{words[15]}</summary>
                <label>
                  <input
                    disabled={!!pending || busy}
                    aria-label={words[15]}
                    value={item.notes ?? ""}
                    maxLength={200}
                    onChange={(e) => {
                      const notes = e.target.value;
                      setCart((current) =>
                        current.map((entry) =>
                          entry.key === item.key ? { ...entry, notes } : entry,
                        ),
                      );
                    }}
                  />
                </label>
              </details>
              <button
                disabled={!!pending || busy}
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
        <button
          className="public-primary"
          disabled={changed || !!pending || !cart.length}
          onClick={() => {
            setStep("details");
            setError(null);
          }}
        >
          {words[0]}
        </button>
      </div>
      <form
        hidden={step !== "details"}
        onSubmit={submit}
        onChange={(e) => {
          const target = e.target;
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
          )
            setDetails((current) => ({
              ...current,
              [target.name]: target.value,
            }));
        }}
      >
        <button type="button" onClick={() => setStep("basket")}>
          {words[3]}
        </button>
        <fieldset disabled={busy || !!pending}>
          {
            <select
              aria-label={labels.order}
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
            defaultValue={details.name}
            autoComplete="name"
            aria-label={labels.name}
            placeholder={labels.name}
            required
          />
          <input
            name="phone"
            defaultValue={details.phone}
            autoComplete="tel"
            type="tel"
            aria-label={labels.phone}
            placeholder={labels.phone}
            required
          />
          <input
            name="email"
            defaultValue={details.email}
            autoComplete="email"
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
              onChange={
                mode === "PICKUP" ? setPickupChoice : setScheduledChoice
              }
              fulfillmentType={mode}
              refresh={timingRefresh}
            />
          }
          {mode === "DELIVERY" && (
            <>
              <input
                name="address"
                defaultValue={details.address}
                autoComplete="street-address"
                aria-label={labels.address}
                placeholder={labels.address}
                required
              />
              <input
                name="postal"
                defaultValue={details.postal}
                autoComplete="postal-code"
                aria-label={labels.postal}
                placeholder={labels.postal}
                required
              />
              <input
                name="city"
                defaultValue={details.city}
                autoComplete="address-level2"
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
            defaultValue={details.notes}
            maxLength={500}
            aria-label={labels.notes}
            placeholder={labels.notes}
          />
          <button disabled={busy || cart.length === 0} type="submit">
            {busy ? words[7] : words[1]}
          </button>
        </fieldset>
      </form>
      {step === "review" && review && (
        <section className="public-checkout-review">
          <h3>{words[1]}</h3>
          <ul>
            {review.quote.items.map((item, i) => (
              <li key={i}>
                {item.quantity} × {item.productName}
                {item.variantName ? ` · ${item.variantName}` : ""}
                {item.modifiers?.map((option, index) => (
                  <small key={index}> · {option.optionName}</small>
                ))}
                <strong>{price(item.quantity * item.unitPriceMinor)}</strong>
              </li>
            ))}
          </ul>
          {mode === "PICKUP" && pickupChoice.timingMode === "ASAP" ? (
            <p>{timingWords.asapConfirmation}</p>
          ) : (
            review.quote.requestedFor &&
            review.quote.timezone && (
              <p>
                {labels.time}:{" "}
                {formatVenueTime(
                  locale,
                  review.quote.requestedFor,
                  review.quote.timezone,
                )}
              </p>
            )
          )}
          {review.quote.deliveryFeeMinor > 0 && (
            <p>
              {words[10]}: {price(review.quote.deliveryFeeMinor)}
            </p>
          )}
          <p>
            {words[17]}
            <strong>{price(review.quote.totalMinor)}</strong>
          </p>
          <p>{words[11]}</p>
          <button
            disabled={busy || !!pending}
            onClick={() => setStep("details")}
          >
            {words[3]}
          </button>
          <button
            className="public-primary"
            disabled={busy || !!pending}
            onClick={() => void sendOrder()}
          >
            {busy ? labels.sending : words[2]}
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
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

      <label>
        {words[15]}
        <textarea
          maxLength={200}
          value={productNote}
          onChange={(e) => setProductNote(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
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

  const catalog = (
    <div className="public-catalog">
      <nav className="public-categories" aria-label={labels.order}>
        {website.menu
          .filter((c) => c.products.length)
          .map((c) => (
            <a key={c.id} href={`#menu-category-${c.id}`}>
              {c.name}
            </a>
          ))}
      </nav>
      {website.menu.map((category) => (
        <section
          className="public-category"
          id={`menu-category-${category.id}`}
          key={category.id}
        >
          <h3>{category.name}</h3>
          <div className="public-products">
            {category.products.map((product) => (
              <article key={product.id} data-available={product.available}>
                <CatalogPhoto media={product.media} category={category.name} />
                <div>
                  <h4>{product.name}</h4>
                  <p>{product.description}</p>
                  <strong>
                    {product.variants.length ? labels.from + " " : ""}
                    {price(
                      product.priceMinor +
                        (product.variants.length
                          ? Math.min(
                              ...product.variants
                                .filter((v) => v.available)
                                .map((v) => v.priceDeltaMinor),
                              ...(!product.variants.some((v) => v.available)
                                ? [0]
                                : []),
                            )
                          : 0),
                    )}
                  </strong>
                  {!product.available && <small>{labels.unavailable}</small>}
                </div>
                {orderingEnabled && (
                  <button
                    className="public-add"
                    disabled={
                      !product.available || !!pending || cart.length >= 30
                    }
                    aria-label={`${labels.add}: ${product.name}`}
                    onClick={() => beginAdd(product)}
                  >
                    +
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
  const count = cart.reduce((n, item) => n + item.quantity, 0);
  const basket = orderingEnabled ? (
    <button
      className="public-basket-icon"
      aria-label={`${words[14]} (${count})`}
      onClick={() => {
        setDrawer(true);
        setStep("basket");
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M3 8h18l-2 13H5L3 8Z M8 8V6a4 4 0 0 1 8 0v2" />
      </svg>
      {count > 0 && <span>{count}</span>}
    </button>
  ) : null;
  return (
    <>
      {render ? (
        render(catalog, basket)
      ) : (
        <main className="online-order-page public-standalone">
          <header>
            <a href={`/${locale}/venue/${publicSlug}`}>{website.venue.name}</a>
            <h1>{labels.order}</h1>
            {basket}
            <TrackOrderEntry locale={locale} publicSlug={publicSlug} />
          </header>
          {catalog}
        </main>
      )}
      {(count > 0 || pending) && orderingEnabled && (
        <button
          className="public-basket-bar"
          onClick={() => {
            setDrawer(true);
            setStep("basket");
          }}
        >
          <span>
            {words[14]} · {count}
          </span>
          <strong>{price(total)}</strong>
        </button>
      )}
      {drawer && (
        <PilotDialog
          title={words[16]}
          closeLabel={words[4]}
          onClose={() => setDrawer(false)}
          className="public-basket-drawer"
          dismissOnBackdrop
        >
          <div className="public-basket-body">{checkout}</div>
        </PilotDialog>
      )}
      {productToConfigure && (
        <PilotDialog
          title={productToConfigure.name}
          closeLabel={words[4]}
          onClose={() => setProductToConfigure(null)}
          className="public-product-dialog"
          dismissOnBackdrop
        >
          {configuration}
        </PilotDialog>
      )}
    </>
  );
}

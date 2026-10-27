"use client";
import "../../../../components/product-catalog.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "../../../../lib/dictionaries";
import { HardwareSettings } from "./hardware-settings";
import { CounterPayment } from "./counter-payment";
import { RegisterPanel } from "./register-panel";
import { PilotDialog } from "../pilot-dialog";
import { PilotIcon } from "../pilot-icon";
import { pilotText } from "../../../../lib/pilot-copy";
import { orderReference } from "@flowgastronomie/domain";
import type { StaffRole } from "@flowgastronomie/domain";
import { usePilotDemo, usePilotStaff } from "../../../pilot-app-shell";
import { resolveProductImage } from "../../../../lib/pilot-product-images";
import {
  ProductMedia,
  TableSetting,
} from "../../../../components/product-media";
import {
  posRecoveryKey,
  readPosRecovery,
  type PosCartLine,
  type PosRecovery,
} from "../../../../lib/pos-recovery";

type PosOption = {
  id: string;
  name: string;
  priceDeltaMinor: number;
  available: boolean;
};

type PosVariant = PosOption & { isDefault: boolean };

type PosProduct = {
  media?: import("@flowgastronomie/domain").CanonicalMediaReference;
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  available: boolean;
  station: "BAR" | "KITCHEN" | "DESSERT";
  allergens: string[];
  variants: PosVariant[];
  modifierGroups: Array<{
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    options: PosOption[];
  }>;
};

type PosMenu = {
  locale: string;
  venue: { id: string; name: string; currency: string };
  tables: Array<{ id: string; label: string; area: string | null }>;
  categories: Array<{
    id: string;
    name: string;
    products: PosProduct[];
  }>;
};

type StaffPosLabels = {
  eyebrow: string;
  title: string;
  orderType: string;
  dineIn: string;
  takeaway: string;
  selectTable: string;
  selectTablePlaceholder: string;
  cart: string;
  cartEmpty: string;
  clear: string;
  submit: string;
  submitting: string;
  confirmed: string;
  orderReference: string;
  newOrder: string;
  add: string;
  back: string;
  required: string;
  optional: string;
  loading: string;
  menuError: string;
  submitError: string;
  sessionExpired: string;
  needShift: string;
  search: string;
  noResults: string;
  total: string;
  qtyMinus: string;
  qtyPlus: string;
  remove: string;
  unavailable: string;
};

type StaffLabels = {
  noShift: string;
  shiftActive: string;
  sessionExpired: string;
};

type CartLine = PosCartLine;

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string }
  | {
      phase: "confirmed";
      reference: string;
      totalMinor: number;
      currency: string;
      tableLabel: string | null;
    };

function formatMoney(minor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(minor / 100);
}

function lineKey(
  productId: string,
  variantId: string | undefined,
  modifierOptionIds: string[],
) {
  return [
    productId,
    variantId ?? "default",
    [...modifierOptionIds].sort().join(","),
  ].join(":");
}

export function StaffPosClient(
  props: Parameters<typeof ScopedStaffPosClient>[0],
) {
  const staff = usePilotStaff();
  // Reset all cart/attempt state when the authenticated scope changes.
  return (
    <ScopedStaffPosClient
      key={staff ? `${posRecoveryKey(staff)}:${props.locale}` : "anonymous"}
      {...props}
    />
  );
}

function ScopedStaffPosClient({
  locale,
  labels,
  staffLabels,
  counterLabels,
  hardwareLabels,
}: {
  locale: string;
  labels: StaffPosLabels;
  staffLabels: StaffLabels;
  counterLabels: Dictionary["counterSale"];
  hardwareLabels: Dictionary["hardware"];
}) {
  const staff = usePilotStaff();
  const demo = usePilotDemo();
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [menu, setMenu] = useState<PosMenu | null>(null);
  const [menuError, setMenuError] = useState(false);
  const [hasShift, setHasShift] = useState<boolean | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [registerRevision, setRegisterRevision] = useState(0);
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY">(
    "TAKEAWAY",
  );
  const [tableId, setTableId] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchToggle = useRef<HTMLButtonElement>(null);
  const [configQuantity, setConfigQuantity] = useState(1);
  const [configNotes, setConfigNotes] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // One presentation state: no independent booleans can stack POS dialogs.
  const [overlay, setOverlay] = useState<
    | { kind: "register" | "hardware" | "checkout" }
    | { kind: "product"; product: PosProduct }
    | null
  >(null);
  const configuring = overlay?.kind === "product" ? overlay.product : null;
  const hardwareTrigger = useRef<HTMLButtonElement>(null);
  const orderHeading = useRef<HTMLHeadingElement>(null);
  function closeOverlay(kind: NonNullable<typeof overlay>["kind"]) {
    setOverlay((current) => (current?.kind === kind ? null : current));
  }
  function closeCheckout() {
    closeOverlay("checkout");
    setSubmitState({ phase: "idle" });
  }
  const [configVariantId, setConfigVariantId] = useState<string | null>(null);
  const [configOptions, setConfigOptions] = useState<string[]>([]);
  const [configError, setConfigError] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [submitState, setSubmitState] = useState<SubmitState>({
    phase: "idle",
  });
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const inFlight = useRef(false);
  const attempt = useRef<PosRecovery | null>(null);
  const [pending, setPending] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const storageKey = staff ? posRecoveryKey(staff) : null;
  const locked = pending || submitState.phase === "submitting" || !draftReady;
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = readPosRecovery(sessionStorage.getItem(storageKey));
      if (saved) {
        setCart(saved.cart);
        setOrderType(saved.orderType);
        setTableId(saved.tableId);
        idempotencyKey.current = saved.key;
        if (saved.pending) {
          attempt.current = saved;
          setPending(true);
          setSubmitState({
            phase: "error",
            message: pilotText(locale).pendingOrder,
          });
        }
      }
    } catch {
      /* Storage can be unavailable; in-memory retries still retain identity. */
    }
    setDraftReady(true);
  }, [storageKey, locale]);
  useEffect(() => {
    if (!storageKey || !draftReady) return;
    try {
      if (cart.length === 0 && !pending) sessionStorage.removeItem(storageKey);
      else
        sessionStorage.setItem(
          storageKey,
          JSON.stringify(
            attempt.current ??
              ({
                version: 1,
                savedAt: Date.now(),
                key: idempotencyKey.current,
                locale,
                orderType,
                tableId,
                pending: false,
                cart,
              } satisfies PosRecovery),
          ),
        );
    } catch {
      /* A storage failure must not prevent normal service. */
    }
  }, [storageKey, draftReady, cart, locale, orderType, tableId, pending]);

  const authHeaders = useMemo(
    () => ({ "content-type": "application/json" }),
    [],
  );

  const goToLogin = useCallback(() => {
    window.location.href = `/${locale}/staff/login?next=${encodeURIComponent(window.location.pathname)}`;
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const meResponse = await fetch(`${apiUrl}/v1/staff/me`, {
        credentials: "include",
      });
      if (cancelled) return;
      if (meResponse.status === 401) {
        goToLogin();
        return;
      }
      const me = (await meResponse.json()) as { staff: { role: StaffRole } };
      setRole(me.staff.role);
      const [menuResponse, shiftResponse] = await Promise.all([
        fetch(`${apiUrl}/v1/staff/pos/menu?locale=${locale}`, {
          credentials: "include",
        }),
        fetch(`${apiUrl}/v1/staff/shift`, { credentials: "include" }),
      ]);
      if (cancelled) return;
      if (!menuResponse.ok) {
        setMenuError(true);
        return;
      }
      setMenu((await menuResponse.json()) as PosMenu);
      if (shiftResponse.ok) {
        const shift = (await shiftResponse.json()) as {
          shift: { id: string } | null;
        };
        setHasShift(Boolean(shift.shift));
      }
    }
    void load().catch(() => {
      if (!cancelled) setMenuError(true);
    });
    const refresh = () => {
      if (document.visibilityState === "visible") void load().catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [apiUrl, goToLogin, locale]);

  const categories = menu?.categories ?? [];
  const visibleCategories = activeCategory
    ? categories.filter((category) => category.id === activeCategory)
    : categories;
  const needle = search.trim().toLowerCase();
  const filteredCategories = needle
    ? visibleCategories
        .map((category) => ({
          ...category,
          products: category.products.filter((product) =>
            product.name.toLowerCase().includes(needle),
          ),
        }))
        .filter((category) => category.products.length > 0)
    : visibleCategories;

  const cartTotal = cart.reduce(
    (total, line) => total + line.unitPriceMinor * line.quantity,
    0,
  );

  function startConfiguring(product: PosProduct) {
    if (!product.available) return;
    setConfigQuantity(1);
    setConfigNotes("");
    setConfigVariantId(
      product.variants.find((variant) => variant.isDefault)?.id ??
        product.variants[0]?.id ??
        null,
    );
    setConfigOptions([]);
    setConfigError(false);
    setOverlay({ kind: "product", product });
  }

  function addToCart(
    product: PosProduct,
    variant: PosVariant | undefined,
    optionIds: string[],
    modifiersLabel: string,
    quantity: number,
    notes: string,
  ) {
    if (locked) return;
    const optionTotal = optionIds.reduce((total, id) => {
      const option = product.modifierGroups
        .flatMap((group) => group.options)
        .find((entry) => entry.id === id);
      return total + (option?.priceDeltaMinor ?? 0);
    }, 0);
    const unitPriceMinor =
      product.priceMinor + (variant?.priceDeltaMinor ?? 0) + optionTotal;
    const key = crypto.randomUUID();

    setCart((previous) => {
      const existing = previous.find(
        (line) =>
          lineKey(line.productId, line.variantId, line.modifierOptionIds) ===
            lineKey(product.id, variant?.id, optionIds) &&
          line.notes.trim() === notes.trim(),
      );
      if (existing) {
        return previous.map((line) =>
          line.key === existing.key
            ? { ...line, quantity: line.quantity + quantity }
            : line,
        );
      }
      return [
        ...previous,
        {
          key,
          productId: product.id,
          productName: product.name,
          unitPriceMinor,
          quantity,
          variantId: variant?.id,
          variantName: variant?.name ?? null,
          modifierOptionIds: optionIds,
          modifiersLabel,
          notes: notes.trim(),
        },
      ];
    });
  }

  function confirmConfiguredProduct() {
    if (!configuring) return;
    const product = configuring;
    const variant = product.variants.find(
      (entry) => entry.id === configVariantId,
    );
    if (product.variants.length > 0 && !variant) {
      setConfigError(true);
      return;
    }
    const optionNames: string[] = [];
    for (const group of product.modifierGroups) {
      const chosen = group.options.filter((option) =>
        configOptions.includes(option.id),
      );
      if (chosen.length < group.minSelect || chosen.length > group.maxSelect) {
        setConfigError(true);
        return;
      }
      for (const option of chosen) optionNames.push(option.name);
    }
    addToCart(
      product,
      variant,
      configOptions,
      optionNames.join(", "),
      configQuantity,
      configNotes,
    );
    closeOverlay("product");
    setConfigOptions([]);
    setConfigVariantId(null);
    setConfigError(false);
  }

  function changeQuantity(key: string, delta: number) {
    if (locked) return;
    setCart((previous) =>
      previous
        .map((line) =>
          line.key === key
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function resetCart() {
    if (locked) return;
    setCart([]);
    idempotencyKey.current = crypto.randomUUID();
    setSubmitState({ phase: "idle" });
  }

  async function submitOrder() {
    if (!menu || !draftReady || cart.length === 0 || inFlight.current) {
      return;
    }
    if (orderType === "DINE_IN" && !tableId) return;
    inFlight.current = true;
    const submission: PosRecovery = attempt.current ?? {
      version: 1,
      savedAt: Date.now(),
      key: idempotencyKey.current,
      locale,
      orderType,
      tableId,
      pending: true,
      cart,
    };
    attempt.current = submission;
    setPending(true);
    // Persist before dispatch, including the exact retry identity and body.
    try {
      if (storageKey)
        sessionStorage.setItem(storageKey, JSON.stringify(submission));
    } catch {
      /* Remain locked and retain the attempt in memory. */
    }
    setSubmitState({ phase: "submitting" });
    try {
      const response = await fetch(`${apiUrl}/v1/staff/orders`, {
        method: "POST",
        credentials: "include",
        headers: {
          ...authHeaders,
          "idempotency-key": submission.key,
        },
        body: JSON.stringify({
          orderType: submission.orderType,
          ...(submission.orderType === "DINE_IN"
            ? { tableId: submission.tableId }
            : {}),
          locale: submission.locale,
          items: submission.cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            variantId: line.variantId,
            modifierOptionIds: line.modifierOptionIds,
            notes: line.notes.trim() || undefined,
          })),
        }),
      });
      if (response.status === 401) {
        goToLogin();
        return;
      }
      if (!response.ok) {
        // A server error can follow a commit. Only explicit client rejection
        // releases the frozen basket; connection failures retain the same attempt.
        if (response.status < 500) {
          attempt.current = null;
          setPending(false);
          idempotencyKey.current = crypto.randomUUID();
        }
        const payload = (await response.json().catch(() => null)) as {
          code?: string;
        } | null;
        setSubmitState({
          phase: "error",
          message:
            payload?.code === "ACTIVE_SHIFT_REQUIRED"
              ? labels.needShift
              : payload?.code === "PRODUCT_UNAVAILABLE"
                ? pilotText(locale).productChanged
                : payload?.code === "TABLE_NOT_FOUND"
                  ? pilotText(locale).tableChanged
                  : labels.submitError,
        });
        return;
      }
      const order = (await response.json()) as {
        id: string;
        totalMinor: number;
        currency: string;
        tableLabel: string | null;
      };
      if (!order.id) throw new Error("Invalid order response");
      attempt.current = null;
      setPending(false);
      try {
        if (storageKey) sessionStorage.removeItem(storageKey);
      } catch {
        /* no storage */
      }
      setCart([]);
      idempotencyKey.current = crypto.randomUUID();
      setSubmitState({
        phase: "confirmed",
        reference: order.id,
        totalMinor: order.totalMinor,
        currency: order.currency,
        tableLabel: order.tableLabel,
      });
      setOverlay({ kind: "checkout" });
    } catch {
      setSubmitState({
        phase: "error",
        message: pilotText(locale).pendingOrder,
      });
    } finally {
      inFlight.current = false;
    }
  }

  const currency = menu?.venue.currency ?? "EUR";
  const selectedTable = menu?.tables.find((table) => table.id === tableId);

  return (
    <main className="pos-page">
      {menuError && <p className="pos-warning">{labels.menuError}</p>}
      {pending && (
        <p className="pos-warning" role="status">
          {pilotText(locale).pendingOrder}{" "}
          <a className="counter-button" href={`/${locale}/staff/orders`}>
            {pilotText(locale).orders}
          </a>
        </p>
      )}
      {!menu && !menuError && <p className="pos-loading">{labels.loading}</p>}

      {menu && (
        <div className="pos-layout">
          <section className="pos-catalog" aria-label={labels.title}>
            <div className="pos-filters">
              <div className="pos-categories">
                <button
                  type="button"
                  aria-pressed={activeCategory === null}
                  className={activeCategory === null ? "is-active" : ""}
                  onClick={() => setActiveCategory(null)}
                >
                  {pilotText(locale).all}
                </button>
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={activeCategory === category.id}
                    className={
                      activeCategory === category.id ? "is-active" : ""
                    }
                    onClick={() => setActiveCategory(category.id)}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
              <button
                ref={searchToggle}
                type="button"
                className="pilot-icon-button"
                aria-label={labels.search}
                aria-expanded={searchOpen}
                aria-controls="pos-search-field"
                onClick={() => {
                  setSearchOpen(!searchOpen);
                  if (searchOpen) setSearch("");
                }}
              >
                <PilotIcon name="search" />
              </button>
            </div>
            {searchOpen && (
              <div className="pos-search-bar">
                <PilotIcon name="search" />
                <input
                  id="pos-search-field"
                  className="pos-search"
                  type="search"
                  autoFocus
                  value={search}
                  placeholder={labels.search}
                  aria-label={labels.search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearchOpen(false);
                      setSearch("");
                      searchToggle.current?.focus();
                    }
                  }}
                />
                <button
                  type="button"
                  className="pilot-icon-button"
                  aria-label={labels.back}
                  onClick={() => {
                    setSearchOpen(false);
                    setSearch("");
                    searchToggle.current?.focus();
                  }}
                >
                  <PilotIcon name="close" />
                </button>
              </div>
            )}

            {demo && (
              <p className="pos-imagery-note">
                {pilotText(locale).demoImagery}
              </p>
            )}
            <div className="pos-catalog-scroll">
              {filteredCategories.length === 0 && (
                <div className="pos-empty pos-catalog-empty">
                  <TableSetting />
                  <h2>{labels.noResults}</h2>
                </div>
              )}

              {filteredCategories.map((category) => (
                <section key={category.id} className="pos-category">
                  <h2>
                    {category.name}
                    <span>{category.products.length}</span>
                  </h2>
                  <div className="pos-grid">
                    {category.products.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className={`pos-product${
                          product.available
                            ? cart.some((line) => line.productId === product.id)
                              ? " is-selected"
                              : ""
                            : " is-unavailable"
                        }`}
                        onClick={() => startConfiguring(product)}
                        disabled={!product.available || locked}
                      >
                        <ProductMedia
                          key={`${product.id}-${demo}`}
                          category={category.name}
                          image={
                            product.media
                              ? {
                                  src: `${apiUrl}${product.media.url}`,
                                  kind:
                                    product.media.source === "DEMO"
                                      ? "demo"
                                      : "approved",
                                  label: product.media.label ?? undefined,
                                }
                              : staff
                                ? resolveProductImage({
                                    tenantId: staff.tenantId,
                                    venueId: staff.venueId,
                                    productId: product.id,
                                    demo,
                                  })
                                : undefined
                          }
                          demoLabel={pilotText(locale).demoPhoto}
                          kind={
                            product.station === "BAR"
                              ? "drink"
                              : product.station === "DESSERT"
                                ? "dessert"
                                : "plate"
                          }
                        />
                        <span className="pos-product-category">
                          {category.name}
                        </span>
                        <strong className="pos-product-name">
                          {product.name}
                        </strong>
                        <span className="pos-product-bottom">
                          <span className="pos-product-price">
                            {formatMoney(
                              product.priceMinor,
                              product.currency,
                              locale,
                            )}
                          </span>
                          <span className="pos-product-add">
                            {cart
                              .filter((line) => line.productId === product.id)
                              .reduce(
                                (sum, line) => sum + line.quantity,
                                0,
                              ) || <PilotIcon name="plus" />}
                          </span>
                        </span>
                        {!product.available && (
                          <small>{labels.unavailable}</small>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <aside className="pos-cart" aria-label={labels.cart}>
            <div className="pos-operative-tools">
              <span className={`pos-status ${hasShift ? "is-open" : ""}`}>
                <PilotIcon name={hasShift ? "ready" : "pending"} />
                {hasShift === null
                  ? pilotText(locale).unknown
                  : hasShift
                    ? staffLabels.shiftActive
                    : pilotText(locale).shiftInactive}
              </span>
              <div className="pos-tools">
                {" "}
                <RegisterPanel
                  open={overlay?.kind === "register"}
                  onOpen={() => setOverlay({ kind: "register" })}
                  onClose={() => closeOverlay("register")}
                  closeLabel={labels.back}
                  revision={registerRevision}
                  locale={locale}
                  currency={currency}
                  labels={counterLabels}
                  hasShift={hasShift}
                  onShiftStarted={() => setHasShift(true)}
                  onShiftEnded={() => setHasShift(false)}
                />
                {(role === "OWNER" || role === "MANAGER") && (
                  <button
                    ref={hardwareTrigger}
                    type="button"
                    className="pos-tool-trigger hardware-panel"
                    aria-label={hardwareLabels.settings}
                    aria-haspopup="dialog"
                    aria-expanded={overlay?.kind === "hardware"}
                    onClick={() => setOverlay({ kind: "hardware" })}
                  >
                    <PilotIcon name="settings" />
                  </button>
                )}
              </div>
            </div>
            {hasShift === false && (
              <p className="pos-warning">{labels.needShift}</p>
            )}
            <div className="pos-cart-heading">
              <h2 ref={orderHeading} tabIndex={-1}>
                {pilotText(locale).newOrder}
              </h2>
              <PilotIcon name="orders" />
            </div>
            <div
              className="pos-ordertype"
              role="group"
              aria-label={labels.orderType}
            >
              <button
                type="button"
                aria-pressed={orderType === "DINE_IN"}
                disabled={locked}
                className={orderType === "DINE_IN" ? "is-active" : ""}
                onClick={() => setOrderType("DINE_IN")}
              >
                <PilotIcon name="counter" />
                {labels.dineIn}
              </button>
              <button
                type="button"
                aria-pressed={orderType === "TAKEAWAY"}
                disabled={locked}
                className={orderType === "TAKEAWAY" ? "is-active" : ""}
                onClick={() => {
                  setOrderType("TAKEAWAY");
                  setTableId("");
                }}
              >
                <PilotIcon name="bag" />
                {labels.takeaway}
              </button>
            </div>

            {orderType === "DINE_IN" && (
              <label className="pos-table-select">
                <span>{labels.selectTable}</span>
                <select
                  value={tableId}
                  disabled={locked}
                  onChange={(event) => setTableId(event.target.value)}
                >
                  <option value="">{labels.selectTablePlaceholder}</option>
                  {menu.tables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.area
                        ? `${table.label} · ${table.area}`
                        : table.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="pos-cart-label">
              <span>{pilotText(locale).items}</span>
              <span>{cart.reduce((sum, line) => sum + line.quantity, 0)}</span>
            </div>
            {cart.length === 0 && (
              <div className="pos-empty-cart">
                <TableSetting />
                <p>{labels.cartEmpty}</p>
              </div>
            )}
            <ul className="pos-cart-lines">
              {cart.map((line) => (
                <li key={line.key}>
                  <div className="pos-line-info">
                    <strong>{line.productName}</strong>
                    {line.variantName && <small>{line.variantName}</small>}
                    {line.modifiersLabel && (
                      <small>{line.modifiersLabel}</small>
                    )}
                    <span>
                      {formatMoney(
                        line.unitPriceMinor * line.quantity,
                        currency,
                        locale,
                      )}
                    </span>
                    <details className="pos-line-note">
                      <summary>
                        <PilotIcon name="note" />
                        {line.notes || pilotText(locale).itemNote}
                      </summary>
                      <input
                        aria-label={pilotText(locale).itemNote}
                        value={line.notes}
                        disabled={locked}
                        maxLength={200}
                        placeholder={pilotText(locale).itemNoteHint}
                        onChange={(event) =>
                          setCart((previous) =>
                            previous.map((item) =>
                              item.key === line.key
                                ? { ...item, notes: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </details>
                  </div>
                  <div className="pos-line-actions">
                    <button
                      type="button"
                      aria-label={labels.qtyMinus}
                      disabled={locked}
                      onClick={() => changeQuantity(line.key, -1)}
                    >
                      −
                    </button>
                    <span aria-live="polite">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label={labels.qtyPlus}
                      disabled={locked}
                      onClick={() => changeQuantity(line.key, 1)}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {cart.length > 0 && (
              <div className="pos-cart-total">
                <span>{labels.total}</span>
                <strong>{formatMoney(cartTotal, currency, locale)}</strong>
              </div>
            )}

            <button
              type="button"
              className="pos-submit"
              disabled={
                cart.length === 0 ||
                !draftReady ||
                submitState.phase === "submitting" ||
                (orderType === "DINE_IN" && !tableId)
              }
              onClick={() => void submitOrder()}
            >
              <PilotIcon name="kitchen" />
              {submitState.phase === "submitting"
                ? labels.submitting
                : pending
                  ? pilotText(locale).retryOrder
                  : labels.submit}
            </button>
            {cart.length > 0 && submitState.phase !== "submitting" && (
              <button
                type="button"
                className="pos-clear"
                disabled={locked}
                onClick={resetCart}
              >
                {labels.clear}
              </button>
            )}
            {submitState.phase === "error" && (
              <p className="pos-warning" role="alert">
                {submitState.message}
              </p>
            )}
          </aside>
        </div>
      )}

      {overlay?.kind === "hardware" && (
        <PilotDialog
          className="pos-tools-dialog"
          title={hardwareLabels.settings}
          closeLabel={labels.back}
          onClose={() => closeOverlay("hardware")}
          dismissOnBackdrop
          returnFocusRef={hardwareTrigger}
        >
          <HardwareSettings labels={hardwareLabels} />
        </PilotDialog>
      )}

      {overlay?.kind === "checkout" && submitState.phase === "confirmed" && (
        <PilotDialog
          className="pos-confirmation"
          title={labels.confirmed}
          closeLabel={labels.back}
          onClose={closeCheckout}
          dismissOnBackdrop
          returnFocusRef={orderHeading}
        >
          <span className="pos-success">
            <PilotIcon name="ready" />
            {pilotText(locale).accepted}
          </span>
          <p>
            {labels.orderReference}:{" "}
            <code>{orderReference(submitState.reference)}</code>
            {submitState.tableLabel
              ? ` · ${labels.dineIn} ${submitState.tableLabel}`
              : ` · ${labels.takeaway}`}
          </p>
          <p>
            {formatMoney(submitState.totalMinor, submitState.currency, locale)}
          </p>
          <CounterPayment
            hardwareLabels={hardwareLabels}
            onPaid={() => setRegisterRevision((value) => value + 1)}
            key={submitState.reference}
            orderId={submitState.reference}
            totalMinor={submitState.totalMinor}
            currency={submitState.currency}
            locale={locale}
            labels={counterLabels}
          />
          <button
            type="button"
            className="pos-next-order"
            onClick={closeCheckout}
          >
            {labels.newOrder}
          </button>
        </PilotDialog>
      )}

      {configuring && (
        <PilotDialog
          className="pos-config"
          title={configuring.name}
          closeLabel={labels.back}
          onClose={() => closeOverlay("product")}
          dismissOnBackdrop
        >
          <p className="pos-config-description">{configuring.description}</p>
          <p className="pos-config-price">
            {formatMoney(configuring.priceMinor, currency, locale)}
          </p>
          {configuring.variants.length > 0 && (
            <fieldset>
              <legend>{labels.required}</legend>
              <div className="pos-options">
                {configuring.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={!variant.available}
                    aria-pressed={configVariantId === variant.id}
                    className={
                      configVariantId === variant.id ? "is-active" : ""
                    }
                    onClick={() => setConfigVariantId(variant.id)}
                  >
                    {variant.name}
                    {variant.priceDeltaMinor !== 0 && (
                      <small>
                        {formatMoney(variant.priceDeltaMinor, currency, locale)}
                      </small>
                    )}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {configuring.modifierGroups.map((group) => (
            <fieldset key={group.id}>
              <legend>
                {group.minSelect > 0
                  ? `${group.name} · ${labels.required}`
                  : `${group.name} · ${labels.optional}`}
              </legend>
              <div className="pos-options">
                {group.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!option.available}
                    aria-pressed={configOptions.includes(option.id)}
                    className={
                      configOptions.includes(option.id) ? "is-active" : ""
                    }
                    onClick={() =>
                      setConfigOptions((previous) =>
                        previous.includes(option.id)
                          ? previous.filter((id) => id !== option.id)
                          : previous.length < group.maxSelect
                            ? [...previous, option.id]
                            : previous,
                      )
                    }
                  >
                    {option.name}
                    {option.priceDeltaMinor !== 0 && (
                      <small>
                        {formatMoney(option.priceDeltaMinor, currency, locale)}
                      </small>
                    )}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <label className="pos-config-note">
            <span>
              <PilotIcon name="note" />
              {pilotText(locale).itemNote}
            </span>
            <textarea
              value={configNotes}
              maxLength={200}
              placeholder={pilotText(locale).itemNoteHint}
              onChange={(event) => setConfigNotes(event.target.value)}
            />
          </label>
          <div className="pos-line-actions pos-config-quantity">
            <button
              type="button"
              aria-label={labels.qtyMinus}
              disabled={configQuantity === 1}
              onClick={() => setConfigQuantity((value) => value - 1)}
            >
              -
            </button>
            <output aria-live="polite">{configQuantity}</output>
            <button
              type="button"
              aria-label={labels.qtyPlus}
              disabled={configQuantity === 99}
              onClick={() => setConfigQuantity((value) => value + 1)}
            >
              +
            </button>
          </div>
          <div className="pos-config-actions">
            <button
              type="button"
              onClick={() => {
                closeOverlay("product");
                setConfigOptions([]);
              }}
            >
              {labels.back}
            </button>
            <button type="button" onClick={confirmConfiguredProduct}>
              {labels.add}
            </button>
          </div>
          {configError && (
            <p role="alert">{pilotText(locale).modifierRequired}</p>
          )}
        </PilotDialog>
      )}
    </main>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { PLATFORM_LOCALES } from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import { BusinessImportClient } from "../app/app/[lang]/onboarding/business-import/import-client";
import { ProductPhotoEditor } from "./product-photo-editor";
import { websiteV2Copy } from "./website-v2-copy";
import { websiteBuilderCopy } from "./website-builder-copy";
type Product = {
  id: string;
  categoryId: string;
  revision: string;
  priceMinor: number;
  currency: string;
  published: boolean;
  posEnabled?: boolean | null;
  available: boolean;
  station: "KITCHEN" | "BAR" | "DESSERT";
  sortOrder: number;
  translations: { locale: string; name: string; description: string | null }[];
};
type Menu = {
  venue: { currency: string };
  categories: {
    id: string;
    translations: { locale: string; name: string }[];
    products: Product[];
  }[];
};
export function WebsiteMenuStudio({
  apiUrl,
  locale,
  productId,
  onClose,
  onChanged,
}: {
  apiUrl: string;
  locale: Locale;
  productId: string | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const c = websiteV2Copy(locale),
    b = websiteBuilderCopy(locale),
    dialog = useRef<HTMLDialogElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null),
    [product, setProduct] = useState<Product | null>(null),
    [price, setPrice] = useState(""),
    [importing, setImporting] = useState(false),
    [adding, setAdding] = useState(false),
    [photo, setPhoto] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function request(path: string, body?: unknown, method = "POST") {
    const response = await fetch(`${apiUrl}/v1/staff/menu${path}`, {
      credentials: "include",
      ...(body
        ? {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!response.ok) throw Error(response.status === 409 ? c[12] : b[13]);
    return response.json();
  }
  function select(p: Product) {
    setProduct(p);
    setPrice((p.priceMinor / 100).toFixed(2));
    setAdding(false);
  }
  async function refresh() {
    const data: Menu = await request("");
    setMenu(data);
    return data;
  }
  useEffect(() => {
    let active = true;
    dialog.current?.showModal();
    void request("")
      .then((m: Menu) => {
        if (!active) return;
        setMenu(m);
        const p = m.categories
          .flatMap((c) => c.products)
          .find((p) => p.id === productId);
        if (p) select(p);
      })
      .catch(() => {
        if (active) setError(b[13]!);
      });
    return () => {
      active = false;
      dialog.current?.close();
    };
    // The modal belongs to one authenticated editor mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const name =
    product?.translations.find((t) => t.locale === locale)?.name ?? "";
  async function save() {
    if (!product || busy) return;
    const amount = Number(price.replace(",", "."));
    if (
      !name.trim() ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      !product.categoryId
    ) {
      setError(b[13]!);
      return;
    }
    if (
      !adding &&
      (product.published || product.posEnabled) &&
      !window.confirm(c[36])
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await request(
        adding ? "/products" : `/products/${product.id}`,
        {
          ...product,
          priceMinor: Math.round(amount * 100),
          ...(!adding ? { expectedRevision: product.revision } : {}),
        },
        adding ? "POST" : "PUT",
      );
      await refresh();
      await onChanged();
      select(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : b[13]!);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="v2-menu-studio"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{c[18]}</h2>
        <button onClick={onClose} aria-label={c[7]}>
          ×
        </button>
      </header>
      <p>{c[22]}</p>
      {error && <p role="alert">{error}</p>}
      {importing ? (
        <>
          <button onClick={() => setImporting(false)}>{c[44]}</button>
          <BusinessImportClient
            locale={locale}
            menuOnly
            onCommitted={() => {
              void refresh();
              void onChanged();
            }}
          />
        </>
      ) : (
        <>
          <div className="builder-actions">
            <button
              onClick={() => {
                setProduct(null);
                setImporting(true);
              }}
            >
              {c[35]}
            </button>
            <button
              disabled={!menu}
              onClick={() => {
                setProduct({
                  id: "",
                  categoryId: menu?.categories[0]?.id ?? "",
                  revision: "",
                  priceMinor: 0,
                  currency: menu!.venue.currency,
                  published: false,
                  available: true,
                  station: "KITCHEN",
                  sortOrder: 0,
                  translations: PLATFORM_LOCALES.map((locale) => ({
                    locale,
                    name: "",
                    description: null,
                  })),
                });
                setPrice("");
                setAdding(true);
              }}
            >
              {c[34]}
            </button>
          </div>
          {product ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                {c[32]}
                <input
                  required
                  value={name}
                  maxLength={120}
                  onChange={(e) =>
                    setProduct({
                      ...product,
                      translations: product.translations.map((t) =>
                        adding || t.locale === locale
                          ? { ...t, name: e.target.value }
                          : t,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {c[33]} · {product.currency}
                <input
                  required
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  pattern="[0-9]+([.,][0-9]{1,2})?"
                />
              </label>
              <label>
                {c[41]}
                <select
                  required
                  value={product.categoryId}
                  onChange={(e) =>
                    setProduct({ ...product, categoryId: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {menu?.categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.translations.find((t) => t.locale === locale)
                        ?.name ?? cat.translations[0]?.name}
                    </option>
                  ))}
                </select>
              </label>
              {!menu?.categories.length && (
                <label>
                  {c[41]}
                  <input
                    aria-label={c[41]}
                    placeholder={c[41]}
                    onBlur={async (e) => {
                      const name = e.target.value.trim();
                      if (!name) return;
                      try {
                        const cat = await request("/categories", {
                          published: false,
                          sortOrder: 0,
                          translations: PLATFORM_LOCALES.map((locale) => ({
                            locale,
                            name,
                          })),
                        });
                        await refresh();
                        setProduct((p) =>
                          p ? { ...p, categoryId: cat.id } : p,
                        );
                      } catch {
                        setError(b[13]!);
                      }
                    }}
                  />
                </label>
              )}
              <div className="builder-actions">
                <button className="builder-primary" disabled={busy}>
                  {c[31]}
                </button>
                {!adding && (
                  <button type="button" onClick={() => setPhoto(true)}>
                    {c[45]}
                  </button>
                )}
                <button type="button" onClick={() => setProduct(null)}>
                  {c[7]}
                </button>
              </div>
            </form>
          ) : (
            <div className="v2-product-list">
              {menu?.categories.map((cat) => (
                <section key={cat.id}>
                  <h3>
                    {cat.translations.find((t) => t.locale === locale)?.name ??
                      cat.translations[0]?.name}
                  </h3>
                  {cat.products.map((p) => (
                    <button key={p.id} onClick={() => select(p)}>
                      <span>
                        {p.translations.find((t) => t.locale === locale)
                          ?.name ?? p.translations[0]?.name}
                      </span>
                      <span>
                        {(p.priceMinor / 100).toFixed(2)} {p.currency} ·{" "}
                        {p.published ? "Live" : "Draft"}
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {photo && product && (
        <ProductPhotoEditor
          productId={product.id}
          name={name}
          category={
            menu?.categories.find((c) => c.id === product.categoryId)
              ?.translations[0]?.name ?? ""
          }
          locale={locale}
          apiUrl={apiUrl}
          onClose={() => setPhoto(false)}
          onSaved={() => {
            setPhoto(false);
            void onChanged();
          }}
        />
      )}
    </dialog>
  );
}

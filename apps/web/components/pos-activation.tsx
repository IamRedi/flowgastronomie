"use client";
import { useEffect, useState } from "react";
import type { PlatformLocale } from "@flowgastronomie/domain";
import { compactCopy } from "../app/app/[lang]/onboarding/business-import/compact-copy";
type Product = {
  id: string;
  posEnabled?: boolean | null;
  published: boolean;
  available: boolean;
  translations: { locale: string; name: string }[];
};
export function PosActivation({
  locale,
  productIds,
}: {
  locale: PlatformLocale;
  productIds?: string[];
}) {
  const c = compactCopy(locale),
    [products, setProducts] = useState<Product[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [state, setState] = useState(""),
    [busy, setBusy] = useState(false);
  const productKey = productIds?.join(",");
  const api =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  useEffect(() => {
    let alive = true;
    void fetch(`${api}/v1/staff/menu`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const menu = await r.json();
        const rows: Product[] = menu.categories
          .flatMap((c: { products: Product[] }) => c.products)
          .filter(
            (p: Product) =>
              productKey === undefined || productKey.split(",").includes(p.id),
          );
        if (alive) setProducts(rows);
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [api, productKey]);
  async function activate() {
    setBusy(true);
    setState("");
    try {
      const r = await fetch(`${api}/v1/staff/menu/pos-activation`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: selected,
          enabled: true,
          confirm: true,
        }),
      });
      if (!r.ok) throw Error();
      setState("done");
      setConfirmed(false);
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="pos-activation">
      <details open={!!productIds}>
        <summary>{c.activate}</summary>
        <p>{c.posOnly}</p>
        <button
          type="button"
          onClick={() => {
            setSelected(products.map((p) => p.id));
            setConfirmed(false);
          }}
        >
          {c.selectAll}
        </button>
        <div className="pos-activation-list">
          {products.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={(e) => {
                  setSelected((ids) =>
                    e.target.checked
                      ? [...ids, p.id]
                      : ids.filter((id) => id !== p.id),
                  );
                  setConfirmed(false);
                  setState("");
                }}
              />
              {p.translations.find((t) => t.locale.toLowerCase() === locale)
                ?.name ?? p.translations[0]?.name}
            </label>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {c.posConfirm}
        </label>
        <button
          type="button"
          className="button"
          disabled={busy || !confirmed || !selected.length}
          onClick={activate}
        >
          {c.activate} ({selected.length})
        </button>
        {state === "done" && (
          <p role="status">
            {c.posDone} <a href={`/${locale}/staff/pos`}>{c.pos}</a>
          </p>
        )}
        {state === "error" && <p role="alert">{c.unsaved}</p>}
      </details>
    </section>
  );
}

"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  approveSelectedImportItems,
  compareMenuImport,
  validateBusinessField,
  type BusinessReview,
  type PlatformLocale,
} from "@flowgastronomie/domain";
import { ImportFields, ImportProduct } from "./import-review";
import type { ImportView } from "./import-client";
import type { ImportCopy } from "./import-copy";
import { setupApi } from "../setup-api";
import { websiteV2Copy } from "../../../../../components/website-v2-copy";
import { compactCopy } from "./compact-copy";
function Drawer({
  title,
  close,
  children,
  closeLabel,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  closeLabel: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="bi-drawer"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button autoFocus type="button" onClick={close} aria-label={closeLabel}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
function SourcePreview({ data, label }: { data: ImportView; label: string }) {
  const [source, setSource] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );
  async function open(url: string) {
    setFailed(false);
    try {
      const response = await fetch(`${setupApi}${url}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw Error();
      setSource(URL.createObjectURL(await response.blob()));
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="bi-source-links">
      {data.sources.map((s) => (
        <div key={s.id}>
          <button type="button" onClick={() => open(s.url)}>
            {label}: {s.filename}
          </button>
          <a href={`${setupApi}${s.url}`} target="_blank" rel="noreferrer">
            ↗
          </a>
        </div>
      ))}
      {source && (
        <iframe className="bi-source-preview" src={source} title={label} />
      )}{" "}
      {failed && <p role="alert">{label}: unavailable</p>}
    </div>
  );
}
export function CompactReview({
  data,
  review,
  change,
  locale,
  words,
  incomplete,
  menuOnly = false,
}: {
  data: ImportView;
  review: BusinessReview;
  change: (review: BusinessReview) => void;
  locale: PlatformLocale;
  words: ImportCopy;
  incomplete: string[];
  menuOnly?: boolean;
}) {
  const v = websiteV2Copy(locale),
    comparison = compareMenuImport(review.items, data.canonical.products);
  const c = compactCopy(locale),
    [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [attention, setAttention] = useState(false),
    [ack, setAck] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [business, setBusiness] = useState(false),
    [blocked, setBlocked] = useState(false);
  const rows = review.items.filter(
    (r) =>
      (!attention || incomplete.includes(r.id)) &&
      `${r.item.name} ${r.item.categoryName}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const update = (
    id: string,
    patch: Partial<BusinessReview["items"][number]["item"]>,
  ) =>
    change({
      ...review,
      items: review.items.map((r) =>
        r.id === id
          ? {
              ...r,
              item: { ...r.item, ...patch },
              approvePrice: false,
              approveConfiguration: false,
              action: r.action === "SKIP" ? "PENDING" : r.action,
            }
          : r,
      ),
    });
  const edited = review.items.find((r) => r.id === editing);
  const applyBusiness = (use: boolean) => {
    try {
      const fields = review.fields.map((f) => {
        if (!use || !f.value.trim())
          return { ...f, decision: "REJECT" as const };
        validateBusinessField(f.field, f.value);
        return { ...f, decision: "APPROVE" as const };
      });
      change({ ...review, fields });
      setBusiness(false);
    } catch {
      setBlocked(true);
    }
  };
  return (
    <>
      {menuOnly && (
        <details className="bi-panel" open>
          <summary>{v[42]}</summary>
          <p>{v[43]}</p>
          <ul>
            {comparison.items.map((row) => (
              <li key={row.id}>
                {review.items.find((r) => r.id === row.id)?.item.name}:{" "}
                {
                  v[
                    row.kind === "NEW"
                      ? 48
                      : row.kind === "PRICE_CHANGED"
                        ? 49
                        : row.kind === "REVIEW"
                          ? 50
                          : 47
                  ]
                }
                {row.variants ? ` ? ${row.variants} variants` : ""}
              </li>
            ))}
          </ul>
          {comparison.absent.length > 0 && (
            <p>
              {v[51]}:{" "}
              {comparison.absent
                .map(
                  (id) =>
                    data.canonical.products.find((p) => p.id === id)
                      ?.translations[0]?.name,
                )
                .join(", ")}
              . {v[52]}.
            </p>
          )}
        </details>
      )}
      {!menuOnly && (
        <section className="bi-panel bi-business-summary" id="import-identity">
          <header>
            <h2>{c.business}</h2>
            <button type="button" onClick={() => setBusiness(true)}>
              {c.edit}
            </button>
          </header>
          <dl>
            {(["venueName", "address", "phone", "contactEmail"] as const).map(
              (name) => {
                const f = review.fields.find((f) => f.field === name);
                const current =
                  name === "venueName"
                    ? data.canonical.venue.name
                    : data.canonical.website?.[name];
                return (
                  <div key={name}>
                    <dt>{words.fields[name]}</dt>
                    <dd>
                      {f?.decision !== "REJECT" && f?.value
                        ? f.value
                        : current || words.missing}
                    </dd>
                  </div>
                );
              },
            )}
          </dl>
          {review.fields.some((f) => f.decision === "PENDING") && (
            <p>{c.approveBusiness}</p>
          )}
          <div className="bi-inline-actions">
            <button type="button" onClick={() => applyBusiness(false)}>
              {c.businessKeep}
            </button>
            <button type="button" onClick={() => applyBusiness(true)}>
              {c.businessApply}
            </button>
          </div>
        </section>
      )}
      <section className="bi-panel" id="import-menu">
        <header className="bi-list-header">
          <h2>
            {words.menu} <small>{review.items.length}</small>
          </h2>
          <label>
            <span className="sr-only">{c.search}</span>
            <input
              type="search"
              placeholder={c.search}
              aria-label={c.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </header>
        <div className="bi-toolbar">
          <button
            type="button"
            aria-pressed={!attention}
            onClick={() => setAttention(false)}
          >
            {c.all}
          </button>
          <button
            type="button"
            aria-pressed={attention}
            onClick={() => setAttention(true)}
          >
            {c.attention} ({incomplete.length})
          </button>
          <button
            type="button"
            onClick={() => setSelected(rows.map((r) => r.id))}
          >
            {c.selectAll}
          </button>
        </div>
        <div className="bi-list" role="list">
          {rows.map((row) => (
            <article
              className="bi-menu-row"
              role="listitem"
              id={`import-item-${row.id}`}
              key={row.id}
            >
              <label className="bi-check">
                <input
                  type="checkbox"
                  aria-label={`${c.select} ${row.item.name}`}
                  checked={selected.includes(row.id)}
                  onChange={(e) => {
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, row.id]
                        : ids.filter((id) => id !== row.id),
                    );
                    setAck(false);
                  }}
                />
              </label>
              <div>
                <input
                  aria-label={`${words.name} ${row.id}`}
                  value={row.item.name}
                  onChange={(e) => update(row.id, { name: e.target.value })}
                />
                <input
                  aria-label={`${words.category} ${row.id}`}
                  value={row.item.categoryName}
                  onChange={(e) =>
                    update(row.id, {
                      categoryId: null,
                      categoryName: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label>
                  <span className="sr-only">
                    {words.price} {row.item.name}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    aria-label={`${words.price} ${row.id}`}
                    aria-invalid={row.item.priceMinor === null}
                    value={
                      row.item.priceMinor === null
                        ? ""
                        : row.item.priceMinor / 100
                    }
                    placeholder={c.missingPrice}
                    onChange={(e) =>
                      update(row.id, {
                        priceMinor:
                          e.target.value === ""
                            ? null
                            : Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </label>
                <small>
                  {row.item.currency}
                  {row.item.variants.length
                    ? ` · ${row.item.variants.length} ${words.variant}`
                    : ""}
                </small>
              </div>
              {row.item.variants.length > 0 && (
                <small className="bi-variant-summary">
                  {row.item.variants
                    .map(
                      (v) =>
                        `${v.name}: ${row.item.priceMinor === null || v.priceDeltaMinor === null ? "—" : ((row.item.priceMinor + v.priceDeltaMinor) / 100).toFixed(2)} ${row.item.currency}`,
                    )
                    .join(" · ")}
                </small>
              )}
              <span className="bi-row-state">
                {row.action === "SKIP"
                  ? c.skipped
                  : row.item.priceMinor === null
                    ? c.missingPrice
                    : incomplete.includes(row.id)
                      ? c.attention
                      : c.reviewed}
              </span>
              <button type="button" onClick={() => setEditing(row.id)}>
                {c.details}
              </button>
            </article>
          ))}
        </div>
        {!rows.length && <p>{c.empty}</p>}
        <div className="bi-bulk">
          <label className="bi-check">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            {c.ack}
          </label>
          <div className="bi-inline-actions">
            <button
              type="button"
              disabled={!selected.length || !ack}
              onClick={() => {
                const result = approveSelectedImportItems(
                  review,
                  selected,
                  data.canonical.venue.currency,
                  ack,
                );
                change(result.review);
                setBlocked(result.blocked.length > 0);
                setSelected(result.blocked);
                setAck(false);
              }}
            >
              {c.approve} ({selected.length})
            </button>
            <button
              type="button"
              disabled={!selected.length}
              onClick={() => {
                change({
                  ...review,
                  items: review.items.map((r) =>
                    selected.includes(r.id) ? { ...r, action: "SKIP" } : r,
                  ),
                });
                setSelected([]);
                setAck(false);
                setBlocked(false);
              }}
            >
              {c.skip} ({selected.length})
            </button>
          </div>
          {blocked && <p role="alert">{c.blocked}</p>}
        </div>
      </section>
      {business && (
        <Drawer
          closeLabel={c.close}
          title={c.business}
          close={() => setBusiness(false)}
        >
          <ImportFields
            data={data}
            review={review}
            onChange={change}
            words={words}
            locale={locale}
          />
          <button type="button" onClick={() => applyBusiness(true)}>
            {c.businessApply}
          </button>
        </Drawer>
      )}
      {edited && (
        <Drawer
          closeLabel={c.close}
          title={edited.item.name || c.details}
          close={() => setEditing(null)}
        >
          <ImportProduct
            compact
            row={edited}
            data={data}
            words={words}
            onChange={(next) =>
              change({
                ...review,
                items: review.items.map((r) => (r.id === edited.id ? next : r)),
              })
            }
          />
          <SourcePreview data={data} label={c.source} />
          <button type="button" onClick={() => setEditing(null)}>
            {c.close}
          </button>
        </Drawer>
      )}
    </>
  );
}

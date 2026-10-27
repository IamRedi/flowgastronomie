"use client";
import { useEffect, useId, useState } from "react";
import {
  importAllergenCodes,
  importPriceMinor,
  importPriceText,
  menuDuplicateCandidates,
  type ReviewedMenuItem,
} from "@flowgastronomie/domain";
import type { Locale } from "../../../../lib/i18n";
import { setupApi, type ImportData, type ImportRow } from "./setup-api";
import type { SetupCopy } from "./setup-copy";

function Money({
  label,
  value,
  currency,
  onChange,
  signed = false,
}: {
  label: string;
  value: number | null;
  currency: string;
  onChange: (value: number | null) => void;
  signed?: boolean;
}) {
  const [text, setText] = useState(importPriceText(value, currency));
  const [error, setError] = useState(false);
  return (
    <label>
      {label} ({currency || "?"})
      <input
        value={text}
        inputMode="decimal"
        required
        aria-invalid={error}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            const minus = signed && next.startsWith("-");
            const parsed = importPriceMinor(
              minus ? next.slice(1) : next,
              currency,
            );
            onChange(parsed === null ? null : minus ? -parsed : parsed);
            setError(false);
          } catch {
            onChange(null);
            setError(true);
          }
        }}
      />
    </label>
  );
}
export function ImportSource({
  source,
  words,
}: {
  source: ImportData["sources"][number];
  words: SetupCopy;
}) {
  const [url, setUrl] = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setFailed(false);
    setUrl("");
    const controller = new AbortController();
    fetch(
      `${setupApi}${source.url}${source.mimeType === "application/pdf" ? `/pages/${page}` : ""}`,
      {
        credentials: "include",
        signal: controller.signal,
      },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error();
        objectUrl = URL.createObjectURL(await r.blob());
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source.url, source.mimeType, page]);
  useEffect(() => {
    if (source.mimeType !== "application/pdf") return;
    let active = true;
    let objectUrl = "";
    const controller = new AbortController();
    fetch(`${setupApi}${source.url}`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        objectUrl = URL.createObjectURL(await r.blob());
        if (active) setOriginalUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source.url, source.mimeType]);
  return (
    <figure className="setup-source">
      <figcaption>{source.filename}</figcaption>
      {url && (
        <img src={url} alt={`${words.source} · ${page}/${source.pageCount}`} />
      )}
      {source.pageCount > 1 && (
        <div className="setup-actions">
          <button
            aria-label={words.back}
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ←
          </button>
          <span>
            {page}/{source.pageCount}
          </span>
          <button
            aria-label={words.next}
            disabled={page === source.pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </button>
        </div>
      )}
      {(originalUrl || url) && (
        <a href={originalUrl || url} target="_blank" rel="noreferrer">
          {words.download}
        </a>
      )}
      {failed && <p role="alert">{words.reload}</p>}
    </figure>
  );
}
export function ImportReviewRow({
  row,
  session,
  words,
  locale,
  currency,
  busy,
  onReview,
  onDirty,
}: {
  row: ImportRow;
  session: ImportData;
  words: SetupCopy;
  locale: Locale;
  currency: string;
  busy: boolean;
  onReview: (
    row: ImportRow,
    item: ReviewedMenuItem,
    action: "SAVE" | "APPROVE" | "REJECT",
  ) => Promise<void>;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const [item, setItem] = useState(row.reviewed);
  const id = useId();
  const set = <K extends keyof ReviewedMenuItem>(
    key: K,
    value: ReviewedMenuItem[K],
  ) => setItem((old) => ({ ...old, [key]: value }));
  const approved =
    row.status === "APPROVED" &&
    JSON.stringify(item) === JSON.stringify(row.reviewed);
  const dirty = JSON.stringify(item) !== JSON.stringify(row.reviewed);
  const duplicates = menuDuplicateCandidates(item, [
    ...session.products,
    ...session.items
      .filter((other) => other.id !== row.id && other.status !== "REJECTED")
      .map((other) => ({
        id: other.id,
        names: [other.reviewed.name],
        priceMinor: other.reviewed.priceMinor ?? 0,
      })),
  ]);
  useEffect(() => onDirty(row.id, dirty), [row.id, dirty, onDirty]);
  return (
    <article className="setup-review-card" aria-labelledby={id}>
      <div className="setup-card-heading">
        <h3 id={id}>{row.reviewed.name || words.name}</h3>
        <span className={`setup-status status-${row.status.toLowerCase()}`}>
          {words.statuses[row.status as keyof typeof words.statuses] ??
            row.status}
        </span>
      </div>
      <fieldset disabled={busy || row.status === "IMPORTED"}>
        <div className="setup-fields">
          <label>
            {words.name}
            <input
              value={item.name}
              maxLength={160}
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <Money
            label={words.price}
            value={item.priceMinor}
            currency={item.currency}
            onChange={(v) => set("priceMinor", v)}
          />
          {item.currency !== currency && (
            <label>
              {words.currency} ({currency})
              <input
                value={item.currency}
                maxLength={3}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
              />
            </label>
          )}
          <label>
            {words.category}
            <select
              value={item.categoryId ?? ""}
              onChange={(e) => {
                const category = session.categories.find(
                  (c) => c.id === e.target.value,
                );
                setItem((old) => ({
                  ...old,
                  categoryId: category?.id ?? null,
                  categoryName: category
                    ? (category.translations.find(
                        (t) => t.locale === locale.toUpperCase(),
                      ) ?? category.translations[0])!.name
                    : old.categoryName,
                }));
              }}
            >
              <option value="">{words.newCategory}</option>
              {session.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {
                    (
                      c.translations.find(
                        (t) => t.locale === locale.toUpperCase(),
                      ) ?? c.translations[0]
                    )?.name
                  }
                </option>
              ))}
            </select>
          </label>
          {!item.categoryId && (
            <label>
              {words.categoryName}
              <input
                value={item.categoryName}
                maxLength={160}
                onChange={(e) => set("categoryName", e.target.value)}
              />
            </label>
          )}
        </div>
        {duplicates.length > 0 && (
          <div className="setup-warning">
            <strong>{words.duplicates}</strong>
            <p>{duplicates.map((d) => d.name).join(", ")}</p>
            <label className="setup-check">
              <input
                type="checkbox"
                checked={item.duplicateAcknowledged}
                onChange={(e) => set("duplicateAcknowledged", e.target.checked)}
              />
              {words.duplicateConfirm}
            </label>
          </div>
        )}
        <details>
          <summary>
            {words.details}
            {item.variants.length + item.modifierGroups.length > 0
              ? ` (${item.variants.length + item.modifierGroups.length})`
              : ""}
          </summary>
          <label>
            {words.description}
            <textarea
              value={item.description}
              maxLength={2000}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <div className="setup-fields">
            <label>
              {words.currency}
              <input
                value={item.currency}
                maxLength={3}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
                placeholder={currency}
              />
            </label>
            <label>
              {words.station}
              <select
                value={item.station}
                onChange={(e) =>
                  set("station", e.target.value as ReviewedMenuItem["station"])
                }
              >
                <option>KITCHEN</option>
                <option>BAR</option>
                <option>DESSERT</option>
              </select>
            </label>
          </div>
          <h4>{words.variants}</h4>
          {item.variants.map((v, i) => (
            <div className="setup-option" key={i}>
              <label>
                {words.name}
                <input
                  value={v.name}
                  onChange={(e) =>
                    set(
                      "variants",
                      item.variants.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <Money
                label={words.delta}
                currency={item.currency}
                value={v.priceDeltaMinor}
                signed
                onChange={(value) =>
                  set(
                    "variants",
                    item.variants.map((x, j) =>
                      j === i ? { ...x, priceDeltaMinor: value } : x,
                    ),
                  )
                }
              />
              <label className="setup-check">
                <input
                  type="radio"
                  name={`variant-${id}`}
                  checked={v.isDefault}
                  onChange={() =>
                    set(
                      "variants",
                      item.variants.map((x, j) => ({
                        ...x,
                        isDefault: j === i,
                      })),
                    )
                  }
                />
                {words.defaultVariant}
              </label>
              <button
                type="button"
                onClick={() =>
                  set(
                    "variants",
                    item.variants.filter((_, j) => i !== j),
                  )
                }
              >
                {words.remove}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set("variants", [
                ...item.variants,
                {
                  name: "",
                  priceDeltaMinor: null,
                  isDefault: !item.variants.length,
                },
              ])
            }
          >
            {words.add} · {words.variants}
          </button>
          <h4>{words.extras}</h4>
          {item.modifierGroups.map((g, i) => (
            <div className="setup-option-group" key={i}>
              <label>
                {words.name}
                <input
                  value={g.name}
                  onChange={(e) =>
                    set(
                      "modifierGroups",
                      item.modifierGroups.map((x, j) =>
                        i === j ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <div className="setup-fields">
                {(["minSelect", "maxSelect"] as const).map((k) => (
                  <label key={k}>
                    {k === "minSelect" ? words.min : words.max}
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={g[k]}
                      onChange={(e) =>
                        set(
                          "modifierGroups",
                          item.modifierGroups.map((x, j) =>
                            i === j ? { ...x, [k]: Number(e.target.value) } : x,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              {g.options.map((o, n) => (
                <div className="setup-option" key={n}>
                  <label>
                    {words.name}
                    <input
                      value={o.name}
                      onChange={(e) =>
                        set(
                          "modifierGroups",
                          item.modifierGroups.map((x, j) =>
                            i === j
                              ? {
                                  ...x,
                                  options: x.options.map((y, k) =>
                                    n === k
                                      ? { ...y, name: e.target.value }
                                      : y,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <Money
                    label={words.delta}
                    currency={item.currency}
                    value={o.priceDeltaMinor}
                    onChange={(value) =>
                      set(
                        "modifierGroups",
                        item.modifierGroups.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                options: x.options.map((y, k) =>
                                  n === k
                                    ? { ...y, priceDeltaMinor: value }
                                    : y,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "modifierGroups",
                        item.modifierGroups.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                options: x.options.filter((_, k) => n !== k),
                              }
                            : x,
                        ),
                      )
                    }
                  >
                    {words.remove}
                  </button>
                </div>
              ))}
              <div className="setup-actions">
                <button
                  type="button"
                  onClick={() =>
                    set(
                      "modifierGroups",
                      item.modifierGroups.map((x, j) =>
                        i === j
                          ? {
                              ...x,
                              options: [
                                ...x.options,
                                { name: "", priceDeltaMinor: null },
                              ],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  {words.add}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    set(
                      "modifierGroups",
                      item.modifierGroups.filter((_, j) => i !== j),
                    )
                  }
                >
                  {words.remove} · {words.extras}
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set("modifierGroups", [
                ...item.modifierGroups,
                { name: "", minSelect: 0, maxSelect: 1, options: [] },
              ])
            }
          >
            {words.add} · {words.extras}
          </button>
          <h4>{words.allergens}</h4>
          <p>{words.allergenHelp}</p>
          <div className="setup-allergens">
            {importAllergenCodes.map((code) => (
              <label className="setup-check" key={code}>
                <input
                  type="checkbox"
                  checked={item.approvedAllergens.includes(code)}
                  onChange={(e) =>
                    set(
                      "approvedAllergens",
                      e.target.checked
                        ? [...item.approvedAllergens, code]
                        : item.approvedAllergens.filter((c) => c !== code),
                    )
                  }
                />
                {code}
                {row.original.allergenCandidates.some((a) => a.value === code)
                  ? " · ?"
                  : ""}
              </label>
            ))}
          </div>
        </details>
        <details>
          <summary>{words.evidence}</summary>
          <pre>{JSON.stringify(row.original, null, 2)}</pre>
        </details>
        <div className="setup-actions">
          <button
            type="button"
            onClick={() => void onReview(row, item, "SAVE")}
          >
            {words.save}
          </button>
          <button
            type="button"
            onClick={() => void onReview(row, item, "REJECT")}
          >
            {words.reject}
          </button>
          <button
            type="button"
            className="setup-primary"
            disabled={
              approved ||
              item.priceMinor === null ||
              !item.name.trim() ||
              !item.categoryName.trim() ||
              item.currency !== currency
            }
            onClick={() => void onReview(row, item, "APPROVE")}
          >
            {words.approve}
          </button>
        </div>
      </fieldset>
    </article>
  );
}

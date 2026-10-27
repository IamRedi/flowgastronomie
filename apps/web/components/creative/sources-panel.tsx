"use client";
import { useEffect, useState } from "react";
import {
  creativeTemplates,
  instantiateCreativeTemplate,
  createTextLayer,
  applyResolvedBindings,
  type CreativeBinding,
  type CreativeLayer,
  type DesignDocument,
  type CreativeTemplate,
} from "@flowgastronomie/domain";
import { studioRequest } from "./api";
type Catalog = {
  venue: { id: string; name: string };
  brand: { id: string; primaryColor: string; accentColor: string } | null;
  products: {
    id: string;
    name: string;
    price: string;
    categoryId: string;
    variants: { id: string; name: string }[];
  }[];
  categories: { id: string; name: string }[];
  tables: { id: string; label: string }[];
  websiteAssets: { id: string; kind: string }[];
};
export function SourcesPanel({
  document,
  projectId,
  change,
  error,
  refreshAssets,
}: {
  document: DesignDocument;
  projectId: string;
  change: (doc: DesignDocument) => void;
  error: (message: string) => void;
  refreshAssets: () => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [template, setTemplate] =
    useState<CreativeTemplate>("Product spotlight");
  const [changes, setChanges] = useState<
    { previous: CreativeBinding; current: CreativeBinding }[]
  >([]);
  const [resolved, setResolved] = useState<CreativeBinding[]>([]);
  const [table, setTable] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void studioRequest<Catalog>(`/sources?locale=${document.locale}`)
      .then(setCatalog)
      .catch((e) => error(e.message));
  }, [document.locale, error]);
  async function binding(
    sourceType: CreativeBinding["sourceType"],
    sourceId: string,
    field: CreativeBinding["field"],
    value = "",
  ) {
    return studioRequest<CreativeBinding>("/sources/resolve", {
      method: "POST",
      body: JSON.stringify({
        locale: document.locale,
        binding: {
          id: crypto.randomUUID(),
          sourceType,
          sourceId,
          field,
          value,
          version: "",
        },
      }),
    });
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function append(b: CreativeBinding) {
    const base = createTextLayer(crypto.randomUUID(), b.value);
    const layer =
      b.field === "destination"
        ? ({
            id: base.id,
            name: "Venue QR",
            type: "qr",
            x: 60,
            y: 350,
            width: 150,
            height: 150,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            groupId: null,
            bindingId: b.id,
            fill: "#000000",
            background: "#ffffff",
          } as CreativeLayer)
        : {
            ...base,
            bindingId: b.id,
            name: `${b.sourceType} ${b.field}`,
            ...(b.field === "price" ? { type: "price" as const } : {}),
          };
    change({
      ...document,
      bindings: [...document.bindings, b],
      pages: [
        {
          ...document.pages[0]!,
          layers: [...document.pages[0]!.layers, layer],
        },
      ],
    });
  }
  if (!catalog) return <p>Loading venue sources…</p>;
  return (
    <details className="cs-sources">
      <summary>Sources & templates</summary>
      <fieldset disabled={busy}>
        <legend>From {catalog.venue.name}</legend>
        <label>
          Template
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as CreativeTemplate)}
          >
            {creativeTemplates.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Menu items
          <select
            multiple
            aria-label="Select menu products"
            value={selected}
            onChange={(e) =>
              setSelected(
                Array.from(e.target.selectedOptions, (option) => option.value),
              )
            }
          >
            {catalog.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.price}
              </option>
            ))}
          </select>
        </label>
        <label>
          Choose a category
          <select
            value=""
            onChange={(e) =>
              setSelected(
                catalog.products
                  .filter((p) => p.categoryId === e.target.value)
                  .map((p) => p.id),
              )
            }
          >
            <option value="">Select all items in…</option>
            {catalog.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        {selected.length === 1 &&
          catalog.products
            .find((p) => p.id === selected[0])
            ?.variants.map((variant) => (
              <div key={variant.id}>
                <small>{variant.name}</small>
                <div className="cs-row">
                  <button
                    onClick={() =>
                      void run(async () =>
                        append(await binding("VARIANT", variant.id, "name")),
                      )
                    }
                  >
                    Add variant
                  </button>
                  <button
                    onClick={() =>
                      void run(async () =>
                        append(await binding("VARIANT", variant.id, "price")),
                      )
                    }
                  >
                    Add variant price
                  </button>
                </div>
              </div>
            ))}
        <button
          onClick={() =>
            void run(async () => {
              const bindings = await Promise.all([
                binding("VENUE", catalog.venue.id, "name"),
                ...selected.flatMap((id) => [
                  binding("PRODUCT", id, "name"),
                  binding("PRODUCT", id, "price"),
                ]),
              ]);
              if (
                (template === "QR table card" || template === "QR sticker") &&
                catalog.brand
              )
                bindings.push(
                  await binding("QR", catalog.brand.id, "destination"),
                );
              const theme = catalog.brand
                ? {
                    ...document.theme,
                    primary: catalog.brand.primaryColor,
                    accent: catalog.brand.accentColor,
                  }
                : document.theme;
              change(
                instantiateCreativeTemplate(
                  template,
                  template === "Printed menu" &&
                    !["A4", "A5"].includes(document.format)
                    ? "A4"
                    : document.format,
                  document.locale,
                  bindings,
                  theme,
                ),
              );
            })
          }
        >
          Apply template (replaces layers)
        </button>
        <button
          disabled={selected.length !== 1}
          onClick={() =>
            void run(async () =>
              append(await binding("PRODUCT", selected[0]!, "price")),
            )
          }
        >
          Add current price
        </button>
        {catalog.brand && (
          <>
            <button
              onClick={() =>
                void run(async () =>
                  append(await binding("BRAND", catalog.brand!.id, "phone")),
                )
              }
            >
              Add venue phone
            </button>
            <button
              onClick={() =>
                void run(async () =>
                  append(await binding("HOURS", catalog.brand!.id, "hours")),
                )
              }
            >
              Add opening hours
            </button>
            <button
              onClick={() =>
                void run(async () =>
                  append(await binding("QR", catalog.brand!.id, "destination")),
                )
              }
            >
              Add menu QR
            </button>
            <button
              onClick={() =>
                void run(async () =>
                  append(
                    await binding(
                      "QR",
                      catalog.brand!.id,
                      "destination",
                      `/${document.locale}/order/`,
                    ),
                  ),
                )
              }
            >
              Add ordering QR
            </button>
            <button
              onClick={() =>
                void run(async () =>
                  append(await binding("BRAND", catalog.brand!.id, "address")),
                )
              }
            >
              Add address
            </button>
          </>
        )}
        {catalog.websiteAssets.map((asset) => (
          <button
            key={asset.id}
            onClick={() =>
              void run(async () => {
                await studioRequest(`/sources/brand-assets/${asset.id}`, {
                  method: "POST",
                });
                await refreshAssets();
              })
            }
          >
            Import venue {asset.kind.toLowerCase()}
          </button>
        ))}
        <details>
          <summary>Existing table QR</summary>
          <label>
            Table
            <select value={table} onChange={(e) => setTable(e.target.value)}>
              <option value="">Choose a table</option>
              {catalog.tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Existing QR link
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the link from table setup"
            />
          </label>
          <button
            disabled={!table || !token}
            onClick={() =>
              void run(async () => {
                append(await binding("TABLE_QR", table, "destination", token));
                setToken("");
              })
            }
          >
            Add verified table QR
          </button>
          <small>Existing links only. No token is rotated.</small>
        </details>
        <button
          onClick={() =>
            void run(async () => {
              const result = await studioRequest<{
                resolved: CreativeBinding[];
                changes: typeof changes;
              }>("/sources/check", {
                method: "POST",
                body: JSON.stringify({ projectId, document }),
              });
              setChanges(result.changes);
              setResolved(result.resolved);
              if (!result.changes.length)
                error("All connected sources are current.");
            })
          }
        >
          Check source freshness
        </button>
        {changes.length > 0 && (
          <div className="cs-error" role="status">
            <strong>Source changed</strong>
            {changes.map((c) => (
              <p key={c.previous.id}>
                {c.previous.value} → {c.current.value}
              </p>
            ))}
            <button
              onClick={() => {
                change(applyResolvedBindings(document, resolved));
                setChanges([]);
              }}
            >
              Update connected values
            </button>
            <button
              onClick={() => {
                setChanges([]);
              }}
            >
              Keep this design version
            </button>
          </div>
        )}
      </fieldset>
    </details>
  );
}

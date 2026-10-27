"use client";
import { useState } from "react";
import { creativeApi, studioRequest } from "./api";
import type { WorkspaceCopy } from "./workspace-copy";
export type WorkspaceAsset = {
  id: string;
  name: string;
  source: string;
  approvedForPublicUse: boolean;
  provenance?: {
    canonicalMediaId?: string;
    source?: string;
    internalReview?: boolean;
    catalog?: { kind: string; productId: string | null };
  };
};
export type WorkspaceCatalog = {
  venue: { id: string; name: string };
  products: { id: string; name: string; price: string }[];
  websiteAssets: { id: string }[];
};
export function WorkspaceAssets({
  t,
  catalog,
  assets,
  onChange,
}: {
  t: WorkspaceCopy;
  catalog: WorkspaceCatalog | null;
  assets: WorkspaceAsset[];
  onChange: (assets: WorkspaceAsset[]) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<WorkspaceAsset | null>(null);
  const [name, setName] = useState(""),
    [kind, setKind] = useState("VENUE"),
    [productId, setProductId] = useState("");
  function edit(asset: WorkspaceAsset) {
    setEditing(asset);
    setName(asset.name);
    setKind(asset.provenance?.catalog?.kind ?? "VENUE");
    setProductId(asset.provenance?.catalog?.productId ?? "");
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChange(await studioRequest("/assets"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <p className="cs-eyebrow">CREATIVE STUDIO / {t("photos")}</p>
      <h1>{t("photoTitle")}</h1>
      <p className="cw-subtitle">{t("photoNote")}</p>
      <label className="cw-upload">
        {t("upload")}
        <input
          disabled={busy}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void run(async () => {
              const asset = await studioRequest<WorkspaceAsset>("/assets", {
                method: "POST",
                headers: { "Content-Type": file.type },
                body: file,
              });
              edit({
                ...asset,
                name: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
              });
            });
            e.target.value = "";
          }}
        />
      </label>
      {error && (
        <p className="cs-error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <form
          className="cw-asset-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await studioRequest(`/assets/${editing.id}/catalog`, {
                method: "POST",
                body: JSON.stringify({
                  name,
                  kind,
                  productId: kind === "PRODUCT" ? productId : null,
                }),
              });
              setEditing(null);
            });
          }}
        >
          <label>
            {t("name")}
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {t("kind")}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {(
                [
                  ["VENUE", "venue"],
                  ["PRODUCT", "product"],
                  ["LOGO", "logo"],
                  ["ARTWORK", "artwork"],
                ] as const
              )
                .filter(
                  ([value]) =>
                    editing.source !== "GENERATED" || value !== "LOGO",
                )
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
            </select>
          </label>
          {kind === "PRODUCT" && (
            <label>
              {t("product")}
              <select
                required
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">—</option>
                {catalog?.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="cs-primary" disabled={busy}>
            {t("save")}
          </button>
        </form>
      )}
      <div className="cw-assets-grid">
        {assets.map((a) => (
          <article key={a.id}>
            <img
              loading="lazy"
              src={`${creativeApi}/assets/${a.id}/content`}
              alt={a.name}
            />
            <div>
              <h2>{a.name}</h2>
              <p>
                {a.source === "GENERATED" ? "AI · " : ""}
                {catalog?.products.find(
                  (p) => p.id === a.provenance?.catalog?.productId,
                )?.name ?? ""}
              </p>
              <span className="cw-badge">
                {a.provenance?.internalReview
                  ? "INTERNAL REVIEW"
                  : t(a.approvedForPublicUse ? "approved" : "pending")}
                {a.provenance?.source === "DEMO" && " · DEMO"}
              </span>
              <div className="cw-actions">
                <button
                  disabled={busy || !!a.provenance?.canonicalMediaId}
                  onClick={() => edit(a)}
                >
                  {t("kind")}
                </button>
                {!a.approvedForPublicUse && !a.provenance?.canonicalMediaId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await studioRequest(`/assets/${a.id}/approve`, {
                          method: "POST",
                        });
                      })
                    }
                  >
                    {t("approve")}
                  </button>
                )}
                {a.approvedForPublicUse &&
                  !a.provenance?.canonicalMediaId &&
                  a.provenance?.catalog?.productId && (
                    <div>
                      <small>{t("promoteNote")}</small>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await studioRequest(`/assets/${a.id}/promote`, {
                              method: "POST",
                              body: JSON.stringify({
                                kind: "PRODUCT",
                                productId: a.provenance!.catalog!.productId,
                                approved: true,
                              }),
                            });
                          })
                        }
                      >
                        {t("promote")}
                      </button>
                    </div>
                  )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

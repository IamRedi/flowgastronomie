"use client";
import { useState } from "react";
import type { SetupMediaAssignment } from "@flowgastronomie/domain";
import { setupApi } from "../setup-api";
import type { MediaPhoto } from "./media-types";
import type { MediaCopy } from "./media-copy";

export function PhotoTarget({
  title,
  productId,
  role,
  rows,
  assets,
  busy,
  demoTenant,
  words,
  onUpload,
  onChoose,
  onRemove,
  onPrimary,
  onMove,
}: {
  title: string;
  productId: string | null;
  role: SetupMediaAssignment["role"];
  rows: SetupMediaAssignment[];
  assets: MediaPhoto[];
  busy: boolean;
  demoTenant: boolean;
  words: MediaCopy;
  onUpload: (
    file: File,
    source: "UPLOAD" | "DEMO",
    publicUse: boolean,
    replace?: SetupMediaAssignment,
  ) => void;
  onChoose: (id: string) => void;
  onRemove: (row: SetupMediaAssignment) => void;
  onPrimary: (row: SetupMediaAssignment) => void;
  onMove: (row: SetupMediaAssignment, delta: number) => void;
}) {
  const [source, setSource] = useState<"UPLOAD" | "DEMO">(
    demoTenant ? "DEMO" : "UPLOAD",
  );
  const [publicUse, setPublicUse] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const multi = !!productId || role === "GALLERY";
  const displayed = rows
    .filter((r) => r.productId === productId && (productId || r.role === role))
    .sort((a, b) =>
      a.role === "PRIMARY"
        ? -1
        : b.role === "PRIMARY"
          ? 1
          : a.sortOrder - b.sortOrder,
    );
  const accept = "image/jpeg,image/png,image/webp";
  return (
    <article className="media-target" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <span className="setup-secondary">
          {displayed.length || words.noPhoto}
        </span>
      </header>
      <div className="media-photo-grid">
        {displayed.map((row) => {
          const photo = assets.find((a) => a.id === row.assetId);
          if (!photo) return null;
          return (
            <figure key={`${row.assetId}:${row.role}`}>
              <img src={`${setupApi}${photo.url}`} alt={title} loading="lazy" />
              <figcaption>
                {row.role === "PRIMARY" && (
                  <strong className="media-primary-badge">
                    {words.primary}
                  </strong>
                )}
                {photo.label && (
                  <span className="media-disclosure">{photo.label}</span>
                )}
                <span className="setup-secondary">
                  {photo.approvedForPublicUse ? words.approved : words.private}
                </span>
              </figcaption>
              <div className="media-photo-actions">
                {!!productId && (
                  <button disabled={busy} onClick={() => onPrimary(row)}>
                    {row.role === "PRIMARY"
                      ? words.makeGallery
                      : words.makePrimary}
                  </button>
                )}
                <label className="media-file-button">
                  {words.replace}
                  <input
                    type="file"
                    accept={accept}
                    disabled={busy}
                    aria-label={`${words.replace} ${title}`}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) onUpload(file, source, publicUse, row);
                    }}
                  />
                </label>
                <button disabled={busy} onClick={() => onRemove(row)}>
                  {words.remove}
                </button>
                {row.role === "GALLERY" && (
                  <>
                    <button
                      disabled={busy || row.sortOrder === 0}
                      onClick={() => onMove(row, -1)}
                      aria-label={words.up}
                    >
                      ↑
                    </button>
                    <button
                      disabled={
                        busy ||
                        row.sortOrder ===
                          displayed.filter((r) => r.role === "GALLERY").length -
                            1
                      }
                      onClick={() => onMove(row, 1)}
                      aria-label={words.down}
                    >
                      ↓
                    </button>
                  </>
                )}
              </div>
              <details className="media-provenance">
                <summary>{words.provenance}</summary>
                <p>
                  {photo.source} · {photo.width} × {photo.height}
                </p>
                <pre>{JSON.stringify(photo.provenance, null, 2)}</pre>
                <code>{photo.contentHash}</code>
              </details>
            </figure>
          );
        })}
      </div>
      {(multi || !displayed.length) && (
        <label
          className="media-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy && e.dataTransfer.files[0])
              onUpload(e.dataTransfer.files[0], source, publicUse);
          }}
        >
          <span aria-hidden="true">＋</span>
          <strong>{words.upload}</strong>
          <small>{words.drop}</small>
          <input
            type="file"
            accept={accept}
            disabled={busy}
            aria-label={`${words.upload} ${title}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onUpload(file, source, publicUse);
            }}
          />
        </label>
      )}
      <details className="media-permissions">
        <summary>{words.details}</summary>
        <p className="setup-secondary">{words.privacy}</p>
        <label>
          {words.source}
          <select
            aria-label={words.source}
            value={source}
            disabled={busy || demoTenant}
            onChange={(e) => {
              setSource(e.target.value as "UPLOAD" | "DEMO");
              setPublicUse(false);
            }}
          >
            <option value="UPLOAD">{words.actual}</option>
            <option value="DEMO">{words.demo}</option>
          </select>
        </label>
        {source === "UPLOAD" && (
          <label className="setup-check">
            <input
              type="checkbox"
              checked={publicUse}
              disabled={busy}
              onChange={(e) => setPublicUse(e.target.checked)}
            />
            {words.public}
          </label>
        )}
        <details onToggle={(e) => setLibraryOpen(e.currentTarget.open)}>
          <summary>{words.library}</summary>
          {libraryOpen && (
            <div className="media-library">
              {assets.map((a, index) => (
                <button
                  key={a.id}
                  disabled={busy}
                  aria-label={`${words.choose} ${index + 1}`}
                  onClick={() => onChoose(a.id)}
                >
                  <img src={`${setupApi}${a.url}`} alt="" loading="lazy" />
                  <small>
                    {a.label ??
                      (a.approvedForPublicUse ? words.approved : words.private)}
                  </small>
                </button>
              ))}
            </div>
          )}
        </details>
      </details>
    </article>
  );
}

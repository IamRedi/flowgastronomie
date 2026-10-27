"use client";
import { useState } from "react";
import type { CreativeBinding } from "@flowgastronomie/domain";
import { creativeApi, studioRequest, downloadCreativeFile } from "./api";
type Preflight = {
  version: number;
  confirmationHash: string;
  changes: { previous: CreativeBinding; current: CreativeBinding }[];
  warnings: string[];
};
export function ExportPanel({
  projectId,
  prepare,
  refresh,
}: {
  projectId: string;
  prepare: () => Promise<boolean>;
  refresh: () => Promise<void>;
}) {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(false);
  const [type, setType] = useState("PNG");
  const [bleed, setBleed] = useState(false);
  const [marks, setMarks] = useState(false);
  const [exports, setExports] = useState<
    { id: string; outputType: string; createdAt: string }[]
  >([]);
  const [preview, setPreview] = useState("");
  async function review() {
    setBusy(true);
    setError("");
    setKeep(false);
    try {
      if (!(await prepare()))
        throw new Error("Save your changes before export.");
      setPreflight(await studioRequest(`/projects/${projectId}/preflight`));
      setExports(await studioRequest(`/projects/${projectId}/exports`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="cs-export">
      <summary>Preview & export</summary>
      <div className="cs-export-body">
        <p>Review connected data, then create an immutable export.</p>
        <button disabled={busy} onClick={() => void review()}>
          Review export
        </button>
        {error && (
          <p role="alert" className="cs-error">
            {error}
          </p>
        )}
        {preflight && (
          <>
            {preflight.changes.length > 0 && (
              <div className="cs-error">
                <strong>Source changed</strong>
                {preflight.changes.map((c) => (
                  <p key={c.previous.id}>
                    {c.previous.value} → {c.current.value}
                  </p>
                ))}
                <label>
                  <input
                    type="checkbox"
                    checked={keep}
                    onChange={(e) => setKeep(e.target.checked)}
                  />
                  I reviewed these changes and want to export the saved values.
                </label>
                <p>To use current values, update them in Sources first.</p>
              </div>
            )}
            {preflight.warnings.map((w) => (
              <p key={w} className="cs-error">
                {w}
              </p>
            ))}
            <div className="cs-row">
              <label>
                File type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option>PNG</option>
                  <option>WEBP</option>
                  <option>PDF</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bleed}
                  onChange={(e) => setBleed(e.target.checked)}
                />
                3 mm bleed (print)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={marks}
                  onChange={(e) => setMarks(e.target.checked)}
                />
                Crop marks (PDF)
              </label>
            </div>
            <div className="cs-row">
              <button
                disabled={busy}
                onClick={async () => {
                  try {
                    const response = await fetch(
                      `${creativeApi}/projects/${projectId}/preview`,
                      { credentials: "include" },
                    );
                    if (!response.ok)
                      throw new Error(
                        "Preview could not be rendered. Check text fit and asset approval.",
                      );
                    if (preview) URL.revokeObjectURL(preview);
                    setPreview(URL.createObjectURL(await response.blob()));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Preview output
              </button>
              <button
                className="cs-primary"
                disabled={busy || (!!preflight.changes.length && !keep)}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    if (!(await prepare()))
                      throw new Error("Save your changes before export.");
                    const result = await studioRequest<{ id: string }>(
                      `/projects/${projectId}/exports`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          type,
                          expectedVersion: preflight.version,
                          confirmationHash: preflight.confirmationHash,
                          keepStale: keep,
                          bleed,
                          cropMarks: marks,
                          requestKey: crypto.randomUUID(),
                        }),
                      },
                    );
                    setExports(
                      await studioRequest(`/projects/${projectId}/exports`),
                    );
                    setPreflight(null);
                    await downloadCreativeFile(result.id, type);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    await refresh();
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Preparing…" : `Export ${type}`}
              </button>
            </div>
          </>
        )}
        {preview && (
          <div>
            <img
              className="cs-preview"
              src={preview}
              alt="Rendered export preview"
            />
            <button
              onClick={() => {
                URL.revokeObjectURL(preview);
                setPreview("");
              }}
            >
              Close preview
            </button>
          </div>
        )}
        <h3>Export history</h3>
        {exports.map((record) => (
          <a
            key={record.id}
            href={`${creativeApi}/exports/${record.id}/content`}
            onClick={(event) => {
              event.preventDefault();
              void downloadCreativeFile(record.id, record.outputType).catch(
                (e) => setError(e.message),
              );
            }}
          >
            {record.outputType} · {new Date(record.createdAt).toLocaleString()}
          </a>
        ))}
      </div>
    </details>
  );
}

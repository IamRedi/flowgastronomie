"use client";
import { useEffect, useState } from "react";
import { creativeApi, studioRequest } from "./api";
export function ImagePanel({
  projectId,
  sourceLayerId,
  prepare,
  useAsset,
  refreshAssets,
}: {
  projectId: string;
  sourceLayerId: string | null;
  prepare: () => Promise<boolean>;
  useAsset: (id: string, replace: boolean) => void;
  refreshAssets: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(false);
  const [asset, setAsset] = useState<{
    id: string;
    approvedForPublicUse: boolean;
  } | null>(null);
  useEffect(() => {
    void studioRequest<{ images: boolean }>("/capabilities")
      .then((c) => setConfigured(c.images))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <details className="cs-assistant">
      <summary>Generate an image asset</summary>
      <div className="cs-export-body">
        <p>
          Create an optional illustration for one image layer. Your text,
          prices, logo and QR stay editable.
        </p>
        <label>
          Art direction
          <textarea
            maxLength={2000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="An illustrated basil sprig on warm cream, no text"
          />
        </label>
        {sourceLayerId && (
          <label>
            <input
              type="checkbox"
              checked={edit}
              onChange={(e) => setEdit(e.target.checked)}
            />
            Edit the selected image
          </label>
        )}
        <p className="cs-muted">
          Generated food imagery is illustrative. Approve it before export. Each
          explicit generation may incur provider cost.
        </p>
        {!configured && (
          <p>
            Image generation is not configured. Upload or use an approved venue
            image.
          </p>
        )}
        <button
          disabled={!configured || busy || prompt.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (!(await prepare()))
                throw new Error("Save before generating an image.");
              setAsset(
                await studioRequest(`/projects/${projectId}/images`, {
                  method: "POST",
                  body: JSON.stringify({
                    prompt,
                    requestKey: crypto.randomUUID(),
                    sourceLayerId: edit ? sourceLayerId : null,
                  }),
                }),
              );
              await refreshAssets();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Generating one image…"
            : asset
              ? "Generate another image"
              : "Generate image"}
        </button>
        {error && (
          <p role="alert" className="cs-error">
            {error}
          </p>
        )}
        {asset && (
          <div className="cs-proposal">
            <img
              className="cs-preview"
              alt="AI-generated promotional illustration, pending your review"
              src={`${creativeApi}/assets/${asset.id}/content`}
            />
            <p className="cs-tag">
              AI-generated · {asset.approvedForPublicUse ? "Approved" : "Draft"}
            </p>
            <div className="cs-row">
              <button onClick={() => useAsset(asset.id, false)}>
                Add as image layer
              </button>
              {sourceLayerId && (
                <button onClick={() => useAsset(asset.id, true)}>
                  Replace selected image
                </button>
              )}
              <button
                disabled={asset.approvedForPublicUse}
                onClick={async () => {
                  try {
                    await studioRequest(`/assets/${asset.id}/approve`, {
                      method: "POST",
                    });
                    setAsset({ ...asset, approvedForPublicUse: true });
                    await refreshAssets();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Approve for public use
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

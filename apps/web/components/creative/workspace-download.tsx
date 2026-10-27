"use client";
import { useEffect, useState } from "react";
import { studioRequest, creativeApi, downloadCreativeFile } from "./api";
import type { StudioProject } from "./studio";
import type { WorkspaceCopy } from "./workspace-copy";
import { WorkspacePreview } from "./workspace-preview";
type Preflight = {
  version: number;
  confirmationHash: string;
  changes: unknown[];
  warnings: string[];
};
export function WorkspaceDownload({
  project,
  t,
  onProject,
  back,
}: {
  project: StudioProject;
  t: WorkspaceCopy;
  onProject: (project: StudioProject) => void;
  back: () => void;
}) {
  const [preflight, setPreflight] = useState<Preflight | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState<{ id: string; type: string } | null>(null);
  useEffect(() => {
    let active = true;
    setPreflight(null);
    void studioRequest<Preflight>(`/projects/${project.id}/preflight`)
      .then((p) => {
        if (active) setPreflight(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [project.id, project.version]);
  async function download(type: "PNG" | "PDF") {
    if (!preflight) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const file = await studioRequest<{ id: string }>(
        `/projects/${project.id}/exports`,
        {
          method: "POST",
          body: JSON.stringify({
            type,
            expectedVersion: preflight.version,
            confirmationHash: preflight.confirmationHash,
            keepStale: false,
            bleed: false,
            cropMarks: false,
            requestKey: crypto.randomUUID(),
          }),
        },
      );
      setResult({ id: file.id, type });
      onProject(await studioRequest(`/projects/${project.id}`));
      await downloadCreativeFile(file.id, type);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <p className="cs-eyebrow">04 / {t("download")}</p>
      <h1>{t("download")}</h1>
      <p className="cw-subtitle">{t("exportNote")}</p>
      <div className="cw-review-grid">
        <WorkspacePreview
          projectId={project.id}
          version={project.version}
          alt={project.title}
        />
        <div className="cw-download-options">
          {error && (
            <p role="alert" className="cs-error">
              {error}
            </p>
          )}
          {preflight?.changes.length ? (
            <p role="alert">{t("needsReview")}</p>
          ) : null}
          {preflight?.warnings.map((w) => (
            <p key={w} className="cw-notice">
              {w}
            </p>
          ))}
          {(["PDF", "PNG"] as const).map((type) => (
            <button
              className="cw-download-card"
              disabled={busy || !preflight || !!preflight.changes.length}
              key={type}
              onClick={() => void download(type)}
            >
              <b>{type}</b>
              <span>
                <strong>{t(type === "PDF" ? "print" : "digital")}</strong>
                <small>{t(type === "PDF" ? "printHint" : "digitalHint")}</small>
              </span>
              <span>↓</span>
            </button>
          ))}
          {busy && <p role="status">{t("loading")}</p>}
          {result && (
            <p className="cw-notice">
              <a
                href={`${creativeApi}/exports/${result.id}/content`}
                onClick={(e) => {
                  e.preventDefault();
                  void downloadCreativeFile(result.id, result.type).catch((e) =>
                    setError(e.message),
                  );
                }}
              >
                {t("downloadReady")} · {result.type} ↓
              </a>
            </p>
          )}
          <button disabled={busy} onClick={back}>
            {t("editAgain")}
          </button>
        </div>
      </div>
    </section>
  );
}

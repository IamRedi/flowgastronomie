"use client";
import { useEffect, useState } from "react";
import type { DesignDocument } from "@flowgastronomie/domain";
import type { StudioProject } from "./studio";
import { creativeApi, studioRequest, downloadCreativeFile } from "./api";
import type { WorkspaceCopy } from "./workspace-copy";
type Entry = StudioProject & {
  archiveState: "DRAFT" | "CURRENT" | "CHANGED" | "ARCHIVED";
  latestExport: { id: string; outputType: string } | null;
  needsReview?: boolean;
};
type Revision = {
  id: string;
  number: number;
  name: string | null;
  actor: string;
  createdAt: string;
};
export function WorkspaceArchive({
  t,
  locale,
  open,
}: {
  t: WorkspaceCopy;
  locale: DesignDocument["locale"];
  open: (id: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL"),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{
    project: Entry;
    revisions: Revision[];
    exports: { id: string; outputType: string; createdAt: string }[];
  } | null>(null);
  useEffect(() => {
    let active = true,
      pending = false;
    const load = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const initial = await studioRequest<Entry[]>("/projects");
        const reviews = new Set<string>();
        // Bound reconciliation concurrency for larger archives.
        for (let offset = 0; offset < initial.length; offset += 4) {
          if (!active) return;
          await Promise.all(
            initial
              .slice(offset, offset + 4)
              .filter((p) => p.status !== "ARCHIVED")
              .map(async (p) => {
                try {
                  const result = await studioRequest<{ needsReview: boolean }>(
                    `/projects/${p.id}/sync`,
                    { method: "POST" },
                  );
                  if (result.needsReview) reviews.add(p.id);
                } catch {
                  reviews.add(p.id);
                }
              }),
          );
        }
        const next = await studioRequest<Entry[]>("/projects");
        if (active) {
          setEntries(
            next.map((p) => ({ ...p, needsReview: reviews.has(p.id) })),
          );
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    DRAFT: "draft",
    CURRENT: "current",
    CHANGED: "changed",
    ARCHIVED: "archived",
  } as const;
  return (
    <section className="cw-archive">
      <p className="cs-eyebrow">CREATIVE STUDIO / {t("archive")}</p>
      <h1>{t("archiveTitle")}</h1>
      <p className="cw-subtitle">{t("archiveNote")}</p>
      <div className="cw-archive-tools">
        <div className="cw-filters">
          {["ALL", "CURRENT", "DRAFT", "CHANGED", "ARCHIVED"].map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "ALL"
                ? t("all")
                : t(labels[value as keyof typeof labels])}
            </button>
          ))}
        </div>
        <input
          aria-label={t("search")}
          placeholder={t("search")}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="cs-error">
          {error}
        </p>
      )}
      {loading && <p role="status">{t("loading")}</p>}
      {!loading && !entries.length && (
        <div className="cw-empty">
          <span>✦</span>
          <h2>{t("empty")}</h2>
        </div>
      )}
      <div className="cw-archive-grid">
        {entries
          .filter(
            (p) =>
              (filter === "ALL" || p.archiveState === filter) &&
              `${p.title} ${p.format}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .map((p) => (
            <article className="cw-archive-card" key={p.id}>
              <div
                className={`cw-archive-art ${p.format === "STICKER" ? "cw-round" : ""}`}
              >
                <span>{p.format}</span>
                <strong>{p.title}</strong>
                <small>v{p.version}</small>
              </div>
              <div className="cw-archive-info">
                <span
                  className={`cw-badge cw-badge-${p.archiveState.toLowerCase()}`}
                >
                  {p.needsReview
                    ? t("needsReview")
                    : t(labels[p.archiveState] ?? "draft")}
                </span>
                <h2>{p.title}</h2>
                <p>
                  {new Date(p.updatedAt).toLocaleDateString(locale)} · v
                  {p.version}
                </p>
                <div className="cw-actions">
                  <button
                    className="cs-primary"
                    disabled={busy}
                    onClick={() => open(p.id)}
                  >
                    {t("open")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const [revisions, exports] = await Promise.all([
                          studioRequest<Revision[]>(
                            `/projects/${p.id}/revisions`,
                          ),
                          studioRequest<
                            {
                              id: string;
                              outputType: string;
                              createdAt: string;
                            }[]
                          >(`/projects/${p.id}/exports`),
                        ]);
                        setHistory({ project: p, revisions, exports });
                      })
                    }
                  >
                    {t("history")}
                  </button>
                </div>
                {p.latestExport && (
                  <a
                    href={`${creativeApi}/exports/${p.latestExport.id}/content`}
                    onClick={(e) => {
                      e.preventDefault();
                      void run(() =>
                        downloadCreativeFile(
                          p.latestExport!.id,
                          p.latestExport!.outputType,
                        ),
                      );
                    }}
                  >
                    {t("latest")} · {p.latestExport.outputType}
                  </a>
                )}
                <button
                  className="cw-text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await studioRequest(`/projects/${p.id}/archive`, {
                        method: "POST",
                        body: JSON.stringify({
                          expectedVersion: p.version,
                          archived: p.status !== "ARCHIVED",
                        }),
                      });
                      setEntries(await studioRequest("/projects"));
                    })
                  }
                >
                  {t(p.status === "ARCHIVED" ? "unarchive" : "archiveAction")}
                </button>
              </div>
            </article>
          ))}
      </div>
      {history && (
        <section className="cw-history" aria-label={t("history")}>
          <div className="cw-review-header">
            <h2>
              {history.project.title} · {t("history")}
            </h2>
            <button onClick={() => setHistory(null)} aria-label="Close history">
              ×
            </button>
          </div>
          <ol>
            {history.revisions.map((r) => (
              <li key={r.id}>
                <div>
                  <strong>
                    v{r.number} · {r.name ?? r.actor}
                  </strong>
                  <small>
                    {new Date(r.createdAt).toLocaleString(locale)} · {r.actor}
                  </small>
                </div>
                <button
                  disabled={
                    busy ||
                    history.project.status === "ARCHIVED" ||
                    r.number === history.project.version
                  }
                  onClick={() =>
                    void run(async () => {
                      await studioRequest(
                        `/projects/${history.project.id}/restore`,
                        {
                          method: "POST",
                          body: JSON.stringify({
                            revisionId: r.id,
                            expectedVersion: history.project.version,
                          }),
                        },
                      );
                      open(history.project.id);
                    })
                  }
                >
                  {t("restore")}
                </button>
              </li>
            ))}
          </ol>
          <div className="cw-actions">
            {history.exports.map((e) => (
              <a
                key={e.id}
                href={`${creativeApi}/exports/${e.id}/content`}
                onClick={(event) => {
                  event.preventDefault();
                  void run(() => downloadCreativeFile(e.id, e.outputType));
                }}
              >
                {e.outputType} · {new Date(e.createdAt).toLocaleString(locale)}
              </a>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

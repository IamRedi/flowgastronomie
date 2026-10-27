"use client";
import { websiteBuilderCopy } from "../../../../../components/website-builder-copy";
import {
  cacheReview,
  cachedReview,
  clearReviewCache,
  sameReview,
} from "./review-cache";
import { CompactReview } from "./compact-review";
import { compactCopy } from "./compact-copy";
import { entryCopy } from "./entry-copy";
import { ImportEntry } from "./import-entry";
import { PosActivation } from "../../../../../components/pos-activation";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  businessImportFieldNames,
  premiumStyles,
  businessProfileIds,
  businessReviewReadiness,
  isUnfinishedBusinessImport,
  type BusinessImportState,
  type BusinessReview,
  type ReviewedMenuItem,
  type PlatformLocale,
} from "@flowgastronomie/domain";
import { setupApi } from "../setup-api";
import { businessImportCopy } from "./import-copy";
import {
  ImportFields,
  ImportProduct,
  ImportPhotographs,
} from "./import-review";
import "./import.css";

export type ImportView = {
  provenance?: {
    providerCalls?: number;
    provider?: { status: string };
    coverage?: Array<{ page: number; products: number; method: string }>;
  };
  id: string;
  version: number;
  status: string;
  canonicalRevision: string;
  businessData: BusinessImportState;
  sources: {
    id: string;
    filename: string;
    mimeType: string;
    contentHash: string;
    sourceUrl: string | null;
    url: string;
  }[];
  items: {
    id: string;
    importedProductId?: string | null;
    reviewed: ReviewedMenuItem;
    original: unknown;
  }[];
  canonical: {
    venue: { name: string; currency: string };
    website: null | {
      premiumStyleId: string | null;
      phone: string | null;
      address: string | null;
      contactEmail: string | null;
      openingHours: unknown;
      instagramUrl: string | null;
      facebookUrl: string | null;
      primaryColor: string;
      translations: {
        locale: string;
        heroSubtitle: string;
        seoTitle: string;
        seoDescription: string;
      }[];
    };
    categories: {
      id: string;
      translations: { name: string; locale: string }[];
    }[];
    products: {
      id: string;
      priceMinor: number;
      currency: string;
      published: boolean;
      archivedAt: string | null;
      translations: {
        name: string;
        locale: string;
        description: string | null;
      }[];
    }[];
  };
};
class ImportHttpError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${setupApi}/v1/staff/${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ImportHttpError(error.code ?? "FAILED");
  }
  return response.json() as Promise<T>;
}
function initialReview(data: ImportView): BusinessReview {
  const saved = data.businessData.review;
  if (saved && saved.canonicalRevision !== data.canonicalRevision)
    return {
      ...saved,
      expectedVersion: data.version,
      canonicalRevision: data.canonicalRevision,
      confirm: false,
      fields: saved.fields.map((f) => ({
        ...f,
        decision: f.decision === "APPROVE" ? "PENDING" : f.decision,
      })),
      items: saved.items.map((i) => ({
        ...i,
        action: i.action === "SKIP" ? "SKIP" : "PENDING",
        approvePrice: false,
        approveConfiguration: false,
      })),
    };
  return data.businessData.review
    ? { ...data.businessData.review, expectedVersion: data.version }
    : {
        expectedVersion: data.version,
        canonicalRevision: data.canonicalRevision,
        confirm: false,
        fields: businessImportFieldNames.map((field) => {
          const proposal = data.businessData.fields.find(
            (f) => f.field === field,
          );
          return {
            field,
            proposalId: proposal?.id ?? null,
            value: proposal?.value ?? "",
            decision: proposal ? "PENDING" : "REJECT",
          };
        }),
        items: data.items.map((row) => ({
          id: row.id,
          item: row.reviewed,
          action: "PENDING",
          targetProductId: null,
          approvePrice: false,
          approveConfiguration: false,
        })),
        media: [],
        premiumStyleId: data.canonical.website?.premiumStyleId ?? null,
      };
}
export function BusinessImportClient({
  locale,
  menuOnly = false,
  onCommitted,
}: {
  locale: PlatformLocale;
  menuOnly?: boolean;
  onCommitted?: () => void;
}) {
  const normalizeReview = useCallback(
    (value: BusinessReview): BusinessReview =>
      menuOnly
        ? {
            ...value,
            fields: value.fields.map((f) => ({ ...f, decision: "REJECT" })),
            premiumStyleId: null,
            media: value.media.filter((m) => !!m.targetItemId),
          }
        : value,
    [menuOnly],
  );
  const words = businessImportCopy(locale);
  const c = compactCopy(locale);
  const e = entryCopy(locale);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [capabilities, setCapabilities] = useState<{
    ai: boolean;
    venue: { id: string; name: string };
  } | null>(null);
  const edits = useRef(0);
  const generation = useRef(0);
  const [entryKey, setEntryKey] = useState(0);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const discardDialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<ImportView | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [review, setReview] = useState<BusinessReview | null>(null);
  const [history, setHistory] = useState<
    {
      id: string;
      status: string;
      phase: BusinessImportState["phase"];
      createdAt: string;
    }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [family, setFamily] = useState("RESTAURANT");
  const createAttempt = useRef<{ key: string; url: string | null } | null>(
    null,
  );
  const accept = useCallback(
    (value: ImportView) => {
      setData(value);
      setReview(normalizeReview(initialReview(value)));
      setDirty(false);
      setConfirmed(false);
      const styleId =
        value.businessData.review?.premiumStyleId ??
        value.canonical.website?.premiumStyleId;
      const selectedFamily = styleId?.replace(/-\d+$/, "").toUpperCase();
      if (
        selectedFamily &&
        businessProfileIds.some((id) => id === selectedFamily)
      )
        setFamily(selectedFamily);
      if (!menuOnly)
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}?import=${encodeURIComponent(value.id)}`,
        );
    },
    [menuOnly, normalizeReview],
  );
  const load = useCallback(
    async (id: string, restoreLocal = false) => {
      const currentGeneration = ++generation.current;
      const value = await request<ImportView>(`business-imports/${id}`);
      if (currentGeneration !== generation.current) return;
      // A cached draft is considered only after a successful scoped server read.
      const local =
        restoreLocal && value.businessData.phase === "REVIEW"
          ? cachedReview(id)
          : null;
      accept(value);
      if (
        local &&
        (!value.businessData.review ||
          !sameReview(local, value.businessData.review))
      ) {
        edits.current++;
        setReview(
          normalizeReview({
            ...local,
            expectedVersion: value.version,
            confirm: false,
          }),
        );
        setDirty(true);
        const conflict =
          local.canonicalRevision !== value.canonicalRevision ||
          local.expectedVersion !== value.version;
        setSaveFailed(conflict);
        if (conflict) setError(words.conflict);
      } else clearReviewCache(id);
    },
    [accept, words.conflict, normalizeReview],
  );
  const report = useCallback(
    (err: unknown) => {
      const code = err instanceof ImportHttpError ? err.code : "FAILED";
      setError(
        code === "CONFLICT"
          ? words.conflict
          : code === "LIMIT"
            ? words.limitError
            : ["INVALID_INPUT", "REVIEW_REQUIRED"].includes(code)
              ? words.reviewError
              : words.error,
      );
    },
    [words],
  );
  useEffect(() => {
    void request<NonNullable<typeof capabilities>>(
      "business-imports/capabilities",
    )
      .then(setCapabilities)
      .catch(() => {});
    let alive = true;
    request<typeof history>("business-imports")
      .then(async (list) => {
        if (!alive) return;
        setHistory(list);
        const id = menuOnly
          ? null
          : new URLSearchParams(window.location.search).get("import");
        if (id) await load(id, true);
      })
      .catch(report)
      .finally(() => {
        if (alive) setLoadingHistory(false);
      });
    return () => {
      alive = false;
    };
  }, [load, report, menuOnly]);
  useEffect(() => {
    if (discardTarget) discardDialog.current?.showModal();
    else discardDialog.current?.close();
  }, [discardTarget]);
  function resetEntry() {
    generation.current++;
    edits.current++;
    setData(null);
    setReview(null);
    setDirty(false);
    setConfirmed(false);
    setSaveFailed(false);
    setError("");
    setNotice("");
    setSaving(false);
    setRestoreConfirmed(false);
    createAttempt.current = null;
    setEntryKey((key) => key + 1);
    if (!menuOnly)
      window.history.replaceState(null, "", window.location.pathname);
  }
  async function refreshHistory() {
    setHistory(await request<typeof history>("business-imports"));
  }
  async function uploadFiles(current: ImportView, files: File[]) {
    for (const file of files) {
      const response = await fetch(
        `${setupApi}/v1/staff/menu-imports/${current.id}/sources?expectedVersion=${current.version}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": file.type,
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        },
      );
      if (!response.ok) {
        const err = await response.json();
        throw new ImportHttpError(err.code);
      }
      current = await request<ImportView>(`business-imports/${current.id}`);
      accept(current);
    }
    return current;
  }
  async function discard(id: string) {
    generation.current++; // Ignore responses from an older in-flight autosave.
    setSaving(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      const latest = await request<ImportView>(`business-imports/${id}`);
      try {
        if (latest.businessData.phase !== "CANCELLED")
          await request(`business-imports/${id}/discard`, "POST", {
            expectedVersion: latest.version,
            confirm: true,
          });
        break;
      } catch (err) {
        const recovered = await request<ImportView>(`business-imports/${id}`);
        if (recovered.businessData.phase === "CANCELLED") break;
        if (
          attempt ||
          !(err instanceof ImportHttpError) ||
          err.code !== "CONFLICT"
        )
          throw err;
      }
    }
    clearReviewCache(id);
    setDiscardTarget(null);
    resetEntry();
    await refreshHistory();
  }
  const phase = data?.businessData.phase;
  const readiness =
    data && review
      ? businessReviewReadiness(
          review,
          data.businessData,
          data.canonical.venue.currency,
          data.items.map((i) => i.id),
        )
      : null;
  useEffect(() => {
    if (!data || phase !== "ANALYZING") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request<ImportView>(`business-imports/${data.id}`);
        if (!stopped) {
          setData(next);
          if (next.businessData.phase !== "ANALYZING") accept(next);
        }
      } catch (err) {
        if (!stopped) report(err);
      } finally {
        if (!stopped) timer = setTimeout(poll, 1200);
      }
    };
    timer = setTimeout(poll, 1200);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [data?.id, phase, accept, report]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    const online = () => {
      if (dirty) setSaveFailed(false);
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("online", online);
    };
  }, [dirty]);
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }
  function change(next: BusinessReview) {
    edits.current++;
    setSaveFailed(false);
    let pending = {
      ...next,
      expectedVersion: data?.version ?? next.expectedVersion,
      confirm: false,
    };
    pending = normalizeReview(pending);
    if (data) cacheReview(data.id, pending);
    setReview(pending);
    setDirty(true);
    setConfirmed(false);
    setNotice("");
  }
  useEffect(() => {
    if (
      !dirty ||
      !data ||
      !review ||
      phase !== "REVIEW" ||
      busy ||
      saving ||
      saveFailed
    )
      return;
    const seq = edits.current;
    const currentGeneration = generation.current;
    const timer = setTimeout(() => {
      setSaving(true);
      void request<ImportView>(`business-imports/${data.id}/review`, "PUT", {
        ...review,
        expectedVersion: data.version,
        confirm: false,
      })
        .then((saved) => {
          if (currentGeneration !== generation.current) return;
          setData(saved);
          if (edits.current === seq) {
            clearReviewCache(data.id);
            setReview(normalizeReview(initialReview(saved)));
            setDirty(false);
          } else
            setReview((current) =>
              current
                ? { ...current, expectedVersion: saved.version }
                : current,
            );
          setSaveFailed(false);
        })
        .catch(async () => {
          if (currentGeneration !== generation.current) return;
          // A save may have committed before its response was lost. Reconcile before retry.
          try {
            const latest = await request<ImportView>(
              `business-imports/${data.id}`,
            );
            if (currentGeneration !== generation.current) return;
            if (latest.businessData.phase === "CANCELLED") {
              clearReviewCache(data.id);
              resetEntry();
              void refreshHistory();
              return;
            }
            if (latest.canonicalRevision !== review.canonicalRevision) {
              setError(words.conflict);
              setSaveFailed(true);
              return;
            }
            setData(latest);
            if (
              latest.businessData.review &&
              sameReview(latest.businessData.review, review) &&
              edits.current === seq
            ) {
              clearReviewCache(data.id);
              setReview(normalizeReview(initialReview(latest)));
              setDirty(false);
              setSaveFailed(false);
            } else {
              setReview((current) =>
                current
                  ? { ...current, expectedVersion: latest.version }
                  : current,
              );
              setSaveFailed(true);
            }
          } catch {
            if (currentGeneration === generation.current) setSaveFailed(true);
          }
        })
        .finally(() => {
          if (currentGeneration === generation.current) setSaving(false);
        });
    }, 900);
    return () => clearTimeout(timer);
  }, [dirty, data, review, phase, busy, saving, saveFailed]);
  const activeStep =
    !data || phase === "SOURCES" || phase === "ANALYZING"
      ? 0
      : phase === "REVIEW"
        ? 1
        : 2;
  const styles = premiumStyles().filter((style) =>
    style.id.startsWith(`${family.toLowerCase()}-`),
  );
  if (loadingHistory)
    return (
      <main className="business-import">
        <p role="status">{words.resume}…</p>
      </main>
    );
  return (
    <main className="business-import">
      <header className="bi-intro">
        <span className="bi-eyebrow">FLOWGASTRONOMIE / SMART IMPORT</span>
        <h1>{e.title}</h1>
        <p>
          {e.activeBusiness}:{" "}
          <strong>
            {capabilities?.venue.name ?? data?.canonical.venue.name ?? "…"}
          </strong>
        </p>
      </header>
      <ol className="bi-steps" aria-label={words.title}>
        {[words.source, words.review, c.finish].map((label, i) => (
          <li key={label} aria-current={i === activeStep ? "step" : undefined}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <div className="bi-alert" role="alert">
          {error}{" "}
          {data && (
            <button onClick={() => act(() => load(data.id))}>
              {words.reload}
            </button>
          )}
        </div>
      )}
      <p className="bi-notice" role="status">
        {saving
          ? c.saving
          : saveFailed
            ? c.unsaved
            : busy
              ? "…"
              : dirty
                ? words.changed
                : notice || (review && phase === "REVIEW" ? c.saved : "")}
      </p>
      {data?.provenance && phase === "REVIEW" && (
        <details className="bi-advanced">
          <summary>{words.details}</summary>
          <p>
            {data.provenance.providerCalls
              ? `AI: ${data.provenance.provider?.status ?? "UNVERIFIED"}`
              : "PDF/HTML text / AI: 0"}
          </p>
          <p>
            {data.provenance.coverage
              ?.map((p) => `${p.page}: ${p.products} (${p.method})`)
              .join(" / ")}
          </p>
        </details>
      )}
      {capabilities && (
        <details className="bi-method-note">
          <summary>{e.info}</summary>
          <p>{capabilities.ai ? c.aiOn : c.aiOff}</p>
        </details>
      )}
      {!data ? (
        <>
          <p className="bi-entry-intro">{e.intro}</p>
          {history
            .filter((row) => isUnfinishedBusinessImport(row.phase))
            .map((row) => (
              <div className="bi-pending" key={row.id}>
                <span>
                  <strong>{e.pending}</strong>
                  <small>
                    {new Date(row.createdAt).toLocaleString(locale)}
                  </small>
                </span>
                <button
                  disabled={busy}
                  onClick={() => act(() => load(row.id, true))}
                >
                  {e.resume}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setDiscardTarget(row.id)}
                >
                  {e.remove}
                </button>
              </div>
            ))}
          <ImportEntry
            key={entryKey}
            locale={locale}
            busy={busy}
            start={(files, sourceUrl) =>
              void act(async () => {
                if (
                  !createAttempt.current ||
                  createAttempt.current.url !== sourceUrl
                )
                  createAttempt.current = {
                    key: crypto.randomUUID(),
                    url: sourceUrl,
                  };
                let current = await request<ImportView>(
                  "business-imports",
                  "POST",
                  {
                    requestKey: createAttempt.current.key,
                    locale,
                    url: sourceUrl,
                    authorized: true,
                  },
                );
                accept(current);
                current = await uploadFiles(current, files);
                accept(
                  await request<ImportView>(
                    `business-imports/${current.id}/analyze`,
                    "POST",
                    {
                      expectedVersion: current.version,
                      requestKey: crypto.randomUUID(),
                    },
                  ),
                );
                await refreshHistory();
              })
            }
          />
          {history.some((row) => !isUnfinishedBusinessImport(row.phase)) && (
            <details className="bi-advanced">
              <summary>{e.history}</summary>
              {history
                .filter((row) => !isUnfinishedBusinessImport(row.phase))
                .map((row) => (
                  <button
                    key={row.id}
                    disabled={busy}
                    onClick={() => act(() => load(row.id))}
                  >
                    {new Date(row.createdAt).toLocaleString(locale)}
                  </button>
                ))}
            </details>
          )}
        </>
      ) : (
        <>
          <div className="bi-source-bar">
            <div>
              <small>{e.source}</small>
              <strong>
                {[
                  ...data.sources.map((source) => source.filename),
                  ...(data.businessData.url
                    ? [new URL(data.businessData.url).hostname]
                    : []),
                ].join(" / ") || e.noSource}
              </strong>
            </div>
            <button
              disabled={busy || saving}
              onClick={() => {
                resetEntry();
                void refreshHistory();
              }}
            >
              {e.back}
            </button>
            {isUnfinishedBusinessImport(data.businessData.phase) && (
              <button disabled={busy} onClick={() => setDiscardTarget(data.id)}>
                {e.cancel}
              </button>
            )}
          </div>
          {phase === "CANCELLED" && <p role="status">{e.cancelled}</p>}
          {phase === "SOURCES" && (
            <section className="bi-panel">
              <h2>{words.upload}</h2>
              <p>{words.filesHint}</p>
              <input
                aria-label={words.upload}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                multiple
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void act(async () => {
                    await uploadFiles(data, files);
                  });
                }}
              />
              <ul>
                {data.sources.map((source) => (
                  <li key={source.id}>{source.filename}</li>
                ))}
              </ul>
              <button
                className="bi-primary"
                disabled={
                  busy || (!data.sources.length && !data.businessData.url)
                }
                onClick={() =>
                  act(async () =>
                    accept(
                      await request<ImportView>(
                        `business-imports/${data.id}/analyze`,
                        "POST",
                        {
                          expectedVersion: data.version,
                          requestKey: crypto.randomUUID(),
                        },
                      ),
                    ),
                  )
                }
              >
                {words.analyze} →
              </button>
            </section>
          )}
          {phase === "ANALYZING" && (
            <section className="bi-panel bi-progress" aria-live="polite">
              <span className="bi-spinner" />
              <h2>{words.analyzing}</h2>
              <p>
                {data.sources.length} {words.progress}
              </p>
              <progress aria-label={words.analyzing} />
            </section>
          )}
          {data.businessData.warnings.length > 0 && (
            <details className="bi-warnings">
              <summary>
                {words.warnings} · {data.businessData.warnings.length}
              </summary>
              <p>{words.manual}</p>
              <ul>
                {data.businessData.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          {phase === "REVIEW" && review && (
            <fieldset className="bi-review" disabled={busy}>
              <CompactReview
                data={data}
                menuOnly={menuOnly}
                review={review}
                change={change}
                locale={locale}
                words={words}
                incomplete={readiness?.incompleteItems ?? []}
              />
              <details className="bi-advanced">
                <summary>{words.manual}</summary>{" "}
                <button
                  disabled={dirty}
                  onClick={() =>
                    act(async () =>
                      accept(
                        await request<ImportView>(
                          `business-imports/${data.id}/items`,
                          "POST",
                          {
                            expectedVersion: data.version,
                            requestKey: crypto.randomUUID(),
                            item: {
                              categoryId: null,
                              categoryName: "",
                              name: "",
                              description: "",
                              priceMinor: null,
                              currency: data.canonical.venue.currency,
                              station: "KITCHEN",
                              variants: [],
                              modifierGroups: [],
                              approvedAllergens: [],
                              duplicateAcknowledged: false,
                            },
                          },
                        ),
                      ),
                    )
                  }
                >
                  + {words.add}
                </button>
              </details>
              {!menuOnly && (
                <details className="bi-advanced">
                  <summary>{c.advanced}</summary>
                  <section className="bi-panel" id="import-media">
                    <div className="bi-section-title">
                      <span>03</span>
                      <h2>{words.media}</h2>
                    </div>
                    <ImportPhotographs
                      data={data}
                      review={review}
                      words={words}
                      onChange={change}
                      onImport={(candidateId, publicUse) =>
                        act(async () => {
                          if (dirty) {
                            const saved = await request<ImportView>(
                              `business-imports/${data.id}/review`,
                              "PUT",
                              {
                                ...review,
                                expectedVersion: data.version,
                                confirm: false,
                              },
                            );
                            const next = await request<ImportView>(
                              `business-imports/${data.id}/images/${candidateId}`,
                              "POST",
                              {
                                expectedVersion: saved.version,
                                rightsConfirmed: true,
                                publicUse,
                              },
                            );
                            accept(next);
                          } else
                            accept(
                              await request<ImportView>(
                                `business-imports/${data.id}/images/${candidateId}`,
                                "POST",
                                {
                                  expectedVersion: data.version,
                                  rightsConfirmed: true,
                                  publicUse,
                                },
                              ),
                            );
                        })
                      }
                    />
                  </section>
                  <section className="bi-panel" id="import-style">
                    <div className="bi-section-title">
                      <span>04</span>
                      <h2>{words.style}</h2>
                    </div>
                    <label>
                      {words.profile}
                      <select
                        value={family}
                        aria-label={words.profile}
                        onChange={(e) => setFamily(e.target.value)}
                      >
                        {businessProfileIds.map((value) => (
                          <option key={value} value={value}>
                            {words.profiles[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="bi-styles">
                      {styles.map((style) => (
                        <button
                          key={style.id}
                          type="button"
                          className="bi-style"
                          aria-pressed={review.premiumStyleId === style.id}
                          style={{
                            background: style.backgroundColor,
                            color: style.primaryColor,
                          }}
                          onClick={() =>
                            change({ ...review, premiumStyleId: style.id })
                          }
                        >
                          <small>{style.layout}</small>
                          <strong>
                            {review.fields.find((f) => f.field === "venueName")
                              ?.value || data.canonical.venue.name}
                          </strong>
                          <span>{style.name}</span>
                          <i />
                          <i />
                          <i />
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() =>
                        change({
                          ...review,
                          premiumStyleId:
                            data.canonical.website?.premiumStyleId ?? null,
                        })
                      }
                    >
                      {words.keepStyle}
                    </button>
                  </section>
                </details>
              )}
              <div className="bi-save-bar" id="import-save">
                <div aria-live="polite">
                  <p>{words.saveReviewHelp}</p>
                  <p>{words.saveDraftHelp}</p>
                  {readiness && (
                    <p>
                      {words.selectedCount}: {readiness.selectedProducts} ·{" "}
                      {words.remainingCount}:{" "}
                      {readiness.incompleteItems.length +
                        readiness.pendingFields.length}
                    </p>
                  )}
                  {readiness && !readiness.ready && (
                    <ul>
                      {readiness.pendingFields.slice(0, 3).map((field) => (
                        <li key={field}>
                          <a href="#import-identity">{words.fields[field]}</a> —{" "}
                          {words.reviewError}
                        </li>
                      ))}
                      {review.items
                        .filter((i) => readiness.incompleteItems.includes(i.id))
                        .slice(0, 3)
                        .map((i) => (
                          <li key={i.id}>
                            <a href={`#import-item-${i.id}`}>
                              {i.item.name || words.missing}
                            </a>{" "}
                            — {words.itemReviewHelp}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
                <button
                  hidden={!saveFailed}
                  disabled={saving}
                  onClick={() =>
                    act(async () => {
                      accept(
                        await request<ImportView>(
                          `business-imports/${data.id}/review`,
                          "PUT",
                          {
                            ...review,
                            expectedVersion: data.version,
                            confirm: false,
                          },
                        ),
                      );
                      setNotice(words.savedReview);
                    })
                  }
                >
                  {words.save}
                </button>
                <label className="bi-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  {words.confirm}
                </label>
                <button
                  className="bi-primary"
                  disabled={
                    saving ||
                    !confirmed ||
                    !readiness?.ready ||
                    !readiness.selectedProducts
                  }
                  onClick={() =>
                    act(async () => {
                      const approved = await request<ImportView>(
                        `business-imports/${data.id}/review`,
                        "PUT",
                        {
                          ...review,
                          expectedVersion: data.version,
                          confirm: true,
                        },
                      );
                      accept(approved);
                      try {
                        await request(
                          `business-imports/${data.id}/commit`,
                          "POST",
                          { expectedVersion: approved.version, confirm: true },
                        );
                      } catch (err) {
                        const recovered = await request<ImportView>(
                          `business-imports/${data.id}`,
                        );
                        if (recovered.businessData.phase === "COMMITTED") {
                          accept(recovered);
                          onCommitted?.();
                          return;
                        }
                        throw err;
                      }
                      await load(data.id);
                      onCommitted?.();
                    })
                  }
                >
                  {c.import} {readiness?.selectedProducts ?? 0} {c.products} →
                </button>
              </div>
            </fieldset>
          )}
          {(phase === "COMMITTED" || phase === "REVERTED") && (
            <section className="bi-panel bi-complete">
              <h2>{phase === "COMMITTED" ? words.saved : words.reverted}</h2>
              <p>{words.savedText}</p>
              <p>
                {c.count}:{" "}
                {data.items.filter((i) => i.importedProductId).length} /{" "}
                {review?.items.filter((i) => i.action === "SKIP").length ?? 0}
              </p>
              {phase === "COMMITTED" && (
                <PosActivation
                  locale={locale}
                  productIds={data.items.flatMap((i) =>
                    i.importedProductId ? [i.importedProductId] : [],
                  )}
                />
              )}

              <a href={`/${locale}/staff/menu`}>{words.manageDraft} →</a>
              <p>{words.publishHelp}</p>
              <a
                className="button button-primary"
                href={`/app/${locale}/website`}
              >
                {websiteBuilderCopy(locale)[0]} &rarr;
              </a>
              <details>
                <summary>{c.advanced}</summary>
                <a href={`/app/${locale}/website/preview`}>{words.preview} ↗</a>
                <a href={`/app/${locale}/website`}>{words.edit}</a>
              </details>
              {phase === "COMMITTED" && (
                <details>
                  <summary>{words.revert}</summary>
                  <label className="bi-check">
                    <input
                      type="checkbox"
                      checked={restoreConfirmed}
                      onChange={(e) => setRestoreConfirmed(e.target.checked)}
                    />
                    {words.revertConfirm}
                  </label>
                  <button
                    disabled={busy || !restoreConfirmed}
                    onClick={() =>
                      act(async () => {
                        await request(
                          `business-imports/${data.id}/revert`,
                          "POST",
                          { expectedVersion: data.version, confirm: true },
                        );
                        await load(data.id);
                        onCommitted?.();
                      })
                    }
                  >
                    {words.revert}
                  </button>
                </details>
              )}
            </section>
          )}
        </>
      )}
      {discardTarget && (
        <dialog
          className="bi-discard-dialog"
          ref={discardDialog}
          onCancel={() => setDiscardTarget(null)}
          aria-labelledby="discard-title"
        >
          <h2 id="discard-title">{e.confirmTitle}</h2>
          <p>{e.confirmText}</p>
          {error && <p role="alert">{error}</p>}
          <div className="bi-inline-actions">
            <button disabled={busy} onClick={() => setDiscardTarget(null)}>
              {e.keep}
            </button>
            <button
              className="bi-primary"
              disabled={busy}
              onClick={() => {
                if (discardTarget) void act(() => discard(discardTarget));
              }}
            >
              {e.confirm}
            </button>
          </div>
        </dialog>
      )}
    </main>
  );
}

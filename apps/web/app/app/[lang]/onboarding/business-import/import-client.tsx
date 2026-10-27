"use client";
import { useCallback, useEffect, useState } from "react";
import {
  businessImportFieldNames,
  premiumStyles,
  businessProfileIds,
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
  items: { id: string; reviewed: ReviewedMenuItem; original: unknown }[];
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
export function BusinessImportClient({ locale }: { locale: PlatformLocale }) {
  const words = businessImportCopy(locale);
  const [data, setData] = useState<ImportView | null>(null);
  const [review, setReview] = useState<BusinessReview | null>(null);
  const [history, setHistory] = useState<
    { id: string; status: string; createdAt: string }[]
  >([]);
  const [url, setUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [family, setFamily] = useState("RESTAURANT");
  const [createKey, setCreateKey] = useState<string | null>(null);
  const accept = useCallback((value: ImportView) => {
    setData(value);
    setReview(initialReview(value));
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
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?import=${encodeURIComponent(value.id)}`,
    );
  }, []);
  const load = useCallback(
    async (id: string) => {
      accept(await request<ImportView>(`business-imports/${id}`));
    },
    [accept],
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
    let alive = true;
    request<typeof history>("business-imports")
      .then(async (list) => {
        if (!alive) return;
        setHistory(list);
        const id = new URLSearchParams(window.location.search).get("import");
        if (id) await load(id);
      })
      .catch(report);
    return () => {
      alive = false;
    };
  }, [load, report]);
  const phase = data?.businessData.phase;
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
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
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
    setReview({ ...next, confirm: false });
    setDirty(true);
    setConfirmed(false);
    setNotice("");
  }
  const activeStep =
    !data || phase === "SOURCES"
      ? 0
      : phase === "ANALYZING"
        ? 1
        : phase === "REVIEW"
          ? 2
          : 3;
  const styles = premiumStyles().filter((style) =>
    style.id.startsWith(`${family.toLowerCase()}-`),
  );
  return (
    <main className="business-import">
      <header className="bi-intro">
        <span className="bi-eyebrow">FLOWGASTRONOMIE / SMART IMPORT</span>
        <h1>{words.title}</h1>
        <p>{words.intro}</p>
      </header>
      <ol className="bi-steps" aria-label={words.title}>
        {[words.source, words.analyze, words.review, words.draft].map(
          (label, i) => (
            <li
              key={label}
              aria-current={i === activeStep ? "step" : undefined}
            >
              <span>{i + 1}</span>
              {label}
            </li>
          ),
        )}
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
        {busy ? "…" : dirty ? words.changed : notice}
      </p>
      {!data ? (
        <section className="bi-panel">
          <h2>{words.source}</h2>
          <label>
            {words.url}
            <input
              type="url"
              placeholder="https://"
              value={url}
              maxLength={2048}
              onChange={(e) => {
                setUrl(e.target.value);
                setCreateKey(null);
              }}
            />
          </label>
          <label className="bi-check">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
            />
            {words.authorize}
          </label>
          <button
            className="bi-primary"
            disabled={busy || !authorized}
            onClick={() =>
              act(async () => {
                const key = createKey ?? crypto.randomUUID();
                setCreateKey(key);
                accept(
                  await request<ImportView>("business-imports", "POST", {
                    requestKey: key,
                    locale,
                    url: url.trim() || null,
                    authorized: true,
                  }),
                );
              })
            }
          >
            {words.start} →
          </button>
          <p>{words.manual}</p>
          {history.length > 0 && (
            <label>
              {words.resume}
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) void act(() => load(e.target.value));
                }}
              >
                <option value="">{words.choose}</option>
                {history.map((row) => (
                  <option value={row.id} key={row.id}>
                    {new Date(row.createdAt).toLocaleString(locale)} ·{" "}
                    {row.status}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      ) : (
        <>
          <div className="bi-source-bar">
            <strong>
              {data.businessData.url
                ? new URL(data.businessData.url).hostname
                : words.source}
            </strong>
            <span>
              {data.sources.length} {words.progress}
            </span>
            <button
              disabled={busy || phase === "ANALYZING" || dirty}
              onClick={() => {
                setData(null);
                setReview(null);
                setCreateKey(null);
                window.history.replaceState(null, "", window.location.pathname);
              }}
            >
              {words.createAnother}
            </button>
          </div>
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
                    let current = data;
                    for (const file of files) {
                      const response = await fetch(
                        `${setupApi}/v1/staff/menu-imports/${data.id}/sources?expectedVersion=${current.version}`,
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
                      current = await request<ImportView>(
                        `business-imports/${data.id}`,
                      );
                      accept(current);
                    }
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
              <button
                disabled={busy}
                onClick={() =>
                  act(async () =>
                    accept(
                      await request<ImportView>(
                        `business-imports/${data.id}/cancel`,
                        "POST",
                        { expectedVersion: data.version },
                      ),
                    ),
                  )
                }
              >
                {words.cancel}
              </button>
            </section>
          )}
          {data.businessData.warnings.length > 0 && (
            <details className="bi-panel">
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
              <nav className="bi-review-nav" aria-label={words.review}>
                <a href="#import-identity">{words.identity}</a>
                <a href="#import-menu">{words.menu}</a>
                <a href="#import-media">{words.media}</a>
                <a href="#import-style">{words.style}</a>
                <a href="#import-save">{words.save}</a>
              </nav>
              <section className="bi-panel" id="import-identity">
                <div className="bi-section-title">
                  <span>01</span>
                  <h2>{words.identity}</h2>
                </div>
                <ImportFields
                  data={data}
                  review={review}
                  onChange={change}
                  words={words}
                  locale={locale}
                />
              </section>
              <section className="bi-panel" id="import-menu">
                <div className="bi-section-title">
                  <span>02</span>
                  <h2>{words.menu}</h2>
                  <span>{review.items.length}</span>
                </div>
                <p>{words.fallback}</p>
                {review.items.map((row, index) => (
                  <ImportProduct
                    key={row.id}
                    row={row}
                    data={data}
                    words={words}
                    onChange={(next) =>
                      change({
                        ...review,
                        items: review.items.map((item, i) =>
                          i === index ? next : item,
                        ),
                      })
                    }
                  />
                ))}
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
              </section>
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
              <div className="bi-save-bar" id="import-save">
                <button
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
                  disabled={!confirmed}
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
                      await request(
                        `business-imports/${data.id}/commit`,
                        "POST",
                        { expectedVersion: approved.version, confirm: true },
                      );
                      await load(data.id);
                    })
                  }
                >
                  {words.draft} →
                </button>
              </div>
            </fieldset>
          )}
          {(phase === "COMMITTED" || phase === "REVERTED") && (
            <section className="bi-panel bi-complete">
              <span className="bi-complete-mark">✓</span>
              <h2>{phase === "COMMITTED" ? words.saved : words.reverted}</h2>
              <p>{words.savedText}</p>
              <a className="bi-primary" href={`/app/${locale}/website/preview`}>
                {words.preview} ↗
              </a>
              <a href={`/app/${locale}/website`}>{words.edit}</a>
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
    </main>
  );
}

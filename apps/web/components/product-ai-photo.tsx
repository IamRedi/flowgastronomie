"use client";
import { useEffect, useState } from "react";
import type { CanonicalMediaReference } from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import { productPhotoCopy } from "./product-photo-copy";
import type { ImageProviderId } from "@flowgastronomie/domain";

type Job = {
  id: string;
  state: string;
  resultId: string | null;
  requestKey: string;
  createdAt: string;
};
export function ProductAiPhoto({
  productId,
  target = "products",
  name,
  category,
  locale,
  apiUrl,
  sourceBlob,
  onSaved,
}: {
  productId: string;
  target?: "products" | "website-sections";
  name: string;
  category: string;
  locale: Locale;
  apiUrl: string;
  sourceBlob?: Blob | null;
  onSaved: (media: CanonicalMediaReference) => void;
}) {
  const c = productPhotoCopy(locale, target);
  const [prompt, setPrompt] = useState(`${name} · ${category}`);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<
    { id: ImageProviderId; enabled: boolean; used: number; limit: number }[]
  >([]);
  const [selectedProvider, setSelectedProvider] =
    useState<ImageProviderId | null>(null);
  const [hasCurrentPhoto, setHasCurrentPhoto] = useState(false);
  const [editCurrent, setEditCurrent] = useState(false);
  const uploadedSource = useState<{ blob: Blob; id: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadedAsset, setLoadedAsset] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `${apiUrl}/v1/staff/creative/${target}/${encodeURIComponent(productId)}/images`;
  // Recover durable server jobs, not cached previews or a new paid request.
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch(endpoint, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw Error();
        const data = (await response.json()) as {
          enabled: boolean;
          providers?: typeof providers;
          hasCurrentPhoto: boolean;
          jobs: Job[];
        };
        if (!alive) return;
        const options = data.providers ?? [];
        setEnabled(data.enabled);
        setProviders(options);
        setHasCurrentPhoto(!!data.hasCurrentPhoto);
        setSelectedProvider((prior) =>
          options.some((p) => p.id === prior && p.enabled)
            ? prior
            : (options.find((p) => p.enabled)?.id ?? null),
        );
        setJobs(data.jobs);
        const recovered = data.jobs.find(
          (j) => j.state === "SUCCEEDED" && j.resultId,
        )?.resultId;
        if (recovered) setSelected((prior) => prior ?? recovered);
      } catch {
        if (alive) setError(c.aiError);
      }
      if (alive) timer = setTimeout(() => void read(), 4000);
    }
    void read();
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [endpoint, c.aiError]);
  const pending = jobs.some(
    (j) =>
      j.state === "PENDING" && Date.now() - Date.parse(j.createdAt) < 600_000,
  );
  async function generate() {
    if (busy || pending || !selectedProvider) return;
    setBusy(true);
    setError("");
    // Each explicit generation is one variant. Transport failures are recovered
    // through the history endpoint; never automatically repeat a provider call.
    try {
      let sourceAssetId: string | null = null;
      if (sourceBlob) {
        if (uploadedSource[0]?.blob === sourceBlob) {
          sourceAssetId = uploadedSource[0].id;
        } else {
          const upload = await fetch(`${apiUrl}/v1/staff/creative/assets`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": sourceBlob.type || "image/webp" },
            body: sourceBlob,
            signal: AbortSignal.timeout(30_000),
          });
          if (!upload.ok) throw Error();
          sourceAssetId = ((await upload.json()) as { id: string }).id;
          uploadedSource[1]({ blob: sourceBlob, id: sourceAssetId });
        }
      }
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          locale,
          requestKey: crypto.randomUUID(),
          provider: selectedProvider,
          sourceAssetId,
          editCurrent: !sourceAssetId && editCurrent,
        }),
        signal: AbortSignal.timeout(330_000),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(
          detail?.message || (response.status === 429 ? c.aiLimit : c.aiError),
        );
        return;
      }
      const asset = (await response.json()) as { id: string };
      setSelected(asset.id);
    } catch {
      setError(c.aiError);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}/approve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: selected, approved: true }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw Error();
      onSaved((await response.json()) as CanonicalMediaReference);
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="photo-ai" aria-busy={busy || pending}>
      {enabled === false && <p role="status">{c.aiOff}</p>}
      <label>
        {c.prompt}
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={1000}
          disabled={busy || pending}
        />
      </label>
      {!sourceBlob && hasCurrentPhoto && (
        <label>
          <input
            type="checkbox"
            checked={editCurrent}
            onChange={(event) => setEditCurrent(event.target.checked)}
            disabled={busy || pending}
          />
          {c.editCurrent}
        </label>
      )}
      <label>
        {c.providerLabel}
        <select
          value={selectedProvider ?? ""}
          onChange={(event) =>
            setSelectedProvider(event.target.value as ImageProviderId)
          }
          disabled={busy || pending}
        >
          {providers
            .filter((p) => p.enabled)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === "meta"
                  ? "Meta Muse Image 1.0"
                  : p.id === "ideogram"
                    ? "Ideogram 4.5"
                    : "OpenAI"}{" "}
                · {p.used}/{p.limit}
              </option>
            ))}
        </select>
      </label>
      <small>{sourceBlob || editCurrent ? c.edited : c.generated}</small>
      <button
        type="button"
        disabled={
          !enabled ||
          !selectedProvider ||
          busy ||
          pending ||
          prompt.trim().length < 3
        }
        onClick={() => void generate()}
      >
        {busy || pending ? c.generating : selected ? c.regenerate : c.ai}
      </button>
      {selected && (
        <div className="photo-preview">
          <img
            src={`${apiUrl}/v1/staff/creative/assets/${selected}/content`}
            alt={`${name} — ${c.generated}`}
            onLoad={() => setLoadedAsset(selected)}
            onError={() => setError(c.aiError)}
          />
        </div>
      )}
      <div className="photo-fit">
        {jobs
          .filter((j) => j.state === "SUCCEEDED" && j.resultId)
          .map((j, i) => (
            <button
              type="button"
              key={j.id}
              aria-pressed={selected === j.resultId}
              disabled={busy}
              onClick={() => setSelected(j.resultId)}
            >
              {c.variant} {i + 1}
            </button>
          ))}
      </div>
      {error && (
        <p className="photo-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button button-primary"
        type="button"
        disabled={!selected || loadedAsset !== selected || busy || pending}
        onClick={() => void save()}
      >
        {c.approveImage}
      </button>
    </section>
  );
}

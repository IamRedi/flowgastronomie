"use client";
import { useEffect, useState } from "react";
import type { Locale } from "../../../../../lib/i18n";
import type { ImageProviderId } from "@flowgastronomie/domain";
import "./platform-ai-usage.css";

type Provider = {
  provider: ImageProviderId;
  used: number;
  limit: number;
  enabled: boolean;
  successful: number;
  uncertain: number;
  estimatedCostUsd: number;
  unknownCostCount: number;
};
type Job = {
  id: string;
  provider: string;
  model: string;
  state: string;
  operation: string;
  createdAt: string;
  estimatedCostUsd: number | null;
  venueId: string;
};
type Business = {
  tenantId: string;
  name: string;
  providers: Provider[];
  estimatedTotalUsd: number;
  history: Job[];
};
type Summary = {
  month: string;
  emergencyDisabled: boolean;
  businesses: Business[];
  totals: {
    provider: ImageProviderId;
    used: number;
    estimatedCostUsd: number;
  }[];
  estimatedTotalUsd: number;
};
const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
).replace(/\/$/, "");
const labels = {
  sq: {
    title: "Përdorimi dhe limitet AI",
    overview: "Të gjitha bizneset",
    business: "Biznesi",
    used: "Përdorur",
    limit: "Limiti mujor",
    enabled: "Aktiv",
    cost: "Kosto e vlerësuar",
    total: "Totali",
    save: "Ruaj",
    history: "Historiku",
    stop: "Çaktivizo AI urgjent",
    resume: "Aktivizo AI",
    denied: "Ky seksion kërkon aksesin e administratorit të platformës.",
    unknown: "Kosto të panjohura",
    note: "Vlerësim në USD, jo faturë reale. Muaji llogaritet në UTC.",
    empty: "Nuk ka kërkesa imazhesh këtë muaj.",
  },
  de: {
    title: "KI-Nutzung und Limits",
    overview: "Alle Betriebe",
    business: "Betrieb",
    used: "Verwendet",
    limit: "Monatslimit",
    enabled: "Aktiv",
    cost: "Geschätzte Kosten",
    total: "Gesamt",
    save: "Speichern",
    history: "Verlauf",
    stop: "KI sofort deaktivieren",
    resume: "KI aktivieren",
    denied: "Dieser Bereich erfordert Plattformadministrator-Zugriff.",
    unknown: "Unbekannte Kosten",
    note: "Schätzung in USD, keine Rechnung. Kalendermonat in UTC.",
    empty: "Diesen Monat keine Bildanfragen.",
  },
  en: {
    title: "AI Usage & Limits",
    overview: "All businesses",
    business: "Business",
    used: "Used",
    limit: "Monthly limit",
    enabled: "Enabled",
    cost: "Estimated cost",
    total: "Total",
    save: "Save",
    history: "History",
    stop: "Emergency disable AI",
    resume: "Enable AI",
    denied: "This area requires platform administrator access.",
    unknown: "Unknown costs",
    note: "USD estimate, not an invoice. Calendar month uses UTC.",
    empty: "No image requests this month.",
  },
  it: {
    title: "Utilizzo e limiti IA",
    overview: "Tutte le attività",
    business: "Attività",
    used: "Utilizzati",
    limit: "Limite mensile",
    enabled: "Attivo",
    cost: "Costo stimato",
    total: "Totale",
    save: "Salva",
    history: "Cronologia",
    stop: "Disattiva IA subito",
    resume: "Attiva IA",
    denied: "Questa sezione richiede accesso amministratore della piattaforma.",
    unknown: "Costi sconosciuti",
    note: "Stima in USD, non una fattura. Mese in UTC.",
    empty: "Nessuna richiesta immagine questo mese.",
  },
};
const money = (value: number) => `$${value.toFixed(2)}`;

export function PlatformAiUsage({ locale }: { locale: Locale }) {
  const t = labels[locale];
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<
    Record<string, { limit: number; enabled: boolean }>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  async function load() {
    const response = await fetch(`${apiUrl}/v1/platform/ai-usage`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      setDenied(true);
      return;
    }
    if (!response.ok) throw Error("AI usage could not be loaded.");
    const data = (await response.json()) as Summary;
    setSummary(data);
    setSelected((current) => current ?? data.businesses[0]?.tenantId ?? null);
    setDraft(
      Object.fromEntries(
        data.businesses.flatMap((b) =>
          b.providers.map((p) => [
            `${b.tenantId}:${p.provider}`,
            { limit: p.limit, enabled: p.enabled },
          ]),
        ),
      ),
    );
  }
  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, []);
  async function mutate(path: string, method: "PUT" | "POST", body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/v1/platform/ai-usage${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw Error(
          (
            (await response.json().catch(() => null)) as {
              message?: string;
            } | null
          )?.message ?? `HTTP ${response.status}`,
        );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (denied)
    return (
      <main className="platform-ai-usage">
        <p role="alert">{t.denied}</p>
      </main>
    );
  const business = summary?.businesses.find((b) => b.tenantId === selected);
  return (
    <main className="platform-ai-usage">
      <header>
        <h1>{t.title}</h1>
        <p>{t.note}</p>
      </header>
      {error && (
        <p role="alert" className="platform-ai-error">
          {error}
        </p>
      )}
      {!summary ? (
        <p role="status">…</p>
      ) : (
        <>
          <section aria-label={t.overview}>
            <h2>
              {t.overview} · {summary.month}
            </h2>
            <div className="platform-ai-totals">
              {summary.totals.map((p) => (
                <p key={p.provider}>
                  <strong>{p.provider}</strong> {p.used} ·{" "}
                  {money(p.estimatedCostUsd)}
                </p>
              ))}
              <p>
                <strong>{t.total}</strong> {money(summary.estimatedTotalUsd)}
              </p>
            </div>
            <button
              type="button"
              className="platform-ai-emergency"
              disabled={busy}
              onClick={() =>
                void mutate("/emergency", "POST", {
                  disabled: !summary.emergencyDisabled,
                })
              }
            >
              {summary.emergencyDisabled ? t.resume : t.stop}
            </button>
          </section>
          <label>
            {t.business}
            <select
              value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {summary.businesses.map((b) => (
                <option key={b.tenantId} value={b.tenantId}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {business && (
            <>
              <section aria-label={business.name}>
                <h2>
                  {business.name} · {money(business.estimatedTotalUsd)}
                </h2>
                <div className="platform-ai-provider-grid">
                  {business.providers.map((p) => {
                    const key = `${business.tenantId}:${p.provider}`;
                    const setting = draft[key] ?? {
                      limit: p.limit,
                      enabled: p.enabled,
                    };
                    return (
                      <div className="platform-ai-provider" key={key}>
                        <h3>
                          {p.provider === "meta"
                            ? "Meta Muse Image 1.0"
                            : p.provider === "ideogram"
                              ? "Ideogram 4.5"
                              : "OpenAI"}
                        </h3>
                        <p>
                          {t.used}: {p.used}/{p.limit} · {t.cost}:{" "}
                          {money(p.estimatedCostUsd)}
                        </p>
                        <small>
                          {p.successful} succeeded · {p.uncertain} uncertain ·{" "}
                          {p.unknownCostCount} {t.unknown.toLowerCase()}
                        </small>
                        <label>
                          {t.limit}
                          <input
                            type="number"
                            min="0"
                            max="1000000"
                            step="1"
                            value={setting.limit}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [key]: {
                                  ...setting,
                                  limit: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                        <label className="platform-ai-checkbox">
                          <input
                            type="checkbox"
                            checked={setting.enabled}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [key]: {
                                  ...setting,
                                  enabled: e.target.checked,
                                },
                              })
                            }
                          />
                          {t.enabled}
                        </label>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            !Number.isSafeInteger(setting.limit) ||
                            setting.limit < 0
                          }
                          onClick={() =>
                            void mutate(
                              `/${encodeURIComponent(business.tenantId)}/${p.provider}`,
                              "PUT",
                              {
                                monthlyLimit: setting.limit,
                                enabled: setting.enabled,
                              },
                            )
                          }
                        >
                          {t.save}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section aria-label={t.history}>
                <h2>{t.history}</h2>
                {business.history.length ? (
                  <div className="platform-ai-history">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Provider</th>
                          <th>Operation</th>
                          <th>Status</th>
                          <th>{t.cost}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {business.history.map((job) => (
                          <tr key={job.id}>
                            <td>
                              {new Date(job.createdAt).toLocaleString(locale)}
                            </td>
                            <td>{job.provider}</td>
                            <td>{job.operation}</td>
                            <td>{job.state}</td>
                            <td>
                              {job.estimatedCostUsd === null
                                ? "—"
                                : money(job.estimatedCostUsd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>{t.empty}</p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}

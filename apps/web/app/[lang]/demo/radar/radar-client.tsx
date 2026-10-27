"use client";

import type { StaffRadarSignal } from "@flowgastronomie/domain";
import { useCallback, useEffect, useState } from "react";

import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";

type Properties = {
  labels: Dictionary["radar"];
  locale: Locale;
};

function formatPrice(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

function formatWait(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

export function RadarClient({ labels, locale }: Properties) {
  const [signals, setSignals] = useState<StaffRadarSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySignal, setBusySignal] = useState<string | null>(null);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  const loadSignals = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/v1/demo/radar`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const result = (await response.json()) as {
        signals: StaffRadarSignal[];
      };
      setSignals(result.signals);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void loadSignals();
    const interval = window.setInterval(() => void loadSignals(), 5_000);
    return () => window.clearInterval(interval);
  }, [loadSignals]);

  async function acknowledge(signalId: string) {
    setBusySignal(signalId);
    const response = await fetch(
      `${apiUrl}/v1/demo/radar/${encodeURIComponent(signalId)}/acknowledge`,
      { method: "PATCH" },
    );

    if (response.ok) {
      setSignals((current) =>
        current.filter((signal) => signal.id !== signalId),
      );
    }
    setBusySignal(null);
  }

  return (
    <section className="real-radar shell" aria-busy={loading}>
      <div className="real-radar-summary">
        <div>
          <strong>{signals.length}</strong>
          <span>{labels.summary[0]?.label}</span>
        </div>
        <div>
          <strong>
            {signals[0] ? formatWait(signals[0].waitingSeconds) : "—"}
          </strong>
          <span>{labels.summary[1]?.label}</span>
        </div>
      </div>

      {loading && signals.length === 0 ? (
        <p className="real-radar-empty">{labels.loading}</p>
      ) : signals.length === 0 ? (
        <p className="real-radar-empty">{labels.empty}</p>
      ) : (
        <div className="real-signal-list">
          {signals.map((signal) => (
            <article
              className={`real-signal type-${signal.type}`}
              key={signal.id}
            >
              <span className="real-table-number">{signal.tableLabel}</span>
              <div className="real-signal-copy">
                <small>{signal.area}</small>
                <h2>{labels.types[signal.type]}</h2>
                {signal.order && (
                  <p>
                    {signal.order.itemCount} {labels.items} ·{" "}
                    {formatPrice(
                      signal.order.totalMinor,
                      signal.order.currency,
                      locale,
                    )}
                  </p>
                )}
              </div>
              <strong className="real-wait">
                {formatWait(signal.waitingSeconds)}
              </strong>
              <button
                disabled={busySignal === signal.id}
                onClick={() => acknowledge(signal.id)}
                type="button"
              >
                {labels.acknowledge}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

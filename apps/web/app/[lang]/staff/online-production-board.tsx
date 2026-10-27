"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Locale } from "../../../lib/i18n";
import type { ProductionItem } from "@flowgastronomie/domain";
import { ProductionItems } from "./production-board";
import { pilotText } from "../../../lib/pilot-copy";

type Ticket = {
  id: string;
  version: number;
  status: "NEW" | "PREPARING" | "READY";
  referenceCode: string;
  fulfillmentType: string;
  requestedFor: string;
  createdAt: string;
  items: ProductionItem[];
};
const labels: Record<Locale, Record<string, string>> = {
  sq: {
    title: "Porosi online",
    start: "Nis përgatitjen",
    ready: "Shëno gati",
    empty: "Nuk ka porosi online për këtë stacion.",
  },
  en: {
    title: "Online orders",
    start: "Start preparing",
    ready: "Mark ready",
    empty: "No online orders for this station.",
  },
  de: {
    title: "Online-Bestellungen",
    start: "Zubereitung starten",
    ready: "Als fertig markieren",
    empty: "Keine Online-Bestellungen für diese Station.",
  },
  it: {
    title: "Ordini online",
    start: "Inizia preparazione",
    ready: "Segna pronto",
    empty: "Nessun ordine online per questa stazione.",
  },
};
export function OnlineProductionBoard({
  locale,
  station,
}: {
  locale: Locale;
  station: "BAR" | "KITCHEN";
}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [, tick] = useState(0);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const text = labels[locale]!;
  const load = useCallback(async () => {
    const response = await fetch(
      `${apiUrl}/v1/staff/online-production/${station}`,
      { credentials: "include" },
    );
    if (!response.ok) throw new Error();
    setTickets((await response.json()) as Ticket[]);
    setError(false);
  }, [apiUrl, station]);
  useEffect(() => {
    const ageTimer = setInterval(() => tick((n) => n + 1), 60_000);
    void load().catch(() => setError(true));
    const events = new EventSource(
      `${apiUrl}/v1/staff/online-production/${station}/events`,
      { withCredentials: true },
    );
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };
    events.onopen = stopFallback;
    events.onerror = () => {
      fallbackTimer ??= setInterval(
        () => void load().catch(() => setError(true)),
        5_000,
      );
    };
    events.addEventListener("tickets", (event) => {
      setTickets(JSON.parse((event as MessageEvent<string>).data) as Ticket[]);
    });
    return () => {
      stopFallback();
      events.close();
      clearInterval(ageTimer);
    };
  }, [apiUrl, load, station]);
  async function advance(ticket: Ticket) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(
        `${apiUrl}/v1/staff/online-production-tickets/${ticket.id}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: ticket.status === "NEW" ? "PREPARING" : "READY",
            expectedVersion: ticket.version,
          }),
        },
      );
      if (!response.ok) throw new Error();
      await load();
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="online-production-board">
      <h2>{text.title}</h2>
      {error && <p role="alert">{pilotText(locale).error}</p>}
      {tickets.length === 0 ? (
        <p>{text.empty}</p>
      ) : (
        tickets.map((ticket) => (
          <article key={ticket.id}>
            <strong>{ticket.referenceCode}</strong>
            <span>
              {ticket.fulfillmentType} ·{" "}
              {new Date(ticket.requestedFor).toLocaleString(locale, {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <p>
              {pilotText(locale).age}:{" "}
              {Math.max(
                0,
                Math.floor((Date.now() - Date.parse(ticket.createdAt)) / 60000),
              )}
              m
            </p>
            <ProductionItems items={ticket.items} />
            {ticket.status !== "READY" && (
              <button
                disabled={busy}
                onClick={() => void advance(ticket)}
                type="button"
              >
                {ticket.status === "NEW" ? text.start : text.ready}
              </button>
            )}
          </article>
        ))
      )}
    </section>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PilotTicket, ProductionItem } from "@flowgastronomie/domain";
import { pilotText } from "../../../lib/pilot-copy";
export function ProductionItems({ items }: { items: ProductionItem[] }) {
  return (
    <ul className="pilot-items">
      {items.map((item, index) => (
        <li key={index}>
          <strong>
            {item.quantity}× {item.productName}
          </strong>
          {item.variantName && <span>{item.variantName}</span>}
          {item.modifiers.length > 0 && (
            <span>{item.modifiers.map((m) => m.optionName).join(", ")}</span>
          )}
          {item.notes && <em>{item.notes}</em>}
        </li>
      ))}
    </ul>
  );
}
export function ProductionBoard({
  locale,
  station,
}: {
  locale: string;
  station: "KITCHEN" | "BAR";
}) {
  const text = pilotText(locale);
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const [tickets, setTickets] = useState<PilotTicket[]>([]);
  const [venueName, setVenueName] = useState("");
  const [shift, setShift] = useState(false);
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const r = await fetch(`${api}/v1/staff/production/${station}`, {
        credentials: "include",
        signal: signal ?? null,
      });
      if (r.status === 401) {
        window.location.href = `/${locale}/staff/login`;
        return;
      }
      if (!r.ok) throw new Error();
      const body = await r.json();
      if (!signal?.aborted) {
        setTickets(body);
        setLoading(false);
        setError(false);
      }
    },
    [api, station, locale],
  );
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      void load(controller.signal).catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    refresh();
    const timer = setInterval(refresh, 5000);
    void Promise.all([
      fetch(`${api}/v1/staff/me`, {
        credentials: "include",
        signal: controller.signal,
      }),
      fetch(`${api}/v1/staff/shift`, {
        credentials: "include",
        signal: controller.signal,
      }),
    ])
      .then(async ([me, work]) => {
        const [m, w] = await Promise.all([me.json(), work.json()]);
        if (!controller.signal.aborted) {
          setVenueName(m.staff?.venueName ?? "");
          setShift(!!w.shift);
        }
      })
      .catch(() => {});
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [api, load]);
  async function act(ticket?: PilotTicket) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(ticket?.id ?? "shift");
    setError(false);
    setConflict(false);
    try {
      const r = await fetch(
        ticket
          ? `${api}/v1/staff/production-tickets/${ticket.id}/status`
          : `${api}/v1/staff/shift/start`,
        {
          method: ticket ? "PATCH" : "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            ticket
              ? {
                  status:
                    ticket.status === "NEW"
                      ? "PREPARING"
                      : ticket.status === "PREPARING"
                        ? "READY"
                        : "SERVED",
                  expectedVersion: ticket.version,
                }
              : {},
          ),
        },
      );
      if (!r.ok) {
        if (r.status === 409) {
          setConflict(true);
          await load();
          return;
        }
        throw new Error();
      }
      if (!ticket) setShift(true);
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }
  return (
    <section
      className="pilot-production"
      aria-label={station === "KITCHEN" ? text.kitchen : text.bar}
    >
      <header>
        <h1>{station === "KITCHEN" ? text.kitchen : text.bar}</h1>
        <p>{venueName}</p>
        <button onClick={() => void load().catch(() => setError(true))}>
          {text.refresh}
        </button>
        {!shift && (
          <button disabled={!!busy} onClick={() => void act()}>
            {text.shift}
          </button>
        )}
      </header>
      {error && <p role="alert">{text.error}</p>}
      {conflict && <p role="alert">{text.kitchenConflict}</p>}
      {loading ? (
        <p>{text.unknown}</p>
      ) : (
        tickets.length === 0 && <p>{text.empty}</p>
      )}
      <div className="pilot-ticket-grid">
        {tickets.map((t) => (
          <article
            className={`pilot-ticket status-${t.status}`}
            key={t.id}
            data-order-reference={t.reference}
          >
            <header>
              <h2>#{t.reference}</h2>
              <strong>
                {t.orderType === "TAKEAWAY"
                  ? text.takeaway
                  : `${text.table} ${t.tableLabel}`}
              </strong>
            </header>
            <p>
              {t.station} ·{" "}
              {t.status === "READY"
                ? text.ready
                : t.status === "PREPARING"
                  ? text.preparing
                  : text.new}{" "}
              · {text.age}:{" "}
              {Math.max(
                0,
                Math.floor((Date.now() - Date.parse(t.createdAt)) / 60000),
              )}
              m
            </p>
            <time dateTime={t.createdAt}>
              {new Date(t.createdAt).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <ProductionItems items={t.items} />
            {(t.canStart || t.canReady || t.canServe) && (
              <button disabled={!shift || !!busy} onClick={() => void act(t)}>
                {t.canStart
                  ? text.start
                  : t.canReady
                    ? text.markReady
                    : t.orderType === "TAKEAWAY"
                      ? text.pickup
                      : text.served}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

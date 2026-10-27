"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../../../lib/i18n";
import {
  type OnlineFulfillmentType,
  type OnlineOrderStatus,
  onlineOrderStatusLabels,
} from "../../../../../lib/online-order-copy";
import { orderingUxCopy } from "../../../../../lib/ordering-ux-copy";
import { rememberRecentOrder } from "../../../../../lib/recent-order";
import { formatCurrency } from "../../../../../lib/format-currency";
import { formatVenueTime } from "../../../../../lib/venue-time";
import "../../../../../components/online-ordering.css";

type Tracking = {
  venue?: { name: string; publicSlug: string; timezone: string };
  referenceCode: string;
  status: OnlineOrderStatus;
  fulfillmentType: OnlineFulfillmentType;
  totalMinor: number;
  currency: string;
  contact: { name: string };
  requestedFor?: string;
  timingMode?: "ASAP" | "SCHEDULED";
  items: Array<{
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    variantName: string | null;
    modifiers: Array<{ optionName: string }>;
  }>;
  timeline: Array<{
    status: OnlineOrderStatus;
    note: string | null;
    createdAt: string;
  }>;
  messages: Array<{
    author: "GUEST" | "STAFF";
    body: string;
    createdAt: string;
  }>;
};
const steps = [
  "PENDING_CONFIRMATION",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "COMPLETED",
] as const;
export function OnlineOrderTrackingClient({
  locale,
  trackingToken,
  publicSlug,
}: {
  locale: Locale;
  trackingToken: string;
  publicSlug?: string | undefined;
}) {
  const [order, setOrder] = useState<Tracking | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [connection, setConnection] = useState<
    "connection" | "live" | "fallback"
  >("connection");
  const loading = useRef<AbortController | null>(null);
  const streamVersion = useRef(0);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const text = orderingUxCopy[locale];
  const endpoint = `${apiUrl}/v1/public/online-orders/track/${encodeURIComponent(trackingToken)}${trackingToken === "recovered" ? `?venue=${encodeURIComponent(publicSlug ?? "")}` : ""}`;
  const endpointFor = (suffix: string) =>
    endpoint.replace(/(\?.*)?$/, `${suffix}$1`);
  const load = useCallback(async () => {
    if (loading.current) return;
    const controller = new AbortController();
    loading.current = controller;
    const version = streamVersion.current;
    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        cache: "no-store",
        credentials: "include",
      });
      if (controller.signal.aborted || version !== streamVersion.current)
        return;
      if (response.ok) {
        const value = (await response.json()) as Tracking;
        if (controller.signal.aborted || version !== streamVersion.current)
          return;
        setOrder(value);
        setMissing(false);
        setFailed(false);
      } else if (response.status === 404) {
        setMissing(true);
        setOrder(null);
      } else setFailed(true);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (loading.current === controller) loading.current = null;
    }
  }, [endpoint]);
  useEffect(() => {
    void load();
    const eventUrl = endpoint.replace(/(\?.*)?$/, "/events$1");
    const events = new EventSource(eventUrl, { withCredentials: true });
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    events.onopen = () => {
      stop();
      setConnection("live");
      void load();
    };
    events.addEventListener("order", (event) => {
      try {
        streamVersion.current += 1;
        setOrder(JSON.parse((event as MessageEvent<string>).data) as Tracking);
        setMissing(false);
        setFailed(false);
      } catch {
        setConnection("fallback");
        timer ??= setInterval(() => void load(), 5_000);
      }
    });
    events.onerror = () => {
      setConnection("fallback");
      timer ??= setInterval(() => void load(), 5_000);
    };
    return () => {
      stop();
      events.close();
      loading.current?.abort();
      loading.current = null;
    };
  }, [endpoint, load]);
  useEffect(() => {
    const slug = order?.venue?.publicSlug ?? publicSlug;
    if (order && slug)
      rememberRecentOrder(slug, {
        referenceCode: order.referenceCode,
        destination: `${window.location.pathname}${window.location.search}`,
      });
  }, [order, publicSlug]);
  async function send() {
    if (!message.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(endpointFor("/messages"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: message }),
      });
      if (!response.ok) throw new Error();
      setOrder((await response.json()) as Tracking);
      setMessage("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  if (missing)
    return (
      <main className="customer-tracking">
        <p role="alert">{text.missing}</p>
        {publicSlug && (
          <a href={`/${locale}/venue/${encodeURIComponent(publicSlug)}`}>
            {text.lookup}
          </a>
        )}
      </main>
    );
  if (!order)
    return (
      <main className="customer-tracking">
        <p role="status">{failed ? text.error : text.loading}</p>
        {failed && (
          <button type="button" onClick={() => void load()}>
            {text.retry}
          </button>
        )}
      </main>
    );
  const timezone = order.venue?.timezone ?? "Europe/Berlin";
  const slug = order.venue?.publicSlug ?? publicSlug;
  const home = slug
    ? `/${locale}/venue/${encodeURIComponent(slug)}`
    : `/${locale}`;
  const notes: Record<OnlineOrderStatus, string> = {
    PENDING_CONFIRMATION: text.pendingNote,
    ACCEPTED: text.acceptedNote,
    PREPARING: text.preparingNote,
    READY:
      order.fulfillmentType === "PICKUP"
        ? text.readyNote
        : onlineOrderStatusLabels[locale].READY,
    COMPLETED: text.completedNote,
    REJECTED: text.rejectedNote,
    CANCELLED: text.cancelledNote,
    OUT_FOR_DELIVERY: text.outNote,
  };
  const progressSteps =
    order.fulfillmentType === "DELIVERY"
      ? [...steps.slice(0, 4), "OUT_FOR_DELIVERY", "COMPLETED"]
      : [...steps];
  const progressLabels = [
    text.received,
    text.confirmed,
    text.preparing,
    order.fulfillmentType === "PICKUP"
      ? text.ready
      : onlineOrderStatusLabels[locale].READY,
    ...(order.fulfillmentType === "DELIVERY"
      ? [onlineOrderStatusLabels[locale].OUT_FOR_DELIVERY]
      : []),
    text.completed,
  ];
  const progress = progressSteps.findIndex((s) => s === order.status);
  const terminalFailure =
    order.status === "REJECTED" || order.status === "CANCELLED";
  const lastMessage = order.messages.filter((m) => m.author === "STAFF").at(-1);
  return (
    <main className="customer-tracking">
      <header>
        <a href={home}>
          <h1>{order.venue?.name ?? text.restaurant}</h1>
        </a>
        <h2>{text.track}</h2>
        <strong>{order.referenceCode}</strong>
      </header>
      <section
        className="tracking-status"
        data-state={order.status}
        aria-label={text.track}
      >
        <div className="tracking-emblem" key={order.status} aria-hidden="true">
          <svg
            viewBox="0 0 80 80"
            width="80"
            height="80"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="40" cy="40" r="36" />
            {terminalFailure ? (
              <path d="m28 28 24 24m0-24L28 52" />
            ) : order.status === "COMPLETED" || order.status === "READY" ? (
              <path d="m24 40 11 11 22-24" />
            ) : order.status === "OUT_FOR_DELIVERY" ? (
              <>
                <path d="M18 28h28v25H18zM46 36h10l8 10v7H46" />
                <circle cx="27" cy="55" r="5" />
                <circle cx="55" cy="55" r="5" />
              </>
            ) : (
              <>
                <path d="M20 49h40M24 46a16 16 0 0 1 32 0M36 24h8" />
                <path className="tracking-steam" d="M32 21v-6m16 6v-6" />
              </>
            )}
          </svg>
        </div>
        <div aria-live="polite" aria-atomic="true">
          <h2>
            {order.status === "READY" && order.fulfillmentType === "PICKUP"
              ? text.ready
              : onlineOrderStatusLabels[locale][order.status]}
          </h2>
          <p>{notes[order.status]}</p>
        </div>
        <small role="status">{text[connection]}</small>
        {!terminalFailure && (
          <ol className="tracking-progress" aria-label={text.timeline}>
            {progressSteps.map((step, index) => (
              <li
                key={step}
                aria-current={index === progress ? "step" : undefined}
                data-reached={index <= progress}
              >
                <span aria-hidden="true">
                  {index < progress ? "✓ " : `${index + 1}. `}
                </span>
                {progressLabels[index]}
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="tracking-summary">
        <section>
          <h2>{text.items}</h2>
          <ul>
            {order.items.map((item, index) => (
              <li key={index}>
                <div>
                  <strong>
                    {item.quantity}× {item.productName}
                  </strong>
                  {item.variantName && <small>{item.variantName}</small>}
                  {item.modifiers.map((extra, i) => (
                    <small key={i}>+ {extra.optionName}</small>
                  ))}
                </div>
                <span>
                  {formatCurrency(
                    item.unitPriceMinor * item.quantity,
                    order.currency,
                    locale,
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="tracking-total">
            <span>{text.total}</span>
            <strong>
              {formatCurrency(order.totalMinor, order.currency, locale)}
            </strong>
          </p>
        </section>
        <section>
          <h2>{text.requested}</h2>
          <p>
            {order.timingMode === "ASAP"
              ? text.asapConfirmation
              : order.requestedFor
                ? formatVenueTime(locale, order.requestedFor, timezone)
                : text.requested}
          </p>
          {order.timingMode !== "ASAP" && <small>{text.venueTime}</small>}
          <h2>{text.customer}</h2>
          <p>{order.contact.name}</p>
          {lastMessage && (
            <div className="tracking-latest">
              <strong>{text.restaurant}</strong>
              <p>{lastMessage.body}</p>
            </div>
          )}
        </section>
      </div>
      <details className="tracking-messages">
        <summary>{text.messages}</summary>
        <ol>
          {order.timeline.map((entry, index) => (
            <li key={index}>
              {onlineOrderStatusLabels[locale][entry.status]} ·{" "}
              {formatVenueTime(locale, entry.createdAt, timezone)}
              {entry.note && <p>{entry.note}</p>}
            </li>
          ))}
        </ol>
        {order.messages.map((entry, index) => (
          <p key={index}>
            <strong>
              {entry.author === "GUEST" ? text.guest : text.restaurant}:{" "}
            </strong>
            {entry.body}
          </p>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="order-guest-message">{text.message}</label>
          <textarea
            id="order-guest-message"
            maxLength={500}
            onChange={(event) => setMessage(event.target.value)}
            value={message}
            required
          />
          <button
            className="ordering-primary"
            disabled={busy || !message.trim()}
            type="submit"
          >
            {busy ? text.sending : text.send}
          </button>
          {failed && <p role="alert">{text.error}</p>}
        </form>
      </details>
    </main>
  );
}

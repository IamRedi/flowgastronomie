"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  pilotOrderViews,
  type PilotOrderView,
  type SimplePilotOrder,
} from "@flowgastronomie/domain";
import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";
import { pilotText } from "../../../../lib/pilot-copy";
import { PilotDialog } from "../pilot-dialog";
import { PilotIcon } from "../pilot-icon";
import { ProductionItems } from "../production-board";
import { CounterPayment } from "../pos/counter-payment";
import { reconciliationText } from "../../../../lib/order-reconciliation-copy";

const copy = {
  en: {
    title: "Orders",
    website: "Website",
    counter: "Counter",
    table: "Table",
    pending: "Pending payment",
    accept: "Accept",
    reject: "Reject",
    waiting: "Awaiting confirmation",
    retry: "Refresh",
  },
  sq: {
    title: "Porositë",
    website: "Website",
    counter: "Kasa",
    table: "Tavolina",
    pending: "Në pritje të pagesës",
    accept: "Prano",
    reject: "Refuzo",
    waiting: "Në pritje konfirmimi",
    retry: "Rifresko",
  },
  de: {
    title: "Bestellungen",
    website: "Website",
    counter: "Kasse",
    table: "Tisch",
    pending: "Zahlung ausstehend",
    accept: "Annehmen",
    reject: "Ablehnen",
    waiting: "Wartet auf Bestätigung",
    retry: "Aktualisieren",
  },
  it: {
    title: "Ordini",
    website: "Sito web",
    counter: "Cassa",
    table: "Tavolo",
    pending: "Pagamento in sospeso",
    accept: "Accetta",
    reject: "Rifiuta",
    waiting: "In attesa di conferma",
    retry: "Aggiorna",
  },
} as const;

export function SimpleOrdersClient({
  locale,
  counterLabels,
  hardwareLabels,
}: {
  locale: Locale;
  counterLabels: Dictionary["counterSale"];
  hardwareLabels: Dictionary["hardware"];
}) {
  const [orders, setOrders] = useState<SimplePilotOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<PilotOrderView>("ACTIVE");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const words = copy[locale];
  const text = pilotText(locale);
  const recon = reconciliationText(locale);
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      amount / 100,
    );
  const stateLabel = (status: string) =>
    recon.states[status as keyof typeof recon.states] ?? status;
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current;
      const query = new URLSearchParams();
      if (view !== "ACTIVE") query.set("view", view);
      if (date && view !== "ACTIVE") query.set("date", date);
      const response = await fetch(
        `${api}/v1/staff/pilot/orders${query.size ? `?${query}` : ""}`,
        {
          credentials: "include",
          cache: "no-store",
          ...(signal ? { signal } : {}),
        },
      );
      if (response.status === 401) {
        window.location.assign(`/${locale}/staff/login`);
        return;
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as SimplePilotOrder[];
      if (signal?.aborted || version !== requestVersion.current) return;
      setOrders(result);
      setError(null);
      setLoading(false);
    },
    [api, locale, view, date],
  );
  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    async function refresh() {
      if (polling) return;
      polling = true;
      try {
        await load(controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          setError(text.error);
          setLoading(false);
        }
      } finally {
        polling = false;
      }
    }
    setOrders([]);
    setSelectedId(null);
    setLoading(true);
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      requestVersion.current += 1;
      controller.abort();
      clearInterval(timer);
    };
  }, [api, load, text.error]);

  async function transition(
    order: SimplePilotOrder,
    status: "ACCEPTED" | "REJECTED" | "COMPLETED",
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${api}/v1/staff/online-orders/${encodeURIComponent(order.reference)}/status`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!response.ok) throw new Error();
      await load();
    } catch {
      setError(text.error);
    } finally {
      setBusy(false);
    }
  }

  async function advance(
    order: SimplePilotOrder,
    ticket: SimplePilotOrder["tickets"][number],
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const path =
        order.source === "WEBSITE"
          ? "online-production-tickets"
          : "production-tickets";
      const response = await fetch(
        `${api}/v1/staff/${path}/${ticket.id}/status`,
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
      setError(text.kitchenConflict);
    } finally {
      setBusy(false);
    }
  }

  async function complete(order: SimplePilotOrder) {
    if (order.source === "WEBSITE") {
      await transition(order, "COMPLETED");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${api}/v1/staff/pos/orders/${order.id}/complete`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error();
      await load();
    } catch {
      setError(text.error);
    } finally {
      setBusy(false);
    }
  }

  const selected = orders.find((order) => order.id === selectedId);
  return (
    <main className="simple-orders-page">
      <h1>{words.title}</h1>
      <nav className="order-view-filters" aria-label={recon.filters}>
        {pilotOrderViews.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => setView(key)}
          >
            {recon.views[key]}
          </button>
        ))}
      </nav>
      <div className="order-view-context">
        <p>{view === "ACTIVE" ? recon.activeHelp : recon.todayHelp}</p>
        {view !== "ACTIVE" && (
          <label>
            {recon.date}
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        )}
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => void load().catch(() => setError(text.error))}>
            {words.retry}
          </button>
        </p>
      )}
      {loading && <p role="status">{recon.loading}</p>}
      <div className="pilot-queue-list" aria-busy={loading}>
        {orders.map((order) => (
          <article key={order.id} data-order-reference={order.reference}>
            <strong>
              #{order.reference} ·{" "}
              {
                words[
                  order.source.toLowerCase() as "counter" | "website" | "table"
                ]
              }
            </strong>
            <p className="pilot-payment-status">
              <PilotIcon
                name={order.productionStatus === "READY" ? "ready" : "pending"}
              />
              {recon.lifecycle}: {stateLabel(order.lifecycleStatus)}
            </p>
            <p>
              {recon.production}: {stateLabel(order.productionStatus)}
            </p>
            <p
              className={`pilot-payment-status ${order.paymentStatus === "PAID" ? "is-paid" : ""}`}
            >
              <PilotIcon
                name={order.paymentStatus === "PAID" ? "ready" : "pending"}
              />
              {order.paymentStatus === "PAID" ? text.paid : words.pending}
              {order.paymentMethods.length > 0 && (
                <>
                  {" "}
                  ·{" "}
                  {order.paymentMethods
                    .map((method) => recon.methods[method])
                    .join(" + ")}
                </>
              )}
            </p>
            <p>
              {recon.linkedPaid}: {money(order.paidMinor, order.currency)}
            </p>
            {order.sessionPaymentMinor > 0 && (
              <p className="order-session-payment">
                {recon.sessionPaid}:{" "}
                {money(order.sessionPaymentMinor, order.currency)}
              </p>
            )}
            <p>
              {recon.total}:{" "}
              {new Intl.NumberFormat(locale, {
                style: "currency",
                currency: order.currency,
              }).format(order.totalMinor / 100)}
              {view === "ACTIVE" && (
                <>
                  {" "}
                  · {text.age}:{" "}
                  {Math.max(
                    0,
                    Math.floor(
                      (Date.now() - Date.parse(order.createdAt)) / 60000,
                    ),
                  )}
                  m
                </>
              )}
            </p>
            {order.receiptId && (
              <a
                className="order-receipt-link"
                href={`/${locale}/staff/receipts/${encodeURIComponent(order.receiptId)}`}
              >
                {recon.receipt}
              </a>
            )}
            <button type="button" onClick={() => setSelectedId(order.id)}>
              {text.open}
            </button>
          </article>
        ))}
      </div>
      {!orders.length && !error && !loading && (
        <p>{view === "ACTIVE" ? text.empty : recon.empty}</p>
      )}
      {selected && (
        <PilotDialog
          className="simple-order-detail"
          title={`${words.title} #${selected.reference}`}
          closeLabel={text.close}
          onClose={() => setSelectedId(null)}
        >
          {error && <p role="alert">{error}</p>}
          <p>
            {stateLabel(selected.lifecycleStatus)} ·{" "}
            {stateLabel(selected.productionStatus)} ·{" "}
            {selected.paymentStatus === "PAID" ? text.paid : words.pending}
          </p>
          <ProductionItems items={selected.items} />
          {selected.source === "WEBSITE" &&
            selected.lifecycleStatus === "PENDING_CONFIRMATION" &&
            selected.canManage && (
              <div className="simple-order-actions">
                <button
                  disabled={busy}
                  onClick={() => void transition(selected, "ACCEPTED")}
                >
                  {words.accept}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void transition(selected, "REJECTED")}
                >
                  {words.reject}
                </button>
              </div>
            )}
          {selected.canProduce &&
            selected.tickets.map((ticket) =>
              ticket.status === "NEW" || ticket.status === "PREPARING" ? (
                <button
                  key={ticket.id}
                  disabled={busy}
                  onClick={() => void advance(selected, ticket)}
                >
                  {ticket.station}:{" "}
                  {ticket.status === "NEW" ? text.start : text.markReady}
                </button>
              ) : null,
            )}
          {(selected.canPay || (view === "ACTIVE" && selected.receiptId)) && (
            <CounterPayment
              key={selected.id}
              source={selected.source === "WEBSITE" ? "WEBSITE" : "COUNTER"}
              orderId={selected.id}
              initialReceiptId={selected.receiptId}
              totalMinor={selected.totalMinor}
              currency={selected.currency}
              locale={locale}
              labels={counterLabels}
              hardwareLabels={hardwareLabels}
              onPaid={() => void load().catch(() => setError(text.error))}
            />
          )}
          {view !== "ACTIVE" && selected.receiptId && (
            <a
              className="order-receipt-link"
              href={`/${locale}/staff/receipts/${encodeURIComponent(selected.receiptId)}`}
            >
              {recon.receipt}
            </a>
          )}
          {selected.canComplete && (
            <button disabled={busy} onClick={() => void complete(selected)}>
              {text.pickup}
            </button>
          )}
          <button onClick={() => setSelectedId(null)}>{text.close}</button>
        </PilotDialog>
      )}
    </main>
  );
}

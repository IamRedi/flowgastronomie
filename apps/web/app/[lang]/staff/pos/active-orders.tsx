"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CounterQueueOrder } from "@flowgastronomie/domain";
import type { Dictionary } from "../../../../lib/dictionaries";
import { pilotText } from "../../../../lib/pilot-copy";
import { ProductionItems } from "../production-board";
import { CounterPayment } from "./counter-payment";
export function ActiveOrders({
  locale,
  revision,
  labels,
  hardwareLabels,
  onPaid,
}: {
  locale: string;
  revision: number;
  labels: Dictionary["counterSale"];
  hardwareLabels: Dictionary["hardware"];
  onPaid: () => void;
}) {
  const [orders, setOrders] = useState<CounterQueueOrder[]>([]);
  const [selected, setSelected] = useState<CounterQueueOrder | null>(null);
  const [error, setError] = useState(false);
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const text = pilotText(locale);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const r = await fetch(`${api}/v1/staff/pos/orders`, {
        credentials: "include",
        signal: signal ?? null,
      });
      if (!r.ok) throw new Error();
      const b = await r.json();
      if (!signal?.aborted) {
        setOrders(b);
        setSelected((previous) =>
          previous
            ? (b.find((o: CounterQueueOrder) => o.id === previous.id) ??
              previous)
            : null,
        );
        setError(false);
      }
    },
    [api],
  );
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      void load(controller.signal).catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load, revision]);
  return (
    <section className="pilot-counter-queue" aria-label={text.active}>
      <h2>
        {text.active} ({orders.length})
      </h2>
      {error && <p role="alert">{text.error}</p>}
      <div className="pilot-queue-list">
        {orders.map((o) => (
          <article key={o.id} data-order-reference={o.reference}>
            <strong>
              #{o.reference} ·{" "}
              {o.orderType === "TAKEAWAY"
                ? text.takeaway
                : `${text.table} ${o.tableLabel}`}
            </strong>
            <p>
              {o.productionStatus === "READY"
                ? text.ready
                : o.productionStatus === "SERVED"
                  ? text.completed
                  : o.productionStatus === "PREPARING"
                    ? text.preparing
                    : o.productionStatus === "ACCEPTED"
                      ? text.accepted
                      : text.new}{" "}
              · {o.paymentStatus === "PAID" ? text.paid : text.unpaid}
            </p>
            <p>
              {new Intl.NumberFormat(locale, {
                style: "currency",
                currency: o.currency,
              }).format(o.totalMinor / 100)}{" "}
              · {text.age}:{" "}
              {Math.max(
                0,
                Math.floor((Date.now() - Date.parse(o.createdAt)) / 60000),
              )}
              m
            </p>
            <button onClick={() => setSelected(o)}>
              {text.open} #{o.reference}
            </button>
          </article>
        ))}
      </div>
      {!orders.length && !error && <p>{text.empty}</p>}
      {selected && (
        <CounterOrderDialog
          key={selected.id}
          order={selected}
          locale={locale}
          labels={labels}
          hardwareLabels={hardwareLabels}
          onClose={() => setSelected(null)}
          onPaid={() => {
            onPaid();
            void load().catch(() => setError(true));
          }}
          onComplete={() => {
            setSelected(null);
            void load().catch(() => setError(true));
          }}
        />
      )}
    </section>
  );
}
function CounterOrderDialog({
  order,
  locale,
  labels,
  hardwareLabels,
  onClose,
  onPaid,
  onComplete,
}: {
  order: CounterQueueOrder;
  locale: string;
  labels: Dictionary["counterSale"];
  hardwareLabels: Dictionary["hardware"];
  onClose: () => void;
  onPaid: () => void;
  onComplete: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const text = pilotText(locale);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      previous?.focus();
    };
  }, []);
  async function complete() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/staff/pos/orders/${order.id}/complete`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) throw new Error();
      onComplete();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <dialog
      ref={dialog}
      className="pilot-order-dialog"
      aria-labelledby={`queue-title-${order.id}`}
      onClose={onClose}
    >
      <h2 id={`queue-title-${order.id}`}>#{order.reference}</h2>
      <p>
        {order.productionStatus === "SERVED"
          ? text.completed
          : order.productionStatus === "READY"
            ? text.ready
            : order.productionStatus === "PREPARING"
              ? text.preparing
              : order.productionStatus === "ACCEPTED"
                ? text.accepted
                : text.new}{" "}
        · {order.paymentStatus === "PAID" ? text.paid : text.unpaid}
      </p>
      <ProductionItems items={order.items} />
      {(order.paymentStatus === "UNPAID" || order.receiptId) && (
        <CounterPayment
          orderId={order.id}
          initialReceiptId={order.receiptId}
          totalMinor={order.totalMinor}
          currency={order.currency}
          locale={locale}
          labels={labels}
          hardwareLabels={hardwareLabels}
          onPaid={onPaid}
        />
      )}
      {order.canComplete && (
        <button disabled={busy} onClick={() => void complete()}>
          {order.orderType === "TAKEAWAY" ? text.pickup : text.served}
        </button>
      )}
      {error && <p role="alert">{text.error}</p>}
      <button onClick={onClose}>{text.close}</button>
    </dialog>
  );
}

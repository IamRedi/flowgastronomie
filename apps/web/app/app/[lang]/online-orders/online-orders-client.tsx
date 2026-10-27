"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { Locale } from "../../../../lib/i18n";
import {
  type OnlineFulfillmentType,
  type OnlineOrderStatus,
  onlineFulfillmentLabels,
  onlineOrderStatusLabels,
} from "../../../../lib/online-order-copy";

type Order = {
  referenceCode: string;
  status: OnlineOrderStatus;
  fulfillmentType: OnlineFulfillmentType;
  totalMinor: number;
  currency: string;
  contact: { name: string; phone: string };
  requestedFor: string;
  guestNotes: string | null;
  items: Array<{
    productName: string;
    quantity: number;
    variantName: string | null;
    modifiers: Array<{ groupName: string; optionName: string }>;
  }>;
  messages: Array<{
    author: "GUEST" | "STAFF";
    body: string;
    createdAt: string;
  }>;
  timeline: Array<{
    status: OnlineOrderStatus;
    note: string | null;
    createdAt: string;
  }>;
};
const copy: Record<Locale, Record<string, string>> = {
  sq: {
    title: "Porositë online",
    loading: "Po ngarkohen porositë…",
    empty: "Nuk ka porosi online.",
    accept: "Prano",
    reject: "Refuzo",
    cancel: "Anulo",
    note: "Shënim për klientin (opsional)",
    message: "Përgjigju klientit",
    send: "Dërgo",
    refresh: "Përditëso",
    error: "Veprimi nuk u krye.",
    pending: "Në pritje konfirmimi",
    out: "Në rrugë",
    handed: "U dorëzua",
    delivered: "Dorëzuar",
  },
  en: {
    title: "Online orders",
    loading: "Loading orders…",
    empty: "There are no online orders.",
    accept: "Accept",
    reject: "Reject",
    cancel: "Cancel",
    note: "Note for the guest (optional)",
    message: "Reply to guest",
    send: "Send",
    refresh: "Refresh",
    error: "The action could not be completed.",
    pending: "Awaiting confirmation",
    out: "Out for delivery",
    handed: "Handed over",
    delivered: "Delivered",
  },
  de: {
    title: "Online-Bestellungen",
    loading: "Bestellungen werden geladen…",
    empty: "Es gibt keine Online-Bestellungen.",
    accept: "Annehmen",
    reject: "Ablehnen",
    cancel: "Stornieren",
    note: "Notiz für den Gast (optional)",
    message: "Dem Gast antworten",
    send: "Senden",
    refresh: "Aktualisieren",
    error: "Die Aktion konnte nicht ausgeführt werden.",
    pending: "Wartet auf Bestätigung",
    out: "Unterwegs",
    handed: "Übergeben",
    delivered: "Zugestellt",
  },
  it: {
    title: "Ordini online",
    loading: "Caricamento ordini…",
    empty: "Non ci sono ordini online.",
    accept: "Accetta",
    reject: "Rifiuta",
    cancel: "Annulla",
    note: "Nota per il cliente (facoltativa)",
    message: "Rispondi al cliente",
    send: "Invia",
    refresh: "Aggiorna",
    error: "Impossibile completare l'azione.",
    pending: "In attesa di conferma",
    out: "In consegna",
    handed: "Consegnato",
    delivered: "Consegnato",
  },
};

export function OnlineOrdersClient({ locale }: { locale: Locale }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const labels = copy[locale]!;
  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setState("loading");
      const response = await fetch(`${apiUrl}/v1/staff/online-orders`, {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign(`/${locale}/staff/login`);
        return;
      }
      if (!response.ok) {
        setState("error");
        return;
      }
      setOrders((await response.json()) as Order[]);
      setState("ready");
    },
    [apiUrl, locale],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const events = new EventSource(`${apiUrl}/v1/staff/online-orders/events`, {
      withCredentials: true,
    });
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = undefined;
    };
    events.onopen = stopFallback;
    events.onerror = () => {
      fallbackTimer ??= setInterval(() => void load(false), 5_000);
    };
    events.addEventListener("orders", (event) => {
      setOrders(JSON.parse((event as MessageEvent<string>).data) as Order[]);
      setState("ready");
    });
    return () => {
      stopFallback();
      events.close();
    };
  }, [apiUrl, load]);
  async function transition(
    referenceCode: string,
    status:
      | "ACCEPTED"
      | "REJECTED"
      | "CANCELLED"
      | "PREPARING"
      | "READY"
      | "OUT_FOR_DELIVERY"
      | "COMPLETED",
    form: HTMLFormElement,
  ) {
    setError(null);
    const response = await fetch(
      `${apiUrl}/v1/staff/online-orders/${encodeURIComponent(referenceCode)}/status`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          note: new FormData(form).get("note") || undefined,
        }),
      },
    );
    if (!response.ok) {
      setError(labels.error ?? "Error");
      return;
    }
    await load();
  }
  async function message(
    event: FormEvent<HTMLFormElement>,
    referenceCode: string,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await fetch(
      `${apiUrl}/v1/staff/online-orders/${encodeURIComponent(referenceCode)}/messages`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: new FormData(form).get("message") }),
      },
    );
    if (!response.ok) {
      setError(labels.error ?? "Error");
      return;
    }
    form.reset();
    await load();
  }
  const price = (value: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      value / 100,
    );
  if (state === "loading")
    return (
      <main className="online-orders-admin">
        <p>{labels.loading}</p>
      </main>
    );
  if (state === "error")
    return (
      <main className="online-orders-admin">
        <p>{labels.error}</p>
        <button onClick={() => void load()} type="button">
          {labels.refresh}
        </button>
      </main>
    );
  return (
    <main className="online-orders-admin">
      <header>
        <h1>{labels.title}</h1>
        <button onClick={() => void load()} type="button">
          {labels.refresh}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {orders.length === 0 ? (
        <p>{labels.empty}</p>
      ) : (
        <div className="online-orders-list">
          {orders.map((order) => (
            <article key={order.referenceCode}>
              <div>
                <strong>{order.referenceCode}</strong>
                <span>{onlineOrderStatusLabels[locale][order.status]}</span>
                <p>
                  {order.contact.name} · {order.contact.phone} ·{" "}
                  {onlineFulfillmentLabels[locale][order.fulfillmentType]}
                </p>
                <p>
                  {new Date(order.requestedFor).toLocaleString(locale)} ·{" "}
                  {price(order.totalMinor, order.currency)}
                </p>
                {order.items.map((item, index) => (
                  <small key={`${item.productName}-${index}`}>
                    {item.quantity}× {item.productName}
                    {item.variantName ? ` · ${item.variantName}` : ""}
                    {item.modifiers
                      .map(
                        (modifier) =>
                          ` · ${modifier.groupName}: ${modifier.optionName}`,
                      )
                      .join("")}
                  </small>
                ))}
              </div>
              {order.status === "PENDING_CONFIRMATION" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void transition(
                      order.referenceCode,
                      "ACCEPTED",
                      event.currentTarget,
                    );
                  }}
                >
                  <textarea name="note" placeholder={labels.note} />
                  <button type="submit">{labels.accept}</button>
                  <button
                    onClick={(event) => {
                      void transition(
                        order.referenceCode,
                        "REJECTED",
                        event.currentTarget.form!,
                      );
                    }}
                    type="button"
                  >
                    {labels.reject}
                  </button>
                </form>
              )}
              {order.status === "READY" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void transition(
                      order.referenceCode,
                      order.fulfillmentType === "DELIVERY"
                        ? "OUT_FOR_DELIVERY"
                        : "COMPLETED",
                      event.currentTarget,
                    );
                  }}
                >
                  <button type="submit">
                    {order.fulfillmentType === "DELIVERY"
                      ? labels.out
                      : labels.handed}
                  </button>
                </form>
              )}
              {order.status === "OUT_FOR_DELIVERY" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void transition(
                      order.referenceCode,
                      "COMPLETED",
                      event.currentTarget,
                    );
                  }}
                >
                  <button type="submit">{labels.delivered}</button>
                </form>
              )}
              <form
                onSubmit={(event) => void message(event, order.referenceCode)}
              >
                <input name="message" placeholder={labels.message} required />
                <button type="submit">{labels.send}</button>
              </form>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

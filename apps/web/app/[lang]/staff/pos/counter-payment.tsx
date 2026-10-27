"use client";
import { useEffect, useRef, useState } from "react";
import {
  cashChange,
  parseMinorInput,
  type FinalReceipt,
} from "@flowgastronomie/domain";
import { PilotIcon } from "../pilot-icon";
import { HardwareActions } from "./hardware-actions";
import type { Dictionary } from "../../../../lib/dictionaries";
import { pilotText } from "../../../../lib/pilot-copy";

export function CounterPayment({
  onPaid,
  orderId,
  totalMinor,
  currency,
  locale,
  labels,
  hardwareLabels,
  initialReceiptId,
  source = "COUNTER",
}: {
  onPaid: () => void;
  orderId: string;
  totalMinor: number;
  currency: string;
  locale: string;
  labels: Dictionary["counterSale"];
  hardwareLabels: Dictionary["hardware"];
  initialReceiptId?: string | null;
  source?: "COUNTER" | "WEBSITE";
}) {
  const [method, setMethod] = useState<"CASH" | "CARD_AT_COUNTER">("CASH");
  const [received, setReceived] = useState("");
  const [terminalConfirmed, setTerminalConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<FinalReceipt | null>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Payment controls disappear on success; keep keyboard focus in the result.
    if (receipt) receiptHeading.current?.focus();
  }, [receipt]);
  const key = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  useEffect(() => {
    if (!initialReceiptId) return;
    const controller = new AbortController();
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/staff/receipts/${initialReceiptId}`,
      { credentials: "include", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!controller.signal.aborted) setReceipt(body as FinalReceipt);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(labels.loadError);
      });
    return () => controller.abort();
  }, [initialReceiptId, labels.loadError]);
  const receivedMinor = parseMinorInput(received);
  const change =
    receivedMinor != null && receivedMinor >= totalMinor
      ? cashChange(totalMinor, receivedMinor)
      : null;
  const money = (n: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      n / 100,
    );
  async function confirm() {
    if (inFlight.current || receipt) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/staff/${source === "WEBSITE" ? "online-orders" : "pos/orders"}/${encodeURIComponent(orderId)}/payment`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": key.current,
          },
          body: JSON.stringify(
            method === "CASH"
              ? { method, receivedMinor }
              : { method, terminalConfirmed },
          ),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        const text = pilotText(locale);
        setError(
          body.code === "REGISTER_REQUIRED"
            ? text.registerRequired
            : body.code === "ACTIVE_SHIFT_REQUIRED"
              ? labels.startShift
              : body.code === "ALREADY_PAID"
                ? text.alreadyPaid
                : [
                      "RECEIPT_BUSINESS_NOT_READY",
                      "RECEIPT_TAX_NOT_READY",
                      "INVALID_TAX",
                    ].includes(body.code)
                  ? text.receiptSetup
                  : text.paymentConflict,
        );
        return;
      }
      setReceipt(body as FinalReceipt);
      onPaid();
    } catch {
      setError(pilotText(locale).networkError);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <section className="counter-payment">
        <h2 ref={receiptHeading} tabIndex={-1}>
          <PilotIcon name="ready" />
          {labels.receipt} #{receipt.number}
        </h2>
        <p>{money(receipt.grossMinor)}</p>
        <HardwareActions
          receipt={receipt}
          automatic
          labels={hardwareLabels}
          locale={locale}
        />
        <a
          className="counter-button"
          href={`/${locale}/staff/receipts/${receipt.id}`}
        >
          {labels.openReceipt}
        </a>
      </section>
    );
  if (initialReceiptId)
    return (
      <section className="counter-payment">
        <p>{error ?? labels.receipt}</p>
        <a
          className="counter-button"
          href={`/${locale}/staff/receipts/${initialReceiptId}`}
        >
          {labels.openReceipt}
        </a>
      </section>
    );
  return (
    <section className="counter-payment" aria-label={labels.paymentMethod}>
      <div className="counter-actions">
        <button
          type="button"
          disabled={busy}
          aria-pressed={method === "CASH"}
          onClick={() => {
            setMethod("CASH");
            setError(null);
          }}
        >
          <PilotIcon name="counter" />
          {labels.cash}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={method === "CARD_AT_COUNTER"}
          onClick={() => {
            setMethod("CARD_AT_COUNTER");
            setError(null);
          }}
        >
          <PilotIcon name="payment" />
          {labels.card}
        </button>
      </div>
      {method === "CASH" ? (
        <>
          <label>
            {labels.received}
            <input
              inputMode="decimal"
              value={received}
              disabled={busy}
              onChange={(event) => setReceived(event.target.value)}
            />
          </label>
          <p>
            {labels.change}:{" "}
            <strong>{change == null ? "—" : money(change)}</strong>
          </p>
        </>
      ) : (
        <label className="counter-terminal">
          <input
            type="checkbox"
            checked={terminalConfirmed}
            disabled={busy}
            onChange={(event) => setTerminalConfirmed(event.target.checked)}
          />
          {labels.terminalHint}
        </label>
      )}
      <button
        type="button"
        disabled={
          busy || (method === "CASH" ? change == null : !terminalConfirmed)
        }
        onClick={() => void confirm()}
      >
        {method === "CASH" ? labels.confirmCash : labels.confirmCard}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

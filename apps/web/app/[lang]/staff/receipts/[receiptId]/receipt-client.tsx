"use client";
import { useEffect, useState } from "react";
import type { FinalReceipt } from "@flowgastronomie/domain";
import { HardwareActions } from "../../pos/hardware-actions";
import type { Dictionary } from "../../../../../lib/dictionaries";
import { pilotText } from "../../../../../lib/pilot-copy";

export function ReceiptClient({
  id,
  locale,
  labels,
  hardwareLabels,
}: {
  id: string;
  locale: string;
  labels: Dictionary["counterSale"];
  hardwareLabels: Dictionary["hardware"];
}) {
  const [receipt, setReceipt] = useState<FinalReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<"page" | "58" | "80">("80");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/staff/receipts/${encodeURIComponent(id)}`,
        { credentials: "include", signal: controller.signal },
      );
      if (response.status === 401) {
        window.location.assign(`/${locale}/staff/login`);
        return;
      }
      if (!response.ok) {
        setError(labels.loadError);
        return;
      }
      setReceipt((await response.json()) as FinalReceipt);
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setError(labels.loadError);
    });
    return () => controller.abort();
  }, [id, locale, labels.loadError]);
  const money = (minor: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: receipt?.currency ?? "EUR",
    }).format(minor / 100);
  if (!receipt)
    return (
      <main className="receipt-page">
        <h1>{labels.receipt}</h1>
        <p role={error ? "alert" : "status"}>{error ?? labels.loading}</p>
        <a href={`/${locale}/staff/pos`}>{labels.back}</a>
      </main>
    );
  return (
    <main className="receipt-page" data-paper={paper}>
      <style media="print">{"@page { size: auto; margin: 3mm; }"}</style>
      <div className="receipt-actions">
        <label>
          {pilotText(locale).printWidth}
          <select
            value={paper}
            onChange={(event) =>
              setPaper(event.target.value as "page" | "58" | "80")
            }
          >
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
            <option value="page">{pilotText(locale).printFullPage}</option>
          </select>
        </label>
        <HardwareActions
          receipt={receipt}
          labels={hardwareLabels}
          locale={locale}
        />
      </div>
      <div className="receipt-actions">
        <a className="counter-button" href={`/${locale}/staff/pos`}>
          {labels.newOrder}
        </a>
        <button type="button" onClick={() => window.print()}>
          {labels.print}
        </button>
      </div>
      <h1>
        {labels.receipt} #{receipt.number}
      </h1>
      <p>
        {labels.finalized} ·{" "}
        <time dateTime={receipt.issuedAt}>
          {new Date(receipt.issuedAt).toLocaleString(locale)}
        </time>
      </p>
      <address>
        <strong>{receipt.business.legalName}</strong>
        <br />
        {receipt.business.addressLine1}
        <br />
        {receipt.business.postalCode} {receipt.business.city}
        <br />
        {receipt.business.countryCode}
        {receipt.business.vatId && (
          <>
            <br />
            VAT ID: {receipt.business.vatId}
          </>
        )}
      </address>
      <p>
        {receipt.business.venueName} · {labels.cashier}:{" "}
        {receipt.cashier.displayName}
      </p>
      <ul className="receipt-items">
        {receipt.items.map((item, index) => (
          <li key={index}>
            <div>
              {item.quantity} × {item.productName}
              {item.variantName && ` · ${item.variantName}`}
              {item.modifiers.map((modifier, modifierIndex) => (
                <small key={modifierIndex}>{modifier.optionName}</small>
              ))}
            </div>
            <strong>{money(item.grossMinor)}</strong>
          </li>
        ))}
      </ul>
      <dl className="receipt-totals">
        <dt>{labels.net}</dt>
        <dd>{money(receipt.netMinor)}</dd>
        <dt>{labels.tax}</dt>
        <dd>{money(receipt.taxMinor)}</dd>
        <dt>{labels.total}</dt>
        <dd data-testid="receipt-total">{money(receipt.grossMinor)}</dd>
      </dl>
      <table className="receipt-tax">
        <caption>{labels.tax}</caption>
        <thead>
          <tr>
            <th>{labels.taxCode}</th>
            <th>{labels.rate}</th>
            <th>{labels.net}</th>
            <th>{labels.tax}</th>
          </tr>
        </thead>
        <tbody>
          {receipt.breakdown.map((group) => (
            <tr key={`${group.taxCode}:${group.rateBasisPoints}`}>
              <td>{group.taxCode}</td>
              <td>{group.rateBasisPoints / 100}%</td>
              <td>{money(group.netMinor)}</td>
              <td>{money(group.taxMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {labels.paymentMethod}:{" "}
        {receipt.method === "CASH" ? labels.cash : labels.card}
      </p>
      {receipt.receivedMinor != null && (
        <p>
          {labels.received}: {money(receipt.receivedMinor)} · {labels.change}:{" "}
          {money(receipt.changeMinor ?? 0)}
        </p>
      )}
    </main>
  );
}

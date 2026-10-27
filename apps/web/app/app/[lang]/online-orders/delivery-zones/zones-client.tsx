"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { Locale } from "../../../../../lib/i18n";
import { deliveryZoneCopy } from "../../../../../lib/online-order-copy";

type Zone = {
  id: string;
  name: string;
  postalPrefixes: string[];
  feeMinor: number;
  minimumOrderMinor: number;
  active: boolean;
};
export function DeliveryZonesClient({ locale }: { locale: Locale }) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const labels = deliveryZoneCopy[locale];
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
  });
  const load = useCallback(async () => {
    const r = await fetch(`${apiUrl}/v1/staff/delivery-zones`, {
      credentials: "include",
    });
    if (!r.ok) {
      setState("error");
      return;
    }
    setZones((await r.json()) as Zone[]);
    setState("ready");
  }, [apiUrl]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const r = await fetch(`${apiUrl}/v1/staff/delivery-zones`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        postalPrefixes: String(data.get("prefixes")).split(","),
        feeMinor: Math.round(Number(data.get("fee")) * 100),
        minimumOrderMinor: Math.round(Number(data.get("minimum")) * 100),
      }),
    });
    setMessage(r.ok ? labels.saved : labels.saveError);
    if (r.ok) {
      event.currentTarget.reset();
      await load();
    }
  }
  async function toggle(zone: Zone) {
    setMessage("");
    const response = await fetch(
      `${apiUrl}/v1/staff/delivery-zones/${zone.id}`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...zone, active: !zone.active }),
      },
    );
    if (!response.ok) {
      setMessage(labels.saveError);
      return;
    }
    await load();
  }
  if (state === "loading") {
    return (
      <main className="online-orders-admin">
        <p>{labels.loading}</p>
      </main>
    );
  }
  if (state === "error") {
    return (
      <main className="online-orders-admin">
        <p role="alert">{labels.loadError}</p>
      </main>
    );
  }
  return (
    <main className="online-orders-admin">
      <header>
        <a href={`/app/${locale}/online-orders`}>FlowGastronomie</a>
        <h1>{labels.title}</h1>
      </header>
      <form onSubmit={create}>
        <input name="name" placeholder={labels.name} required />
        <input name="prefixes" placeholder={labels.prefixes} required />
        <input
          min="0"
          name="fee"
          placeholder={labels.fee}
          required
          step="0.01"
          type="number"
        />
        <input
          min="0"
          name="minimum"
          placeholder={labels.minimum}
          required
          step="0.01"
          type="number"
        />
        <button type="submit">{labels.add}</button>
      </form>
      {message && <p role="status">{message}</p>}
      {zones.map((zone) => (
        <article className="online-channel-toggle" key={zone.id}>
          <span>
            <strong>{zone.name}</strong>
            <small>
              {zone.postalPrefixes.join(", ")} ·{" "}
              {money.format(zone.feeMinor / 100)} · {labels.minimumShort}{" "}
              {money.format(zone.minimumOrderMinor / 100)}
            </small>
          </span>
          <button onClick={() => void toggle(zone)} type="button">
            {zone.active ? labels.active : labels.inactive}
          </button>
        </article>
      ))}
    </main>
  );
}

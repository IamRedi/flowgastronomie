"use client";
import { useEffect, useState } from "react";

import type { Locale } from "../../../../../lib/i18n";
import { onlineOrderSettingsCopy } from "../../../../../lib/online-order-copy";
import { orderingUxCopy } from "../../../../../lib/ordering-ux-copy";

type Settings = {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  cateringEnabled: boolean;
  pickupLeadMinutes?: number | null;
};
export function OnlineOrderSettingsClient({ locale }: { locale: Locale }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const labels = onlineOrderSettingsCopy[locale];
  useEffect(() => {
    void fetch(`${apiUrl}/v1/staff/online-order-settings`, {
      credentials: "include",
    }).then(async (r) => {
      if (!r.ok) {
        setState("error");
        return;
      }
      setSettings((await r.json()) as Settings);
      setState("ready");
    });
  }, [apiUrl]);
  async function save() {
    if (!settings) return;
    const response = await fetch(`${apiUrl}/v1/staff/online-order-settings`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaveState(response.ok ? "saved" : "error");
  }
  if (state === "loading") {
    return <main className="online-orders-admin">{labels.loading}</main>;
  }
  if (state === "error" || !settings) {
    return (
      <main className="online-orders-admin">
        <p role="alert">{labels.loadError}</p>
      </main>
    );
  }
  const channels: Array<
    ["pickupEnabled" | "deliveryEnabled" | "cateringEnabled", string]
  > = [
    ["pickupEnabled", labels.pickup],
    ["deliveryEnabled", labels.delivery],
    ["cateringEnabled", labels.catering],
  ];
  return (
    <main className="online-orders-admin">
      <header>
        <a href={`/app/${locale}/online-orders`}>FlowGastronomie</a>
        <h1>{labels.title}</h1>
      </header>
      {channels.map(([key, name]) => (
        <label className="online-channel-toggle" key={key}>
          <span>
            <strong>{name}</strong>
            <small>{settings[key] ? labels.active : labels.inactive}</small>
          </span>
          <input
            checked={settings[key]}
            onChange={() => {
              setSettings({ ...settings, [key]: !settings[key] });
              setSaveState("idle");
            }}
            type="checkbox"
          />
        </label>
      ))}
      <label className="online-channel-toggle">
        <span>
          <strong>{orderingUxCopy[locale].lead}</strong>
          <small>{orderingUxCopy[locale].leadHelp}</small>
        </span>
        <input
          type="number"
          min={1}
          max={240}
          value={settings.pickupLeadMinutes ?? ""}
          onChange={(event) => {
            setSettings({
              ...settings,
              pickupLeadMinutes: event.target.value
                ? Number(event.target.value)
                : null,
            });
            setSaveState("idle");
          }}
        />
      </label>
      <button onClick={() => void save()} type="button">
        {labels.save}
      </button>
      {saveState !== "idle" && (
        <p role={saveState === "error" ? "alert" : "status"}>
          {saveState === "saved" ? labels.saved : labels.saveError}
        </p>
      )}
    </main>
  );
}

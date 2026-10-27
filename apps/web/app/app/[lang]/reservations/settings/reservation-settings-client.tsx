"use client";

import { useEffect, useState } from "react";

import type { Locale } from "../../../../../lib/i18n";
import { reservationSettingsCopy } from "../../../../../lib/reservation-copy";

type Settings = { enabled: boolean };

export function ReservationSettingsClient({ locale }: { locale: Locale }) {
  const labels = reservationSettingsCopy[locale];
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  useEffect(() => {
    void fetch(`${apiUrl}/v1/staff/reservations/settings/auto-confirm`, {
      credentials: "include",
    }).then(async (response) => {
      if (response.status === 401) {
        window.location.assign(`/${locale}/staff/login`);
        return;
      }
      if (!response.ok) {
        setState("error");
        return;
      }
      setSettings((await response.json()) as Settings);
      setState("ready");
    });
  }, [apiUrl, locale]);

  async function save() {
    if (!settings) return;
    const response = await fetch(
      `${apiUrl}/v1/staff/reservations/settings/auto-confirm`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      },
    );
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

  return (
    <main className="online-orders-admin">
      <header>
        <h1>{labels.title}</h1>
        <p>{labels.description}</p>
      </header>
      <label className="online-channel-toggle">
        <span>
          <strong>{labels.autoConfirm}</strong>
          <small>{settings.enabled ? labels.enabled : labels.disabled}</small>
        </span>
        <input
          checked={settings.enabled}
          onChange={() => {
            setSettings({ enabled: !settings.enabled });
            setSaveState("idle");
          }}
          type="checkbox"
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

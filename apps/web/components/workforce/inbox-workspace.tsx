"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  workforceNotificationCopy,
  workforceNotificationCategories,
} from "@flowgastronomie/domain";
import type { Locale } from "../../lib/i18n";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import { workforceMonthCopy } from "./month-copy";
import type { InboxData } from "./month-types";
export function WorkforceInbox({
  prefix,
  locale,
}: {
  prefix: string;
  locale: Locale;
}) {
  const c = workforceMonthCopy[locale],
    [data, setData] = useState<InboxData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preferences, setPreferences] = useState(false),
    [ack, setAck] = useState<InboxData["items"][number] | null>(null),
    [configuration, setConfiguration] = useState<{
      emailProvider: string;
      pushProvider: string;
      pushPublicKey: string | null;
    } | null>(null);
  const load = useCallback(
    async (cursor?: string) => {
      try {
        const r = await fetch(
          prefix +
            "notifications?" +
            new URLSearchParams({ locale, ...(cursor ? { cursor } : {}) }),
          { credentials: "include", cache: "no-store" },
        );
        if (!r.ok) throw new Error();
        const next = (await r.json()) as InboxData;
        setData((old) =>
          cursor && old
            ? {
                ...next,
                items: [
                  ...old.items,
                  ...next.items.filter(
                    (n) => !old.items.some((a) => a.id === n.id),
                  ),
                ],
              }
            : next,
        );
      } catch {
        setError(c.error);
      }
    },
    [prefix, locale, c.error],
  );
  useEffect(() => {
    let alive = true;
    void load();
    fetch(prefix + "notification-configuration", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (r) => {
        if (r.ok && alive) setConfiguration(await r.json());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [load, prefix]);
  async function command(path: string, body: unknown, method = "POST") {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(prefix + path, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const b = await r.json();
        throw new Error(b.code === "CONFLICT" ? c.conflict : c.error);
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : c.error);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function savePreferences(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const f = new FormData(e.currentTarget),
      body = {
        expectedVersion: data.preferences.version,
        locale: String(f.get("locale")),
        emailEnabled: f.get("email") === "on",
        pushEnabled: f.get("push") === "on",
        reminderMinutes: Number(f.get("reminder")),
        categories: f.getAll("categories").map(String),
        consentConfirmed: f.get("confirm") === "on",
      };
    if (await command("notification-preferences", body, "PUT"))
      setPreferences(false);
  }
  async function enableBrowser() {
    if (!configuration?.pushPublicKey || !data?.preferences.pushEnabled) return;
    setError("");
    try {
      if (!("serviceWorker" in navigator) || !("Notification" in window))
        throw new Error(c.error);
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(c.error);
      const registration = await navigator.serviceWorker.register(
        "/workforce-sw.js",
        { scope: "/" },
      );
      await navigator.serviceWorker.ready;
      const encoded = configuration.pushPublicKey
          .replace(/-/g, "+")
          .replace(/_/g, "/"),
        bytes = Uint8Array.from(
          atob(encoded + "=".repeat((4 - (encoded.length % 4)) % 4)),
          (c) => c.charCodeAt(0),
        );
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await command("push-subscription", {
        consentConfirmed: true,
        subscription: subscription.toJSON(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : c.error);
    }
  }
  return (
    <section className="wf3-workspace" data-testid="wf3-inbox">
      <header className="wf3-heading">
        <div>
          <p className="wf-eyebrow">FlowGastronomie · Workforce</p>
          <h2>{c.inbox}</h2>
          <p>
            {c.unread}: {data?.unreadCount ?? "—"}
          </p>
        </div>
        <div className="wf3-actions">
          <button
            className="wf-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            {c.refresh}
          </button>
          <button
            className="wf-secondary"
            disabled={!data || busy}
            onClick={() => setPreferences(true)}
          >
            {c.preferences}
          </button>
          <button
            className="wf-secondary"
            disabled={
              !data?.preferences.pushEnabled ||
              !configuration?.pushPublicKey ||
              busy
            }
            onClick={() => void enableBrowser()}
          >
            {c.enablePush}
          </button>
        </div>
      </header>
      {configuration &&
        (configuration.emailProvider === "disabled" ||
          configuration.pushProvider === "disabled") && (
          <p className="wf3-note">{c.providerDisabled}</p>
        )}
      {error && <p role="alert">{error}</p>}
      {!data && <p role="status">{c.loading}</p>}
      {data?.items.length === 0 && <p>{c.empty}</p>}
      <div className="wf3-inbox-list">
        {data?.items.map((n) => (
          <article
            key={n.id}
            className={"wf3-notice " + (!n.readAt ? "wf3-notice-unread" : "")}
            data-notice-id={n.id}
          >
            <div>
              <p className="wf-eyebrow">
                {n.createdAt.slice(0, 16).replace("T", " · ")}
                {!n.readAt ? " · " + c.unread : ""}
              </p>
              <h3>{n.title}</h3>
              <p>{n.body}</p>
              {n.acknowledgedAt && <p>{c.acknowledged}</p>}
            </div>
            <div className="wf3-actions">
              <a className="wf3-link" href={n.href}>
                {n.action}
              </a>
              {!n.readAt && (
                <button
                  className="wf-secondary"
                  disabled={busy}
                  onClick={() =>
                    void command("notifications/" + n.id + "/read", {})
                  }
                >
                  {c.read}
                </button>
              )}
              {n.important && !n.acknowledgedAt && (
                <button disabled={busy} onClick={() => setAck(n)}>
                  {c.ack}
                </button>
              )}
            </div>
            <details>
              <summary>{c.delivery}</summary>
              {n.delivery.map((d) => (
                <p key={d.channel}>
                  {d.channel === "EMAIL" ? c.email : c.push} ·{" "}
                  {(
                    {
                      PENDING: c.queued,
                      LEASED: c.sending,
                      DELIVERED: c.providerAccepted,
                      DISABLED: c.off,
                      FAILED: c.failed,
                      UNCERTAIN: c.uncertainDelivery,
                    } as Record<string, string>
                  )[d.state] ?? c.uncertainDelivery}{" "}
                  · {d.attempts}
                </p>
              ))}
            </details>
          </article>
        ))}
      </div>
      {data?.nextCursor && (
        <button
          className="wf-secondary"
          disabled={busy}
          onClick={() => void load(data.nextCursor!)}
        >
          {c.more}
        </button>
      )}
      {preferences && data && (
        <PilotDialog
          title={c.preferences}
          closeLabel={c.closeDialog}
          onClose={() => setPreferences(false)}
          className="wf-dialog"
        >
          <form className="wf-form" onSubmit={savePreferences}>
            <label>
              {c.locale}
              <select name="locale" defaultValue={data.preferences.locale}>
                <option value="sq">Shqip</option>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
                <option value="it">Italiano</option>
              </select>
            </label>
            <label>
              {c.reminder}
              <input
                type="number"
                name="reminder"
                required
                min={5}
                max={1440}
                defaultValue={data.preferences.reminderMinutes}
              />
            </label>
            <label className="wf2-check">
              <input
                type="checkbox"
                name="email"
                defaultChecked={data.preferences.emailEnabled}
              />
              {c.email}
            </label>
            <label className="wf2-check">
              <input
                type="checkbox"
                name="push"
                defaultChecked={data.preferences.pushEnabled}
              />
              {c.push}
            </label>
            <fieldset className="wf-wide">
              <legend>{c.category}</legend>
              {workforceNotificationCategories.map((category) => (
                <label className="wf2-check" key={category}>
                  <input
                    type="checkbox"
                    name="categories"
                    value={category}
                    defaultChecked={data.preferences.categories.includes(
                      category,
                    )}
                  />
                  {workforceNotificationCopy(category, locale).title}
                </label>
              ))}
            </fieldset>
            <label className="wf2-check wf-wide">
              <input type="checkbox" name="confirm" required />
              {c.consent}
            </label>
            {error && (
              <p className="wf-wide" role="alert">
                {error}
              </p>
            )}
            <button className="wf-wide" disabled={busy}>
              {c.saved}
            </button>
          </form>
        </PilotDialog>
      )}
      {ack && (
        <PilotDialog
          title={c.ack}
          closeLabel={c.closeDialog}
          onClose={() => setAck(null)}
          className="wf-dialog"
        >
          <form
            className="wf-form"
            onSubmit={(e) => {
              e.preventDefault();
              void command("notifications/" + ack.id + "/acknowledgment", {
                reviewConfirmed: true,
              }).then((ok) => {
                if (ok) setAck(null);
              });
            }}
          >
            <h3 className="wf-wide">{ack.title}</h3>
            <p className="wf-wide">{ack.body}</p>
            <a className="wf-wide wf3-link" href={ack.href}>
              {ack.action}
            </a>
            <label className="wf-wide wf2-check">
              <input type="checkbox" required />
              {c.ackHelp}
            </label>
            {error && (
              <p className="wf-wide" role="alert">
                {error}
              </p>
            )}
            <button className="wf-wide" disabled={busy}>
              {c.ack}
            </button>
          </form>
        </PilotDialog>
      )}
    </section>
  );
}

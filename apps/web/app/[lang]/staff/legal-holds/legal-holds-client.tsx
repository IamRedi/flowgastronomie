"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { Locale } from "../../../../lib/i18n";

type Hold = {
  id: string;
  target: "ONLINE_ORDER" | "RESERVATION" | "CUSTOMER_PROFILE";
  targetId: string;
  reason: string;
  reviewAt: string;
  expiresAt: string;
  releasedAt: string | null;
};

export function LegalHoldsClient({ locale }: { locale: Locale }) {
  const [holds, setHolds] = useState<Hold[]>([]);
  const [error, setError] = useState("");
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const load = useCallback(async () => {
    const response = await fetch(`${apiUrl}/v1/staff/legal-holds`, {
      credentials: "include",
    });
    if (response.status === 401)
      return window.location.assign(`/${locale}/staff/login`);
    if (!response.ok) return setError("Only the Owner can manage legal holds.");
    setHolds(await response.json());
  }, [apiUrl, locale]);
  useEffect(() => void load(), [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${apiUrl}/v1/staff/legal-holds`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (!response.ok)
      return setError(
        "The hold could not be saved. Check its dates and target.",
      );
    event.currentTarget.reset();
    setError("");
    await load();
  }
  async function release(id: string) {
    const response = await fetch(`${apiUrl}/v1/staff/legal-holds/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) return setError("The hold could not be released.");
    await load();
  }
  return (
    <main className="setup-page">
      <header className="menu-admin-header shell">
        <a className="brand" href={`/${locale}/staff/team`}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
      </header>
      <section className="reports-intro shell">
        <div>
          <p className="eyebrow">Privacy operations</p>
          <h1>Targeted legal holds</h1>
          <p>
            Pause retention only for the record required by a documented legal
            matter. Every hold needs review and expiry dates.
          </p>
        </div>
      </section>
      <section className="shell costs-recipe">
        <form className="costs-recipe-form" onSubmit={submit}>
          <label>
            Target
            <select name="target" defaultValue="ONLINE_ORDER">
              <option value="ONLINE_ORDER">Online order</option>
              <option value="RESERVATION">Reservation</option>
              <option value="CUSTOMER_PROFILE">Customer profile</option>
            </select>
          </label>
          <label>
            Record ID
            <input name="targetId" required />
          </label>
          <label>
            Reason
            <input name="reason" minLength={3} required />
          </label>
          <label>
            Review date
            <input name="reviewAt" type="datetime-local" required />
          </label>
          <label>
            Expiry date
            <input name="expiresAt" type="datetime-local" required />
          </label>
          <button className="button-primary" type="submit">
            Create legal hold
          </button>
        </form>
        {error && <p className="staff-board-feedback">{error}</p>}
      </section>
      <section className="shell staff-activity-section">
        <h2>Current and released holds</h2>
        <div className="report-product-list">
          {holds.map((hold) => (
            <article key={hold.id}>
              <div>
                <strong>{hold.target}</strong>
                <span>
                  {hold.targetId} · review{" "}
                  {new Date(hold.reviewAt).toLocaleString(locale)} · expires{" "}
                  {new Date(hold.expiresAt).toLocaleString(locale)}
                </span>
                <small>{hold.reason}</small>
              </div>
              {hold.releasedAt ? (
                <span>Released</span>
              ) : (
                <button onClick={() => void release(hold.id)} type="button">
                  Release
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

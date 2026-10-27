"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";

export function StaffLoginForm({
  labels,
  locale,
}: {
  labels: Dictionary["staff"];
  locale: Locale;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiUrl}/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantSlug: form.get("tenantSlug"),
          venueSlug: form.get("venueSlug"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      if (!response.ok) throw new Error("LOGIN_FAILED");
      const result = (await response.json()) as {
        staff: { role: "OWNER" | "MANAGER" | "WAITER" | "BAR" | "KITCHEN" };
      };
      const destination =
        result.staff.role === "BAR"
          ? `/${locale}/staff/bar`
          : result.staff.role === "KITCHEN"
            ? `/${locale}/staff/kitchen`
            : ["OWNER", "MANAGER"].includes(result.staff.role)
              ? `/app/${locale}/overview`
              : `/${locale}/staff/radar`;
      window.location.assign(destination);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <form className="staff-login-form" method="post" onSubmit={submit}>
      <label>
        <span>{labels.organization}</span>
        <input autoComplete="organization" name="tenantSlug" required />
      </label>
      <label>
        <span>{labels.venue}</span>
        <input name="venueSlug" required />
      </label>
      <label>
        <span>{labels.email}</span>
        <input autoComplete="username" name="email" required type="email" />
      </label>
      <label>
        <span>{labels.password}</span>
        <input
          autoComplete="current-password"
          minLength={8}
          name="password"
          required
          type="password"
        />
      </label>
      {error && <p role="alert">{labels.loginError}</p>}
      <button disabled={busy || !hydrated} type="submit">
        {busy ? labels.signingIn : labels.signIn}
      </button>
    </form>
  );
}

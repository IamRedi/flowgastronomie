"use client";

import { useState } from "react";

import type { Locale } from "../../../../../lib/i18n";

type Labels = {
  title: string;
  subtitle: string;
  name: string;
  password: string;
  submit: string;
  success: string;
  login: string;
  error: string;
};

export function AcceptInvitationForm({
  labels,
  locale,
  token,
}: {
  labels: Labels;
  locale: Locale;
  token: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "success" | "error">(
    "idle",
  );
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("busy");
    const data = new FormData(event.currentTarget);
    const response = await fetch(
      `${apiUrl}/v1/auth/invitations/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: data.get("displayName"),
          password: data.get("password"),
        }),
      },
    );
    setState(response.ok ? "success" : "error");
  }

  return (
    <main className="staff-login-page">
      <section className="staff-login-card">
        <a className="brand" href={`/${locale}`}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <div>
          <p className="eyebrow">FlowGastronomie Team</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
        {state === "success" ? (
          <div className="invite-success">
            <p>{labels.success}</p>
            <a
              className="button button-primary"
              href={`/${locale}/staff/login`}
            >
              {labels.login}
            </a>
          </div>
        ) : (
          <form className="staff-login-form" onSubmit={submit}>
            <label>
              {labels.name}
              <input
                autoComplete="name"
                name="displayName"
                required
                minLength={2}
              />
            </label>
            <label>
              {labels.password}
              <input
                autoComplete="new-password"
                name="password"
                required
                minLength={8}
                type="password"
              />
            </label>
            {state === "error" && (
              <p className="staff-login-error">{labels.error}</p>
            )}
            <button
              className="button button-primary"
              disabled={state === "busy"}
              type="submit"
            >
              {labels.submit}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

"use client";

import type { LaunchCheck, StaffRole } from "@flowgastronomie/domain";
import { useCallback, useEffect, useState } from "react";

import type { Dictionary } from "../../../lib/dictionaries";
import type { Locale } from "../../../lib/i18n";

type LaunchWorkspace = {
  venue: { name: string; slug: string };
  actorRole: StaffRole;
  checks: Array<{ key: LaunchCheck; required: boolean; complete: boolean }>;
  progress: { completed: number; total: number; percent: number };
  rehearsalConfirmedAt: string | null;
  launchedAt: string | null;
  canLaunch: boolean;
};

const checkRoutes: Record<LaunchCheck, string> = {
  SUBSCRIPTION_ACTIVE: "settings/billing",
  ORGANIZATION_PROFILE: "settings/billing",
  WEBSITE_PUBLISHED: "website",
  MENU_PUBLISHED: "menu",
  TABLE_QR_READY: "tables",
  TEAM_READY: "team",
  SERVICE_REHEARSAL: "launch",
  RETENTION_HEALTH: "launch",
};

export function LaunchWorkspaceClient({
  labels,
  locale,
  mode,
}: {
  labels: Dictionary["launchAdmin"];
  locale: Locale;
  mode: "onboarding" | "launch";
}) {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [workspace, setWorkspace] = useState<LaunchWorkspace | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");
  const [busy, setBusy] = useState<"rehearsal" | "launch" | null>(null);
  const [feedback, setFeedback] = useState<
    "confirmSuccess" | "launchSuccess" | "blocked" | "error" | null
  >(null);

  const load = useCallback(async () => {
    const response = await fetch(`${apiUrl}/v1/workspace/${mode}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401) {
      window.location.assign(`/${locale}/staff/login`);
      return;
    }
    if (response.status === 403) return setState("forbidden");
    if (!response.ok) return setState("error");
    setWorkspace((await response.json()) as LaunchWorkspace);
    setState("ready");
  }, [apiUrl, locale, mode]);

  useEffect(() => void load(), [load]);

  async function perform(action: "rehearsal" | "activate") {
    setBusy(action === "activate" ? "launch" : "rehearsal");
    setFeedback(null);
    const response = await fetch(`${apiUrl}/v1/workspace/launch/${action}`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      setFeedback(response.status === 409 ? "blocked" : "error");
    } else {
      setWorkspace((await response.json()) as LaunchWorkspace);
      setFeedback(action === "activate" ? "launchSuccess" : "confirmSuccess");
    }
    setBusy(null);
  }

  if (state !== "ready" || !workspace) {
    return (
      <main className="workspace-state">
        {state === "forbidden"
          ? labels.permissions
          : state === "error"
            ? labels.error
            : labels.loading}
      </main>
    );
  }

  const routeFor = (check: LaunchCheck) => {
    const route = checkRoutes[check];
    if (route === "menu" || route === "tables" || route === "team") {
      const staffRoute = route === "tables" ? "setup" : route;
      return `/${locale}/staff/${staffRoute}`;
    }
    return `/app/${locale}/${route}`;
  };

  return (
    <main className="launch-page">
      <header className="website-editor-header">
        <nav>
          {mode === "onboarding" && (
            <a
              className="button button-primary button-small"
              href={`/app/${locale}/launch`}
            >
              {labels.openLaunch}
            </a>
          )}
        </nav>
      </header>

      <section className="website-editor-intro">
        <div>
          <p className="eyebrow">
            {mode === "onboarding"
              ? labels.onboardingEyebrow
              : labels.launchEyebrow}
          </p>
          <h1>
            {mode === "onboarding"
              ? labels.onboardingTitle
              : labels.launchTitle}
          </h1>
          <p>
            {mode === "onboarding"
              ? labels.onboardingSubtitle
              : labels.launchSubtitle}
          </p>
        </div>
        {mode === "launch" && (
          <span
            className={`launch-live-status ${workspace.launchedAt ? "live" : "ready"}`}
          >
            {workspace.launchedAt ? labels.launched : labels.notLaunched}
          </span>
        )}
      </section>

      {feedback && (
        <p
          className={`website-feedback ${["blocked", "error"].includes(feedback) ? "error" : "success"}`}
          role="status"
        >
          {labels[feedback]}
        </p>
      )}

      <section className="launch-progress-card">
        <strong>{workspace.progress.percent}%</strong>
        <div>
          <span>
            {workspace.progress.completed}/{workspace.progress.total}{" "}
            {labels.progress}
          </span>
          <i>
            <b style={{ width: `${workspace.progress.percent}%` }} />
          </i>
        </div>
      </section>

      <section className="launch-check-grid">
        {workspace.checks.map((check, index) => {
          const copy = labels.checks[check.key];
          return (
            <article
              className={`${check.complete ? "complete" : "pending"}${check.required ? "" : " optional"}`}
              key={check.key}
            >
              <span>
                {check.complete ? "✓" : String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2>{copy.title}</h2>
                <p>{copy.text}</p>
              </div>
              <strong>
                {check.required
                  ? check.complete
                    ? labels.complete
                    : labels.pending
                  : labels.optional}
              </strong>
              {check.required &&
                !check.complete &&
                check.key !== "SERVICE_REHEARSAL" && (
                  <a href={routeFor(check.key)}>{labels.open} →</a>
                )}
            </article>
          );
        })}
      </section>

      {mode === "launch" && (
        <>
          <section className="launch-rehearsal">
            <div>
              <p className="eyebrow">06</p>
              <h2>{labels.rehearsalTitle}</h2>
              <p>{labels.rehearsalText}</p>
            </div>
            <button
              className="button button-ghost"
              disabled={
                busy !== null || workspace.rehearsalConfirmedAt !== null
              }
              onClick={() => void perform("rehearsal")}
              type="button"
            >
              {workspace.rehearsalConfirmedAt
                ? labels.rehearsalConfirmed
                : labels.confirmRehearsal}
            </button>
          </section>

          <section className="launch-final">
            <div>
              <strong>
                {workspace.canLaunch ? labels.notLaunched : labels.blocked}
              </strong>
              {workspace.actorRole !== "OWNER" && (
                <small>{labels.ownerActivation}</small>
              )}
            </div>
            <button
              className="button button-primary"
              disabled={
                busy !== null ||
                !workspace.canLaunch ||
                workspace.actorRole !== "OWNER" ||
                workspace.launchedAt !== null
              }
              onClick={() => void perform("activate")}
              type="button"
            >
              {workspace.launchedAt
                ? labels.launched
                : busy === "launch"
                  ? labels.activating
                  : labels.activate}
            </button>
          </section>
        </>
      )}
    </main>
  );
}

"use client";

import type { WebsiteDomainStatus } from "@flowgastronomie/domain";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { Dictionary } from "../../../../../lib/dictionaries";
import type { Locale } from "../../../../../lib/i18n";

type DnsRecord = {
  type: "TXT" | "CNAME";
  name: string;
  value: string;
};

type DomainEditor = {
  hostname: string;
  status: WebsiteDomainStatus;
  verificationRecord: DnsRecord;
  routingRecord: DnsRecord;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  activatedAt: string | null;
  failureReason: string | null;
  fallbackUrl: string;
};

type Feedback =
  | "saved"
  | "verifiedSuccess"
  | "activatedSuccess"
  | "removed"
  | "error"
  | "conflict"
  | "invalid"
  | null;

export function DomainSettingsClient({
  labels,
  locale,
}: {
  labels: Dictionary["domainAdmin"];
  locale: Locale;
}) {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [domain, setDomain] = useState<DomainEditor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`${apiUrl}/v1/workspace/website/domain`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401) {
      window.location.assign(`/${locale}/staff/login`);
      return;
    }
    if (response.status === 403) {
      setForbidden(true);
      setLoaded(true);
      return;
    }
    if (!response.ok) {
      setFeedback("error");
      setLoaded(true);
      return;
    }
    const body = (await response.json()) as { domain: DomainEditor | null };
    setDomain(body.domain);
    setLoaded(true);
  }, [apiUrl, locale]);

  useEffect(() => void load(), [load]);

  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`${apiUrl}/v1/workspace/website/domain`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname: form.get("hostname") }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { code?: string };
      setFeedback(
        body.code === "WEBSITE_DOMAIN_CONFLICT"
          ? "conflict"
          : body.code === "INVALID_WEBSITE_DOMAIN"
            ? "invalid"
            : "error",
      );
    } else {
      setDomain(((await response.json()) as { domain: DomainEditor }).domain);
      setFeedback("saved");
    }
    setBusy(false);
  }

  async function action(
    operation: "verify" | "activate",
    success: "verifiedSuccess" | "activatedSuccess",
  ) {
    setBusy(true);
    setFeedback(null);
    const response = await fetch(
      `${apiUrl}/v1/workspace/website/domain/${operation}`,
      { method: "POST", credentials: "include" },
    );
    if (!response.ok) setFeedback("error");
    else {
      setDomain(((await response.json()) as { domain: DomainEditor }).domain);
      setFeedback(success);
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(labels.confirmRemove)) return;
    setBusy(true);
    const response = await fetch(`${apiUrl}/v1/workspace/website/domain`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) setFeedback("error");
    else {
      setDomain(null);
      setFeedback("removed");
    }
    setBusy(false);
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied(null), 1500);
  }

  if (!loaded) return <main className="workspace-state">{labels.loading}</main>;
  if (forbidden)
    return <main className="workspace-state">{labels.ownerOnly}</main>;

  const statusLabel = domain
    ? labels[
        domain.status.toLowerCase() as
          "pending" | "verified" | "active" | "failed"
      ]
    : null;

  return (
    <main className="domain-settings-page">
      <section className="website-editor-intro">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
        {domain && (
          <span className={`domain-status ${domain.status.toLowerCase()}`}>
            {statusLabel}
          </span>
        )}
      </section>

      {feedback && (
        <p
          className={`website-feedback ${["error", "conflict", "invalid"].includes(feedback) ? "error" : "success"}`}
          role="status"
        >
          {labels[feedback]}
        </p>
      )}

      <section className="website-editor-card domain-connect-card">
        <form onSubmit={configure}>
          <label>
            <span>{labels.hostname}</span>
            <input
              defaultValue={domain?.hostname ?? ""}
              key={domain?.hostname}
              name="hostname"
              placeholder="www.restaurantolive.de"
              required
            />
            <small>{labels.hostnameHint}</small>
          </label>
          <button className="button button-primary" disabled={busy}>
            {domain ? labels.save : labels.connect}
          </button>
        </form>
      </section>

      {domain && (
        <>
          <section className="website-editor-card">
            <h2>{labels.recordsTitle}</h2>
            <div className="dns-records">
              {[domain.verificationRecord, domain.routingRecord].map(
                (record) => (
                  <div className="dns-record" key={record.type}>
                    <strong>{record.type}</strong>
                    <div>
                      <small>{labels.recordName}</small>
                      <code>{record.name}</code>
                    </div>
                    <div>
                      <small>{labels.recordValue}</small>
                      <code>{record.value}</code>
                    </div>
                    <button
                      className="button button-ghost button-small"
                      onClick={() => void copy(record.value)}
                      type="button"
                    >
                      {copied === record.value ? labels.copied : labels.copy}
                    </button>
                  </div>
                ),
              )}
            </div>
            <p className="domain-help">
              {domain.status === "VERIFIED"
                ? labels.activationHelp
                : labels.verificationHelp}
            </p>
          </section>

          <section className="domain-actions">
            {domain.status !== "ACTIVE" && (
              <button
                className="button button-ghost"
                disabled={busy}
                onClick={() => void action("verify", "verifiedSuccess")}
                type="button"
              >
                {labels.verify}
              </button>
            )}
            {domain.status === "VERIFIED" && (
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void action("activate", "activatedSuccess")}
                type="button"
              >
                {labels.activate}
              </button>
            )}
            <button
              className="button website-unpublish"
              disabled={busy}
              onClick={() => void remove()}
              type="button"
            >
              {labels.remove}
            </button>
          </section>

          <p className="domain-fallback">
            {labels.fallback}:{" "}
            <a href={`/${locale}/venue${domain.fallbackUrl}`} target="_blank">
              {domain.fallbackUrl}
            </a>
          </p>
        </>
      )}
    </main>
  );
}

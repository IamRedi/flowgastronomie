"use client";

import {
  PLATFORM_LOCALES,
  STAFF_ROLES,
  type StaffRole,
} from "@flowgastronomie/domain";
import { useCallback, useEffect, useState } from "react";

import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";

type Member = {
  id: string;
  displayName: string;
  email: string;
  role: StaffRole;
  active: boolean;
  preferredLocale: "EN" | "DE" | "IT" | "SQ";
  currentShift: null | {
    id: string;
    startedAt: string;
    assignments: Array<{ id: string; tableId: string; tableLabel: string }>;
  };
};
type TeamTable = {
  id: string;
  label: string;
  assignment: null | {
    id: string;
    membershipId: string;
    displayName: string;
  };
};
type Invitation = {
  id: string;
  email: string;
  role: StaffRole;
  preferredLocale: string;
  expiresAt: string;
};
type Shift = {
  id: string;
  displayName: string;
  role: StaffRole;
  status: "OPEN" | "CLOSED";
  startedAt: string;
  endedAt: string | null;
  paymentTotalMinor: number;
};
type TeamData = {
  members: Member[];
  tables: TeamTable[];
  pendingInvitations: Invitation[];
  recentShifts: Shift[];
};

export function StaffTeamClient({
  labels,
  locale,
}: {
  labels: Dictionary["teamAdmin"];
  locale: Locale;
}) {
  const [team, setTeam] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  const goToLogin = useCallback(() => {
    window.location.assign(`/${locale}/staff/login`);
  }, [locale]);

  const load = useCallback(async () => {
    const response = await fetch(`${apiUrl}/v1/staff/team`, {
      cache: "no-store",
      credentials: "include",
    });
    if (response.status === 401) return goToLogin();
    if (response.ok) setTeam((await response.json()) as TeamData);
    else setError(true);
    setLoading(false);
  }, [apiUrl, goToLogin]);

  useEffect(() => void load(), [load]);

  async function write(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ) {
    setBusy(true);
    setError(false);
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      credentials: "include",
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (response.status === 401) return goToLogin();
    if (!response.ok) {
      setError(true);
      setBusy(false);
      return null;
    }
    const result = response.status === 204 ? null : await response.json();
    await load();
    setBusy(false);
    return result as null | { invitationToken?: string };
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await write("/v1/staff/team/invitations", "POST", {
      email: data.get("email"),
      role: data.get("role"),
      preferredLocale: data.get("preferredLocale"),
    });
    if (result?.invitationToken) {
      setInviteLink(
        `${window.location.origin}/${locale}/staff/invite/${encodeURIComponent(result.invitationToken)}`,
      );
      form.reset();
    }
  }

  async function updateMember(
    event: React.FormEvent<HTMLFormElement>,
    member: Member,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await write(
      `/v1/staff/team/members/${encodeURIComponent(member.id)}`,
      "PATCH",
      {
        role: data.get("role"),
        preferredLocale: data.get("preferredLocale"),
      },
    );
  }

  async function assign(
    event: React.FormEvent<HTMLFormElement>,
    table: TeamTable,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await write("/v1/staff/team/assignments", "POST", {
      tableId: table.id,
      membershipId: data.get("membershipId"),
    });
  }

  if (loading)
    return <main className="setup-page setup-message">{labels.loading}</main>;
  if (!team)
    return (
      <main className="setup-page setup-message">{labels.permissions}</main>
    );

  const activeWorkers = team.members.filter(
    (member) => member.active && member.currentShift,
  );

  return (
    <main className="setup-page">
      <header className="menu-admin-header shell">
        <a className="brand" href={`/${locale}/staff/team`}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <nav className="menu-admin-nav" aria-label="Staff workspace">
          <a href={`/${locale}/staff/radar`}>{labels.radar}</a>

          <a href={`/${locale}/staff/setup`}>{labels.setup}</a>
          <a href={`/${locale}/staff/schedule`}>Schedule</a>

          <a href={"/" + locale + "/staff/payments"}>{labels.payments}</a>
        </nav>
      </header>

      <section className="menu-admin-intro shell">
        <div>
          <p className="eyebrow">FlowGastronomie OS</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
      </section>

      <div className="team-content shell">
        {error && (
          <p className="menu-admin-feedback error" role="alert">
            {labels.error}
          </p>
        )}
        {inviteLink && (
          <aside className="qr-result">
            <strong>{labels.inviteReady}</strong>
            <code>{inviteLink}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteLink);
                setCopied(true);
              }}
            >
              {copied ? labels.copied : labels.copy}
            </button>
          </aside>
        )}

        <section className="team-panel">
          <div className="setup-section-heading">
            <h2>{labels.invite}</h2>
          </div>
          <form className="team-invite-form" onSubmit={invite}>
            <label>
              {labels.email}
              <input name="email" required type="email" />
            </label>
            <label>
              {labels.role}
              <select defaultValue="WAITER" name="role">
                {STAFF_ROLES.filter((role) => role !== "OWNER").map((role) => (
                  <option key={role} value={role}>
                    {labels.roles[role]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {labels.language}
              <select defaultValue={locale} name="preferredLocale">
                {PLATFORM_LOCALES.map((language) => (
                  <option key={language} value={language}>
                    {labels.languages[language]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-primary"
              disabled={busy}
              type="submit"
            >
              {labels.sendInvite}
            </button>
          </form>
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            <h2>{labels.members}</h2>
          </div>
          <div className="team-member-grid">
            {team.members.map((member) => (
              <article
                className={`team-member-card${member.active ? "" : " disabled"}`}
                key={member.id}
              >
                <div className="team-avatar">
                  {member.displayName
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </div>
                <div className="team-member-identity">
                  <h3>{member.displayName}</h3>
                  <p>{member.email}</p>
                  <span
                    className={
                      member.currentShift ? "status-live" : "status-off"
                    }
                  >
                    {member.currentShift ? labels.onShift : labels.offShift}
                  </span>
                </div>
                <form
                  className="team-member-controls"
                  onSubmit={(event) => updateMember(event, member)}
                >
                  <select defaultValue={member.role} name="role">
                    {STAFF_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {labels.roles[role]}
                      </option>
                    ))}
                  </select>
                  <select
                    defaultValue={member.preferredLocale.toLowerCase()}
                    name="preferredLocale"
                  >
                    {PLATFORM_LOCALES.map((language) => (
                      <option key={language} value={language}>
                        {labels.languages[language]}
                      </option>
                    ))}
                  </select>
                  <button disabled={busy} type="submit">
                    {labels.save}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void write(
                        `/v1/staff/team/members/${encodeURIComponent(member.id)}`,
                        "PATCH",
                        { active: !member.active },
                      )
                    }
                    type="button"
                  >
                    {member.active ? labels.disable : labels.enable}
                  </button>
                </form>
              </article>
            ))}
          </div>
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            <h2>{labels.assignments}</h2>
          </div>
          <div className="team-table-grid">
            {team.tables.map((table) => (
              <article className="team-table-card" key={table.id}>
                <strong>{table.label}</strong>
                <span>
                  {table.assignment?.displayName ?? labels.unassigned}
                </span>
                {table.assignment ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void write(
                        `/v1/staff/team/assignments/${encodeURIComponent(table.assignment!.id)}`,
                        "DELETE",
                      )
                    }
                    type="button"
                  >
                    {labels.unassign}
                  </button>
                ) : (
                  <form onSubmit={(event) => assign(event, table)}>
                    <select name="membershipId" required defaultValue="">
                      <option disabled value="">
                        {labels.selectWorker}
                      </option>
                      {activeWorkers.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.displayName}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={busy || !activeWorkers.length}
                      type="submit"
                    >
                      {labels.assign}
                    </button>
                  </form>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="team-lower-grid">
          <div className="team-panel">
            <h2>{labels.pending}</h2>
            {team.pendingInvitations.map((invitation) => (
              <div className="team-list-row" key={invitation.id}>
                <div>
                  <strong>{invitation.email}</strong>
                  <span>{labels.roles[invitation.role]}</span>
                </div>
                <small>
                  {labels.expires}:{" "}
                  {new Intl.DateTimeFormat(locale).format(
                    new Date(invitation.expiresAt),
                  )}
                </small>
              </div>
            ))}
          </div>
          <div className="team-panel">
            <h2>{labels.reports}</h2>
            {team.recentShifts.map((shift) => (
              <div className="team-list-row" key={shift.id}>
                <div>
                  <strong>{shift.displayName}</strong>
                  <span>
                    {labels.roles[shift.role]} ·{" "}
                    {shift.status === "OPEN" ? labels.onShift : labels.offShift}
                  </span>
                </div>
                <small>
                  {labels.payments}:{" "}
                  {new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: "EUR",
                  }).format(shift.paymentTotalMinor / 100)}
                </small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

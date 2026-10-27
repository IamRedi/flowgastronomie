"use client";
import { useEffect, useState, type FormEvent } from "react";
import { workforceInstant } from "@flowgastronomie/domain";
import type { Locale } from "../../lib/i18n";
import type { WorkforceCopy } from "./copy";
import type { Workspace } from "./types";
type Operations = {
  tasks: { id: string; title: string; completedAt: string | null }[];
  handovers: { id: string; body: string }[];
};
export function WorkforceOperations({
  locale,
  c,
  workspace,
  week,
  request,
  onChanged,
  busy,
}: {
  locale: Locale;
  c: WorkforceCopy;
  workspace: Workspace;
  week: string;
  request: (
    path: string,
    method?: string,
    body?: unknown,
  ) => Promise<unknown | null>;
  onChanged: () => Promise<void>;
  busy: boolean;
}) {
  const [ops, setOps] = useState<Operations>({ tasks: [], handovers: [] }),
    [expanded, setExpanded] = useState(false),
    [localError, setLocalError] = useState("");
  useEffect(() => {
    let active = true;
    if (expanded)
      void request(
        "/v1/staff/schedule?weekStartsOn=" + week + "T00:00:00Z",
      ).then((r) => {
        if (r && active) setOps(r as Operations);
      });
    return () => {
      active = false;
    };
  }, [expanded, week, request]);
  async function load() {
    const r = await request(
      "/v1/staff/schedule?weekStartsOn=" + week + "T00:00:00Z",
    );
    if (r) setOps(r as Operations);
  }
  async function availability(e: FormEvent) {
    e.preventDefault();
    setLocalError("");
    const f = new FormData(e.currentTarget as HTMLFormElement);
    try {
      if (
        await request("/v1/staff/schedule/availability", "POST", {
          membershipId: workspace.viewer.membershipId,
          startsAt: workforceInstant(
            String(f.get("start")),
            workspace.venue.timezone,
          ),
          endsAt: workforceInstant(
            String(f.get("end")),
            workspace.venue.timezone,
          ),
          note: String(f.get("note")),
        })
      )
        await onChanged();
    } catch {
      setLocalError(c.error + " · " + c.startChoice);
    }
  }
  async function handover(e: FormEvent) {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    if (
      await request("/v1/staff/handover-notes", "POST", {
        shiftId: null,
        body: String(f.get("note")),
      })
    )
      await load();
  }
  async function task(e: FormEvent) {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    if (
      await request("/v1/staff/tasks", "POST", {
        scope: "VENUE",
        scopeId: null,
        title: String(f.get("title")),
        dueAt: null,
        priority: "NORMAL",
        assigneeMembershipId: String(f.get("member")) || null,
      })
    )
      await load();
  }
  return (
    <details
      className="wf-operations"
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>{c.operations}</summary>
      {expanded && (
        <div className="wf-operations-grid">
          <section>
            <h2>{c.availabilityNote}</h2>
            <form onSubmit={availability} className="wf-form">
              <label>
                {c.start}
                <input
                  required
                  name="start"
                  type="datetime-local"
                  step="900"
                  defaultValue={workspace.today + "T09:00"}
                />
              </label>
              <label>
                {c.end}
                <input
                  required
                  name="end"
                  type="datetime-local"
                  step="900"
                  defaultValue={workspace.today + "T17:00"}
                />
              </label>
              <label className="wf-wide">
                {c.note}
                <textarea required name="note" maxLength={500} />
                <small>{c.noPrivate}</small>
              </label>
              <button disabled={busy}>{c.submit}</button>
              {localError && (
                <p className="wf-wide" role="alert">
                  {localError}
                </p>
              )}
            </form>
            {workspace.availability.map((n) => (
              <article className="wf-contract" key={n.id}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "short",
                  timeZone: workspace.venue.timezone,
                }).format(new Date(n.startsAt))}
                <p>{n.note}</p>
              </article>
            ))}
          </section>
          <section>
            <h2>{c.tasks}</h2>
            {ops.tasks.map((t) => (
              <article className="wf-contract" key={t.id}>
                <span>{t.title}</span>
                {!t.completedAt && (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await request(
                          "/v1/staff/tasks/" + t.id + "/complete",
                          "POST",
                          {},
                        )
                      )
                        await load();
                    }}
                  >
                    {c.complete}
                  </button>
                )}
              </article>
            ))}
            {workspace.viewer.canManage && (
              <form onSubmit={task} className="wf-form">
                <label>
                  {c.tasks}
                  <input required name="title" maxLength={240} />
                </label>
                <label>
                  {c.staff}
                  <select name="member">
                    <option value="">{c.all}</option>
                    {workspace.profiles.map((p) => (
                      <option key={p.membershipId} value={p.membershipId}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy}>{c.add}</button>
              </form>
            )}
            <h2>{c.handover}</h2>
            {ops.handovers.map((h) => (
              <p key={h.id}>{h.body}</p>
            ))}
            <form onSubmit={handover} className="wf-form">
              <label className="wf-wide">
                {c.note}
                <textarea required name="note" maxLength={500} />
              </label>
              <button disabled={busy}>{c.save}</button>
            </form>
          </section>
        </div>
      )}
    </details>
  );
}

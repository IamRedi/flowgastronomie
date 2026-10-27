"use client";
import { roleLabel } from "./copy";
import { useState, type FormEvent } from "react";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import type { WorkforceCopy } from "./copy";
import type { Profile } from "./types";
const time = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function ProfileEditor({
  initial,
  c,
  canManage,
  today,
  country,
  api,
  busy,
  error,
  request,
  onClose,
  onChanged,
}: {
  initial: Profile;
  c: WorkforceCopy;
  canManage: boolean;
  today: string;
  country: string | null;
  api: string;
  busy: boolean;
  error: string;
  request: (
    path: string,
    method: string,
    body: unknown,
  ) => Promise<unknown | null>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [p, set] = useState(initial),
    [availability, setAvailability] = useState(
      p.recurringAvailability
        .map((a) => `${a.day},${time(a.startMinute)},${time(a.endMinute)}`)
        .join("\n"),
    );
  const prefix = `/v1/staff/workforce/profiles/${p.membershipId}`;
  const refreshed = async () => {
    const next = await request(prefix, "GET", null);
    if (next) {
      const profile = next as Profile;
      set(profile);
      setAvailability(
        profile.recurringAvailability
          .map((a) => `${a.day},${time(a.startMinute)},${time(a.endMinute)}`)
          .join("\n"),
      );
    }
    await onChanged();
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const minutes = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return h! * 60 + m!;
    };
    const recurringAvailability = availability
      .split("\n")
      .filter((s) => s.trim())
      .map((line) => {
        const [day, start, end] = line.split(",");
        return {
          day: Number(day),
          startMinute: minutes(start ?? ""),
          endMinute: minutes(end ?? ""),
        };
      });
    const body = {
      expectedVersion: p.version,
      displayName: String(form.get("displayName")),
      workPhone: String(form.get("workPhone") || "") || null,
      recurringAvailability,
      ...(canManage
        ? {
            employeeRef: String(form.get("employeeRef") || "") || null,
            jobTitle: String(form.get("jobTitle") || ""),
            employmentStartedOn:
              String(form.get("employmentStartedOn") || "") || null,
            employmentEndedOn:
              String(form.get("employmentEndedOn") || "") || null,
            employmentStatus: String(form.get("employmentStatus")),
            stations: String(form.get("stations") || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            skills: String(form.get("skills") || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {}),
      ...(p.canManageHR
        ? { annualLeaveDays: Number(form.get("annualLeaveDays")) }
        : {}),
    };
    if (await request(prefix, "PUT", body)) await refreshed();
  }
  async function contract(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const body = {
      expectedVersion: p.version,
      effectiveFrom: String(form.get("effectiveFrom")),
      employmentType: String(form.get("employmentType")),
      weeklyTargetMinutes: Math.round(Number(form.get("weekly")) * 60),
      monthlyTargetMinutes: form.get("monthly")
        ? Math.round(Number(form.get("monthly")) * 60)
        : null,
      countryCode: String(form.get("countryCode")).toUpperCase(),
      terms: String(form.get("terms") || ""),
    };
    if (await request(`${prefix}/contracts`, "POST", body)) await refreshed();
  }
  async function upload(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const file = form.get("file") as File;
    if (!file?.size || file.size > 4 * 1024 * 1024) {
      const input = (
        e.currentTarget as HTMLFormElement
      ).querySelector<HTMLInputElement>('input[type="file"]');
      input?.setCustomValidity(c.file);
      input?.reportValidity();
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    if (
      await request(`${prefix}/documents`, "POST", {
        expectedVersion: p.version,
        title: String(form.get("title")),
        kind: String(form.get("kind")),
        expiresOn: String(form.get("expiresOn") || "") || null,
        filename: file.name,
        base64,
      })
    )
      await refreshed();
  }
  return (
    <PilotDialog
      title={`${c.profile} · ${p.displayName}`}
      closeLabel={c.close}
      onClose={onClose}
      className="wf-dialog wf-profile-dialog"
    >
      {error && (
        <div className="wf-alert" role="alert">
          {error}
          <button type="button" onClick={() => void refreshed()}>
            {c.reload}
          </button>
        </div>
      )}
      <p className="wf-muted">
        {p.workEmail} · {roleLabel(c, p.role)} · {c.version} {p.version}
      </p>
      <form className="wf-form" onSubmit={save} key={`${p.version}-profile`}>
        <label>
          {c.name}
          <input
            name="displayName"
            defaultValue={p.displayName}
            required
            maxLength={120}
          />
        </label>
        <label>
          {c.phone}
          <input
            name="workPhone"
            defaultValue={p.workPhone ?? ""}
            maxLength={40}
          />
        </label>
        {canManage ? (
          <>
            <label>
              {c.reference}
              <input name="employeeRef" defaultValue={p.employeeRef ?? ""} />
            </label>
            <label>
              {c.job}
              <input name="jobTitle" defaultValue={p.jobTitle} />
            </label>
            <label>
              {c.employmentStart}
              <input
                name="employmentStartedOn"
                type="date"
                defaultValue={p.employmentStartedOn ?? ""}
              />
            </label>
            <label>
              {c.employmentEnd}
              <input
                name="employmentEndedOn"
                type="date"
                defaultValue={p.employmentEndedOn ?? ""}
              />
            </label>
            <label>
              {c.employmentStatus}
              <select name="employmentStatus" defaultValue={p.employmentStatus}>
                <option value="ACTIVE">{c.active}</option>
                <option value="ONBOARDING">{c.onboarding}</option>
                <option value="ENDED">{c.ended}</option>
              </select>
            </label>
            <label>
              {c.stations}
              <input name="stations" defaultValue={p.stations.join(", ")} />
            </label>
            <label>
              {c.skills}
              <input name="skills" defaultValue={p.skills.join(", ")} />
            </label>
          </>
        ) : (
          <dl className="wf-wide wf-profile-summary">
            <dt>{c.job}</dt>
            <dd>{p.jobTitle || "—"}</dd>
            <dt>{c.employmentStart}</dt>
            <dd>{p.employmentStartedOn ?? "—"}</dd>
            <dt>{c.stations}</dt>
            <dd>{p.stations.join(", ") || "—"}</dd>
            <dt>{c.skills}</dt>
            <dd>{p.skills.join(", ") || "—"}</dd>
            <dt>{c.leave}</dt>
            <dd>{p.annualLeaveDays ?? "—"}</dd>
          </dl>
        )}
        {p.canManageHR && (
          <label>
            {c.leave}
            <input
              type="number"
              name="annualLeaveDays"
              defaultValue={p.annualLeaveDays ?? 0}
              min="0"
              max="366"
            />
          </label>
        )}
        <label className="wf-wide">
          {c.availability}
          <textarea
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            aria-describedby="wf-availability-hint"
          />
          <small id="wf-availability-hint">{c.availabilityHint}</small>
        </label>
        <div className="wf-wide wf-form-actions">
          <button disabled={busy}>{c.save}</button>
        </div>
      </form>
      {p.history && (
        <details className="wf-profile-section">
          <summary>{c.history}</summary>
          {p.history.map((r) => (
            <article className="wf-contract" key={r.id}>
              <strong>
                {c.version} {r.version}
              </strong>
              {Object.entries({
                displayName: c.name,
                workPhone: c.phone,
                employeeRef: c.reference,
                jobTitle: c.job,
                employmentStartedOn: c.employmentStart,
                employmentEndedOn: c.employmentEnd,
                employmentStatus: c.employmentStatus,
                stations: c.stations,
                skills: c.skills,
                annualLeaveDays: c.leave,
              })
                .filter(
                  ([key]) =>
                    JSON.stringify(r.before[key]) !==
                    JSON.stringify(r.after[key]),
                )
                .map(([key, label]) => (
                  <p key={key}>
                    {label}: {String(r.before[key] ?? "—")} →{" "}
                    {String(r.after[key] ?? "—")}
                  </p>
                ))}
            </article>
          ))}
        </details>
      )}
      {p.contracts && (
        <section className="wf-profile-section">
          <h3>{c.contracts}</h3>
          {p.contracts.length ? (
            p.contracts.map((a) => (
              <article className="wf-contract" key={a.id}>
                <strong>
                  {c.version} {a.version} · {a.effectiveFrom}
                </strong>
                <p>
                  {(
                    {
                      FULL_TIME: c.full,
                      PART_TIME: c.part,
                      MINIJOB: c.mini,
                      TEMPORARY: c.temporary,
                      OTHER: c.other,
                    } as Record<string, string>
                  )[a.employmentType] ?? c.other}{" "}
                  · {a.weeklyTargetMinutes / 60} {c.hours} / {c.week} ·{" "}
                  {a.countryCode}
                </p>
                {a.monthlyTargetMinutes !== null && (
                  <p>
                    {a.monthlyTargetMinutes / 60} {c.hours} / {c.month}
                  </p>
                )}
                <p>{a.terms}</p>
              </article>
            ))
          ) : (
            <p>{c.empty}</p>
          )}
        </section>
      )}
      {p.canManageHR && (
        <details className="wf-profile-section">
          <summary>{c.contract}</summary>
          <form className="wf-form" onSubmit={contract}>
            <label>
              {c.effective}
              <input
                type="date"
                name="effectiveFrom"
                defaultValue={today}
                required
              />
            </label>
            <label>
              {c.type}
              <select name="employmentType">
                <option value="FULL_TIME">{c.full}</option>
                <option value="PART_TIME">{c.part}</option>
                <option value="MINIJOB">{c.mini}</option>
                <option value="TEMPORARY">{c.temporary}</option>
                <option value="OTHER">{c.other}</option>
              </select>
            </label>
            <label>
              {c.weekly}
              <input
                required
                type="number"
                min="0"
                max="168"
                step="0.25"
                name="weekly"
                defaultValue="40"
              />
            </label>
            <label>
              {c.monthly}
              <input
                type="number"
                min="0"
                max="744"
                step="0.25"
                name="monthly"
              />
            </label>
            <label>
              {c.country}
              <input
                name="countryCode"
                required
                minLength={2}
                maxLength={2}
                defaultValue={country ?? ""}
              />
            </label>
            <label className="wf-wide">
              {c.terms}
              <textarea name="terms" maxLength={4000} />
            </label>
            <button className="wf-wide" disabled={busy}>
              {c.save}
            </button>
          </form>
        </details>
      )}
      {p.documents && (
        <section className="wf-profile-section">
          <h3>{c.documents}</h3>
          {p.documents.map((d) => (
            <article className="wf-contract" key={d.id}>
              <strong>{d.title}</strong>
              <span>
                {d.kind === "CERTIFICATION" ? c.certificate : c.workDocument} ·{" "}
                {d.expiresOn ?? "—"}
              </span>
              <a
                href={`${api}/v1/staff/workforce/documents/${encodeURIComponent(d.id)}`}
              >
                {c.download}
              </a>
            </article>
          ))}
          <form className="wf-form" onSubmit={upload}>
            <label>
              {c.documentTitle}
              <input required name="title" maxLength={120} />
            </label>
            <label>
              {c.documentKind}
              <select name="kind">
                <option value="CERTIFICATION">{c.certificate}</option>
                <option value="WORK_DOCUMENT">{c.workDocument}</option>
              </select>
            </label>
            <label>
              {c.expiry}
              <input name="expiresOn" type="date" />
            </label>
            <label className="wf-wide">
              {c.file}
              <input
                required
                name="file"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => e.target.setCustomValidity("")}
              />
            </label>
            <button disabled={busy} className="wf-wide">
              {c.upload}
            </button>
          </form>
        </section>
      )}
    </PilotDialog>
  );
}

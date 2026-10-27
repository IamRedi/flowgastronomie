"use client";
import { useState, type FormEvent } from "react";
import type { WorkforceAssignment } from "@flowgastronomie/domain";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import type { WorkforceCopy } from "./copy";
import { stationLabel } from "./copy";
import type { Profile } from "./types";
export function ShiftEditor({
  row,
  profiles,
  stations,
  c,
  busy,
  error,
  onSave,
  onDelete,
  onDuplicate,
  onReload,
  onClose,
}: {
  row: WorkforceAssignment;
  profiles: Profile[];
  stations: string[];
  c: WorkforceCopy;
  busy: boolean;
  error: string;
  onSave: (row: WorkforceAssignment) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onDuplicate: () => void;
  onReload: () => Promise<void>;
  onClose: () => void;
}) {
  const [value, set] = useState(row);
  const change = (key: keyof WorkforceAssignment, value: unknown) =>
    set((a) => ({ ...a, [key]: value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onSave(value)) onClose();
  };
  return (
    <PilotDialog
      title={c.edit}
      closeLabel={c.close}
      onClose={onClose}
      className="wf-dialog"
    >
      {error && (
        <p role="alert" className="wf-alert">
          {error}
          <button
            type="button"
            onClick={async () => {
              await onReload();
              onClose();
            }}
          >
            {c.reload}
          </button>
        </p>
      )}
      <form onSubmit={submit} className="wf-form">
        <label>
          {c.staff}
          <select
            aria-label={c.staff}
            value={value.membershipId ?? ""}
            onChange={(e) => change("membershipId", e.target.value || null)}
          >
            <option value="">{c.open}</option>
            {profiles
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.membershipId} value={p.membershipId}>
                  {p.displayName}
                </option>
              ))}
          </select>
        </label>
        <label>
          {c.station}
          <select
            aria-label={c.station}
            value={value.station}
            onChange={(e) => change("station", e.target.value)}
          >
            {stations.map((s) => (
              <option key={s} value={s}>
                {stationLabel(c, s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {c.start}
          <input
            required
            step="900"
            type="datetime-local"
            value={value.startsLocal}
            onChange={(e) => change("startsLocal", e.target.value)}
          />
        </label>
        <label>
          {c.end}
          <input
            required
            step="900"
            type="datetime-local"
            value={value.endsLocal}
            onChange={(e) => change("endsLocal", e.target.value)}
          />
        </label>
        {(["startChoice", "endChoice"] as const).map((k) => (
          <label key={k}>
            {k === "startChoice" ? c.startChoice : c.endChoice}
            <select
              value={value[k]}
              onChange={(e) => change(k, e.target.value)}
            >
              <option value="reject">{c.reject}</option>
              <option value="earlier">{c.earlier}</option>
              <option value="later">{c.later}</option>
            </select>
          </label>
        ))}
        <label>
          {c.breakMinutes}
          <input
            type="number"
            min="0"
            max="480"
            value={value.breakMinutes}
            onChange={(e) => change("breakMinutes", Number(e.target.value))}
          />
        </label>
        <label>
          {c.skills}
          <input
            value={value.requiredSkills.join(", ")}
            onChange={(e) =>
              change(
                "requiredSkills",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <label className="wf-wide">
          {c.note}
          <textarea
            aria-label={c.note}
            maxLength={500}
            value={value.note}
            onChange={(e) => change("note", e.target.value)}
          />
          <small>{c.noPrivate}</small>
        </label>
        <div className="wf-form-actions wf-wide">
          <button disabled={busy} type="submit">
            {c.save}
          </button>
          <button
            disabled={busy}
            type="button"
            className="wf-secondary"
            onClick={onDuplicate}
          >
            {c.duplicate}
          </button>
          <button
            disabled={busy}
            type="button"
            className="wf-danger"
            onClick={async () => {
              if (await onDelete()) onClose();
            }}
          >
            {c.remove}
          </button>
        </div>
      </form>
    </PilotDialog>
  );
}

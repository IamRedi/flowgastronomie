"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  workforceLocal,
  workforceAttendanceTotals,
  workforceAttendanceWarnings,
} from "@flowgastronomie/domain";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import { operationsWarning, type OperationsCopy } from "./operations-copy";
import type {
  AttendanceRow,
  OperationsData,
  OperationsCommand,
  RequestRow,
} from "./operation-types";
export function OffsetField({
  name,
  c,
  value = "reject",
}: {
  name: string;
  c: OperationsCopy;
  value?: string;
}) {
  return (
    <label>
      {c.offset}
      <select name={name} aria-label={c.offset} defaultValue={value}>
        <option value="reject">{c.rejectOffset}</option>
        <option value="earlier">{c.earlier}</option>
        <option value="later">{c.later}</option>
      </select>
    </label>
  );
}
export function CorrectionDialog({
  row,
  data,
  c,
  busy,
  error,
  command,
  onClose,
}: {
  row: AttendanceRow | null;
  data: OperationsData;
  c: OperationsCopy;
  busy: boolean;
  error: string;
  command: OperationsCommand;
  onClose: () => void;
}) {
  const requestKey = useRef(crypto.randomUUID()),
    zone = row?.timezone ?? data.venue.timezone,
    snapshot = row?.actual;
  const [breaks, setBreaks] = useState(
    () =>
      snapshot?.breaks.map((b) => ({
        id: crypto.randomUUID(),
        start: workforceLocal(b.startsAt, zone),
        end: workforceLocal(b.endsAt, zone),
        kind: b.kind,
      })) ?? [],
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      idempotencyKey: requestKey.current,
      attendanceId: row?.id ?? null,
      expectedAttendanceVersion: row?.version ?? 0,
      reason: String(f.get("reason")),
      startsLocal: String(f.get("start")),
      endsLocal: String(f.get("end")),
      startChoice: String(f.get("startChoice")),
      endChoice: String(f.get("endChoice")),
      breaks: breaks.map((b) => ({
        startsLocal: String(f.get(b.id + "start")),
        endsLocal: String(f.get(b.id + "end")),
        startChoice: String(f.get(b.id + "startChoice")),
        endChoice: String(f.get(b.id + "endChoice")),
        kind: String(f.get(b.id + "kind")),
      })),
    };
    if (
      await command(
        row && row.userId !== data.viewer.userId
          ? "attendance/" + row.id + "/recovery-request"
          : "corrections",
        body,
      )
    )
      onClose();
  }
  return (
    <PilotDialog
      title={c.requestCorrection}
      closeLabel={c.close}
      onClose={onClose}
      className="wf-dialog"
    >
      <form className="wf-form" onSubmit={submit}>
        <label className="wf-wide">
          {c.reason}
          <select
            name="reason"
            defaultValue={
              !row
                ? "MISSING_IN"
                : row.state !== "CLOSED"
                  ? "MISSING_OUT"
                  : "INTERVAL"
            }
          >
            <option value="MISSING_IN">{c.missingIn}</option>
            <option value="MISSING_OUT">{c.missingOut}</option>
            <option value="BREAK">{c.wrongBreak}</option>
            <option value="INTERVAL">{c.wrongInterval}</option>
            <option value="UNSCHEDULED">{c.unscheduled}</option>
          </select>
        </label>
        <label>
          {c.start}
          <input
            name="start"
            type="datetime-local"
            step="60"
            required
            defaultValue={
              snapshot
                ? workforceLocal(snapshot.startsAt, zone)
                : data.today + "T09:00"
            }
          />
        </label>
        <OffsetField name="startChoice" c={c} />
        <label>
          {c.end}
          <input
            name="end"
            type="datetime-local"
            step="60"
            required
            defaultValue={
              snapshot
                ? workforceLocal(snapshot.endsAt, zone)
                : data.today + "T17:00"
            }
          />
        </label>
        <OffsetField name="endChoice" c={c} />
        {breaks.map((b, index) => (
          <fieldset key={b.id} className="wf-wide wf2-break-fields">
            <legend>
              {c.breaks} {index + 1}
            </legend>
            <label>
              {c.start}
              <input
                name={b.id + "start"}
                type="datetime-local"
                step="60"
                required
                defaultValue={b.start}
              />
            </label>
            <OffsetField name={b.id + "startChoice"} c={c} />
            <label>
              {c.end}
              <input
                name={b.id + "end"}
                type="datetime-local"
                step="60"
                required
                defaultValue={b.end}
              />
            </label>
            <OffsetField name={b.id + "endChoice"} c={c} />
            <label>
              {c.category}
              <select
                name={b.id + "kind"}
                aria-label={c.category}
                defaultValue={b.kind}
              >
                <option value="UNPAID">{c.unpaid}</option>
                {data.rules.paidBreaksAllowed && (
                  <option value="PAID">{c.paid}</option>
                )}
              </select>
            </label>
            <button
              type="button"
              className="wf-secondary"
              disabled={busy}
              onClick={() => setBreaks((v) => v.filter((x) => x.id !== b.id))}
            >
              {c.remove}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="wf-secondary wf-wide"
          disabled={busy || breaks.length >= 30}
          onClick={() =>
            setBreaks((v) => [
              ...v,
              {
                id: crypto.randomUUID(),
                start: data.today + "T12:00",
                end: data.today + "T12:30",
                kind: "UNPAID",
              },
            ])
          }
        >
          {c.addBreak}
        </button>
        {error && (
          <p className="wf-wide" role="alert">
            {error}
          </p>
        )}
        <button className="wf-wide" disabled={busy}>
          {c.submit}
        </button>
      </form>
    </PilotDialog>
  );
}
export function LeaveForm({
  data,
  c,
  busy,
  command,
}: {
  data: OperationsData;
  c: OperationsCopy;
  busy: boolean;
  command: OperationsCommand;
}) {
  const key = useRef(crypto.randomUUID()),
    [partial, setPartial] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form),
      body = {
        idempotencyKey: key.current,
        category: String(f.get("category")),
        from: String(f.get("from")),
        to: String(f.get("to")),
        partial: partial
          ? {
              startsLocal: String(f.get("start")),
              endsLocal: String(f.get("end")),
              startChoice: String(f.get("startChoice")),
              endChoice: String(f.get("endChoice")),
            }
          : null,
      };
    if (await command("leave", body)) {
      key.current = crypto.randomUUID();
      form.reset();
      setPartial(false);
    }
  }
  const categories: Record<string, string> = {
    ANNUAL: c.annual,
    UNPAID: c.unpaidLeave,
    PERSONAL: c.personal,
    SICKNESS: c.sickness,
    OTHER: c.other,
  };
  return (
    <form className="wf-form wf2-inline" onSubmit={submit}>
      <h3 className="wf-wide">{c.requestLeave}</h3>
      <label>
        {c.category}
        <select name="category" aria-label={c.category}>
          {data.rules.absenceCategories.map((x) => (
            <option key={x} value={x}>
              {categories[x] ?? x}
            </option>
          ))}
        </select>
      </label>
      <label>
        {c.from}
        <input name="from" type="date" required defaultValue={data.today} />
      </label>
      <label>
        {c.to}
        <input name="to" type="date" required defaultValue={data.today} />
      </label>
      <label className="wf2-check">
        <input
          type="checkbox"
          checked={partial}
          onChange={(e) => setPartial(e.target.checked)}
        />
        {c.partial}
      </label>
      {partial && (
        <>
          <label>
            {c.start}
            <input
              name="start"
              type="datetime-local"
              step="60"
              required
              defaultValue={data.today + "T09:00"}
            />
          </label>
          <OffsetField name="startChoice" c={c} />
          <label>
            {c.end}
            <input
              name="end"
              type="datetime-local"
              step="60"
              required
              defaultValue={data.today + "T11:00"}
            />
          </label>
          <OffsetField name="endChoice" c={c} />
        </>
      )}
      <button className="wf-wide" disabled={busy}>
        {c.submit}
      </button>
    </form>
  );
}
export function ShiftRequestForm({
  data,
  prefix,
  c,
  busy,
  command,
}: {
  data: OperationsData;
  prefix: string;
  c: OperationsCopy;
  busy: boolean;
  command: OperationsCommand;
}) {
  const key = useRef(crypto.randomUUID()),
    [kind, setKind] = useState("OPEN"),
    [target, setTarget] = useState(""),
    [assignment, setAssignment] = useState(""),
    [options, setOptions] = useState<{
      roster: { membershipId: string; displayName: string }[];
      shifts: OperationsData["shifts"];
    }>({ roster: [], shifts: [] }),
    [optionsError, setOptionsError] = useState("");
  useEffect(() => {
    setOptions({ roster: [], shifts: [] });
    setOptionsError("");
    if (kind === "OPEN" || !assignment) return;
    const controller = new AbortController();
    fetch(
      prefix +
        "exchange-options?" +
        new URLSearchParams({
          assignmentId: assignment,
          ...(target ? { targetMembershipId: target } : {}),
        }),
      { credentials: "include", signal: controller.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(c.unavailable);
        const value = await r.json();
        if (!controller.signal.aborted) setOptions(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setOptionsError(c.unavailable);
      });
    return () => controller.abort();
  }, [assignment, target, kind, prefix, c.unavailable]);
  const choices = data.shifts.filter(
      (s) =>
        s.startsAt > data.serverNow &&
        (kind === "OPEN" ? s.userId === null : s.userId === data.viewer.userId),
    ),
    coworkers = options.roster;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      a = data.shifts.find((x) => x.assignmentId === String(f.get("shift"))),
      b = options.shifts.find(
        (x) => x.assignmentId === String(f.get("otherShift")),
      );
    if (!a) return;
    const body = {
      idempotencyKey: key.current,
      kind,
      assignmentId: a.assignmentId,
      publicationRevisionId: a.publicationRevisionId,
      targetMembershipId: kind === "OPEN" ? null : target,
      otherAssignmentId: kind === "SWAP" ? (b?.assignmentId ?? null) : null,
      otherPublicationRevisionId:
        kind === "SWAP" ? (b?.publicationRevisionId ?? null) : null,
    };
    if (await command("shift-requests", body))
      key.current = crypto.randomUUID();
  }
  return (
    <form className="wf-form wf2-inline" onSubmit={submit}>
      <h3 className="wf-wide">{c.shiftRequest}</h3>
      <label>
        {c.category}
        <select
          aria-label={c.category}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setAssignment("");
            setTarget("");
          }}
        >
          <option value="OPEN">{c.open}</option>
          <option value="OFFER">{c.offer}</option>
          <option value="SWAP">{c.swap}</option>
        </select>
      </label>
      <label>
        {c.shift}
        <select
          name="shift"
          aria-label={c.shift}
          required
          value={assignment}
          onChange={(e) => {
            setAssignment(e.target.value);
            setTarget("");
          }}
        >
          <option value="">—</option>
          {choices.map((s) => (
            <option key={s.assignmentId} value={s.assignmentId}>
              {s.startsLocal.replace("T", " · ")} · {s.station}
            </option>
          ))}
        </select>
      </label>
      {kind !== "OPEN" && (
        <label>
          {c.coworker}
          <select
            value={target}
            aria-label={c.coworker}
            required
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">—</option>
            {coworkers.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "SWAP" && (
        <label>
          {c.otherShift}
          <select name="otherShift" aria-label={c.otherShift} required>
            <option value="">—</option>
            {options.shifts
              .filter(
                (s) => s.membershipId === target && s.startsAt > data.serverNow,
              )
              .map((s) => (
                <option key={s.assignmentId} value={s.assignmentId}>
                  {s.startsLocal.replace("T", " · ")} · {s.station}
                </option>
              ))}
          </select>
        </label>
      )}
      {optionsError && (
        <p role="alert" className="wf-wide">
          {optionsError}
        </p>
      )}
      <button className="wf-wide" disabled={busy || choices.length === 0}>
        {c.submit}
      </button>
    </form>
  );
}
export function DecisionDialog({
  data,
  request,
  attendance,
  action,
  c,
  busy,
  error,
  command,
  onClose,
}: {
  data: OperationsData;
  request: RequestRow | null;
  attendance: AttendanceRow | null;
  action: string;
  c: OperationsCopy;
  busy: boolean;
  error: string;
  command: OperationsCommand;
  onClose: () => void;
}) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      expectedVersion: request?.version ?? attendance!.version,
      reason: String(f.get("reason")),
      reviewConfirmed: f.get("confirm") === "on",
      warningsAcknowledged: f.get("acknowledge") === "on",
      ...(request ? { action } : {}),
    };
    if (
      await command(
        request
          ? "requests/" + request.id + "/decision"
          : "attendance/" + attendance!.id + "/approval",
        body,
      )
    )
      onClose();
  }
  const snapshot = request?.payload.snapshot ?? attendance?.actual,
    policy = data.policyVersions.find(
      (p) =>
        p.id === (request?.policyRevisionId ?? attendance?.policyRevisionId),
    ),
    warnings = snapshot
      ? workforceAttendanceWarnings(snapshot, policy?.rules ?? data.rules)
      : [];
  return (
    <PilotDialog
      title={c.review}
      closeLabel={c.close}
      onClose={onClose}
      className="wf-dialog"
    >
      <form className="wf-form" onSubmit={submit}>
        {request?.affectedShifts?.length ? (
          <div className="wf-wide">
            <h4>{c.impact}</h4>
            {request.affectedShifts.map((s) => (
              <p key={s.assignmentId}>
                {s.startsLocal.replace("T", " · ")} → {s.endsLocal.slice(11)} ·{" "}
                {s.station}
              </p>
            ))}
          </div>
        ) : null}
        {attendance?.original && (
          <div className="wf-wide">
            <h4>{c.original}</h4>
            <p>
              {workforceLocal(
                attendance.original.startsAt,
                attendance.timezone,
              )}{" "}
              ·{" "}
              {workforceLocal(attendance.original.endsAt, attendance.timezone)}{" "}
              · {c.worked}:{" "}
              {workforceAttendanceTotals(attendance.original).workedMinutes}{" "}
              {c.minutes}
            </p>
            {attendance.events
              .filter((e) => e.kind !== "CORRECTION")
              .map((e) => (
                <p key={e.id}>
                  {workforceLocal(e.occurredAt, attendance.timezone)} ·{" "}
                  {e.kind === "CLOCK_IN"
                    ? c.clockIn
                    : e.kind === "CLOCK_OUT"
                      ? c.clockOut
                      : e.kind === "BREAK_START"
                        ? c.startBreak
                        : c.endBreak}
                </p>
              ))}
          </div>
        )}
        {snapshot && (
          <div className="wf-wide">
            <h4>{request ? c.proposed : c.worked}</h4>
            <p>
              {workforceLocal(snapshot.startsAt, data.venue.timezone)} ·{" "}
              {workforceLocal(snapshot.endsAt, data.venue.timezone)} ·{" "}
              {c.worked}: {workforceAttendanceTotals(snapshot).workedMinutes}{" "}
              {c.minutes}
            </p>
            <p>
              {c.presence}:{" "}
              {workforceAttendanceTotals(snapshot).presenceMinutes} {c.minutes}{" "}
              ? {c.breaks}: {workforceAttendanceTotals(snapshot).breakMinutes}{" "}
              {c.minutes}
            </p>
            {snapshot.breaks.map((b, index) => (
              <p key={index}>
                {c.breaks} {index + 1}:{" "}
                {workforceLocal(b.startsAt, data.venue.timezone)} -{" "}
                {workforceLocal(b.endsAt, data.venue.timezone)} ·{" "}
                {b.kind === "PAID" ? c.paid : c.unpaid}
              </p>
            ))}
            {warnings.map((w) => (
              <p className="wf2-warning" key={w}>
                {operationsWarning(w, c)}
              </p>
            ))}
          </div>
        )}
        <p className="wf-wide">
          {request
            ? request.startsAt.slice(0, 10) +
              " → " +
              request.endsAt.slice(0, 10)
            : attendance?.actual?.startsAt + " → " + attendance?.actual?.endsAt}
        </p>
        {request?.payload.slices && (
          <p className="wf-wide">
            {c.minutes}:{" "}
            {request.payload.slices.reduce((n, s) => n + s.chargedMinutes, 0)}
          </p>
        )}
        {request?.payload.snapshot && (
          <p className="wf-wide">
            {request.payload.snapshot.startsAt} →{" "}
            {request.payload.snapshot.endsAt} · {c.breaks}:{" "}
            {request.payload.snapshot.breaks.length}
          </p>
        )}
        <label className="wf-wide">
          {c.reason}
          <input
            name="reason"
            minLength={3}
            maxLength={300}
            required
            defaultValue={
              request?.payload.category === "SICKNESS" ? c.sickness : ""
            }
          />
        </label>
        <label className="wf-wide wf2-check">
          <input name="confirm" type="checkbox" required />
          {c.confirm}
        </label>
        <label className="wf-wide wf2-check">
          <input name="acknowledge" type="checkbox" />
          {c.acknowledge}
        </label>
        {error && (
          <p className="wf-wide" role="alert">
            {error}
          </p>
        )}
        <button className="wf-wide" disabled={busy}>
          {action === "REJECT"
            ? c.reject
            : action === "CANCEL_APPROVED"
              ? c.cancelApproved
              : c.approve}
        </button>
      </form>
    </PilotDialog>
  );
}

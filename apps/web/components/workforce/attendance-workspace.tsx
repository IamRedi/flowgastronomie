"use client";
import { WorkforceMonthWorkspace } from "./month-workspace";
import { WorkforceInbox } from "./inbox-workspace";
import { workforceMonthCopy } from "./month-copy";
import "./month.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  workforceWeek,
  workforceDateSchema,
  workforceAddDays,
  workforceDayRange,
  workforceToday,
  workforceLocal,
  workforceOriginalAttendance,
  workforceAttendanceTotals,
  workforceAttendanceWindowTotals,
  workforceSumAttendanceTotals,
  workforcePlannedMinutes,
} from "@flowgastronomie/domain";
import type { Locale } from "../../lib/i18n";
import { workforceOperationsCopy, operationsWarning } from "./operations-copy";
import type {
  AttendanceRow,
  OperationsData,
  RequestRow,
  LeaveBalance,
  TimeTotals,
} from "./operation-types";
import {
  CorrectionDialog,
  LeaveForm,
  ShiftRequestForm,
  DecisionDialog,
} from "./operation-forms";
import { PolicyDialog, GrantDialog } from "./policy-forms";
import "./attendance.css";
const hours = (n: number) => Math.floor(n / 60) + " h " + (n % 60) + " min";
export function AttendanceWorkspace({
  locale,
  api,
  initialDate,
  onScheduleChanged,
}: {
  locale: Locale;
  api: string;
  initialDate: string;
  onScheduleChanged: () => Promise<void>;
}) {
  const c = workforceOperationsCopy[locale],
    prefix = api + "/v1/staff/workforce/",
    [date, setDate] = useState(initialDate),
    [data, setData] = useState<OperationsData | null>(null),
    [tab, setTab] = useState("today"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [breakKind, setBreakKind] = useState("UNPAID"),
    [linkService, setLinkService] = useState(false),
    [tick, setTick] = useState(0),
    [correction, setCorrection] = useState<{
      row: AttendanceRow | null;
    } | null>(null),
    [decision, setDecision] = useState<{
      request: RequestRow | null;
      attendance: AttendanceRow | null;
      action: string;
    } | null>(null),
    [tool, setTool] = useState<"policy" | "grant" | null>(null),
    [uncertain, setUncertain] = useState<{
      path: string;
      body: unknown;
    } | null>(null);
  const initial = useRef(true),
    receivedAt = useRef(0),
    loadSequence = useRef(0),
    actionPending = useRef(false),
    alive = useRef(true);
  const week = workforceWeek(date),
    end = workforceAddDays(week, 6);
  const message = useCallback(
    (code: string, detail?: string) =>
      (
        ({
          INELIGIBLE: c.ineligible,
          ALLOWANCE: c.allowanceError,
          OVERLAP: c.overlapError,
          REVIEW: c.reviewNeeded,
          STATE: c.stateError,
          POLICY: c.policyError,
        }) as Record<string, string>
      )[detail ?? ""] ??
      (code === "CONFLICT"
        ? c.conflict
        : code === "FORBIDDEN"
          ? c.forbidden
          : code === "UNAVAILABLE"
            ? c.unavailable
            : c.invalid),
    [c],
  );
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const r = await fetch(prefix + "operations?from=" + week + "&to=" + end, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) {
        const body = (await r.json()) as { code: string };
        throw new Error(body.code);
      }
      const next = (await r.json()) as OperationsData;
      if (!alive.current || sequence !== loadSequence.current) return;
      receivedAt.current = performance.now();
      setData(next);
      if (initial.current) {
        initial.current = false;
        const requestedDate = new URLSearchParams(window.location.search).get(
          "date",
        );
        setDate(
          requestedDate && workforceDateSchema.safeParse(requestedDate).success
            ? requestedDate
            : next.today,
        );
        const requestedTab = new URLSearchParams(window.location.search).get(
          "workforceTab",
        );
        if (
          requestedTab &&
          [
            "today",
            "hours",
            "leave",
            "requests",
            "month",
            "inbox",
            ...(next.viewer.canManage ? ["operations"] : []),
          ].includes(requestedTab)
        )
          setTab(requestedTab);
        else if (next.viewer.canManage) setTab("operations");
      }
    } catch (e) {
      if (alive.current && sequence === loadSequence.current)
        setError(message(e instanceof Error ? e.message : "UNAVAILABLE"));
    }
  }, [prefix, week, end, message]);
  useEffect(() => {
    alive.current = true;
    void load();
    const interval = setInterval(() => {
      if (!actionPending.current) void load();
    }, 15000);
    return () => {
      alive.current = false;
      clearInterval(interval);
    };
  }, [load]);
  useEffect(() => {
    if (!data?.current || tab !== "today") return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [data?.current?.id, tab]);
  const command = useCallback(
    async (path: string, body: unknown) => {
      if (actionPending.current) return false;
      actionPending.current = true;
      setBusy(true);
      setError("");
      setStatus("");
      try {
        const r = await fetch(prefix + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        });
        const result = (await r.json()) as { code?: string; detail?: string };
        if (!r.ok) {
          setUncertain(null);
          setError(message(result.code ?? "UNAVAILABLE", result.detail));
          return false;
        }
        setUncertain(null);
        setStatus(c.saved);
        await load();
        await onScheduleChanged();
        return true;
      } catch {
        setUncertain({ path, body });
        setError(c.unavailable);
        return false;
      } finally {
        actionPending.current = false;
        setBusy(false);
      }
    },
    [prefix, c, load, onScheduleChanged, message],
  );
  const readBalance = useCallback(
    async (member: string, year: number) => {
      try {
        const r = await fetch(
          prefix +
            "leave-allowance/" +
            encodeURIComponent(member) +
            "?year=" +
            year,
          { credentials: "include", cache: "no-store" },
        );
        if (!r.ok) {
          const b = (await r.json()) as { code: string };
          setError(message(b.code));
          return null;
        }
        return (await r.json()) as LeaveBalance;
      } catch {
        setError(c.unavailable);
        return null;
      }
    },
    [prefix, c, message],
  );
  useEffect(() => {
    if (!data) return;
    const params = new URLSearchParams(window.location.search),
      request = params.get("workforceRequest"),
      attendance = params.get("workforceAttendance");
    const id = request ?? attendance;
    if (!id) return;
    const key = request
      ? "data-workforce-request"
      : "data-workforce-attendance";
    const timer = setTimeout(
      () =>
        document
          .querySelector(`[${key}="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "center" }),
      0,
    );
    return () => clearTimeout(timer);
  }, [data, tab]);
  if (!data)
    return (
      <section className="wf2-workspace" aria-label={c.operations}>
        <p>{error || c.loading}</p>
      </section>
    );
  const disabled = busy || uncertain !== null,
    name = (id: string) =>
      data.roster.find((m) => m.userId === id)?.displayName ?? "—",
    state = (s: string) =>
      s === "WORKING" ? c.working : s === "BREAK" ? c.onBreak : c.closed,
    category = (s: string) =>
      (
        ({
          ANNUAL: c.annual,
          UNPAID: c.unpaidLeave,
          PERSONAL: c.personal,
          SICKNESS: c.sickness,
          OTHER: c.other,
          LEAVE: c.requestLeave,
          CORRECTION: c.requestCorrection,
          SWAP: c.swap,
          OFFER: c.offer,
          OPEN: c.open,
        }) as Record<string, string>
      )[s] ?? s,
    requestStatus = (s: string) =>
      (
        ({
          PENDING: c.pending,
          ACCEPTED: c.accepted,
          APPROVED: c.approved,
          REJECTED: c.rejected,
          CANCELLED: c.cancelled,
        }) as Record<string, string>
      )[s] ?? s;
  const tabs = data.viewer.canManage
      ? ["operations", "today", "hours", "leave", "requests", "month", "inbox"]
      : ["today", "hours", "leave", "requests", "month", "inbox"],
    labels: Record<string, string> = {
      operations: c.operations,
      today: c.today,
      hours: c.hours,
      leave: c.leave,
      requests: c.requests,
      month: workforceMonthCopy[locale].monthTab,
      inbox: workforceMonthCopy[locale].inbox,
    };
  const own = data.attendance.filter((a) => a.userId === data.viewer.userId),
    liveSnapshot = data.current
      ? workforceOriginalAttendance(
          data.current.events,
          new Date(
            Date.parse(data.serverNow) +
              Math.max(0, performance.now() - receivedAt.current),
          ).toISOString(),
        )
      : null,
    todayRange = workforceDayRange(data.today, data.venue.timezone),
    liveTotals = workforceSumAttendanceTotals(
      own.flatMap((a) => {
        const value = a.id === data.current?.id ? liveSnapshot : a.actual;
        return value
          ? [
              workforceAttendanceWindowTotals(
                value,
                todayRange.start,
                todayRange.end,
              ),
            ]
          : [];
      }),
    );
  const closeDialogs = () => {
    setCorrection(null);
    setDecision(null);
    setTool(null);
    setError("");
  };
  const instant = (at: string, zone = data.venue.timezone) =>
    workforceLocal(at, zone).replace("T", " · ");
  const totals = (v: TimeTotals | null) =>
    v && (
      <dl className="wf2-totals">
        <div>
          <dt>{c.presence}</dt>
          <dd>{hours(v.presenceMinutes)}</dd>
        </div>
        <div>
          <dt>{c.breaks}</dt>
          <dd>{hours(v.breakMinutes)}</dd>
        </div>
        <div>
          <dt>{c.worked}</dt>
          <dd>{hours(v.workedMinutes)}</dd>
        </div>
      </dl>
    );
  const warningList = (a: AttendanceRow) =>
    data.warnings
      .find((w) => w.attendanceId === a.id)
      ?.codes.map((code) => (
        <p className="wf2-warning" key={code}>
          {code === "UNSCHEDULED" && a.approved
            ? c.unscheduledReviewed
            : operationsWarning(code, c)}
        </p>
      ));
  const history = (a: AttendanceRow) => (
    <details className="wf2-history">
      <summary>
        {c.original} · {c.history}
      </summary>
      {a.events.map((e) => (
        <p key={e.id}>
          <strong>
            {
              {
                CLOCK_IN: c.clockIn,
                CLOCK_OUT: c.clockOut,
                BREAK_START: c.startBreak,
                BREAK_END: c.endBreak,
                CORRECTION: c.requestCorrection,
              }[e.kind]
            }
          </strong>{" "}
          · {instant(e.occurredAt, a.timezone)} · {name(e.actorUserId)}
        </p>
      ))}
      {a.approvalHistory.map((p) => (
        <p key={p.id}>
          {c.approved}: {hours(p.totals.workedMinutes)} ·{" "}
          {instant(p.createdAt, a.timezone)} · {name(p.actorUserId)} ·{" "}
          {p.reason}
        </p>
      ))}
    </details>
  );
  const requestCards = (rows: RequestRow[]) =>
    rows.length ? (
      <div className="wf2-list">
        {rows.map((r) => (
          <article
            className="wf2-card"
            key={r.id}
            data-workforce-request={r.id}
          >
            <header>
              <div>
                <p className="wf-eyebrow">{requestStatus(r.status)}</p>
                <h4>{category(r.payload.category ?? r.kind)}</h4>
                <p>
                  {name(r.userId)} · {instant(r.startsAt)} → {instant(r.endsAt)}
                </p>
              </div>
            </header>
            {r.affectedShifts?.length ? (
              <details>
                <summary>{c.impact}</summary>
                {r.affectedShifts.map((s) => (
                  <p key={s.assignmentId}>
                    {s.startsLocal.replace("T", " · ")} ·{" "}
                    {s.endsLocal.slice(11)} → {s.station} ·{" "}
                    {s.userId ? name(s.userId) : c.open}
                  </p>
                ))}
              </details>
            ) : null}
            {["SWAP", "OFFER"].includes(r.kind) && r.status === "PENDING" && (
              <p>{c.waitingCoworker}</p>
            )}
            {r.payload.slices && (
              <p>
                {c.minutes}:{" "}
                {r.payload.slices.reduce((n, s) => n + s.chargedMinutes, 0)}
              </p>
            )}
            <div className="wf2-actions">
              {r.allowedActions.includes("ACCEPT") && (
                <>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void command("requests/" + r.id + "/decision", {
                        expectedVersion: r.version,
                        action: "ACCEPT",
                      })
                    }
                  >
                    {c.accept}
                  </button>
                  <button
                    disabled={disabled}
                    className="wf-secondary"
                    onClick={() =>
                      void command("requests/" + r.id + "/decision", {
                        expectedVersion: r.version,
                        action: "DECLINE",
                      })
                    }
                  >
                    {c.decline}
                  </button>
                </>
              )}
              {r.allowedActions.includes("WITHDRAW") && (
                <button
                  disabled={disabled}
                  className="wf-secondary"
                  onClick={() =>
                    void command("requests/" + r.id + "/decision", {
                      expectedVersion: r.version,
                      action: "WITHDRAW",
                    })
                  }
                >
                  {c.withdraw}
                </button>
              )}
              {r.allowedActions.includes("REJECT") && (
                <>
                  <button
                    disabled={disabled || !r.allowedActions.includes("APPROVE")}
                    onClick={() =>
                      setDecision({
                        request: r,
                        attendance:
                          data.attendance.find(
                            (a) => a.id === r.payload.attendanceId,
                          ) ?? null,
                        action: "APPROVE",
                      })
                    }
                  >
                    {c.review}
                  </button>
                  <button
                    disabled={disabled}
                    className="wf-secondary"
                    onClick={() =>
                      setDecision({
                        request: r,
                        attendance: null,
                        action: "REJECT",
                      })
                    }
                  >
                    {c.reject}
                  </button>
                </>
              )}
              {r.allowedActions.includes("CANCEL_APPROVED") && (
                <button
                  disabled={disabled}
                  className="wf-secondary"
                  onClick={() =>
                    setDecision({
                      request: r,
                      attendance: null,
                      action: "CANCEL_APPROVED",
                    })
                  }
                >
                  {c.cancelApproved}
                </button>
              )}
            </div>
            <details className="wf2-history">
              <summary>{c.history}</summary>
              {r.transitions.map((t) => (
                <p key={t.id}>
                  {requestStatus(t.toStatus)} · {instant(t.createdAt)} ·{" "}
                  {name(t.actorUserId)} {t.reason && "· " + t.reason}
                </p>
              ))}
            </details>
          </article>
        ))}
      </div>
    ) : (
      <p className="wf2-empty">{c.empty}</p>
    );
  return (
    <section
      className="wf2-workspace"
      aria-label={c.operations}
      data-testid="wf2-workspace"
      data-refresh={tick}
    >
      <div className="wf2-tabs" role="tablist" aria-label={c.operations}>
        {tabs.map((id, index) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={"wf2-tab-" + id}
            aria-selected={tab === id}
            aria-controls="wf2-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? tabs.length - 1
                      : (index +
                          (e.key === "ArrowRight" ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                setTab(tabs[next]!);
                document.getElementById("wf2-tab-" + tabs[next])?.focus();
              }
            }}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      <div className="wf2-toolbar">
        <span>
          {data.venue.name} · {data.venue.timezone}
        </span>
        <button
          className="wf-secondary"
          disabled={busy}
          onClick={() => {
            setError("");
            void load();
          }}
        >
          {c.refresh}
        </button>
      </div>
      {error && !decision && !correction && !tool && (
        <p role="alert" className="wf2-feedback">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="wf2-feedback">
          {status}
        </p>
      )}
      {uncertain && (
        <button
          disabled={busy}
          onClick={() => void command(uncertain.path, uncertain.body)}
        >
          {c.retry}
        </button>
      )}
      {data.truncated && <p role="alert">{c.truncated}</p>}
      <div id="wf2-panel" role="tabpanel" aria-labelledby={"wf2-tab-" + tab}>
        {tab === "today" && (
          <div className="wf2-today">
            <article className="wf2-clock">
              <p className="wf-eyebrow">
                {data.today} ·{" "}
                {data.current
                  ? state(data.current.state)
                  : liveTotals.workedMs > 0
                    ? c.closed
                    : c.notStarted}
              </p>
              <h3>{c.today}</h3>
              {totals(liveTotals)}
              {!data.current && data.operationalSession && (
                <label className="wf2-check">
                  <input
                    type="checkbox"
                    checked={linkService}
                    onChange={(e) => setLinkService(e.target.checked)}
                  />
                  {c.linkService}
                </label>
              )}
              {data.activeElsewhere ? (
                <p>{c.elsewhere}</p>
              ) : (
                <div className="wf2-actions">
                  {!data.current ? (
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void command("attendance/punch", {
                          kind: "CLOCK_IN",
                          expectedVersion: 0,
                          idempotencyKey: crypto.randomUUID(),
                          ...(linkService && data.operationalSession
                            ? {
                                operationalStaffShiftId:
                                  data.operationalSession.id,
                              }
                            : {}),
                        })
                      }
                    >
                      {c.clockIn}
                    </button>
                  ) : data.current.state === "BREAK" ? (
                    <button
                      disabled={disabled}
                      onClick={() =>
                        void command("attendance/punch", {
                          kind: "BREAK_END",
                          expectedVersion: data.current!.version,
                          idempotencyKey: crypto.randomUUID(),
                        })
                      }
                    >
                      {c.endBreak}
                    </button>
                  ) : (
                    <>
                      <label className="wf2-break-choice">
                        {c.breaks}
                        <select
                          aria-label={c.breaks}
                          value={breakKind}
                          onChange={(e) => setBreakKind(e.target.value)}
                        >
                          <option value="UNPAID">{c.unpaid}</option>
                          {data.rules.paidBreaksAllowed && (
                            <option value="PAID">{c.paid}</option>
                          )}
                        </select>
                      </label>
                      <button
                        disabled={disabled}
                        className="wf-secondary"
                        onClick={() =>
                          void command("attendance/punch", {
                            kind: "BREAK_START",
                            expectedVersion: data.current!.version,
                            idempotencyKey: crypto.randomUUID(),
                            breakKind,
                          })
                        }
                      >
                        {c.startBreak}
                      </button>
                      <button
                        disabled={disabled}
                        onClick={() =>
                          void command("attendance/punch", {
                            kind: "CLOCK_OUT",
                            expectedVersion: data.current!.version,
                            idempotencyKey: crypto.randomUUID(),
                          })
                        }
                      >
                        {c.clockOut}
                      </button>
                    </>
                  )}
                </div>
              )}
              {data.current && warningList(data.current)}
              {data.current && (
                <button
                  className="wf-secondary"
                  disabled={disabled}
                  onClick={() => setCorrection({ row: data.current })}
                >
                  {c.requestCorrection}
                </button>
              )}
            </article>
            <article className="wf2-card">
              <p className="wf-eyebrow">{c.nextShift}</p>
              <h3>
                {data.nextShift
                  ? data.nextShift.startsLocal.replace("T", " · ")
                  : c.noShift}
              </h3>
              {data.nextShift && (
                <p>
                  {data.nextShift.endsLocal.replace("T", " · ")} ·{" "}
                  {data.nextShift.station}
                </p>
              )}
            </article>
          </div>
        )}
        {tab === "hours" && (
          <>
            <div className="wf2-period">
              <h3>{c.hours}</h3>
              <label>
                {c.from}
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (e.target.value) setDate(e.target.value);
                  }}
                />
              </label>
              <span>
                {week} → {end}
              </span>
            </div>
            <div className="wf2-days">
              {Array.from({ length: 7 }, (_, i) =>
                workforceAddDays(week, i),
              ).map((day) => {
                const range = workforceDayRange(day, data.venue.timezone),
                  planned = data.shifts
                    .filter(
                      (s) =>
                        s.userId === data.viewer.userId &&
                        s.startsLocal.slice(0, 10) === day,
                    )
                    .reduce((n, s) => n + workforcePlannedMinutes(s), 0),
                  actual = workforceSumAttendanceTotals(
                    own.flatMap((a) =>
                      a.actual
                        ? [
                            workforceAttendanceWindowTotals(
                              a.actual,
                              range.start,
                              range.end,
                            ),
                          ]
                        : [],
                    ),
                  ).workedMinutes,
                  approved = workforceSumAttendanceTotals(
                    own.flatMap((a) =>
                      a.approved
                        ? [
                            workforceAttendanceWindowTotals(
                              a.approved.snapshot,
                              range.start,
                              range.end,
                            ),
                          ]
                        : [],
                    ),
                  ).workedMinutes;
                return (
                  <article key={day} className="wf2-card">
                    <h4>{day}</h4>
                    <p>
                      {c.plannedStart}: {hours(planned)}
                    </p>
                    <p>
                      {c.worked}: {hours(actual)}
                    </p>
                    <p>
                      {c.approved}: {hours(approved)}
                    </p>
                  </article>
                );
              })}
            </div>
            <div className="wf2-list">
              {own.map((a) => (
                <article
                  key={a.id}
                  className="wf2-card"
                  data-workforce-attendance={a.id}
                >
                  <header>
                    <h4>
                      {instant(a.actual?.startsAt ?? a.startedAt, a.timezone)}
                    </h4>
                    <span>
                      {state(a.state)} · {a.approved ? c.approved : c.pending}
                    </span>
                  </header>
                  {totals(a.totals)}
                  {warningList(a)}
                  <button
                    className="wf-secondary"
                    disabled={disabled}
                    onClick={() => setCorrection({ row: a })}
                  >
                    {c.requestCorrection}
                  </button>
                  {history(a)}
                </article>
              ))}
            </div>
          </>
        )}
        {tab === "leave" && (
          <>
            <div className="wf2-stats">
              <article>
                <span>
                  {c.balance} · {data.balance.year}
                </span>
                <strong>
                  {data.balance.configured
                    ? hours(data.balance.remainingMinutes ?? 0)
                    : "—"}
                </strong>
                <p>
                  {data.balance.configured
                    ? c.allowance +
                      ": " +
                      hours(data.balance.allowanceMinutes ?? 0)
                    : c.notConfigured}
                </p>
                <p>
                  {c.pending}: {hours(data.balance.pendingMinutes)}
                </p>
              </article>
            </div>
            <LeaveForm data={data} c={c} busy={disabled} command={command} />
            {requestCards(
              data.requests.filter(
                (r) => r.kind === "LEAVE" && r.userId === data.viewer.userId,
              ),
            )}
          </>
        )}
        {tab === "requests" && (
          <>
            <div className="wf2-actions">
              <button
                className="wf-secondary"
                disabled={disabled}
                onClick={() => setCorrection({ row: null })}
              >
                {c.missingIn} · {c.requestCorrection}
              </button>
            </div>
            <ShiftRequestForm
              prefix={prefix}
              data={data}
              c={c}
              busy={disabled}
              command={command}
            />
            {requestCards(
              data.requests.filter(
                (r) =>
                  r.kind !== "LEAVE" &&
                  (r.userId === data.viewer.userId ||
                    r.invitedUserId === data.viewer.userId),
              ),
            )}
          </>
        )}
        {tab === "month" && (
          <WorkforceMonthWorkspace
            prefix={prefix}
            locale={locale}
            initialMonth={date.slice(0, 7)}
            operations={data}
          />
        )}
        {tab === "inbox" && <WorkforceInbox prefix={prefix} locale={locale} />}
        {tab === "operations" && (
          <>
            <div className="wf2-stats">
              <article>
                <span>{c.workingNow}</span>
                <strong>
                  {data.attendance.filter((a) => a.state === "WORKING").length}
                </strong>
              </article>
              <article>
                <span>{c.onBreak}</span>
                <strong>
                  {data.attendance.filter((a) => a.state === "BREAK").length}
                </strong>
              </article>
              <article>
                <span>{c.late}</span>
                <strong>{data.absent.length}</strong>
              </article>
              <article>
                <span>{c.queue}</span>
                <strong>
                  {data.requests.filter((r) =>
                    ["PENDING", "ACCEPTED"].includes(r.status),
                  ).length +
                    data.attendance.filter(
                      (a) => a.state === "CLOSED" && !a.approved,
                    ).length}
                </strong>
              </article>
            </div>
            <div className="wf2-list">
              {data.attendance
                .filter((a) => a.state !== "CLOSED")
                .map((a) => (
                  <article className="wf2-card" key={a.id}>
                    <header>
                      <h4>{name(a.userId)}</h4>
                      <span>{state(a.state)}</span>
                    </header>
                    {totals(a.totals)}
                    {warningList(a)}
                    {a.userId !== data.viewer.userId && (
                      <button
                        className="wf-secondary"
                        disabled={disabled}
                        onClick={() => setCorrection({ row: a })}
                      >
                        {c.requestCorrection}
                      </button>
                    )}
                    {history(a)}
                  </article>
                ))}
              {data.absent.map((a) => (
                <article className="wf2-card" key={a.assignmentId}>
                  <h4>{name(a.userId)}</h4>
                  <p>
                    {c.late} · {instant(a.startsAt)} → {instant(a.endsAt)}
                  </p>
                </article>
              ))}
            </div>
            <h3>{c.queue}</h3>
            {requestCards(
              data.requests.filter((r) =>
                ["PENDING", "ACCEPTED"].includes(r.status),
              ),
            )}
            <details>
              <summary>{c.history}</summary>
              {requestCards(
                data.requests.filter(
                  (r) => !["PENDING", "ACCEPTED"].includes(r.status),
                ),
              )}
            </details>
            <h3>{c.reviewHours}</h3>
            <div className="wf2-list">
              {data.attendance
                .filter((a) => a.state === "CLOSED" && !a.approved)
                .map((a) => (
                  <article
                    key={a.id}
                    className="wf2-card"
                    data-workforce-attendance={a.id}
                  >
                    <header>
                      <h4>{name(a.userId)}</h4>
                      <span>
                        {instant(a.actual?.startsAt ?? a.startedAt, a.timezone)}
                      </span>
                    </header>
                    {totals(a.totals)}
                    {warningList(a)}
                    {a.userId !== data.viewer.userId && (
                      <button
                        disabled={disabled}
                        onClick={() =>
                          setDecision({
                            request: null,
                            attendance: a,
                            action: "APPROVE",
                          })
                        }
                      >
                        {c.reviewHours}
                      </button>
                    )}
                    {history(a)}
                  </article>
                ))}
            </div>
            <details>
              <summary>
                {c.approved} ? {c.history}
              </summary>
              <div className="wf2-list">
                {data.attendance
                  .filter((a) => a.state === "CLOSED" && a.approved)
                  .map((a) => (
                    <article
                      key={a.id}
                      className="wf2-card"
                      data-workforce-attendance={a.id}
                    >
                      <h4>
                        {name(a.userId)} ·{" "}
                        {instant(a.actual?.startsAt ?? a.startedAt, a.timezone)}
                      </h4>
                      {totals(a.totals)}
                      {history(a)}
                      {a.userId !== data.viewer.userId && (
                        <button
                          className="wf-secondary"
                          disabled={disabled}
                          onClick={() => setCorrection({ row: a })}
                        >
                          {c.requestCorrection}
                        </button>
                      )}
                    </article>
                  ))}
              </div>
            </details>
            <details className="wf2-policy">
              <summary>
                {c.policy} · {data.venue.countryCode}
              </summary>
              <p>{c.legalReview}</p>
              <p>
                {c.rest}: {data.rules.minimumRestMinutes}
              </p>
              <p>
                {c.thresholds}:{" "}
                {data.rules.breakThresholds
                  .map((t) => t.afterMinutes + ":" + t.breakMinutes)
                  .join(", ") || "—"}
              </p>
              {data.viewer.canConfigure && (
                <div className="wf2-actions">
                  <button
                    disabled={disabled}
                    className="wf-secondary"
                    onClick={() => setTool("policy")}
                  >
                    {c.configure}
                  </button>
                  <button
                    disabled={disabled}
                    className="wf-secondary"
                    onClick={() => setTool("grant")}
                  >
                    {c.grant}
                  </button>
                </div>
              )}
            </details>
          </>
        )}
      </div>
      {correction && (
        <CorrectionDialog
          row={correction.row}
          data={data}
          c={c}
          busy={disabled}
          error={error}
          command={command}
          onClose={closeDialogs}
        />
      )}
      {decision && (
        <DecisionDialog
          data={data}
          request={decision.request}
          attendance={decision.attendance}
          action={decision.action}
          c={c}
          busy={disabled}
          error={error}
          command={command}
          onClose={closeDialogs}
        />
      )}
      {tool === "policy" && (
        <PolicyDialog
          data={data}
          c={c}
          busy={disabled}
          error={error}
          command={command}
          onClose={closeDialogs}
        />
      )}
      {tool === "grant" && (
        <GrantDialog
          data={data}
          c={c}
          busy={disabled}
          error={error}
          command={command}
          readBalance={readBalance}
          onClose={closeDialogs}
        />
      )}
    </section>
  );
}

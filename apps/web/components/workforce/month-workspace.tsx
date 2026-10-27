"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  workforceMonthSchema,
  workforceAbsenceLabels,
} from "@flowgastronomie/domain";
import type { Locale } from "../../lib/i18n";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import { workforceMonthCopy } from "./month-copy";
import { MonthReport, monthHours } from "./month-report";
import { AccountPolicyDialog } from "./account-policy-dialog";
import type {
  MonthData,
  MonthStatistics,
  AccountPolicies,
} from "./month-types";
import type { OperationsData, LeaveBalance } from "./operation-types";
export function WorkforceMonthWorkspace({
  prefix,
  locale,
  initialMonth,
  operations,
}: {
  prefix: string;
  locale: Locale;
  initialMonth: string;
  operations: OperationsData;
}) {
  const c = workforceMonthCopy[locale],
    [month, setMonth] = useState(initialMonth),
    [initialized, setInitialized] = useState(false),
    [member, setMember] = useState(operations.viewer.membershipId),
    [data, setData] = useState<MonthData | null>(null),
    [stats, setStats] = useState<MonthStatistics | null>(null),
    [policies, setPolicies] = useState<AccountPolicies | null>(null),
    [leave, setLeave] = useState<LeaveBalance | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [closeDialog, setCloseDialog] = useState(false),
    [policyDialog, setPolicyDialog] = useState(false),
    [print, setPrint] = useState(false),
    [original, setOriginal] = useState(false),
    [refresh, setRefresh] = useState(0),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef<{
      month: string;
      member: string;
      body: unknown;
    } | null>(null),
    inFlight = useRef(false);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "workforceMonth",
    );
    if (requested && workforceMonthSchema.safeParse(requested).success)
      setMonth(requested);
    setInitialized(true);
  }, []);
  useEffect(() => {
    // Resolve the requested reporting month before starting account/statistics
    // reads; avoid loading an unrelated full future month on initial mount.
    if (!initialized) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    const get = async (path: string) => {
      const r = await fetch(prefix + path, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!r.ok) throw new Error(c.error);
      return r.json();
    };
    Promise.all([
      get(
        "monthly-account?" +
          new URLSearchParams({ month, membershipId: member }),
      ),
      operations.viewer.canManage
        ? get("monthly-statistics?month=" + month)
        : Promise.resolve(null),
      get("account-policies"),
      member === operations.viewer.membershipId
        ? get("leave-allowance/" + member + "?year=" + month.slice(0, 4))
        : Promise.resolve(null),
    ])
      .then(([account, statistics, versions, balance]) => {
        if (controller.signal.aborted) return;
        setData(account);
        setStats(statistics);
        setPolicies(versions);
        setLeave(balance);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(c.error);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [
    initialized,
    prefix,
    month,
    member,
    refresh,
    c.error,
    operations.viewer.canManage,
    operations.viewer.membershipId,
  ]);
  const reload = useCallback(async () => {
    setRefresh((v) => v + 1);
  }, []);
  async function doClose(body: unknown, period: string, target: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(
        prefix + "monthly-account/" + target + "/close?month=" + period,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!r.ok) {
        const b = await r.json();
        pending.current = null;
        setUncertain(false);
        setError(b.code === "CONFLICT" ? c.conflict : c.error);
        return;
      }
      pending.current = null;
      setUncertain(false);
      setData(await r.json());
      setCloseDialog(false);
      setStatus(c.saved);
      await reload();
    } catch {
      setUncertain(true);
      setError(c.error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function close(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const f = new FormData(e.currentTarget),
      body = pending.current?.body ?? {
        idempotencyKey: crypto.randomUUID(),
        expectedFingerprint: data.fingerprint,
        reason: String(f.get("reason")),
        reviewConfirmed: f.get("confirm") === "on",
      };
    pending.current = { month, member, body };
    await doClose(body, month, member);
  }
  async function download(format: "csv" | "pdf") {
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams({
          month,
          membershipId: member,
          format,
          locale,
          version: original ? "original" : "current",
        }),
        r = await fetch(prefix + "monthly-account/export?" + q, {
          credentials: "include",
          cache: "no-store",
        });
      if (!r.ok) throw new Error(c.error);
      const object = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = object;
      a.download = "workforce-" + month + "." + format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(object), 30000);
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  }
  const a = original && data?.closing ? data.closing.original : data?.account;
  return (
    <section className="wf3-workspace" data-testid="wf3-month">
      <header className="wf3-heading">
        <div>
          <p className="wf-eyebrow">FlowGastronomie · Workforce</p>
          <h2>{operations.viewer.canManage ? c.team : c.title}</h2>
          <p>{c.policyHelp}</p>
        </div>
        <div className="wf3-controls">
          <label>
            {c.month}
            <input
              type="month"
              aria-label={c.month}
              value={month}
              disabled={busy || uncertain}
              onChange={(e) => {
                if (workforceMonthSchema.safeParse(e.target.value).success) {
                  setMonth(e.target.value);
                  setOriginal(false);
                }
              }}
            />
          </label>
          {operations.viewer.canManage && (
            <label>
              {c.employee}
              <select
                aria-label={c.employee}
                value={member}
                disabled={busy || uncertain}
                onChange={(e) => {
                  setMember(e.target.value);
                  setOriginal(false);
                }}
              >
                {(
                  stats?.team ?? [
                    {
                      employee: {
                        membershipId: operations.viewer.membershipId,
                        displayName:
                          operations.roster.find(
                            (m) =>
                              m.membershipId === operations.viewer.membershipId,
                          )?.displayName ?? c.employee,
                      },
                    },
                  ]
                ).map((t) => (
                  <option
                    key={t.employee.membershipId}
                    value={t.employee.membershipId}
                  >
                    {t.employee.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="wf-secondary"
            disabled={busy}
            onClick={() => void reload()}
          >
            {c.refresh}
          </button>
          {policies?.canConfigure && (
            <button
              className="wf-secondary"
              onClick={() => setPolicyDialog(true)}
            >
              {c.configure}
            </button>
          )}
        </div>
      </header>
      {loading && <p role="status">{c.loading}</p>}
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {uncertain && pending.current && !closeDialog && (
        <button
          disabled={busy}
          onClick={() =>
            void doClose(
              pending.current!.body,
              pending.current!.month,
              pending.current!.member,
            )
          }
        >
          {c.retry}
        </button>
      )}
      {data && a && (
        <>
          <div className="wf3-statement">
            <div className="wf3-statement-title">
              <h3>
                {original && data.closing
                  ? data.closing.identity.displayName
                  : data.employee.displayName}
              </h3>
              <span className="wf3-status">
                {data.closing ? c.closed : c.draft} · V
                {data.closing?.version ?? 0}
                {!data.employee.active ? " · " + c.inactive : ""}
              </span>
            </div>
            {!data.closing && (
              <p className="wf2-warning" data-testid="wf3-provisional-note">
                {c.provisionalNote}
              </p>
            )}
            {data.closing && (
              <p data-testid="wf3-close-version">
                {c.originalClose} · V{data.closing.version}
                {!original && data.adjustments.length > 0
                  ? " · " +
                    c.latestCompensation +
                    " · V" +
                    data.adjustments.at(-1)!.version
                  : ""}
              </p>
            )}
            <dl className="wf3-metrics">
              {(
                [
                  ["plannedMs", c.planned],
                  ["actualMs", data.closing ? c.actual : c.recordedToDate],
                  ["approvedMs", c.approved],
                  ["creditedMs", c.credited],
                  ["targetMs", c.target],
                  ["carryMs", c.carry],
                  [
                    "balanceMs",
                    data.closing ? c.confirmedBalance : c.provisionalBalance,
                  ],
                  ["overtimeMs", c.overtime],
                ] as const
              ).map(([key, label]) => (
                <div key={key} data-testid={"wf3-" + key}>
                  <dt>{label}</dt>
                  <dd>{monthHours(a.totals[key], c)}</dd>
                </div>
              ))}
            </dl>
            <div className="wf3-detail-line">
              <span>
                {c.paidBreak}: {monthHours(a.totals.actualPaidBreakMs, c)}
              </span>
              <span>
                {c.unpaidBreak}: {monthHours(a.totals.actualUnpaidBreakMs, c)}
              </span>
              <span>
                {c.pending}: {a.unapprovedAttendanceIds.length} /{" "}
                {a.pendingRequestIds.length}
              </span>
              {leave && (
                <span>
                  {c.leaveBalance}:{" "}
                  {leave.remainingMinutes === null
                    ? c.notConfigured
                    : monthHours(leave.remainingMinutes * 60000, c)}
                </span>
              )}
            </div>
            {a.warnings.length > 0 && (
              <p className="wf2-warning">
                {a.warnings.includes("HOLIDAY_LEAVE_DEBIT_REQUIRES_REVIEW")
                  ? c.calendarReview
                  : c.sourceConfig}
              </p>
            )}
            <div className="wf3-actions">
              {data.closing && (
                <label className="wf2-check">
                  <input
                    type="checkbox"
                    checked={original}
                    onChange={(e) => setOriginal(e.target.checked)}
                  />
                  {c.original}
                </label>
              )}
              <button
                className="wf-secondary"
                disabled={busy}
                onClick={() => void download("csv")}
              >
                {c.csv}
              </button>
              <button
                className="wf-secondary"
                disabled={busy}
                onClick={() => void download("pdf")}
              >
                {c.pdf}
              </button>
              <button className="wf-secondary" onClick={() => setPrint(true)}>
                {c.printable}
              </button>
              {operations.viewer.canManage && (
                <button
                  disabled={!data.canClose || busy || uncertain}
                  onClick={() => setCloseDialog(true)}
                >
                  {c.closeMonth}
                </button>
              )}
            </div>
          </div>
          {data.adjustments.length > 0 && (
            <section className="wf3-adjustments">
              <h3>{c.adjustments}</h3>
              {data.adjustments.map((adjustment) => (
                <article key={adjustment.id}>
                  <strong>
                    V{adjustment.version} · {adjustment.createdAt.slice(0, 10)}
                  </strong>
                  <p>
                    {c.approved}:{" "}
                    {monthHours(adjustment.delta.approvedMs ?? 0, c)} ·{" "}
                    {c.credited}:{" "}
                    {monthHours(adjustment.delta.creditedMs ?? 0, c)} ·{" "}
                    {c.balance}:{" "}
                    {monthHours(adjustment.delta.balanceMs ?? 0, c)}
                  </p>
                  <details>
                    <summary>{c.audit}</summary>
                    <p className="wf3-reference">
                      {adjustment.auditEventId} · {adjustment.actorUserId} ·{" "}
                      {adjustment.sourceHash}
                    </p>
                  </details>
                </article>
              ))}
            </section>
          )}
          {a.absences.length > 0 && (
            <section className="wf3-absences">
              <h3>{c.absences}</h3>
              {a.absences.map((absence, i) => (
                <article key={i}>
                  <strong>
                    {absence.date} ·{" "}
                    {
                      workforceAbsenceLabels(
                        absence.category,
                        absence.status,
                        locale,
                      ).category
                    }
                  </strong>
                  <p>
                    {
                      workforceAbsenceLabels(
                        absence.category,
                        absence.status,
                        locale,
                      ).status
                    }{" "}
                    · {absence.chargedMinutes} min · {c.credited}:{" "}
                    {monthHours(absence.creditedMs, c)}
                  </p>
                  <details>
                    <summary>{c.sources}</summary>
                    <p className="wf3-reference">
                      {absence.requestId} · {absence.decisionId} ·{" "}
                      {absence.contractRevisionId} · {absence.policyRevisionId}
                    </p>
                  </details>
                </article>
              ))}
            </section>
          )}
          <details className="wf3-sources">
            <summary>
              {c.sources} · {a.entries.length}
            </summary>
            <p className="wf3-reference">{data.fingerprint}</p>
            <div className="wf3-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{c.date}</th>
                    <th>{c.category}</th>
                    <th>{c.minutes}</th>
                    <th>{c.sources}</th>
                  </tr>
                </thead>
                <tbody>
                  {a.entries.map((e, i) => (
                    <tr key={i}>
                      <td>{e.date}</td>
                      <td>
                        {
                          {
                            PLANNED: c.planned,
                            ACTUAL: c.actual,
                            APPROVED: c.approved,
                            CREDITED: c.credited,
                            TARGET: c.target,
                          }[e.category]
                        }
                      </td>
                      <td>
                        {e.minutes.toLocaleString(locale, {
                          maximumFractionDigits: 3,
                        })}
                      </td>
                      <td className="wf3-reference">
                        {e.sourceId}
                        <br />
                        {e.contractRevisionId} · {e.policyRevisionId} ·{" "}
                        {e.accountPolicyRevisionId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {stats && (
        <>
          <section className="wf3-team">
            <h3>{c.team}</h3>
            <div className="wf3-team-grid">
              {stats.team.map((t) => (
                <button
                  className="wf3-team-card"
                  key={t.employee.membershipId}
                  onClick={() => {
                    setMember(t.employee.membershipId);
                    setOriginal(false);
                  }}
                  aria-pressed={member === t.employee.membershipId}
                  disabled={busy || uncertain}
                >
                  <strong>{t.employee.displayName}</strong>
                  <span>
                    {c.planned} {monthHours(t.totals.plannedMs, c)} · {c.actual}{" "}
                    {monthHours(t.totals.actualMs, c)}
                  </span>
                  <span>
                    {c.approved} {monthHours(t.totals.approvedMs, c)} ·{" "}
                    {c.credited} {monthHours(t.totals.creditedMs, c)}
                  </span>
                  <span>
                    {c.deviation}: {monthHours(t.deviationMs, c)} · {c.overtime}
                    : {monthHours(t.totals.overtimeMs, c)}
                  </span>
                  <span>
                    {c.balance}: {monthHours(t.totals.balanceMs, c)}
                  </span>
                  <span>
                    {c.pending}: {t.pendingApprovals} / {t.pendingRequests} ·{" "}
                    {t.closed ? c.closed : c.draft}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <div className="wf3-insights">
            <section>
              <h3>{c.coverage}</h3>
              {stats.stations.map((s) => (
                <article key={s.station}>
                  <strong>{s.station}</strong>
                  <p>
                    {s.assignedShifts} / {s.publishedShifts} ·{" "}
                    {monthHours(s.assignedPresenceMs, c)} /{" "}
                    {monthHours(s.publishedPresenceMs, c)}
                  </p>
                  <progress
                    value={s.coverageFraction ?? 0}
                    max={1}
                    aria-label={c.coverage + " · " + s.station}
                  />
                </article>
              ))}
            </section>
            <section>
              <h3>{c.trends}</h3>
              {stats.trends.map((t) => (
                <article key={t.month}>
                  <strong>{t.month}</strong>
                  <p>
                    {c.actual}: {monthHours(t.actualMs, c)} · {c.approved}:{" "}
                    {monthHours(t.approvedMs, c)}
                  </p>
                  <meter
                    min={0}
                    max={Math.max(
                      1,
                      ...stats.trends.map((t) => t.actualMs),
                      ...stats.trends.map((t) => t.approvedMs),
                    )}
                    value={t.approvedMs}
                    aria-label={c.approved + " · " + t.month}
                  />
                </article>
              ))}
            </section>
          </div>
          {stats.laborToSales && <p>{c.unavailableCost}</p>}
        </>
      )}
      {closeDialog && data && (
        <PilotDialog
          title={c.closeMonth}
          closeLabel={c.closeDialog}
          onClose={() => setCloseDialog(false)}
          className="wf-dialog"
        >
          <form className="wf-form" onSubmit={close}>
            <p className="wf-wide">
              {data.employee.displayName} · {month} · {c.balance}:{" "}
              {monthHours(data.account.totals.balanceMs, c)}
            </p>
            <label className="wf-wide">
              {c.reason}
              <input
                name="reason"
                minLength={3}
                maxLength={300}
                required
                disabled={uncertain}
              />
            </label>
            <label className="wf-wide wf2-check">
              <input
                name="confirm"
                type="checkbox"
                required
                disabled={uncertain}
              />
              {c.confirm}
            </label>
            {error && (
              <p className="wf-wide" role="alert">
                {error}
              </p>
            )}
            {uncertain && pending.current && (
              <button
                type="button"
                className="wf-wide"
                disabled={busy}
                onClick={() =>
                  void doClose(
                    pending.current!.body,
                    pending.current!.month,
                    pending.current!.member,
                  )
                }
              >
                {c.retry}
              </button>
            )}
            <button className="wf-wide" disabled={busy || uncertain}>
              {c.closeMonth}
            </button>
          </form>
        </PilotDialog>
      )}
      {policyDialog && policies && (
        <AccountPolicyDialog
          prefix={prefix}
          policies={policies}
          operations={operations}
          month={month}
          c={c}
          onClose={() => setPolicyDialog(false)}
          onSaved={reload}
        />
      )}
      {print && data && (
        <MonthReport
          data={data}
          c={c}
          original={original}
          onClose={() => setPrint(false)}
        />
      )}
      <p className="wf3-note">{c.note}</p>
    </section>
  );
}

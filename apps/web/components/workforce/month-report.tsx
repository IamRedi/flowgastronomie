"use client";
import { createPortal } from "react-dom";
import {
  workforceFormatHours,
  workforceAbsenceLabels,
} from "@flowgastronomie/domain";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import type { MonthData } from "./month-types";
import type { MonthCopy } from "./month-copy";
export const monthHours = (milliseconds: number | null, c: MonthCopy) =>
  workforceFormatHours(milliseconds, c.languageCode, c.notConfigured);
export function MonthReport({
  data,
  c,
  original,
  onClose,
}: {
  data: MonthData;
  c: MonthCopy;
  original: boolean;
  onClose: () => void;
}) {
  const a = original && data.closing ? data.closing.original : data.account,
    name =
      original && data.closing
        ? data.closing.identity.displayName
        : data.employee.displayName;
  return createPortal(
    <div className="wf3-print-host">
      <PilotDialog
        title={c.printable}
        closeLabel={c.closeDialog}
        onClose={onClose}
        className="wf3-report-dialog"
      >
        <div className="wf3-print-actions">
          <button onClick={() => window.print()}>{c.print}</button>
        </div>
        <article className="wf3-print-report" data-testid="wf3-print-report">
          <p className="wf-eyebrow">FlowGastronomie · {data.venueName}</p>
          <h1>{c.title}</h1>
          <h2>
            {name} · {a.month}
          </h2>
          <p>
            {data.closing ? c.closed : c.draft} · {c.version}{" "}
            {data.closing?.version ?? 0} · {c.adjustments}{" "}
            {original ? 0 : data.adjustments.length}
          </p>
          {!data.closing && <p>{c.provisionalNote}</p>}
          {data.closing && (
            <p>
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
                ["actualPaidBreakMs", c.paidBreak],
                ["actualUnpaidBreakMs", c.unpaidBreak],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{monthHours(a.totals[key], c)}</dd>
              </div>
            ))}
          </dl>
          <p className="wf3-reference">
            {data.employee.userId} · {data.employee.membershipId} · {a.timezone}
          </p>
          <p className="wf3-reference">
            {original && data.closing
              ? data.closing.sourceHash
              : data.fingerprint}
          </p>
          <h3>{c.sources}</h3>
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
                    {e.minutes.toLocaleString(c.languageCode, {
                      maximumFractionDigits: 3,
                    })}
                  </td>
                  <td className="wf3-reference">
                    {e.sourceId}
                    <br />
                    {e.contractRevisionId} · {e.policyRevisionId} ·{" "}
                    {e.accountPolicyRevisionId}
                    <br />
                    {e.sourceEventIds?.join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.absences.length > 0 && (
            <section>
              <h3>{c.absences}</h3>
              {a.absences.map((absence, i) => (
                <p className="wf3-reference" key={i}>
                  {absence.date} ·{" "}
                  {
                    workforceAbsenceLabels(
                      absence.category,
                      absence.status,
                      c.languageCode,
                    ).category
                  }{" "}
                  ·{" "}
                  {
                    workforceAbsenceLabels(
                      absence.category,
                      absence.status,
                      c.languageCode,
                    ).status
                  }{" "}
                  · {absence.chargedMinutes} min · {absence.requestId} ·{" "}
                  {absence.decisionId}
                </p>
              ))}
            </section>
          )}
          {!original && data.adjustments.length > 0 && (
            <section>
              <h3>{c.adjustments}</h3>
              {data.adjustments.map((a) => (
                <p className="wf3-reference" key={a.id}>
                  V{a.version} · {a.createdAt} · {a.id} · {a.auditEventId} ·{" "}
                  {JSON.stringify(a.delta)}
                </p>
              ))}
            </section>
          )}
          <p>{c.note}</p>
        </article>
      </PilotDialog>
    </div>,
    document.body,
  );
}

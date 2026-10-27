import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  workforceCsvCell,
  workforceMonthlyCopy,
  workforceFormatHours,
  workforceAbsenceLabels,
  type PlatformLocale,
  type WorkforceMonthlyAccount,
} from "@flowgastronomie/domain";
import type { createWorkforceAccountRepository } from "@flowgastronomie/database";
export type WorkforceMonthlyReport = Awaited<
  ReturnType<ReturnType<typeof createWorkforceAccountRepository>["account"]>
>;
const require = createRequire(import.meta.url);
const metricKeys = [
  "plannedMs",
  "actualMs",
  "approvedMs",
  "creditedMs",
  "targetMs",
  "carryMs",
  "balanceMs",
  "overtimeMs",
  "actualPaidBreakMs",
  "actualUnpaidBreakMs",
  "approvedPaidBreakMs",
  "approvedUnpaidBreakMs",
] as const;
export function workforceMonthlyCsv(
  report: WorkforceMonthlyReport,
  lang: PlatformLocale,
  original = false,
) {
  const c = workforceMonthlyCopy[lang],
    account = (original ? report.closing?.original : report.account) as
      WorkforceMonthlyAccount | undefined;
  if (!account) throw new Error("Original statement unavailable.");
  const lines: (string | number | null)[][] = [
    ["FlowGastronomie", c.title],
    [c.month, account.month],
    [
      c.employee,
      original
        ? report.closing!.identity.displayName
        : report.employee.displayName,
    ],
    [
      "Employee reference",
      original
        ? report.closing!.identity.employeeRef
        : report.employee.employeeRef,
    ],
    ["Tenant", report.tenantId],
    ["Venue", report.venueId],
    [c.status, report.closing ? "CLOSED" : "OPEN"],
    ["Statement meaning", report.closing ? c.confirmedBalance : c.draft],
    [
      "Balance meaning",
      report.closing ? c.confirmedBalance : c.provisionalNote,
    ],
    ["Target meaning", c.target],
    ["Actual meaning", report.closing ? c.actual : c.recordedToDate],
    [c.version, report.closing?.version ?? 0],
    [
      "Adjustment version",
      original ? 0 : (report.adjustments.at(-1)?.version ?? 0),
    ],
    [
      "Source fingerprint",
      original ? report.closing!.sourceHash : report.fingerprint,
    ],
    [c.audit, report.closing?.auditEventId ?? ""],
    [],
    ["Metric", "milliseconds", "minutes"],
  ];
  for (const key of metricKeys)
    lines.push([
      key,
      account.totals[key],
      account.totals[key] === null ? null : account.totals[key]! / 60000,
    ]);
  lines.push(
    [],
    [
      "Category",
      "Date",
      "milliseconds",
      "minutes",
      "Source kind",
      "Source ID",
      "Contract revision",
      "Operational policy revision",
      "Account policy revision",
      "Attendance ID",
      "Approval ID",
      "Leave decision ID",
      "Publication revision",
      "Schedule revision",
      "Source events",
      "Actor",
      "Occurred at",
      "Station",
      "Detail",
    ],
  );
  for (const e of account.entries)
    lines.push([
      e.category,
      e.date,
      e.milliseconds,
      e.minutes,
      e.sourceKind,
      e.sourceId,
      e.contractRevisionId,
      e.policyRevisionId,
      e.accountPolicyRevisionId,
      e.attendanceId ?? "",
      e.approvalId ?? "",
      e.leaveDecisionId ?? "",
      e.publishedAssignmentRevisionId ?? "",
      e.scheduleRevisionId ?? "",
      e.sourceEventIds?.join("|") ?? "",
      e.actorUserId,
      e.occurredAt,
      e.station ?? "",
      e.detail,
    ]);
  for (const absence of account.absences)
    lines.push([
      "ABSENCE",
      absence.date,
      absence.category,
      absence.status,
      absence.chargedMinutes,
      absence.creditedMs,
      absence.requestId,
      absence.decisionId,
      absence.contractRevisionId,
      absence.policyRevisionId,
      absence.actorUserId,
      absence.occurredAt,
    ]);
  if (!original)
    for (const adjustment of report.adjustments)
      lines.push([
        "ADJUSTMENT",
        adjustment.createdAt,
        adjustment.id,
        adjustment.version,
        adjustment.actorUserId,
        adjustment.auditEventId,
        JSON.stringify(adjustment.delta),
      ]);
  lines.push([], [c.note]);
  return (
    "\ufeff" +
    lines.map((row) => row.map(workforceCsvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}
export async function workforceMonthlyPdf(
  report: WorkforceMonthlyReport,
  lang: PlatformLocale,
  original = false,
): Promise<Buffer> {
  const c = workforceMonthlyCopy[lang],
    a = (original ? report.closing?.original : report.account) as
      WorkforceMonthlyAccount | undefined;
  if (!a) throw new Error("Original statement unavailable.");
  const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      bufferPages: true,
      info: {
        Title: c.title,
        Author: "FlowGastronomie",
        Subject: "Canonical working-time statement",
      },
    }),
    chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  // Reuse the Creative Studio PDFKit/font infrastructure and existing licensed
  // Noto Sans assets; no second rendering service or external document provider.
  const regular = await readFile(
      require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"),
    ),
    bold = await readFile(
      require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff"),
    );
  doc.registerFont("Workforce", regular);
  doc.registerFont("WorkforceBold", bold);
  const width = doc.page.width - 84;
  const header = () => {
    doc
      .font("WorkforceBold")
      .fontSize(10)
      .fillColor("#0f766e")
      .text("FlowGastronomie", 42, 30);
    doc.y = 58;
  };
  header();
  const ensure = (height: number) => {
    if (doc.y + height > doc.page.height - 64) {
      doc.addPage();
      header();
    }
  };
  const text = (value: string, size = 9, strong = false, color = "#334155") => {
    doc.font(strong ? "WorkforceBold" : "Workforce").fontSize(size);
    const height = doc.heightOfString(value, { width });
    ensure(height + 7);
    doc.fillColor(color).text(value, 42, doc.y, { width });
    doc.moveDown(0.4);
  };
  const hours = (ms: number | null) =>
    workforceFormatHours(ms, lang, c.notConfigured);
  text(c.title, 18, true, "#0f172a");
  text(
    c.month +
      ": " +
      a.month +
      " · " +
      (original ? report.closing!.identity.venueName : report.venueName),
    11,
    true,
  );
  text(
    c.employee +
      ": " +
      (original
        ? report.closing!.identity.displayName
        : report.employee.displayName),
    11,
  );
  text(
    "User: " +
      report.employee.userId +
      " · Membership: " +
      report.employee.membershipId,
    7,
  );
  text(
    c.status +
      ": " +
      (report.closing ? c.closed : c.draft) +
      " · " +
      c.version +
      ": " +
      (report.closing?.version ?? 0) +
      " · " +
      c.adjustments +
      ": " +
      (original ? 0 : report.adjustments.length),
    9,
    true,
  );
  if (!report.closing) text(c.provisionalNote, 9, false);
  else
    text(
      c.originalClose +
        " · V" +
        report.closing.version +
        (!original && report.adjustments.length
          ? " · " +
            c.latestCompensation +
            " · V" +
            report.adjustments.at(-1)!.version
          : ""),
      9,
    );
  text(
    c.country +
      ": " +
      [
        ...new Set(
          a.targetDays.flatMap((d) => (d.countryCode ? [d.countryCode] : [])),
        ),
      ].join(" / "),
    9,
  );
  for (const [key, label] of [
    ["plannedMs", c.planned],
    ["actualMs", report.closing ? c.actual : c.recordedToDate],
    ["approvedMs", c.approved],
    ["creditedMs", c.credited],
    ["targetMs", c.target],
    ["carryMs", c.carry],
    ["balanceMs", report.closing ? c.confirmedBalance : c.provisionalBalance],
    ["overtimeMs", c.overtime],
    ["actualPaidBreakMs", c.paidBreak],
    ["actualUnpaidBreakMs", c.unpaidBreak],
  ] as const)
    text(label + ": " + hours(a.totals[key]), 10, key === "balanceMs");
  text("Timezone: " + a.timezone, 8);
  text(
    "Source fingerprint: " +
      (original ? report.closing!.sourceHash : report.fingerprint),
    7,
  );
  if (report.closing) {
    text(c.audit + ": " + report.closing.auditEventId, 7);
    text(
      "Closed: " +
        report.closing.closedAt +
        " · Actor: " +
        report.closing.actorUserId,
      7,
    );
  }
  text(c.sources, 13, true, "#0f172a");
  for (const entry of a.entries) {
    const refs = [
      entry.contractRevisionId ? "Contract " + entry.contractRevisionId : "",
      entry.policyRevisionId ? "Policy " + entry.policyRevisionId : "",
      entry.accountPolicyRevisionId
        ? "Account policy " + entry.accountPolicyRevisionId
        : "",
      entry.scheduleRevisionId ? "Schedule " + entry.scheduleRevisionId : "",
      entry.publishedAssignmentRevisionId
        ? "Publication " + entry.publishedAssignmentRevisionId
        : "",
      entry.leaveDecisionId ? "Leave decision " + entry.leaveDecisionId : "",
      entry.sourceEventIds?.length
        ? "Events " + entry.sourceEventIds.join(", ")
        : "",
      entry.actorUserId ? "Actor " + entry.actorUserId : "",
      entry.occurredAt ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    ensure(60);
    text(
      entry.date + " · " + entry.category + " · " + hours(entry.milliseconds),
      9,
      true,
    );
    text(entry.sourceKind + " · " + entry.sourceId, 7);
    if (refs) text(refs, 6.5);
    doc.moveDown(0.5);
  }
  if (a.absences.length) {
    text(c.absences, 13, true);
    for (const absence of a.absences) {
      text(
        absence.date +
          " · " +
          workforceAbsenceLabels(absence.category, absence.status, lang)
            .category +
          " · " +
          workforceAbsenceLabels(absence.category, absence.status, lang)
            .status +
          " · " +
          absence.chargedMinutes +
          " min",
        8,
        true,
      );
      text(
        absence.requestId +
          " · " +
          absence.decisionId +
          " · " +
          absence.contractRevisionId +
          " · " +
          absence.policyRevisionId,
        7,
      );
    }
  }
  if (!original && report.adjustments.length) {
    text(c.adjustments, 13, true);
    for (const adjustment of report.adjustments) {
      text(
        "V" +
          adjustment.version +
          " · " +
          adjustment.createdAt +
          " · " +
          adjustment.id,
        8,
        true,
      );
      text(JSON.stringify(adjustment.delta), 7);
      text(
        c.audit +
          ": " +
          adjustment.auditEventId +
          " · Actor: " +
          adjustment.actorUserId,
        7,
      );
    }
  }
  text(c.note, 8, false, "#64748b");
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font("Workforce")
      .fontSize(7)
      .fillColor("#64748b")
      .text(
        a.month + " · " + (i + 1) + " / " + pages.count,
        42,
        doc.page.height - 28,
        { width, align: "right", lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return result;
}

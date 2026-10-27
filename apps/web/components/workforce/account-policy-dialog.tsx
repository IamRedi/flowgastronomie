"use client";
import { useState, type FormEvent } from "react";
import type { WorkforceAccountRules } from "@flowgastronomie/domain";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import type { AccountPolicies } from "./month-types";
import type { OperationsData } from "./operation-types";
import type { MonthCopy } from "./month-copy";
export function AccountPolicyDialog({
  prefix,
  policies,
  operations,
  month,
  c,
  onClose,
  onSaved,
}: {
  prefix: string;
  policies: AccountPolicies;
  operations: OperationsData;
  month: string;
  c: MonthCopy;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [country, setCountry] = useState(
      operations.venue.countryCode === "AL" ? "AL" : "DE",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const last = policies.versions
    .filter((p) => p.countryCode === country)
    .sort((a, b) => b.version - a.version)[0];
  const defaults = last?.rules;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const optionalNumber = (name: string) =>
      String(f.get(name)).trim() ? Number(f.get(name)) : null;
    const rules: WorkforceAccountRules = {
      timezone: operations.venue.timezone,
      workingWeekdays: String(f.get("weekdays"))
        .split(",")
        .map((x) => Number(x.trim())),
      targetBasis: String(
        f.get("basis"),
      ) as WorkforceAccountRules["targetBasis"],
      plannedBreakTreatment: String(
        f.get("breaks"),
      ) as WorkforceAccountRules["plannedBreakTreatment"],
      plannedBreakAllocation: "PROPORTIONAL",
      paidLeaveCategories: f
        .getAll("paidCategories")
        .map(String) as WorkforceAccountRules["paidLeaveCategories"],
      holidays: String(f.get("holidays"))
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((date) => ({ date, label: date })),
      creditOverlapRule: String(
        f.get("overlap"),
      ) as WorkforceAccountRules["creditOverlapRule"],
      overtimeBasis: String(
        f.get("overtime"),
      ) as WorkforceAccountRules["overtimeBasis"],
      carryoverMode: f.get("carry") === "on" ? "BALANCE" : "NONE",
      carryPositiveLimitMinutes: optionalNumber("positive"),
      carryNegativeLimitMinutes: optionalNumber("negative"),
      openingMonth: String(f.get("openingMonth")) || null,
      openingBalanceMinutes: Number(f.get("openingBalance")),
      retentionYears: Number(f.get("retention")),
      legalReviewConfirmed: true,
    };
    try {
      const r = await fetch(prefix + "account-policies", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: last?.version ?? 0,
          effectiveFrom: String(f.get("effective")),
          countryCode: country,
          rules,
          reason: String(f.get("reason")),
          reviewConfirmed: f.get("confirm") === "on",
        }),
      });
      if (!r.ok) {
        const b = await r.json();
        throw new Error(
          b.detail === "HOLIDAY_CALENDAR"
            ? c.calendarReview
            : b.code === "CONFLICT"
              ? c.conflict
              : c.error,
        );
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : c.error);
    } finally {
      setBusy(false);
    }
  }
  const categories = ["ANNUAL", "PERSONAL", "SICKNESS", "OTHER"];
  return (
    <PilotDialog
      title={c.policy}
      closeLabel={c.closeDialog}
      onClose={onClose}
      className="wf-dialog"
    >
      <p>{c.policyHelp}</p>
      <form
        className="wf-form"
        onSubmit={submit}
        key={country + ":" + (last?.version ?? 0)}
      >
        <label>
          {c.country}
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="DE">DE</option>
            <option value="AL">AL</option>
          </select>
        </label>
        <label>
          {c.effective}
          <input
            name="effective"
            type="date"
            required
            defaultValue={last ? operations.today : month + "-01"}
          />
        </label>
        <label>
          {c.weekdays}
          <input
            name="weekdays"
            required
            defaultValue={defaults?.workingWeekdays.join(",") ?? "1,2,3,4,5"}
          />
        </label>
        <label>
          {c.basis}
          <select
            name="basis"
            defaultValue={defaults?.targetBasis ?? "WEEKLY_WORKDAYS"}
          >
            <option value="WEEKLY_WORKDAYS">{c.weeklyBasis}</option>
            <option value="MONTHLY_WORKDAYS">{c.monthlyBasis}</option>
          </select>
        </label>
        <label>
          {c.breaks}
          <select
            name="breaks"
            defaultValue={defaults?.plannedBreakTreatment ?? "UNPAID"}
          >
            <option value="UNPAID">{c.unpaidBreak}</option>
            <option value="PAID">{c.paidBreak}</option>
          </select>
        </label>
        <label>
          {c.overtimeMode}
          <select
            name="overtime"
            defaultValue={defaults?.overtimeBasis ?? "DISABLED"}
          >
            <option value="DISABLED">{c.off}</option>
            <option value="APPROVED_OVER_TARGET">
              {c.approved} / {c.target}
            </option>
            <option value="EARNED_OVER_TARGET">
              {c.approved} + {c.credited} / {c.target}
            </option>
          </select>
        </label>
        <label className="wf-wide">
          {c.overlapRule}
          <select
            name="overlap"
            defaultValue={defaults?.creditOverlapRule ?? "LIMIT_TO_TARGET"}
          >
            <option value="LIMIT_TO_TARGET">{c.limitCredit}</option>
            <option value="EXCLUDE_RECORDED_WORK">{c.excludeWorkCredit}</option>
          </select>
        </label>
        <fieldset className="wf-wide">
          <legend>{c.paidCategories}</legend>
          {categories.map((category) => (
            <label className="wf2-check" key={category}>
              <input
                type="checkbox"
                name="paidCategories"
                value={category}
                defaultChecked={
                  defaults?.paidLeaveCategories.includes(
                    category as WorkforceAccountRules["paidLeaveCategories"][number],
                  ) ?? false
                }
              />
              {
                {
                  ANNUAL: c.annual,
                  PERSONAL: c.personal,
                  SICKNESS: c.sickness,
                  OTHER: c.other,
                }[category as "ANNUAL" | "PERSONAL" | "SICKNESS" | "OTHER"]
              }
            </label>
          ))}
        </fieldset>
        <label className="wf-wide">
          {c.holidayDates}
          <textarea
            name="holidays"
            rows={3}
            defaultValue={
              defaults?.holidays.map((h) => h.date).join("\n") ??
              operations.rules.excludedLeaveDates.join("\n")
            }
          />
        </label>
        <label className="wf2-check">
          <input
            type="checkbox"
            name="carry"
            defaultChecked={defaults?.carryoverMode === "BALANCE"}
          />
          {c.carryMode}
        </label>
        <label>
          {c.openingMonth}
          <input
            name="openingMonth"
            type="month"
            defaultValue={defaults?.openingMonth ?? month}
          />
        </label>
        <label>
          {c.openingBalance}
          <input
            name="openingBalance"
            type="number"
            required
            defaultValue={defaults?.openingBalanceMinutes ?? 0}
          />
        </label>
        <label>
          {c.retention}
          <input
            name="retention"
            type="number"
            min={country === "DE" ? 2 : 1}
            max={30}
            required
            defaultValue={defaults?.retentionYears ?? 2}
          />
        </label>
        <label>
          {c.carryPositive}
          <input
            name="positive"
            type="number"
            min={0}
            defaultValue={defaults?.carryPositiveLimitMinutes ?? ""}
          />
        </label>
        <label>
          {c.carryNegative}
          <input
            name="negative"
            type="number"
            min={0}
            defaultValue={defaults?.carryNegativeLimitMinutes ?? ""}
          />
        </label>
        <label className="wf-wide">
          {c.reason}
          <input name="reason" minLength={3} maxLength={300} required />
        </label>
        <label className="wf2-check wf-wide">
          <input name="confirm" type="checkbox" required />
          {c.legalConfirm}
        </label>
        {error && (
          <p role="alert" className="wf-wide">
            {error}
          </p>
        )}
        <button disabled={busy} className="wf-wide">
          {c.configure}
        </button>
      </form>
    </PilotDialog>
  );
}

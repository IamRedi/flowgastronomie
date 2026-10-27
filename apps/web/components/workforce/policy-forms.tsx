"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { workforceDefaultRules } from "@flowgastronomie/domain";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import type { OperationsCopy } from "./operations-copy";
import type {
  OperationsData,
  OperationsCommand,
  LeaveBalance,
} from "./operation-types";
export function PolicyDialog({
  data,
  c,
  busy,
  error,
  command,
  onClose,
}: {
  data: OperationsData;
  c: OperationsCopy;
  busy: boolean;
  error: string;
  command: OperationsCommand;
  onClose: () => void;
}) {
  const [country, setCountry] = useState(
      data.venue.countryCode === "AL" ? "AL" : "DE",
    ),
    versions = data.policyVersions.filter((p) => p.countryCode === country),
    latest = versions.sort((a, b) => b.version - a.version)[0],
    rules = latest?.rules ?? workforceDefaultRules(country);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await command("policy", {
        expectedVersion: latest?.version ?? 0,
        effectiveFrom: String(f.get("effective")),
        countryCode: country,
        reason: String(f.get("reason")),
        rules: {
          minimumRestMinutes: Number(f.get("rest")),
          minimumBreakSegmentMinutes: Number(f.get("segment")),
          maximumContinuousMinutes: Number(f.get("continuous")),
          paidBreaksAllowed: f.get("paid") === "on",
          managerShiftApproval: true,
          legalReviewRequired: true,
          excludedLeaveDates: String(f.get("holidays"))
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          workingWeekdays: String(f.get("workdays")).split(",").map(Number),
          absenceCategories: String(f.get("categories"))
            .split(",")
            .map((x) => x.trim()),
          breakThresholds: String(f.get("thresholds"))
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const [afterMinutes, breakMinutes] = s.split(":").map(Number);
              return { afterMinutes, breakMinutes };
            }),
        },
      })
    )
      onClose();
  }
  return (
    <PilotDialog
      title={c.policy}
      closeLabel={c.close}
      onClose={onClose}
      className="wf-dialog"
    >
      <form className="wf-form" key={country} onSubmit={submit}>
        <label>
          {c.country}
          <select
            aria-label={c.country}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
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
            defaultValue={data.today}
          />
        </label>
        <label>
          {c.rest}
          <input
            name="rest"
            type="number"
            min="0"
            max="1440"
            required
            defaultValue={rules.minimumRestMinutes}
          />
        </label>
        <label>
          {c.minimumSegment}
          <input
            name="segment"
            type="number"
            min="0"
            max="120"
            required
            defaultValue={rules.minimumBreakSegmentMinutes}
          />
        </label>
        <label className="wf-wide">
          {c.continuous}
          <input
            name="continuous"
            type="number"
            min="0"
            max="1440"
            required
            defaultValue={rules.maximumContinuousMinutes}
          />
        </label>
        <label className="wf-wide">
          {c.thresholds}
          <input
            name="thresholds"
            defaultValue={rules.breakThresholds
              .map((t) => t.afterMinutes + ":" + t.breakMinutes)
              .join(", ")}
          />
        </label>
        <label className="wf-wide">
          {c.holidays}
          <input
            name="holidays"
            defaultValue={rules.excludedLeaveDates.join(", ")}
          />
        </label>
        <label className="wf-wide">
          {c.workdays}
          <input
            name="workdays"
            required
            defaultValue={rules.workingWeekdays.join(",")}
          />
        </label>
        <label className="wf-wide">
          {c.categories}
          <input
            name="categories"
            required
            defaultValue={rules.absenceCategories.join(",")}
          />
        </label>
        <label className="wf-wide wf2-check">
          <input
            name="paid"
            type="checkbox"
            defaultChecked={rules.paidBreaksAllowed}
          />
          {c.paidAllowed}
        </label>
        <label className="wf-wide">
          {c.reason}
          <input name="reason" minLength={3} maxLength={300} required />
        </label>
        <p className="wf-wide">{c.legalReview}</p>
        {error && (
          <p role="alert" className="wf-wide">
            {error}
          </p>
        )}
        <button className="wf-wide" disabled={busy}>
          {c.savePolicy}
        </button>
      </form>
    </PilotDialog>
  );
}
export function GrantDialog({
  data,
  c,
  busy,
  error,
  command,
  readBalance,
  onClose,
}: {
  data: OperationsData;
  c: OperationsCopy;
  busy: boolean;
  error: string;
  command: OperationsCommand;
  readBalance: (member: string, year: number) => Promise<LeaveBalance | null>;
  onClose: () => void;
}) {
  const key = useRef(crypto.randomUUID()),
    [member, setMember] = useState(data.viewer.membershipId),
    [year, setYear] = useState(data.balance.year),
    [balance, setBalance] = useState<LeaveBalance | null>(null);
  useEffect(() => {
    let current = true;
    setBalance(null);
    void readBalance(member, year).then((v) => {
      if (current) setBalance(v);
    });
    return () => {
      current = false;
    };
  }, [member, year, readBalance]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!balance) return;
    const f = new FormData(e.currentTarget);
    if (
      await command("leave-allowance", {
        membershipId: member,
        year,
        minutes: Number(f.get("minutes")),
        expectedVersion: balance.version,
        reason: String(f.get("reason")),
        idempotencyKey: key.current,
      })
    )
      onClose();
  }
  return (
    <PilotDialog
      title={c.grant}
      closeLabel={c.close}
      onClose={onClose}
      className="wf-dialog"
    >
      <form className="wf-form" onSubmit={submit}>
        <label>
          {c.coworker}
          <select
            aria-label={c.coworker}
            value={member}
            onChange={(e) => setMember(e.target.value)}
          >
            {data.roster.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          {c.year}
          <input
            type="number"
            min="2000"
            max="2200"
            required
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <p className="wf-wide">
          {balance
            ? balance.configured
              ? c.remaining + ": " + balance.remainingMinutes + " " + c.minutes
              : c.notConfigured
            : c.loading}
        </p>
        <label>
          {c.minutes}
          <input
            name="minutes"
            type="number"
            min="-527040"
            max="527040"
            required
          />
        </label>
        <label>
          {c.reason}
          <input name="reason" minLength={3} maxLength={300} required />
        </label>
        {balance && (
          <details className="wf-wide">
            <summary>{c.history}</summary>
            {balance.history.map((h) => (
              <p key={h.id}>
                {h.createdAt.slice(0, 10)} · {h.minutes} {c.minutes} ·{" "}
                {h.reason}
              </p>
            ))}
          </details>
        )}
        {error && (
          <p role="alert" className="wf-wide">
            {error}
          </p>
        )}
        <button className="wf-wide" disabled={busy || !balance}>
          {c.grant}
        </button>
      </form>
    </PilotDialog>
  );
}

"use client";
import type { CSSProperties } from "react";
import type { WorkforceInstantAssignment } from "@flowgastronomie/domain";
import {
  workforceWeek,
  workforceAddDays,
  workforceDayRange,
  workforcePlannedMinutes,
  workforceMonthDays,
} from "@flowgastronomie/domain";
import type { Locale } from "../../lib/i18n";
import type { WorkforceCopy } from "./copy";
import { stationLabel, roleLabel, workforceDateLabel } from "./copy";
import type { Workspace } from "./types";
import { ShiftCard } from "./shift-card";
export function CalendarViews({
  data,
  date,
  view,
  station,
  position,
  c,
  locale,
  busy,
  onEdit,
  onMove,
  onResize,
  onAdd,
  onProfile,
  onDate,
}: {
  data: Workspace;
  date: string;
  view: "week" | "day" | "month";
  station: string;
  position: string;
  c: WorkforceCopy;
  locale: Locale;
  busy: boolean;
  onEdit: (a: WorkforceInstantAssignment) => void;
  onMove: (
    a: WorkforceInstantAssignment,
    day: string,
    member: string | null,
    copy: boolean,
  ) => Promise<void>;
  onResize: (a: WorkforceInstantAssignment, minutes: number) => Promise<void>;
  onAdd: (day: string, member: string | null) => void;
  onProfile: (id: string) => void;
  onDate: (date: string) => void;
}) {
  const all = data.schedules
    .flatMap((s) => s.snapshot.assignments)
    .filter(
      (a) =>
        (!station || a.station === station) &&
        (!position ||
          data.profiles.find((p) => p.membershipId === a.membershipId)
            ?.jobTitle === position),
    );
  const week = workforceWeek(date),
    days = Array.from({ length: 7 }, (_, i) => workforceAddDays(week, i)),
    month = workforceMonthDays(date),
    manager = data.viewer.canManage;
  const label = (d: string) => workforceDateLabel(c, d);
  const time = (d: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: data.venue.timezone,
      timeZoneName: "shortOffset",
    }).format(new Date(d));
  const card = (a: WorkforceInstantAssignment, small = false) => (
    <ShiftCard
      key={a.id}
      a={a}
      c={c}
      editable={manager}
      busy={busy}
      small={small}
      onEdit={onEdit}
      onMove={onMove}
      onResize={onResize}
    />
  );
  if (view === "week")
    return (
      <section className="wf-week-scroll" aria-label={c.week}>
        <div className="wf-week-grid" role="table">
          <div className="wf-week-row" role="row">
            <div className="wf-member-label wf-heading" role="columnheader">
              {c.staff}
            </div>
            {days.map((d) => (
              <div className="wf-heading" role="columnheader" key={d}>
                <strong>{label(d)}</strong>
                {d === data.today && <small>{c.today}</small>}
              </div>
            ))}
          </div>
          {[
            ...data.profiles.filter(
              (p) => !position || p.jobTitle === position,
            ),
            ...(manager ? [null] : []),
          ].map((p) => (
            <div
              className="wf-week-row"
              role="row"
              key={p?.membershipId ?? "open"}
            >
              <div className="wf-member-label" role="rowheader">
                {p ? (
                  <button
                    className="wf-profile-link"
                    onClick={() => onProfile(p.membershipId)}
                  >
                    <span className="wf-avatar">
                      {p.displayName
                        .split(/\s+/)
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <strong>{p.displayName}</strong>
                    <small>
                      {p.jobTitle || roleLabel(c, p.role)}
                      {!p.active && " · " + c.ended}
                    </small>
                    <small>
                      {p.targetWeeklyMinutes !== null
                        ? p.targetWeeklyMinutes / 60 + " " + c.hours
                        : ""}
                    </small>
                  </button>
                ) : (
                  <strong>{c.open}</strong>
                )}
              </div>
              {days.map((d) => (
                <div
                  className="wf-week-cell"
                  role="cell"
                  key={d}
                  data-wf-drop-day={d}
                  data-wf-drop-member={p?.membershipId ?? ""}
                >
                  {all
                    .filter(
                      (a) =>
                        a.membershipId === (p?.membershipId ?? null) &&
                        a.startsLocal.slice(0, 10) === d,
                    )
                    .map((a) => card(a))}
                  {manager && (
                    <button
                      className="wf-cell-add"
                      aria-label={
                        c.add + ": " + (p?.displayName ?? c.open) + " " + d
                      }
                      onClick={() => onAdd(d, p?.membershipId ?? null)}
                    >
                      ＋
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    );
  if (view === "day") {
    const range = workforceDayRange(date, data.venue.timezone),
      items = all.filter(
        (a) =>
          Date.parse(a.startsAt) < range.end &&
          Date.parse(a.endsAt) > range.start,
      );
    return (
      <section className="wf-day" aria-label={c.day}>
        <div className="wf-day-axis">
          <span>{label(date)}</span>
          <div>
            {Array.from(
              { length: Math.floor((range.end - range.start) / 10800000) + 1 },
              (_, i) => (
                <small
                  key={i}
                  style={{
                    position: "absolute",
                    left:
                      ((i * 10800000) / (range.end - range.start)) * 100 + "%",
                    transform:
                      i === 0
                        ? "none"
                        : i * 10800000 === range.end - range.start
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                  }}
                >
                  {time(new Date(range.start + i * 10800000).toISOString())}
                </small>
              ),
            )}
          </div>
        </div>
        {data.venue.stations
          .filter((s) => !station || s === station)
          .map((s) => (
            <div className="wf-day-row" key={s}>
              <strong>{stationLabel(c, s)}</strong>
              <div
                className="wf-day-track"
                data-wf-drop-day={date}
                data-wf-drop-member=""
                style={
                  {
                    "--wf-day-hours": (range.end - range.start) / 3600000,
                    height: Math.max(
                      100,
                      items.filter((a) => a.station === s).length * 66 + 10,
                    ),
                  } as CSSProperties
                }
              >
                {items
                  .filter((a) => a.station === s)
                  .map((a, i) => (
                    <button
                      disabled={!manager}
                      key={a.id}
                      className="wf-day-shift"
                      style={{
                        top: 8 + i * 66,
                        left:
                          Math.max(
                            0,
                            (Date.parse(a.startsAt) - range.start) /
                              (range.end - range.start),
                          ) *
                            100 +
                          "%",
                        width:
                          ((Math.min(Date.parse(a.endsAt), range.end) -
                            Math.max(Date.parse(a.startsAt), range.start)) /
                            (range.end - range.start)) *
                            100 +
                          "%",
                      }}
                      title={
                        a.displayName +
                        " · " +
                        time(a.startsAt) +
                        " — " +
                        time(a.endsAt)
                      }
                      onClick={() => onEdit(a)}
                    >
                      <strong>{a.displayName || c.open}</strong>
                      <span>
                        {time(a.startsAt)} — {time(a.endsAt)}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
      </section>
    );
  }
  const items = all.filter(
    (a) =>
      a.startsLocal.slice(0, 10) >= month[0]! &&
      a.startsLocal.slice(0, 10) <= month[month.length - 1]!,
  );
  return (
    <section className="wf-month" aria-label={c.month}>
      <div className="wf-month-calendar">
        {month.map((d) => (
          <div
            className="wf-month-day"
            key={d}
            data-wf-drop-day={d}
            data-wf-drop-member=""
          >
            <button className="wf-month-date" onClick={() => onDate(d)}>
              {label(d)}
            </button>
            {all
              .filter((a) => a.startsLocal.slice(0, 10) === d)
              .map((a) => card(a, true))}
            {manager && (
              <button
                className="wf-cell-add"
                aria-label={c.add + ": " + d}
                onClick={() => onAdd(d, null)}
              >
                ＋
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="wf-month-list">
        {items.map((a) => (
          <article key={a.id}>
            <strong>{label(a.startsLocal.slice(0, 10))}</strong>
            {card(a, true)}
          </article>
        ))}
        {!items.length && <p>{c.empty}</p>}
      </div>
      <section className="wf-month-summary">
        <h2>{c.planned}</h2>
        {data.profiles.map((p) => (
          <article key={p.membershipId}>
            <span>{p.displayName}</span>
            <strong>
              {Math.round(
                (items
                  .filter((a) => a.membershipId === p.membershipId)
                  .reduce((n, a) => n + workforcePlannedMinutes(a), 0) /
                  60) *
                  100,
              ) / 100}{" "}
              {c.hours}
            </strong>
          </article>
        ))}
      </section>
    </section>
  );
}

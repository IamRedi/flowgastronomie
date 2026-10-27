"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  workforceWeek,
  workforceAddDays,
  workforceMonthDays,
  workforceMonthShift,
  workforceMove,
  workforceResize,
  workforceDateSchema,
  workforcePlannedMinutes,
  type WorkforceAssignment,
  type WorkforceInstantAssignment,
} from "@flowgastronomie/domain";
import type { Locale } from "../../lib/i18n";
import { PilotDialog } from "../../app/[lang]/staff/pilot-dialog";
import { workforceCopy, stationLabel, workforceDateLabel } from "./copy";
import { assignmentInput, type Workspace, type Profile } from "./types";
import { ShiftEditor } from "./shift-editor";
import { ProfileEditor } from "./profile-editor";
import { CalendarViews } from "./calendar-views";
import { WorkforceOperations } from "./operations";
import { AttendanceWorkspace } from "./attendance-workspace";
import "./workforce.css";
export function WorkforceWorkspace({ locale }: { locale: Locale }) {
  const c = workforceCopy[locale],
    api =
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
      "http://localhost:4000";
  const [date, setDate] = useState(""),
    [data, setData] = useState<Workspace | null>(null),
    [view, setView] = useState<"week" | "day" | "month">("week"),
    [density, setDensity] = useState("comfortable"),
    [station, setStation] = useState(""),
    [position, setPosition] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(""),
    [status, setStatus] = useState(""),
    [editor, setEditor] = useState<WorkforceAssignment | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [review, setReview] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [changes, setChanges] = useState<{ id: string; kind: string }[]>([]),
    [tool, setTool] = useState<"template" | "stations" | null>(null);
  const loadId = useRef(0),
    initialDate = useRef(false),
    initialView = useRef(false);
  const days = useMemo(() => (date ? workforceMonthDays(date) : []), [date]),
    from = days[0] ? workforceAddDays(workforceWeek(days[0]), -7) : "",
    to = days.length ? workforceAddDays(days[days.length - 1]!, 7) : "",
    week = date ? workforceWeek(date) : "";
  const request = useCallback(
    async (
      path: string,
      method = "GET",
      body: unknown = null,
    ): Promise<unknown | null> => {
      setError("");
      setErrorCode("");
      setBusy(true);
      try {
        const response = await fetch(api + path, {
          method,
          credentials: "include",
          cache: "no-store",
          ...(method !== "GET"
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        });
        if (response.status === 401) {
          window.location.assign("/" + locale + "/staff/login");
          return null;
        }
        const result = await response.json();
        if (!response.ok) {
          setErrorCode(result.code ?? "INVALID");
          setError(
            result.code === "CONFLICT"
              ? c.conflict
              : result.code === "TIME"
                ? c.startChoice + " / " + c.endChoice + ": " + c.reject
                : c.error,
          );
          return null;
        }
        return result;
      } catch {
        setError(c.error);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [api, locale, c],
  );
  const load = useCallback(async () => {
    if (!from || !to) return;
    const id = ++loadId.current;
    const result = (await request(
      "/v1/staff/workforce?from=" + from + "&to=" + to,
    )) as Workspace | null;
    if (!result || id !== loadId.current) return;
    setData(result);
    if (!initialDate.current) {
      initialDate.current = true;
      if (!new URL(window.location.href).searchParams.has("date"))
        setDate(result.today);
    }
    if (!initialView.current) {
      initialView.current = true;
      if (
        !result.viewer.canManage &&
        window.matchMedia("(max-width: 600px)").matches
      ) {
        setView("month");
        setDensity("compact");
      }
    }
  }, [from, to, request]);
  useEffect(() => {
    const raw = new URL(window.location.href).searchParams.get("date");
    setDate(
      raw && workforceDateSchema.safeParse(raw).success
        ? raw
        : new Date().toISOString().slice(0, 10),
    );
  }, []);
  useEffect(() => {
    void load();
    return () => {
      loadId.current++;
    };
  }, [load]);
  const selected = data?.schedules.find((s) => s.week === week),
    items = selected?.snapshot.assignments ?? [],
    all = data?.schedules.flatMap((s) => s.snapshot.assignments) ?? [],
    manager = data?.viewer.canManage ?? false;
  async function save(
    assignments: WorkforceAssignment[],
    publish = false,
    targetWeek = week,
  ) {
    setReview(false);
    setConfirmed(false);
    const result = (await request("/v1/staff/workforce/schedule", "PUT", {
      week: targetWeek,
      expectedVersion:
        data?.schedules.find((s) => s.week === targetWeek)?.version ?? 0,
      status: publish ? "PUBLISHED" : "DRAFT",
      reviewConfirmed: publish,
      assignments,
    })) as { changes: { id: string; kind: string }[] } | null;
    if (!result) return false;
    setChanges(result.changes);
    setStatus(publish ? c.publishedSuccess : c.success);
    await load();
    return true;
  }
  function fresh(
    day = date,
    member: string | null = null,
  ): WorkforceAssignment {
    return {
      id: crypto.randomUUID(),
      membershipId: member,
      station: data?.venue.stations[0] ?? "SERVICE",
      startsLocal: day + "T09:00",
      endsLocal: day + "T17:00",
      startChoice: "reject",
      endChoice: "reject",
      breakMinutes: 30,
      requiredSkills: [],
      note: "",
    };
  }
  function edit(a: WorkforceInstantAssignment) {
    setDate(a.startsLocal.slice(0, 10));
    setEditor(assignmentInput(a));
  }
  async function editSave(a: WorkforceAssignment) {
    const targetWeek = workforceWeek(a.startsLocal.slice(0, 10));
    const prior = all.find((x) => x.id === a.id),
      sourceWeek = prior
        ? workforceWeek(prior.startsLocal.slice(0, 10))
        : targetWeek;
    if (prior && sourceWeek !== targetWeek) {
      const target = (await request(
        "/v1/staff/workforce?from=" +
          targetWeek +
          "&to=" +
          workforceAddDays(targetWeek, 6),
      )) as Workspace | null;
      if (!target) return false;
      const result = await request("/v1/staff/workforce/move", "POST", {
        sourceWeek,
        sourceVersion:
          data?.schedules.find((s) => s.week === sourceWeek)?.version ?? 0,
        targetVersion:
          target.schedules.find((s) => s.week === targetWeek)?.version ?? 0,
        assignment: a,
      });
      if (!result) return false;
      setDate(a.startsLocal.slice(0, 10));
      setStatus(c.success);
      setReview(false);
      await load();
      return true;
    }
    const targetItems =
      data?.schedules.find((s) => s.week === targetWeek)?.snapshot
        .assignments ?? [];
    const ok = await save(
      [...targetItems.filter((x) => x.id !== a.id).map(assignmentInput), a],
      false,
      targetWeek,
    );
    if (ok) setDate(a.startsLocal.slice(0, 10));
    return ok;
  }
  async function move(
    a: WorkforceInstantAssignment,
    day: string,
    member: string | null,
    copy: boolean,
  ) {
    await editSave({
      ...workforceMove(assignmentInput(a), day, member),
      ...(copy ? { id: crypto.randomUUID() } : {}),
    });
  }
  async function resize(a: WorkforceInstantAssignment, delta: number) {
    await editSave(workforceResize(assignmentInput(a), delta));
  }
  async function openProfile(id: string) {
    const result = (await request(
      "/v1/staff/workforce/profiles/" + encodeURIComponent(id),
    )) as Profile | null;
    if (result) setProfile(result);
  }
  async function copyPrevious() {
    if (
      await request("/v1/staff/workforce/copy-week", "POST", {
        from: workforceAddDays(week, -7),
        to: week,
        expectedVersion: selected?.version ?? 0,
      })
    ) {
      setStatus(c.copied);
      setReview(false);
      await load();
    }
  }
  function templateUse(t: Workspace["templates"][number]) {
    const row = fresh();
    row.station = t.station;
    row.startsLocal =
      date +
      "T" +
      String(Math.floor(t.startMinute / 60)).padStart(2, "0") +
      ":" +
      String(t.startMinute % 60).padStart(2, "0");
    row.endsLocal = row.startsLocal;
    row.requiredSkills = t.requiredSkills;
    row.breakMinutes = t.breakMinutes;
    setEditor(workforceResize(row, t.durationMinutes));
  }
  async function toolSave(e: FormEvent) {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const result =
      tool === "stations"
        ? await request("/v1/staff/workforce/stations", "PUT", {
            expectedVersion: data!.venue.configVersion,
            stations: String(f.get("stations"))
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          })
        : await request("/v1/staff/workforce/templates", "POST", {
            name: String(f.get("name")),
            station: String(f.get("station")),
            startMinute:
              Number(String(f.get("start")).slice(0, 2)) * 60 +
              Number(String(f.get("start")).slice(3)),
            durationMinutes: Number(f.get("duration")),
            breakMinutes: Number(f.get("break")),
            requiredSkills: String(f.get("skills") || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          });
    if (result) {
      setTool(null);
      await load();
    }
  }
  if (!data || !date)
    return (
      <main className="wf-workspace">
        <p role={error ? "alert" : "status"}>{error || c.loading}</p>
      </main>
    );
  const monthItems = all.filter(
    (a) =>
      a.startsLocal.slice(0, 10) >= days[0]! &&
      a.startsLocal.slice(0, 10) <= days[days.length - 1]!,
  );
  const nextShift = data.nextShift;
  const displayDate = (day: string) => workforceDateLabel(c, day, false);
  return (
    <main className={"wf-workspace wf-" + density}>
      <header className="wf-header">
        <div>
          <p className="wf-eyebrow">FLOWGASTRONOMIE · {data.venue.name}</p>
          <h2>{manager ? c.title : c.mine}</h2>
          <p>{c.subtitle}</p>
        </div>
        <div className="wf-header-actions">
          <span className="wf-timezone">{data.venue.timezone}</span>
          <button
            className="wf-secondary"
            onClick={() => void openProfile(data.viewer.membershipId)}
          >
            {c.myProfile}
          </button>
          {manager && (
            <a
              className="wf-button wf-secondary"
              href={"/" + locale + "/staff/team"}
            >
              {c.invite}
            </a>
          )}
        </div>
      </header>
      <AttendanceWorkspace
        locale={locale}
        api={api}
        initialDate={date}
        onScheduleChanged={load}
      />
      <section className="wf-stats" aria-label={c.planned}>
        <article>
          <span>{c.planned}</span>
          <strong>
            {Math.round(
              (monthItems.reduce((s, a) => s + workforcePlannedMinutes(a), 0) /
                60) *
                100,
            ) / 100}{" "}
            <small>{c.hours}</small>
          </strong>
        </article>
        <article>
          <span>{manager ? c.version : c.nextShift}</span>
          <strong>
            {manager
              ? (selected?.version ?? 0)
              : nextShift
                ? nextShift.startsLocal.slice(11)
                : "—"}
          </strong>
          <small>
            {manager
              ? c.publishedVersion + ": " + (selected?.publishedVersion ?? "—")
              : nextShift
                ? displayDate(nextShift.startsLocal.slice(0, 10)) +
                  " · " +
                  stationLabel(c, nextShift.station)
                : c.noNext}
          </small>
        </article>
        <article>
          <span>{manager ? c.staff : c.today}</span>
          <strong>
            {manager
              ? data.profiles.filter((p) => p.active).length
              : data.todayAssignments.length}
          </strong>
          <small>
            {manager
              ? selected?.status === "PUBLISHED"
                ? c.published
                : c.draftStatus
              : data.today}
          </small>
        </article>
      </section>
      <div className="wf-toolbar">
        <nav aria-label={manager ? c.title : c.mine}>
          {(["week", "day", "month"] as const).map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {manager
                ? c[v]
                : v === "week"
                  ? c.myWeek
                  : v === "day"
                    ? c.myDay
                    : c.myMonth}
            </button>
          ))}
        </nav>
        <div className="wf-date-controls">
          <button
            className="wf-icon"
            aria-label={c.previous}
            onClick={() =>
              setDate(
                view === "month"
                  ? workforceMonthShift(date, -1)
                  : workforceAddDays(date, view === "week" ? -7 : -1),
              )
            }
          >
            ‹
          </button>
          <label>
            {c.date}
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
                setReview(false);
              }}
            />
          </label>
          <button
            className="wf-icon"
            aria-label={c.next}
            onClick={() =>
              setDate(
                view === "month"
                  ? workforceMonthShift(date, 1)
                  : workforceAddDays(date, view === "week" ? 7 : 1),
              )
            }
          >
            ›
          </button>
          <button className="wf-secondary" onClick={() => setDate(data.today)}>
            {c.today}
          </button>
        </div>
      </div>
      <div className="wf-filterbar">
        <label>
          {c.station}
          <select value={station} onChange={(e) => setStation(e.target.value)}>
            <option value="">{c.all}</option>
            {data.venue.stations.map((s) => (
              <option key={s} value={s}>
                {stationLabel(c, s)}
              </option>
            ))}
          </select>
        </label>
        {manager && (
          <label>
            {c.position}
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              <option value="">{c.all}</option>
              {[
                ...new Set(
                  data.profiles.map((p) => p.jobTitle).filter(Boolean),
                ),
              ].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          {c.compact}
          <select
            aria-label={c.compact}
            value={density}
            onChange={(e) => setDensity(e.target.value)}
          >
            <option value="comfortable">{c.comfortable}</option>
            <option value="compact">{c.compact}</option>
          </select>
        </label>
        {manager && (
          <div className="wf-management">
            <button disabled={busy} onClick={() => setEditor(fresh())}>
              {c.add}
            </button>
            <button
              disabled={busy}
              className="wf-secondary"
              onClick={() => void save(items.map(assignmentInput))}
            >
              {c.draft}
            </button>
            <button
              disabled={busy}
              className="wf-secondary"
              onClick={async () => {
                if (await save(items.map(assignmentInput))) {
                  setReview(true);
                  setConfirmed(false);
                }
              }}
            >
              {c.review}
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="wf-alert" role="alert">
          {error}
          {errorCode === "CONFLICT" && (
            <button onClick={() => void load()}>{c.reload}</button>
          )}
        </div>
      )}
      <p role="status" className="wf-status">
        {status}
      </p>
      {manager && review && (
        <section className="wf-review">
          <h2>{c.review}</h2>
          <p>{c.reviewHint}</p>
          <ul>
            {changes.map((a) => (
              <li key={a.id}>
                {c.change}: {a.kind} · {a.id.slice(0, 8)}
              </li>
            ))}
            {data.warnings
              .filter((w) => items.some((a) => a.id === w.assignmentId))
              .map((w, i) => (
                <li key={i}>
                  {(c as unknown as Record<string, string>)[w.code] ??
                    c.warning}{" "}
                  ·{" "}
                  {items.find((a) => a.id === w.assignmentId)?.displayName ||
                    c.open}
                </li>
              ))}
          </ul>
          <label className="wf-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {c.confirmed}
          </label>
          <button
            disabled={!confirmed || busy}
            onClick={() => void save(items.map(assignmentInput), true)}
          >
            {selected?.publishedVersion !== null &&
            selected?.publishedVersion !== undefined
              ? c.republish
              : c.publish}
          </button>
        </section>
      )}
      {manager && (
        <details className="wf-tools">
          <summary>
            {c.templates} · {c.copy}
          </summary>
          <div>
            <button disabled={busy} onClick={() => void copyPrevious()}>
              {c.copy}
            </button>
            <button
              className="wf-secondary"
              onClick={() => setTool("template")}
            >
              {c.template}
            </button>
            <button
              className="wf-secondary"
              onClick={() => setTool("stations")}
            >
              {c.configure}
            </button>
            {data.templates.map((t) => (
              <button
                className="wf-secondary"
                key={t.id}
                onClick={() => templateUse(t)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </details>
      )}
      <CalendarViews
        data={data}
        date={date}
        view={view}
        station={station}
        position={position}
        c={c}
        locale={locale}
        busy={busy}
        onEdit={edit}
        onMove={move}
        onResize={resize}
        onAdd={(d, m) => {
          setDate(d);
          setEditor(fresh(d, m));
        }}
        onProfile={(id) => void openProfile(id)}
        onDate={(d) => {
          setDate(d);
          setView("day");
        }}
      />
      {!manager && (
        <section className="wf-worker-next">
          <h2>{c.nextShift}</h2>
          {nextShift ? (
            <>
              <strong>
                {displayDate(nextShift.startsLocal.slice(0, 10))} ·{" "}
                {nextShift.startsLocal.slice(11)} —{" "}
                {nextShift.endsLocal.slice(11)}
              </strong>
              <p>
                {data.venue.name} · {stationLabel(c, nextShift.station)}
              </p>
            </>
          ) : (
            <p>{c.noNext}</p>
          )}
        </section>
      )}
      {manager && (
        <details className="wf-history">
          <summary>{c.history}</summary>
          {data.history
            .filter((h) => h.scheduleId === selected?.id)
            .map((h) => (
              <article key={h.id}>
                <strong>
                  {c.version} {h.version} ·{" "}
                  {h.status === "PUBLISHED" ? c.published : c.draftStatus}
                </strong>
                <span>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: data.venue.timezone,
                  }).format(new Date(h.createdAt))}{" "}
                  · {h.changes.length} {c.change}
                </span>
              </article>
            ))}
        </details>
      )}
      <WorkforceOperations
        locale={locale}
        c={c}
        workspace={data}
        week={week}
        request={request}
        onChanged={load}
        busy={busy}
      />
      {editor && (
        <ShiftEditor
          key={editor.id}
          row={editor}
          profiles={data.profiles}
          stations={data.venue.stations}
          c={c}
          busy={busy}
          error={error}
          onSave={editSave}
          onReload={load}
          onClose={() => setEditor(null)}
          onDelete={() =>
            save(items.filter((a) => a.id !== editor.id).map(assignmentInput))
          }
          onDuplicate={() => setEditor({ ...editor, id: crypto.randomUUID() })}
        />
      )}
      {profile && (
        <ProfileEditor
          error={error}
          initial={profile}
          c={c}
          canManage={manager}
          today={data.today}
          country={data.venue.countryCode}
          api={api}
          busy={busy}
          request={request}
          onChanged={load}
          onClose={() => setProfile(null)}
        />
      )}
      {tool && (
        <PilotDialog
          title={tool === "stations" ? c.configure : c.template}
          closeLabel={c.close}
          onClose={() => setTool(null)}
          className="wf-dialog"
        >
          <form className="wf-form" onSubmit={toolSave}>
            {tool === "stations" ? (
              <label className="wf-wide">
                {c.stations}
                <input
                  name="stations"
                  defaultValue={data.venue.stations.join(", ")}
                  required
                />
              </label>
            ) : (
              <>
                <label>
                  {c.templateName}
                  <input name="name" required maxLength={80} />
                </label>
                <label>
                  {c.station}
                  <select name="station" aria-label={c.station}>
                    {data.venue.stations.map((s) => (
                      <option key={s} value={s}>
                        {stationLabel(c, s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {c.start}
                  <input
                    name="start"
                    type="time"
                    step="900"
                    defaultValue="09:00"
                    required
                  />
                </label>
                <label>
                  {c.duration}
                  <input
                    name="duration"
                    type="number"
                    min="15"
                    max="1440"
                    step="15"
                    defaultValue="480"
                    required
                  />
                </label>
                <label>
                  {c.breakMinutes}
                  <input
                    name="break"
                    type="number"
                    min="0"
                    max="480"
                    defaultValue="30"
                  />
                </label>
                <label>
                  {c.skills}
                  <input name="skills" />
                </label>
              </>
            )}
            <button className="wf-wide" disabled={busy}>
              {c.save}
            </button>
          </form>
        </PilotDialog>
      )}
    </main>
  );
}

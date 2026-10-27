"use client";
import { useRef, useState, type PointerEvent } from "react";
import type { WorkforceInstantAssignment } from "@flowgastronomie/domain";
import type { WorkforceCopy } from "./copy";
import { stationLabel } from "./copy";
type Drag = { x: number; y: number; resize: boolean; copy: boolean };
export function ShiftCard({
  a,
  c,
  editable,
  busy,
  small = false,
  onEdit,
  onMove,
  onResize,
}: {
  a: WorkforceInstantAssignment;
  c: WorkforceCopy;
  editable: boolean;
  busy: boolean;
  small?: boolean;
  onEdit: (a: WorkforceInstantAssignment) => void;
  onMove: (
    a: WorkforceInstantAssignment,
    day: string,
    member: string | null,
    copy: boolean,
  ) => Promise<void>;
  onResize: (a: WorkforceInstantAssignment, minutes: number) => Promise<void>;
}) {
  const drag = useRef<Drag | null>(null),
    [ghost, setGhost] = useState<{
      x: number;
      y: number;
      label: string;
    } | null>(null);
  function start(e: PointerEvent<HTMLButtonElement>, resize: boolean) {
    if (busy) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      resize,
      copy: e.altKey || e.ctrlKey,
    };
  }
  function moving(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    if (!d.resize && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
      const scroll = e.currentTarget.closest<HTMLElement>(".wf-week-scroll");
      const bounds = scroll?.getBoundingClientRect();
      if (scroll && bounds) {
        if (e.clientX > bounds.right - 32) scroll.scrollLeft += 12;
        else if (e.clientX < bounds.left + 32) scroll.scrollLeft -= 12;
      }
      if (e.clientY > window.innerHeight - 48) window.scrollBy(0, 12);
      else if (e.clientY < 64) window.scrollBy(0, -12);
    }
    setGhost({
      x: e.clientX,
      y: e.clientY,
      label: d.resize
        ? c.resize + " · " + Math.round((e.clientY - d.y) / 8) * 15 + " min"
        : c.move,
    });
  }
  async function end(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) {
      onEdit(a);
      return;
    }
    if (d.resize) {
      await onResize(a, Math.round((e.clientY - d.y) / 8) * 15);
      return;
    }
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-wf-drop-day]");
    if (target)
      await onMove(
        a,
        target.dataset.wfDropDay!,
        target.dataset.wfDropMember || null,
        d.copy,
      );
  }
  const cancel = () => {
    drag.current = null;
    setGhost(null);
  };
  return (
    <article
      className={"wf-shift " + (small ? "wf-small" : "")}
      data-testid={"shift-" + a.id}
      data-shift-id={a.id}
    >
      <div className="wf-shift-head">
        <span className="wf-station-dot" data-station={a.station} />
        <strong>{stationLabel(c, a.station)}</strong>
        {editable && (
          <button
            className="wf-drag"
            type="button"
            aria-label={c.move + ": " + a.displayName}
            title={c.dragHint}
            onPointerDown={(e) => start(e, false)}
            onPointerMove={moving}
            onPointerUp={(e) => void end(e)}
            onPointerCancel={cancel}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onEdit(a);
              }
            }}
          >
            ⠿
          </button>
        )}
      </div>
      <button
        className="wf-card-body"
        type="button"
        disabled={!editable || busy}
        onClick={() => onEdit(a)}
        aria-label={c.edit + ": " + a.displayName + " " + a.startsLocal}
      >
        <span>
          {a.startsLocal.slice(11)} — {a.endsLocal.slice(11)}
          {a.startsLocal.slice(0, 10) !== a.endsLocal.slice(0, 10) && " ↗"}
        </span>
        <small>
          {small
            ? a.displayName || c.open
            : Math.round(
                (((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60000 -
                  a.breakMinutes) /
                  60) *
                  100,
              ) /
                100 +
              " " +
              c.hours +
              " · " +
              a.breakMinutes +
              " min"}
        </small>
      </button>
      {editable && !small && (
        <button
          type="button"
          className="wf-resize"
          aria-label={c.resize + ": " + a.displayName}
          onPointerDown={(e) => start(e, true)}
          onPointerMove={moving}
          onPointerUp={(e) => void end(e)}
          onPointerCancel={cancel}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEdit(a);
            }
          }}
        >
          ⋯
        </button>
      )}
      {ghost && (
        <div
          className="wf-drag-ghost"
          aria-live="polite"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.label}
        </div>
      )}
    </article>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseMinorInput,
  hasStaffPermission,
  type StaffRole,
} from "@flowgastronomie/domain";
import type { Dictionary } from "../../../../lib/dictionaries";
import { PilotDialog } from "../pilot-dialog";
import { PilotIcon } from "../pilot-icon";
import { pilotText } from "../../../../lib/pilot-copy";
type Session = {
  id: string;
  expectedCashMinor: number;
  countedCashMinor: number | null;
  differenceMinor: number | null;
};
export function RegisterPanel({
  open,
  onOpen,
  onClose,
  closeLabel,
  revision,
  locale,
  currency,
  hasShift,
  onShiftStarted,
  onShiftEnded,
  labels,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  closeLabel: string;
  revision: number;
  locale: string;
  currency: string;
  hasShift: boolean | null;
  onShiftStarted: () => void;
  onShiftEnded: () => void;
  labels: Dictionary["counterSale"];
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lastClosed, setLastClosed] = useState<Session | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const load = useCallback(async () => {
    const [register, me] = await Promise.all([
      fetch(`${api}/v1/staff/register`, { credentials: "include" }),
      fetch(`${api}/v1/staff/me`, { credentials: "include" }),
    ]);
    if (register.ok) {
      const body = await register.json();
      setSession(body.session);
      setLastClosed(body.history[0] ?? null);
      setLoaded(true);
    }
    if (me.ok) {
      const body = await me.json();
      setCanManage(
        hasStaffPermission(body.staff.role as StaffRole, "REGISTER_MANAGE"),
      );
    }
  }, [api]);
  useEffect(() => {
    void load().catch(() => setError(labels.loadError));
  }, [load, labels.loadError, revision]);
  const amountMinor = parseMinorInput(amount);
  const money = (value: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      value / 100,
    );
  async function act(path: string, body: object) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${api}/v1/staff/${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? labels.loadError);
        return;
      }
      if (path === "shift/start") onShiftStarted();
      if (path === "shift/end") onShiftEnded();
      setAmount("");
      setNote("");
      await load();
      if (path === "register/open") onClose();
    } catch {
      setError(labels.loadError);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="register-panel"
      aria-label={labels.register}
      aria-busy={!loaded}
    >
      <button
        ref={trigger}
        type="button"
        className="pos-tool-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
      >
        <PilotIcon name="counter" />
        <span>
          {!loaded
            ? pilotText(locale).unknown
            : session
              ? labels.register
              : labels.noRegister}
        </span>
        <span className={`pos-register-dot${session ? " is-open" : ""}`} />
      </button>
      {open && (
        <PilotDialog
          className="pos-tools-dialog"
          title={labels.register}
          closeLabel={closeLabel}
          onClose={onClose}
          dismissOnBackdrop
          returnFocusRef={trigger}
        >
          <div className="pos-secondary-content">
            <p>
              {session
                ? `${labels.expected}: ${money(session.expectedCashMinor)}`
                : labels.noRegister}
            </p>
            {hasShift === false && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("shift/start", {})}
              >
                {labels.startShift}
              </button>
            )}
            {canManage && (
              <>
                <label>
                  {session ? labels.counted : labels.opening}
                  <input
                    inputMode="decimal"
                    value={amount}
                    disabled={busy}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
                <label>
                  {session ? labels.closingNote : labels.openingNote}
                  <input
                    value={note}
                    maxLength={500}
                    disabled={busy}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !hasShift || amountMinor == null}
                  onClick={() =>
                    void act(
                      session
                        ? `register/${session.id}/close`
                        : "register/open",
                      session
                        ? { countedCashMinor: amountMinor, closingNote: note }
                        : { openingCashMinor: amountMinor, openingNote: note },
                    )
                  }
                >
                  {session ? labels.close : labels.open}
                </button>
              </>
            )}
            {hasShift && !session && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("shift/end", {})}
              >
                {pilotText(locale).endShift}
              </button>
            )}
            {lastClosed && (
              <p>
                {labels.closed} · {labels.expected}:{" "}
                {money(lastClosed.expectedCashMinor)} · {labels.counted}:{" "}
                {money(lastClosed.countedCashMinor ?? 0)} · {labels.difference}:{" "}
                {money(lastClosed.differenceMinor ?? 0)}
              </p>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </PilotDialog>
      )}
    </section>
  );
}

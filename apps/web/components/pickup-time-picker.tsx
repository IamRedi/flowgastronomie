"use client";
import { useEffect, useState } from "react";
import { PilotDialog } from "../app/[lang]/staff/pilot-dialog";
import type { Locale } from "../lib/i18n";
import { orderingUxCopy } from "../lib/ordering-ux-copy";
import { formatVenueTime, venueCalendarDay } from "../lib/venue-time";
import "./online-ordering.css";

export type PickupTimes = {
  generatedAt: string;
  timezone: string;
  earliest: string | null;
  slots: Array<{ at: string; day: string; label: string }>;
  unavailableReason: string | null;
};
export type PickupChoice = {
  timingMode: "ASAP" | "SCHEDULED";
  requestedFor: string;
};
export function PickupTimePicker({
  locale,
  publicSlug,
  apiUrl,
  value,
  onChange,
  refresh = 0,
  fulfillmentType = "PICKUP",
}: {
  locale: Locale;
  publicSlug: string;
  apiUrl: string;
  value: PickupChoice;
  onChange: (value: PickupChoice) => void;
  refresh?: number;
  fulfillmentType?: "PICKUP" | "DELIVERY" | "CATERING";
}) {
  const text = orderingUxCopy[locale];
  const [times, setTimes] = useState<PickupTimes | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `${apiUrl}/v1/public/online-orders/${encodeURIComponent(publicSlug)}/pickup-times?fulfillmentType=${fulfillmentType}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error();
        const available = (await response.json()) as PickupTimes;
        if (!controller.signal.aborted) {
          setTimes(available);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void load();
    const interval = setInterval(() => void load(), 60_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [apiUrl, publicSlug, refresh, retry, fulfillmentType]);
  const days = [...new Set(times?.slots.map((s) => s.day))];
  const currentDay = day && days.includes(day) ? day : days[0];
  const label = (instant: string) =>
    formatVenueTime(locale, instant, times?.timezone ?? "UTC");
  const today = times
    ? venueCalendarDay(times.generatedAt, times.timezone)
    : "";
  const tomorrow = today
    ? new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10)
    : "";
  function showPicker() {
    setDay(
      times?.slots.find((s) => s.at === value.requestedFor)?.day ??
        days[0] ??
        "",
    );
    setOpen(true);
  }
  const earliest = times?.earliest;
  return (
    <section
      className="pickup-timing"
      aria-label={fulfillmentType === "PICKUP" ? text.pickup : text.requested}
    >
      <strong>
        {fulfillmentType === "PICKUP" ? text.pickup : text.requested}
      </strong>
      <div className="pickup-mode">
        {fulfillmentType === "PICKUP" && (
          <button
            type="button"
            aria-pressed={value.timingMode === "ASAP"}
            onClick={() => onChange({ timingMode: "ASAP", requestedFor: "" })}
          >
            {text.asap}
          </button>
        )}
        <button
          type="button"
          aria-pressed={value.timingMode === "SCHEDULED"}
          onClick={showPicker}
        >
          {text.choose}
        </button>
      </div>
      <p role="status" data-testid="pickup-selection">
        {failed
          ? text.unavailable
          : !times
            ? text.timesLoading
            : value.timingMode === "SCHEDULED" && value.requestedFor
              ? label(value.requestedFor)
              : earliest && fulfillmentType === "PICKUP"
                ? `${text.asap} · ${text.approx} ${label(earliest)}`
                : earliest
                  ? text.choose
                  : text.unavailable}
      </p>
      {earliest && (
        <small>
          {text.earliest}: {label(earliest)} · {text.venueTime}
        </small>
      )}
      {(failed || (!earliest && times)) && (
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          {text.retry}
        </button>
      )}
      {value.timingMode === "SCHEDULED" && (
        <button type="button" className="pickup-change" onClick={showPicker}>
          {text.change}
        </button>
      )}
      {open && (
        <PilotDialog
          title={text.choose}
          closeLabel={text.close}
          onClose={() => setOpen(false)}
          className="pickup-slot-overlay"
        >
          <div className="pickup-picker">
            <div
              className="pickup-days"
              role="group"
              aria-label={text.selectDay}
            >
              {days.map((d) => {
                const slot = times!.slots.find((s) => s.day === d)!;
                return (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={currentDay === d}
                    onClick={() => setDay(d)}
                  >
                    {d === today
                      ? text.today
                      : d === tomorrow
                        ? text.tomorrow
                        : formatVenueTime(
                            locale,
                            slot.at,
                            times!.timezone,
                            false,
                          )}
                  </button>
                );
              })}
            </div>
            <div
              className="pickup-slots"
              role="group"
              aria-label={text.selectSlot}
            >
              {times?.slots
                .filter((s) => s.day === currentDay)
                .map((s) => (
                  <button
                    type="button"
                    key={s.at}
                    aria-pressed={value.requestedFor === s.at}
                    onClick={() => {
                      onChange({ timingMode: "SCHEDULED", requestedFor: s.at });
                      setOpen(false);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
            </div>
            {!days.length && (
              <p role="status">
                {failed || times ? text.noSlots : text.timesLoading}
              </p>
            )}
            <small>{text.venueTime}</small>
          </div>
        </PilotDialog>
      )}
    </section>
  );
}

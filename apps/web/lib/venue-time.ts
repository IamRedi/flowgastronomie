import type { Locale } from "./i18n";
export function venueCalendarDay(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function formatVenueTime(
  locale: Locale,
  instant: string,
  timezone: string,
  withTime = true,
) {
  if (locale !== "sq")
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(withTime
        ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
        : {}),
    }).format(new Date(instant));
  // Browser ICU may lack Albanian. Use localized weekday labels and numeric
  // dates rather than silently falling back to another language or timezone.
  const weekdays: Record<string, string> = {
    Mon: "Hën",
    Tue: "Mar",
    Wed: "Mër",
    Thu: "Enj",
    Fri: "Pre",
    Sat: "Sht",
    Sun: "Die",
  };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  return `${weekdays[get("weekday")]} ${get("day")}/${get("month")}${withTime ? ` · ${get("hour")}:${get("minute")}` : ""}`;
}

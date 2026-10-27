import { PLATFORM_LOCALES, type PlatformLocale } from "./locale";

export const WEBSITE_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type OpeningHoursEntry = {
  day: Weekday;
  closed: boolean;
  opensAt: string;
  closesAt: string;
};

const weekdayByShortName: Record<string, Weekday> = {
  Mon: "MONDAY",
  Tue: "TUESDAY",
  Wed: "WEDNESDAY",
  Thu: "THURSDAY",
  Fri: "FRIDAY",
  Sat: "SATURDAY",
  Sun: "SUNDAY",
};

function minutes(value: string) {
  const [hour = Number.NaN, minute = Number.NaN] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function openingHoursMatcher(input: {
  timezone: string;
  openingHours: OpeningHoursEntry[];
}) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (at: Date) => {
    const parts = formatter.formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const day = weekdayByShortName[get("weekday") ?? ""];
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const entry = input.openingHours.find((item) => item.day === day);
    if (!entry || !day || !Number.isFinite(hour) || !Number.isFinite(minute))
      return false;
    const now = hour * 60 + minute;
    const previousDay =
      WEEKDAYS[(WEEKDAYS.indexOf(day) + WEEKDAYS.length - 1) % WEEKDAYS.length];
    const previous = input.openingHours.find(
      (item) => item.day === previousDay,
    );
    if (
      previous &&
      !previous.closed &&
      minutes(previous.closesAt) < minutes(previous.opensAt) &&
      now < minutes(previous.closesAt)
    ) {
      return true;
    }
    if (entry.closed) return false;
    const opens = minutes(entry.opensAt);
    const closes = minutes(entry.closesAt);
    return closes > opens
      ? now >= opens && now < closes
      : now >= opens || now < closes;
  };
}

export function isWithinOpeningHours(input: {
  at: Date;
  timezone: string;
  openingHours: OpeningHoursEntry[];
}) {
  return openingHoursMatcher(input)(input.at);
}

export type WebsiteTranslation = {
  locale: PlatformLocale;
  heroTitle: string;
  heroSubtitle: string;
  storyTitle: string;
  storyBody: string;
  seoTitle: string;
  seoDescription: string;
};

export type WebsitePublicationInput = {
  publicSlug: string;
  primaryColor: string;
  accentColor: string;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  translations: WebsiteTranslation[];
};

export type WebsitePublicationIssue =
  | "INVALID_PUBLIC_SLUG"
  | "INVALID_PRIMARY_COLOR"
  | "INVALID_ACCENT_COLOR"
  | "CONTACT_REQUIRED"
  | "TRANSLATIONS_INCOMPLETE";

export function isValidBrandColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function isValidPublicSiteSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(value);
}

export function websitePublicationIssues(
  input: WebsitePublicationInput,
): WebsitePublicationIssue[] {
  const issues: WebsitePublicationIssue[] = [];
  if (!isValidPublicSiteSlug(input.publicSlug)) {
    issues.push("INVALID_PUBLIC_SLUG");
  }
  if (!isValidBrandColor(input.primaryColor)) {
    issues.push("INVALID_PRIMARY_COLOR");
  }
  if (!isValidBrandColor(input.accentColor)) {
    issues.push("INVALID_ACCENT_COLOR");
  }
  if (!input.phone?.trim() && !input.contactEmail?.trim()) {
    issues.push("CONTACT_REQUIRED");
  }

  const translationsComplete = PLATFORM_LOCALES.every((locale) => {
    const translation = input.translations.find(
      (candidate) => candidate.locale === locale,
    );
    return (
      translation !== undefined &&
      [
        translation.heroTitle,
        translation.heroSubtitle,
        translation.storyTitle,
        translation.storyBody,
        translation.seoTitle,
        translation.seoDescription,
      ].every((value) => value.trim().length > 0)
    );
  });
  if (
    !translationsComplete ||
    input.translations.length !== PLATFORM_LOCALES.length
  ) {
    issues.push("TRANSLATIONS_INCOMPLETE");
  }
  return issues;
}

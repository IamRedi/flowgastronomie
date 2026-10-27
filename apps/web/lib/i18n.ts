import {
  DEFAULT_PLATFORM_LOCALE,
  isPlatformLocale,
  PLATFORM_LOCALES,
  type PlatformLocale,
} from "@flowgastronomie/domain";

export const locales = PLATFORM_LOCALES;

export type Locale = PlatformLocale;

export const defaultLocale = DEFAULT_PLATFORM_LOCALE;

export const localeNames: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  sq: "Shqip",
};

export function hasLocale(value: string): value is Locale {
  return isPlatformLocale(value);
}

export function detectLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return defaultLocale;

  const preferences = acceptLanguage
    .split(",")
    .map((entry) => {
      const [tag = "", quality = "q=1"] = entry.trim().split(";");
      const base = tag.toLowerCase().split("-")[0] ?? "";
      const score = Number(quality.replace("q=", "")) || 0;
      return { base, score };
    })
    .sort((left, right) => right.score - left.score);

  const match = preferences.find(({ base }) => hasLocale(base));
  return match && hasLocale(match.base) ? match.base : defaultLocale;
}

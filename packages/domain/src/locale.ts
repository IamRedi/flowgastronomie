export const PLATFORM_LOCALES = ["en", "de", "it", "sq"] as const;

export type PlatformLocale = (typeof PLATFORM_LOCALES)[number];

export const DEFAULT_PLATFORM_LOCALE: PlatformLocale = "sq";

export function isPlatformLocale(value: string): value is PlatformLocale {
  return PLATFORM_LOCALES.some((locale) => locale === value);
}

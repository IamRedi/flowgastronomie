import type { Locale } from "./i18n";
export function formatCurrency(
  minor: number,
  currency: string,
  locale: Locale,
) {
  // Pin the comma-decimal presentation for sq: Chromium may lack Albanian ICU
  // data while Node supports it. Do not fall back to the browser's own language.
  return new Intl.NumberFormat(locale === "sq" ? "de-DE" : locale, {
    style: "currency",
    currency,
  }).format(minor / 100);
}

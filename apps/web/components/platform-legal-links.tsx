import type { Locale } from "../lib/i18n";

export function PlatformLegalLinks({ locale }: { locale: Locale }) {
  const privacy = {
    sq: "Privatësia",
    en: "Privacy",
    de: "Datenschutz",
    it: "Privacy",
  }[locale];
  return (
    <nav className="platform-legal-links" aria-label={privacy}>
      <a href={`/${locale}/legal/imprint`}>Impressum</a>
      <a href={`/${locale}/legal/privacy`}>{privacy}</a>
    </nav>
  );
}

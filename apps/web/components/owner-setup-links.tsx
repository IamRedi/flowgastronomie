import type { Locale } from "../lib/i18n";
import { premiumCopy } from "./premium-copy";
import "./owner-setup-links.css";
export function OwnerSetupLinks({ locale }: { locale: Locale }) {
  const words = premiumCopy(locale);
  return (
    <nav className="owner-setup-links" aria-label={words.starting}>
      <a href={`/app/${locale}/onboarding/business-import`}>
        {
          {
            sq: "Importo biznesin",
            de: "Betrieb importieren",
            en: "Import business",
            it: "Importa attività",
          }[locale]
        }
      </a>

      <a href={`/${locale}/staff/menu`}>{words.menu}</a>
      <a href={`/${locale}/staff/pos`}>POS</a>
    </nav>
  );
}

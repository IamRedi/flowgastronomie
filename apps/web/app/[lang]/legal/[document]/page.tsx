import { connection } from "next/server";
import { notFound } from "next/navigation";
import { hasLocale } from "../../../../lib/i18n";
import {
  platformOperator,
  platformPrivacyNotice,
} from "../../../../lib/platform-legal";
import { PlatformLegalLinks } from "../../../../components/platform-legal-links";

export default async function PlatformLegalPage({
  params,
}: {
  params: Promise<{ lang: string; document: string }>;
}) {
  const { lang, document } = await params;
  if (!hasLocale(lang) || !["imprint", "privacy"].includes(document))
    notFound();
  await connection();
  const operator = platformOperator();
  const privacy = platformPrivacyNotice(lang);
  const text = {
    en: {
      home: "Home",
      privacy: "Privacy",
      missing: "Publication details are being prepared. Please return later.",
    },
    sq: {
      home: "Kreu",
      privacy: "Privatësia",
      missing: "Të dhënat për publikim po përgatiten. Kthehu më vonë.",
    },
    de: {
      home: "Startseite",
      privacy: "Datenschutz",
      missing:
        "Die Veröffentlichungsangaben werden vorbereitet. Bitte kommen Sie später wieder.",
    },
    it: {
      home: "Home",
      privacy: "Privacy",
      missing:
        "I dati per la pubblicazione sono in preparazione. Riprova più tardi.",
    },
  }[lang];
  return (
    <main className="shell platform-legal-page">
      <a className="button button-ghost" href={`/${lang}`}>
        {text.home}
      </a>
      <h1>{document === "imprint" ? "Impressum" : text.privacy}</h1>
      {operator ? (
        <address>
          <strong>{operator.name}</strong>
          <p>{operator.address}</p>
          <a href={`mailto:${operator.email}`}>{operator.email}</a>
        </address>
      ) : (
        <p>{text.missing}</p>
      )}
      {document === "privacy" && (
        <section className="platform-privacy-notice">
          {privacy ? (
            privacy.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)
          ) : (
            <p>{text.missing}</p>
          )}
        </section>
      )}
      <PlatformLegalLinks locale={lang} />
    </main>
  );
}

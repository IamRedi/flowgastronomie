import { notFound } from "next/navigation";

import { getDictionary } from "../../../../../lib/dictionaries";
import { hasLocale } from "../../../../../lib/i18n";

type LegalData = {
  venue: { name: string };
  publicSlug: string;
  legal: {
    legalName: string;
    addressLine1: string;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId: string | null;
  } | null;
};

export const dynamic = "force-dynamic";

export default async function PublicLegalPage({
  params,
}: {
  params: Promise<{ lang: string; publicSlug: string; legal: string }>;
}) {
  const { lang, publicSlug, legal } = await params;
  if (!hasLocale(lang) || !["imprint", "privacy"].includes(legal)) {
    notFound();
  }
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [response, dictionary] = await Promise.all([
    fetch(
      `${apiUrl}/v1/public/websites/${encodeURIComponent(publicSlug)}?locale=${lang}`,
      { cache: "no-store" },
    ),
    getDictionary(lang),
  ]);
  if (!response.ok) notFound();
  const website = (await response.json()) as LegalData;
  const labels = dictionary.publicSite;
  const isPrivacy = legal === "privacy";
  return (
    <main className="venue-legal-page">
      <nav>
        <a href={`/${lang}/venue/${publicSlug}`}>← {labels.backToWebsite}</a>
      </nav>
      <article>
        <p className="eyebrow">{website.venue.name}</p>
        <h1>{isPrivacy ? labels.privacyTitle : labels.imprint}</h1>
        {isPrivacy ? (
          <>
            <p className="venue-legal-lead">{labels.privacyIntro}</p>
            <p>{labels.privacyBody}</p>
          </>
        ) : website.legal ? (
          <dl>
            <div>
              <dt>{labels.controller}</dt>
              <dd>{website.legal.legalName}</dd>
            </div>
            <div>
              <dt>{labels.contact}</dt>
              <dd>
                {website.legal.addressLine1}, {website.legal.postalCode}{" "}
                {website.legal.city} ({website.legal.countryCode})
              </dd>
            </div>
            {website.legal.vatId && (
              <div>
                <dt>{labels.vatId}</dt>
                <dd>{website.legal.vatId}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p>{labels.legalUnavailable}</p>
        )}
      </article>
    </main>
  );
}

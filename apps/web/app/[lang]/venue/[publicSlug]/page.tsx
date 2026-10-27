import { notFound } from "next/navigation";
import type { Metadata } from "next";

import {
  VenueSiteView,
  type VenueSiteData,
} from "../../../../components/venue-site-view";
import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

export const dynamic = "force-dynamic";

async function publicWebsite(
  apiUrl: string,
  publicSlug: string,
  locale: string,
) {
  return fetch(
    `${apiUrl}/v1/public/websites/${encodeURIComponent(publicSlug)}?locale=${locale}`,
    { cache: "no-store" },
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; publicSlug: string }>;
}): Promise<Metadata> {
  const { lang, publicSlug } = await params;
  if (!hasLocale(lang)) return {};
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const response = await publicWebsite(apiUrl, publicSlug, lang);
  if (!response.ok) return {};
  const website = (await response.json()) as VenueSiteData;
  const image = website.brand.heroImageUrl?.startsWith("/v1/")
    ? `${apiUrl}${website.brand.heroImageUrl}`
    : (website.brand.heroImageUrl ?? undefined);
  const canonical = `/${lang}/venue/${publicSlug}`;
  return {
    title: website.content.seoTitle || website.venue.name,
    description: website.content.seoDescription || website.content.heroSubtitle,
    alternates: {
      canonical,
      languages: {
        en: `/en/venue/${publicSlug}`,
        de: `/de/venue/${publicSlug}`,
        it: `/it/venue/${publicSlug}`,
        sq: `/sq/venue/${publicSlug}`,
      },
    },
    openGraph: {
      title: website.content.seoTitle || website.venue.name,
      description:
        website.content.seoDescription || website.content.heroSubtitle,
      type: "website",
      url: canonical,
      ...(image ? { images: [{ url: image, alt: website.venue.name }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: website.content.seoTitle || website.venue.name,
      description:
        website.content.seoDescription || website.content.heroSubtitle,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function PublicVenueWebsitePage({
  params,
}: {
  params: Promise<{ lang: string; publicSlug: string }>;
}) {
  const { lang, publicSlug } = await params;
  if (!hasLocale(lang)) notFound();
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [response, dictionary] = await Promise.all([
    publicWebsite(apiUrl, publicSlug, lang),
    getDictionary(lang),
  ]);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("PUBLIC_WEBSITE_LOAD_FAILED");
  const website = (await response.json()) as VenueSiteData;

  return (
    <VenueSiteView
      apiUrl={apiUrl}
      homeHref={`/${lang}`}
      labels={dictionary.publicSite}
      languageHref={(locale) => `/${locale}/venue/${publicSlug}`}
      locale={lang}
      website={website}
    />
  );
}

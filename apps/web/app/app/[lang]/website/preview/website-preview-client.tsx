"use client";

import type {
  BusinessProfileId,
  OpeningHoursEntry,
  WebsiteDocument,
  PlatformLocale,
  CanonicalMediaReference,
} from "@flowgastronomie/domain";
import { websiteTemplatePreview } from "../../../../../components/website-template-preview";
import { websiteV2Copy } from "../../../../../components/website-v2-copy";
import { useCallback, useEffect, useState } from "react";

import {
  VenueSiteView,
  type VenueSiteData,
} from "../../../../../components/venue-site-view";
import type { Dictionary } from "../../../../../lib/dictionaries";
import type { Locale } from "../../../../../lib/i18n";

type Translation = {
  locale: PlatformLocale;
  name?: string;
  description?: string | null;
  heroTitle?: string;
  heroSubtitle?: string;
  storyTitle?: string;
  storyBody?: string;
  seoTitle?: string;
  seoDescription?: string;
};

type Editor = {
  designVersion?: 1 | 2;
  businessProfileId?: BusinessProfileId;
  document?: WebsiteDocument | null;
  publicSlug: string;
  venueName: string;
  premiumStyleId?: string | null;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  openingHours: OpeningHoursEntry[];
  translations: Translation[];
};

type StaffMenu = {
  venue: { name: string; currency: string };
  categories: Array<{
    id: string;
    published: boolean;
    translations: Translation[];
    products: Array<{
      id: string;
      published: boolean;
      available: boolean;
      priceMinor: number;
      currency: string;
      translations: Translation[];
    }>;
  }>;
};

function localized(entries: Translation[], locale: Locale) {
  return entries.find((entry) => entry.locale === locale) ?? entries[0];
}

export function WebsitePreviewClient({
  labels,
  locale,
  publicLabels,
}: {
  labels: Dictionary["websiteAdmin"];
  locale: Locale;
  publicLabels: Dictionary["publicSite"];
}) {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [website, setWebsite] = useState<VenueSiteData | null>(null);
  const [demo, setDemo] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [websiteResponse, menuResponse, mediaResponse] = await Promise.all([
      fetch(`${apiUrl}/v1/workspace/website`, {
        cache: "no-store",
        credentials: "include",
      }),
      fetch(`${apiUrl}/v1/staff/menu`, {
        cache: "no-store",
        credentials: "include",
      }),
      fetch(`${apiUrl}/v1/workspace/media`, {
        cache: "no-store",
        credentials: "include",
      }),
    ]);
    if (websiteResponse.status === 401 || menuResponse.status === 401) {
      window.location.assign(`/${locale}/staff/login`);
      return;
    }
    if (!websiteResponse.ok || !menuResponse.ok || !mediaResponse.ok) {
      setFailed(true);
      return;
    }
    const editor = (await websiteResponse.json()) as Editor;
    const menu = (await menuResponse.json()) as StaffMenu;
    const media = (await mediaResponse.json()) as {
      library?: CanonicalMediaReference[];
      venue: { role: string; media: CanonicalMediaReference }[];
      products: { productId: string; media: CanonicalMediaReference }[];
    };
    const productMedia = new Map(
      media.products.map((row) => [row.productId, row.media]),
    );
    const copy = localized(editor.translations, locale);
    const next: VenueSiteData = {
      document: editor.document ?? null,
      sectionMedia: media.library ?? [],
      locale,
      publicSlug: editor.publicSlug,
      designVersion: editor.designVersion,
      venue: menu.venue,
      brand: {
        premiumStyleId: editor.premiumStyleId,
        primaryColor: editor.primaryColor,
        accentColor: editor.accentColor,
        logoUrl:
          media.venue.find((row) => row.role === "LOGO")?.media.url ??
          editor.logoUrl,
        heroImageUrl:
          media.venue.find((row) => row.role === "HERO")?.media.url ??
          editor.heroImageUrl,
      },
      contact: {
        phone: editor.phone,
        email: editor.contactEmail,
        address: editor.address,
        instagramUrl: editor.instagramUrl,
        facebookUrl: editor.facebookUrl,
        openingHours: editor.openingHours,
      },
      content: {
        heroTitle: copy?.heroTitle ?? "",
        heroSubtitle: copy?.heroSubtitle ?? "",
        storyTitle: copy?.storyTitle ?? "",
        storyBody: copy?.storyBody ?? "",
        seoTitle: copy?.seoTitle ?? "",
        seoDescription: copy?.seoDescription ?? "",
      },
      menu: menu.categories.map((category) => ({
        id: category.id,
        name: localized(category.translations, locale)?.name ?? "—",
        products: category.products.map((product) => {
          const translation = localized(product.translations, locale);
          return {
            id: product.id,
            name: translation?.name ?? "—",
            description: translation?.description ?? null,
            priceMinor: product.priceMinor,
            currency: product.currency,
            available: product.available,
            ...(productMedia.has(product.id)
              ? { media: productMedia.get(product.id)! }
              : {}),
          };
        }),
      })),
    };
    if (next.document && editor.designVersion === 2) {
      const decorated = websiteTemplatePreview(
        { ...next, document: next.document },
        editor.businessProfileId ?? "GENERIC",
      );
      setWebsite(decorated.site);
      setDemo(decorated.demo || decorated.illustrative);
    } else setWebsite(next);
  }, [apiUrl, locale]);

  useEffect(() => void load(), [load]);

  if (!website) {
    return (
      <main className="workspace-state">
        {failed ? labels.error : labels.loading}
      </main>
    );
  }

  return (
    <>
      <aside className="website-preview-bar">
        <strong>{labels.previewBadge}</strong>
        <span>{websiteV2Copy(locale)[demo ? 21 : 22]}</span>
        <a href={`/app/${locale}/website`}>{labels.backToEditor} →</a>
      </aside>
      <VenueSiteView
        preview
        apiUrl={apiUrl}
        homeHref={`/app/${locale}/website`}
        labels={publicLabels}
        languageHref={(item) => `/app/${item}/website/preview`}
        locale={locale}
        website={website}
      />
    </>
  );
}

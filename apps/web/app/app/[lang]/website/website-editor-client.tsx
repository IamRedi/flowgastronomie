"use client";
import type {
  WebsiteDocument,
  OpeningHoursEntry,
  WebsiteStatus,
  WebsiteTranslation,
} from "@flowgastronomie/domain";
import { useCallback, useEffect, useState } from "react";
import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";
import { WebsiteBuilder } from "../../../../components/website-builder";
export type WebsiteEditor = {
  designVersion?: 1 | 2 | undefined;
  businessProfileId?: string | null;
  document?: WebsiteDocument | null;
  updatedAt?: string | undefined;
  id: string | null;
  venueId: string;
  venueName: string;
  publicSlug: string;
  status: WebsiteStatus;
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
  publishedAt: string | null;
  translations: WebsiteTranslation[];
};

export function WebsiteEditorClient({
  labels,
  locale,
}: {
  labels: Dictionary["websiteAdmin"];
  locale: Locale;
}) {
  const [website, setWebsite] = useState<WebsiteEditor | null>(null),
    [error, setError] = useState(false),
    [forbidden, setForbidden] = useState(false);
  const apiUrl = (
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  ).replace(/\/$/, "");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/v1/workspace/website`, {
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign(`/${locale}/staff/login`);
        return;
      }
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) throw Error();
      setWebsite(await response.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, [apiUrl, locale]);
  useEffect(() => {
    void load();
  }, [load]);
  if (forbidden)
    return <main className="workspace-state">{labels.permissions}</main>;
  if (!website)
    return (
      <main className="workspace-state">
        {error ? labels.error : labels.loading}
        {error && <button onClick={() => void load()}>{labels.loading}</button>}
      </main>
    );
  return (
    <WebsiteBuilder
      key={website.venueId}
      website={website}
      labels={labels}
      locale={locale}
      apiUrl={apiUrl}
      onSaved={setWebsite}
      onReload={() => void load()}
    />
  );
}

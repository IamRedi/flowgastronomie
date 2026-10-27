import { notFound } from "next/navigation";

import { hasLocale } from "../../../../../lib/i18n";

import { OnlineOrderTrackingClient } from "./tracking-client";

export default async function OnlineOrderTrackingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; trackingToken: string }>;
  searchParams: Promise<{ venue?: string }>;
}) {
  const { lang, trackingToken } = await params;
  if (!hasLocale(lang)) notFound();
  const query = await searchParams;
  return (
    <OnlineOrderTrackingClient
      locale={lang}
      trackingToken={trackingToken}
      publicSlug={query.venue}
    />
  );
}

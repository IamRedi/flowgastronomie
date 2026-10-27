import { notFound } from "next/navigation";

import { getDictionary } from "../../../../../lib/dictionaries";
import { hasLocale } from "../../../../../lib/i18n";

import { WebsitePreviewClient } from "./website-preview-client";

export default async function WebsitePreviewPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return (
    <WebsitePreviewClient
      labels={dictionary.websiteAdmin}
      locale={lang}
      publicLabels={dictionary.publicSite}
    />
  );
}

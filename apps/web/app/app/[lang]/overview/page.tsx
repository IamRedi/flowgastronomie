import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { OwnerOverviewClient } from "./owner-overview-client";

export default async function OwnerOverviewPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return (
    <OwnerOverviewClient
      launchLabels={dictionary.launchAdmin}
      labels={dictionary.workspace}
      locale={lang}
      modeLabels={dictionary.menuPage.modes}
      planLabels={dictionary.pricing.plans}
    />
  );
}

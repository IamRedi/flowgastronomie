import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { StaffRadarClient } from "./staff-radar-client";

export default async function StaffRadarPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const dictionary = await getDictionary(lang);
  return (
    <StaffRadarClient
      locale={lang}
      radarLabels={dictionary.radar}
      staffLabels={dictionary.staff}
    />
  );
}

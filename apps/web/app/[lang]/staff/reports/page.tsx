import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { StaffReportsClient } from "./staff-reports-client";

export default async function StaffReportsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return <StaffReportsClient labels={dictionary.reports} locale={lang} />;
}

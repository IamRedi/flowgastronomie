import { notFound } from "next/navigation";

import { hasLocale } from "../../../../lib/i18n";

import { StaffCostsClient } from "./staff-costs-client";

export default async function StaffCostsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <StaffCostsClient locale={lang} />;
}

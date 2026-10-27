import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { StaffSetupClient } from "./staff-setup-client";

export default async function StaffSetupPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return (
    <StaffSetupClient
      labels={dictionary.setupAdmin}
      locale={lang}
      modeLabels={dictionary.menuPage.modes}
    />
  );
}

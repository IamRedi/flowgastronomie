import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { StaffMenuClient } from "./staff-menu-client";

export default async function StaffMenuPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const dictionary = await getDictionary(lang);
  return (
    <StaffMenuClient
      labels={dictionary.menuAdmin}
      locale={lang}
      staffLabels={dictionary.staff}
    />
  );
}

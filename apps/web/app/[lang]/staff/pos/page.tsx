import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { StaffPosClient } from "./staff-pos-client";

export default async function StaffPosPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const dictionary = await getDictionary(lang);
  return (
    <StaffPosClient
      locale={lang}
      labels={dictionary.staffPos}
      counterLabels={dictionary.counterSale}
      hardwareLabels={dictionary.hardware}
      staffLabels={dictionary.staff}
    />
  );
}

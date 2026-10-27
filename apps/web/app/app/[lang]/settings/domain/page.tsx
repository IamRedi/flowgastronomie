import { notFound } from "next/navigation";

import { getDictionary } from "../../../../../lib/dictionaries";
import { hasLocale } from "../../../../../lib/i18n";

import { DomainSettingsClient } from "./domain-settings-client";

export default async function DomainSettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return <DomainSettingsClient labels={dictionary.domainAdmin} locale={lang} />;
}

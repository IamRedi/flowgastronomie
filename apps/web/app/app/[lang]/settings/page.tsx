import { notFound } from "next/navigation";
import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";
import { PilotSettingsClient } from "./pilot-settings-client";
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return (
    <PilotSettingsClient
      locale={lang}
      labels={dictionary.workspace}
      launchLabels={dictionary.launchAdmin}
    />
  );
}

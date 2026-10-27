import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";
import { LaunchWorkspaceClient } from "../launch-workspace-client";

export default async function LaunchPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return (
    <LaunchWorkspaceClient
      labels={dictionary.launchAdmin}
      locale={lang}
      mode="launch"
    />
  );
}

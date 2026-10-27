import { notFound } from "next/navigation";

import { hasLocale } from "../../../../lib/i18n";
import { SmartSetupClient } from "./smart-setup-client";

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <SmartSetupClient locale={lang} />;
}

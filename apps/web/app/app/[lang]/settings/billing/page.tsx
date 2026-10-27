import { notFound } from "next/navigation";

import { getDictionary } from "../../../../../lib/dictionaries";
import { hasLocale } from "../../../../../lib/i18n";

import { BillingSettingsClient } from "./billing-settings-client";

export default async function BillingSettingsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return (
    <BillingSettingsClient
      labels={dictionary.billingAdmin}
      locale={lang}
      planLabels={dictionary.pricing.plans}
    />
  );
}

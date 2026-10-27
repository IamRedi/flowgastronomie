import { notFound } from "next/navigation";

import { hasLocale } from "../../../../lib/i18n";

import { OnlineOrdersClient } from "./online-orders-client";

export default async function OnlineOrdersPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <OnlineOrdersClient locale={lang} />;
}

import { notFound } from "next/navigation";

import { hasLocale } from "../../../../lib/i18n";

import { OnlineOrderMenuClient } from "./online-order-menu-client";

export default async function OnlineOrderPage({
  params,
}: {
  params: Promise<{ lang: string; publicSlug: string }>;
}) {
  const { lang, publicSlug } = await params;
  if (!hasLocale(lang)) notFound();
  return <OnlineOrderMenuClient locale={lang} publicSlug={publicSlug} />;
}

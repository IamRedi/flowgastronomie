import { notFound } from "next/navigation";

import { hasLocale } from "../../../../lib/i18n";

import { LegalHoldsClient } from "./legal-holds-client";

export default async function LegalHoldsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <LegalHoldsClient locale={lang} />;
}

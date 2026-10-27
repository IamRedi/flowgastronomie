import { notFound } from "next/navigation";
import { hasLocale } from "../../../../../lib/i18n";
import { BusinessImportClient } from "./import-client";
export default async function BusinessImportPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <BusinessImportClient locale={lang} />;
}

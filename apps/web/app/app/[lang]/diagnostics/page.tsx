import { notFound } from "next/navigation";

import { hasLocale } from "../../../../lib/i18n";

import { DiagnosticsClient } from "./diagnostics-client";

export default async function DiagnosticsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <DiagnosticsClient locale={lang} />;
}

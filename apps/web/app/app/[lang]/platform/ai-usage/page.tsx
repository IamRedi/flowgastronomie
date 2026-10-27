import { notFound } from "next/navigation";
import { hasLocale } from "../../../../../lib/i18n";
import { PlatformAiUsage } from "./platform-ai-usage";

export default async function PlatformAiUsagePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <PlatformAiUsage locale={lang} />;
}

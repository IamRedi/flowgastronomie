import { notFound } from "next/navigation";
import { hasLocale } from "../../../../lib/i18n";
import { MarketingWorkspace } from "./marketing-workspace";
import {
  marketingSections,
  type MarketingSection,
} from "../../../../lib/marketing-copy";
export default async function MarketingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { view } = await searchParams;
  if (view && !marketingSections.some((key) => key === view)) notFound();
  return (
    <MarketingWorkspace
      key={`${lang}:${view ?? "overview"}`}
      locale={lang}
      section={(view ?? "overview") as MarketingSection}
    />
  );
}

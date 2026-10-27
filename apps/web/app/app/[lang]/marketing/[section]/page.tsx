import { notFound } from "next/navigation";
import { hasLocale } from "../../../../../lib/i18n";
import {
  marketingSections,
  type MarketingSection,
} from "../../../../../lib/marketing-copy";
import { MarketingWorkspace } from "../marketing-workspace";
export default async function MarketingSectionPage({
  params,
}: {
  params: Promise<{ lang: string; section: string }>;
}) {
  const { lang, section } = await params;
  if (
    !hasLocale(lang) ||
    !marketingSections.slice(1).some((key) => key === section)
  )
    notFound();
  return (
    <MarketingWorkspace
      key={`${lang}:${section}`}
      locale={lang}
      section={section as MarketingSection}
    />
  );
}

import { notFound } from "next/navigation";
import { businessProfileIds, premiumShowcase } from "@flowgastronomie/domain";
import { hasLocale } from "../../../lib/i18n";
import { PremiumBrowser } from "../../../components/premium-browser";
export const metadata = {
  title: "Premium business templates · FlowGastronomie",
  robots: { index: false, follow: false },
};
export default async function ShowcasePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ profile?: string; style?: string }>;
}) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  if (!hasLocale(lang)) notFound();
  const profile =
    businessProfileIds.find((id) => id === query.profile) ?? "RESTAURANT";
  const styleIndex = Math.max(
    0,
    premiumShowcase(profile).styles.findIndex((s) => s.id === query.style),
  );
  return (
    <PremiumBrowser
      locale={lang}
      initialProfile={profile}
      initialStyle={styleIndex}
    />
  );
}

import { notFound } from "next/navigation";

import { hasLocale } from "../../../../lib/i18n";
import { ProductionBoard } from "../production-board";
import { OnlineProductionBoard } from "../online-production-board";

export default async function StaffKitchenPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <main>
      <ProductionBoard locale={lang} station="KITCHEN" />
      <OnlineProductionBoard locale={lang} station="KITCHEN" />
    </main>
  );
}

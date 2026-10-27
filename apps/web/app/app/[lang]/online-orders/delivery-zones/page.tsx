import { notFound } from "next/navigation";
import { hasLocale } from "../../../../../lib/i18n";
import { DeliveryZonesClient } from "./zones-client";
export default async function Page({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <DeliveryZonesClient locale={lang} />;
}

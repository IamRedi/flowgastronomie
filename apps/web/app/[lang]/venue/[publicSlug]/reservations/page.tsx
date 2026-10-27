import { notFound } from "next/navigation";
import { hasLocale } from "../../../../../lib/i18n";
import { ReservationRequestForm } from "./reservation-request-form";
export default async function Page({
  params,
}: {
  params: Promise<{ lang: string; publicSlug: string }>;
}) {
  const { lang, publicSlug } = await params;
  if (!hasLocale(lang)) notFound();
  return <ReservationRequestForm locale={lang} publicSlug={publicSlug} />;
}

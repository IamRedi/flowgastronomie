import { notFound } from "next/navigation";
import { hasLocale } from "../../../../lib/i18n";
import { StaffReservationsClient } from "./staff-reservations-client";

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <StaffReservationsClient locale={lang} />;
}

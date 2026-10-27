import { notFound } from "next/navigation";
import { hasLocale } from "../../../../lib/i18n";
import { CustomersClient } from "./customers-client";

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <CustomersClient locale={lang} />;
}

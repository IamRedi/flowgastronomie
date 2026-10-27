import { notFound } from "next/navigation";
import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";
import { SimpleOrdersClient } from "./simple-orders-client";

export default async function SimpleOrdersPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return (
    <SimpleOrdersClient
      locale={lang}
      counterLabels={dictionary.counterSale}
      hardwareLabels={dictionary.hardware}
    />
  );
}

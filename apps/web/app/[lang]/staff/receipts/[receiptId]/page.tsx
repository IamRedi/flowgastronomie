import { notFound } from "next/navigation";
import { getDictionary } from "../../../../../lib/dictionaries";
import { hasLocale } from "../../../../../lib/i18n";
import { ReceiptClient } from "./receipt-client";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ lang: string; receiptId: string }>;
}) {
  const { lang, receiptId } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return (
    <ReceiptClient
      id={receiptId}
      locale={lang}
      labels={dictionary.counterSale}
      hardwareLabels={dictionary.hardware}
    />
  );
}

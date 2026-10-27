import { notFound } from "next/navigation";
import { hasLocale } from "../../../../../lib/i18n";
import { CreativeWorkspace } from "../../../../../components/creative/workspace";
export default async function CreativePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <CreativeWorkspace locale={lang} />;
}

import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { WebsiteEditorClient } from "./website-editor-client";

export default async function WebsiteEditorPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  return <WebsiteEditorClient labels={dictionary.websiteAdmin} locale={lang} />;
}

import { notFound, redirect } from "next/navigation";

import { hasLocale } from "../../../lib/i18n";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  redirect(`/app/${lang}/overview`);
}

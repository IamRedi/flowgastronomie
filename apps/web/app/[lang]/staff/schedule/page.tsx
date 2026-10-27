import { notFound } from "next/navigation";

import { hasLocale } from "../../../../lib/i18n";

import { WorkforceWorkspace } from "../../../../components/workforce/workspace";

export default async function StaffSchedulePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <WorkforceWorkspace locale={lang} />;
}

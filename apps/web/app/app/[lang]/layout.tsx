import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getDictionary } from "../../../lib/dictionaries";
import { hasLocale, locales } from "../../../lib/i18n";
import "../../globals.css";
import { PilotAppShell } from "../../pilot-app-shell";

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dictionary = await getDictionary(lang);
  return {
    title: `${dictionary.workspace.nav.overview} — FlowGastronomie`,
    description: dictionary.workspace.subtitle,
  };
}

export default async function WorkspaceLocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return (
    <html lang={lang}>
      <body>
        <PilotAppShell locale={lang}>{children}</PilotAppShell>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { hasLocale } from "../../../lib/i18n";
import { PilotAppShell } from "../../pilot-app-shell";
export const metadata: Metadata = { manifest: "/workforce.webmanifest" };
export default async function StaffLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return <PilotAppShell locale={lang}>{children}</PilotAppShell>;
}

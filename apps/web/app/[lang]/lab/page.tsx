import { notFound } from "next/navigation";
import LabDashboard from "./lab-dashboard";
import "./lab.css";
export default async function Page({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  if (process.env.OPERATIONS_LAB_ENABLED !== "true") notFound();
  const { lang } = await params;
  if (!["sq", "de", "en", "it"].includes(lang)) notFound();
  return <LabDashboard lang={lang as "sq" | "de" | "en" | "it"} />;
}

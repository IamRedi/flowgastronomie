import { notFound } from "next/navigation";
import { hasLocale } from "../../../../lib/i18n";
import { PasswordResetForm } from "./password-reset-form";

export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function PasswordResetPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  return (
    <main className="staff-auth-page">
      <section className="staff-login-card">
        <PasswordResetForm locale={lang} />
      </section>
    </main>
  );
}

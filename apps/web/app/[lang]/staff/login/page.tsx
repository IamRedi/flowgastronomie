import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { StaffLoginForm } from "./staff-login-form";

export default async function StaffLoginPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const dictionary = await getDictionary(lang);

  return (
    <main className="staff-auth-page">
      <a className="brand staff-auth-brand" href={`/${lang}`}>
        <span className="brand-mark">FG</span>
        <span>FlowGastronomie</span>
      </a>
      <section className="staff-login-card">
        <p className="eyebrow">Service workspace</p>
        <h1>{dictionary.staff.loginTitle}</h1>
        <p>{dictionary.staff.loginSubtitle}</p>
        <StaffLoginForm labels={dictionary.staff} locale={lang} />
      </section>
    </main>
  );
}

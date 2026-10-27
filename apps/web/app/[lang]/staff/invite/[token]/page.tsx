import { notFound } from "next/navigation";

import { hasLocale } from "../../../../../lib/i18n";

import { AcceptInvitationForm } from "./accept-invitation-form";

const copy = {
  en: {
    title: "Join the restaurant team",
    subtitle: "Create your personal work profile and secure password.",
    name: "Full name",
    password: "Password",
    submit: "Activate profile",
    success: "Profile activated. You can now sign in.",
    login: "Go to staff sign-in",
    error: "This invitation is invalid, expired or already used.",
  },
  de: {
    title: "Dem Restaurantteam beitreten",
    subtitle: "Erstelle dein persönliches Arbeitsprofil und sicheres Passwort.",
    name: "Vollständiger Name",
    password: "Passwort",
    submit: "Profil aktivieren",
    success: "Profil aktiviert. Du kannst dich jetzt anmelden.",
    login: "Zur Mitarbeiter-Anmeldung",
    error: "Diese Einladung ist ungültig, abgelaufen oder bereits verwendet.",
  },
  it: {
    title: "Unisciti al team del ristorante",
    subtitle: "Crea il tuo profilo di lavoro personale e una password sicura.",
    name: "Nome completo",
    password: "Password",
    submit: "Attiva profilo",
    success: "Profilo attivato. Ora puoi accedere.",
    login: "Vai all'accesso staff",
    error: "Questo invito non è valido, è scaduto o è già stato usato.",
  },
  sq: {
    title: "Bashkohu me ekipin e restorantit",
    subtitle:
      "Krijo profilin tënd personal të punës dhe fjalëkalimin e sigurt.",
    name: "Emri i plotë",
    password: "Fjalëkalimi",
    submit: "Aktivizo profilin",
    success: "Profili u aktivizua. Tani mund të hysh.",
    login: "Shko te hyrja e stafit",
    error: "Kjo ftesë nuk është e vlefshme, ka skaduar ose është përdorur.",
  },
};

export default async function InvitePage({
  params,
}: {
  params: Promise<{ lang: string; token: string }>;
}) {
  const { lang, token } = await params;
  if (!hasLocale(lang)) notFound();
  return (
    <AcceptInvitationForm labels={copy[lang]} locale={lang} token={token} />
  );
}

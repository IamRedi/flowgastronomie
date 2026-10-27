import {
  SUBSCRIPTION_PLANS,
  businessProfileIds,
  businessCountries,
  premiumShowcase,
  type SubscriptionPlan,
} from "@flowgastronomie/domain";
import { notFound } from "next/navigation";

import { getDictionary } from "../../../lib/dictionaries";
import { hasLocale, localeNames, locales } from "../../../lib/i18n";

import { TrialSignupForm } from "./trial-signup-form";
import { PlatformLegalLinks } from "../../../components/platform-legal-links";

function selectedPlan(value: string | undefined): SubscriptionPlan {
  return SUBSCRIPTION_PLANS.find((plan) => plan === value) ?? "SMART_SERVICE";
}

export default async function SignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ plan?: string; profile?: string; style?: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const [query, dictionary] = await Promise.all([
    searchParams,
    getDictionary(lang),
  ]);
  const { plan } = query;
  const profile = businessProfileIds.find((p) => p === query.profile);
  const style = profile
    ? premiumShowcase(profile).styles.find((s) => s.id === query.style)
    : undefined;
  const labels = dictionary.signup;

  return (
    <main className="signup-page">
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href={`/${lang}`}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <div className="language-switcher">
          {locales.map((locale) => (
            <a
              aria-current={locale === lang ? "page" : undefined}
              href={`/${locale}/signup?plan=${selectedPlan(plan)}${profile ? `&profile=${profile}` : ""}${style ? `&style=${style.id}` : ""}`}
              hrefLang={locale}
              key={locale}
            >
              <span>{locale.toUpperCase()}</span>
              <span className="language-name">{localeNames[locale]}</span>
            </a>
          ))}
        </div>
      </nav>

      <div className="signup-layout shell">
        <section className="signup-intro">
          <a className="signup-back" href={`/${lang}/pricing`}>
            <span aria-hidden="true">←</span> {labels.back}
          </a>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
          <ul className="signup-assurances">
            <li>✓ {labels.secureSession}</li>
            <li>✓ {labels.noCard}</li>
            <li>✓ {labels.readyAfter}</li>
          </ul>
        </section>

        <section className="signup-card">
          <TrialSignupForm
            regionOptions={{
              countries: businessCountries
                .map((code) => ({
                  code,
                  name:
                    new Intl.DisplayNames(lang, { type: "region" }).of(code) ??
                    code,
                }))
                .sort((a, b) => a.name.localeCompare(b.name, lang)),
              currencies: Intl.supportedValuesOf("currency").map((code) => ({
                code,
                name:
                  new Intl.DisplayNames(lang, { type: "currency" }).of(code) ??
                  code,
              })),
              timezones: ["UTC", ...Intl.supportedValuesOf("timeZone")],
            }}
            initialProfile={profile ?? "GENERIC"}
            initialStyle={style?.id ?? null}
            initialPlan={selectedPlan(plan)}
            labels={labels}
            locale={lang}
            planLabels={dictionary.pricing.plans}
          />
          <p className="signup-signin">
            {labels.signInPrompt}{" "}
            <a href={`/${lang}/staff/login`}>{labels.signIn}</a>
          </p>
          <PlatformLegalLinks locale={lang} />
        </section>
      </div>
    </main>
  );
}

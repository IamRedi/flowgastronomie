import {
  PLAN_DEFINITIONS,
  SUBSCRIPTION_PLANS,
  type FeatureKey,
  type SubscriptionPlan,
} from "@flowgastronomie/domain";
import { notFound } from "next/navigation";

import { getDictionary } from "../../../lib/dictionaries";
import { hasLocale, localeNames, locales } from "../../../lib/i18n";

export default async function PricingPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  const labels = dictionary.pricing;

  return (
    <main className="pricing-page">
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href={"/" + lang}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <div className="nav-links">
          <a href={"/" + lang}>{labels.back}</a>
          <div className="language-switcher">
            {locales.map((locale) => (
              <a
                aria-current={locale === lang ? "page" : undefined}
                href={"/" + locale + "/pricing"}
                hrefLang={locale}
                key={locale}
              >
                <span>{locale.toUpperCase()}</span>
                <span className="language-name">{localeNames[locale]}</span>
              </a>
            ))}
          </div>
        </div>
      </nav>

      <header className="pricing-intro shell">
        <p className="eyebrow">{labels.eyebrow}</p>
        <h1>{labels.title}</h1>
        <p>{labels.subtitle}</p>
      </header>

      <section className="pricing-grid shell">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <PricingCard key={plan} labels={labels} lang={lang} plan={plan} />
        ))}
      </section>

      <p className="pricing-boundary shell">{labels.noCard}</p>
    </main>
  );
}

function PricingCard({
  labels,
  lang,
  plan,
}: {
  labels: Awaited<ReturnType<typeof getDictionary>>["pricing"];
  lang: "en" | "de" | "it" | "sq";
  plan: SubscriptionPlan;
}) {
  const definition = PLAN_DEFINITIONS[plan];
  const copy = labels.plans[plan];
  return (
    <article
      className={
        "pricing-card" + (definition.featured ? " pricing-card-featured" : "")
      }
    >
      {definition.featured && (
        <span className="pricing-popular">{labels.popular}</span>
      )}
      <div>
        <span className="pricing-trial">{labels.trial}</span>
        <h2>{copy.name}</h2>
        <p>{copy.description}</p>
      </div>
      <div className="pricing-price">
        <strong>
          {new Intl.NumberFormat(lang, {
            style: "currency",
            currency: definition.currency,
            maximumFractionDigits: 0,
          }).format(definition.monthlyPriceMinor / 100)}
        </strong>
        <span>{labels.monthly}</span>
      </div>
      <div className="pricing-actions">
        <a
          className="button button-primary"
          href={"/" + lang + "/signup?plan=" + plan}
        >
          {labels.startTrial}
          <span aria-hidden="true">→</span>
        </a>
        <a
          className="button button-ghost"
          href={"/" + lang + "/showcase?plan=" + plan}
        >
          {labels.viewDemo}
        </a>
      </div>
      <div className="pricing-features">
        <h3>{labels.included}</h3>
        <ul>
          {definition.features.map((feature) => (
            <li key={feature}>
              <span aria-hidden="true">✓</span>
              {labels.features[feature as FeatureKey]}
            </li>
          ))}
        </ul>
      </div>
      <div className="pricing-limits">
        <h3>{labels.limits}</h3>
        <span>
          {definition.limits.venues} {labels.venues}
        </span>
        <span>
          {definition.limits.staffSeats} {labels.staffSeats}
        </span>
        <span>
          {definition.limits.publishedSites} {labels.publishedSites}
        </span>
      </div>
    </article>
  );
}

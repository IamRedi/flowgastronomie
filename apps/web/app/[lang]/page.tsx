import { PRODUCT_CATALOG } from "@flowgastronomie/domain";
import { notFound } from "next/navigation";

import { getDictionary } from "../../lib/dictionaries";
import { hasLocale, localeNames, locales, type Locale } from "../../lib/i18n";

function LanguageSwitcher({
  currentLocale,
  label,
}: {
  currentLocale: Locale;
  label: string;
}) {
  return (
    <div className="language-switcher" aria-label={label}>
      {locales.map((locale) => (
        <a
          aria-current={locale === currentLocale ? "page" : undefined}
          href={`/${locale}`}
          key={locale}
          hrefLang={locale}
        >
          <span>{locale.toUpperCase()}</span>
          <span className="language-name">{localeNames[locale]}</span>
        </a>
      ))}
    </div>
  );
}

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const dictionary = await getDictionary(lang);

  return (
    <main>
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href={`/${lang}#top`} aria-label="FlowGastronomie">
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <div className="nav-links">
          <a href="#product">{dictionary.nav.product}</a>
          <a href="#radar">{dictionary.nav.radar}</a>
          <a href={"/" + lang + "/pricing"}>{dictionary.nav.pricing}</a>
          <a className="button button-small button-ghost" href="#pilot">
            {dictionary.nav.pilot}
          </a>
          <LanguageSwitcher
            currentLocale={lang}
            label={dictionary.nav.language}
          />
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <p className="eyebrow">{dictionary.hero.eyebrow}</p>
          <h1>{dictionary.hero.title}</h1>
          <p className="hero-text">{dictionary.hero.text}</p>
          <div className="hero-actions">
            <a className="button button-primary" href="#product">
              {dictionary.hero.action}
              <span aria-hidden="true">→</span>
            </a>
            <span className="microcopy">{dictionary.hero.microcopy}</span>
          </div>
        </div>

        <div className="mode-card" aria-label={dictionary.hero.modeLabel}>
          <div className="mode-card-top">
            <span className="live-dot" />
            <span>{dictionary.hero.active}</span>
            <span className="mode-time">{dictionary.hero.time}</span>
          </div>
          <div className="mode-focus">
            <span className="mode-icon" aria-hidden="true">
              ✓
            </span>
            <div>
              <p>{dictionary.hero.modeLabel}</p>
              <h2>{dictionary.hero.mode}</h2>
            </div>
          </div>
          <div className="mode-flow">
            {dictionary.hero.flow.map((step, index) => (
              <span className="flow-step" key={step}>
                {index > 0 && <i aria-hidden="true" />}
                <span>{step}</span>
              </span>
            ))}
          </div>
          <p className="mode-note">
            {dictionary.hero.overridePrefix}{" "}
            <strong>{dictionary.hero.overrideMode}</strong>
          </p>
        </div>
      </section>

      <section
        className="product-family-section shell"
        aria-labelledby="product-family-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">{dictionary.productFamilies.eyebrow}</p>
            <h2 id="product-family-title">
              {dictionary.productFamilies.title}
            </h2>
          </div>
          <p>{dictionary.productFamilies.intro}</p>
        </div>
        <div className="product-family-grid">
          {PRODUCT_CATALOG.map((product) => {
            const active = product.status === "ACTIVE";
            return (
              <article
                className={`product-family-card${active ? " product-family-active" : ""}`}
                key={product.code}
              >
                <span>
                  {product.status === "ACTIVE"
                    ? dictionary.productFamilies.active
                    : product.status === "LATER"
                      ? dictionary.productFamilies.later
                      : dictionary.productFamilies.planned}
                </span>
                <h3>{product.name}</h3>
                <p>{dictionary.productFamilies.products[product.code]}</p>
                {active && (
                  <a
                    className="button button-primary"
                    href={`/${lang}/pricing`}
                  >
                    {dictionary.nav.pricing}
                    <span aria-hidden="true">→</span>
                  </a>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="product-section" id="product">
        <div className="shell section-heading">
          <div>
            <p className="eyebrow">{dictionary.guest.eyebrow}</p>
            <h2>{dictionary.guest.title}</h2>
          </div>
          <p>{dictionary.guest.intro}</p>
        </div>

        <div className="shell showcase-grid">
          <article className="phone" aria-label={dictionary.guest.eyebrow}>
            <header className="phone-header">
              <div>
                <span className="restaurant-kicker">
                  {dictionary.guest.restaurant}
                </span>
                <h3>{dictionary.guest.greeting}</h3>
                <p>{dictionary.guest.table}</p>
              </div>
              <span
                className="round-button"
                aria-label={dictionary.nav.language}
              >
                {lang.toUpperCase()}
              </span>
            </header>
            <div className="category-tabs" aria-label="Menu categories">
              {dictionary.guest.categories.map((category, index) => (
                <span className={index === 0 ? "active" : ""} key={category}>
                  {category}
                </span>
              ))}
            </div>
            <div className="menu-list">
              {dictionary.guest.items.map((item) => (
                <div className="menu-item" key={item.name}>
                  <div className="food-placeholder" aria-hidden="true">
                    <span>✦</span>
                  </div>
                  <div className="menu-copy">
                    <span className="item-tag">{item.tag}</span>
                    <h4>{item.name}</h4>
                    <p>{item.detail}</p>
                    <strong>{item.price}</strong>
                  </div>
                  <button aria-label={`${dictionary.guest.add}: ${item.name}`}>
                    +
                  </button>
                </div>
              ))}
            </div>
            <div className="phone-actions">
              <button className="service-button">
                {dictionary.guest.callWaiter}
              </button>
              <button className="cart-button">
                {dictionary.guest.cart}{" "}
                <strong>{dictionary.guest.cartTotal}</strong>
              </button>
            </div>
          </article>

          <div className="feature-stack">
            {dictionary.features.map((feature, index) => (
              <article
                className={`feature-card ${index === 0 ? "feature-main" : ""} ${index === 2 ? "feature-dark" : ""}`}
                key={feature.title}
              >
                <span className="feature-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
                {index === 0 && (
                  <div
                    className="avatar-row"
                    aria-label={dictionary.tableConnected}
                  >
                    <span>AK</span>
                    <span>ER</span>
                    <span>JM</span>
                    <span>+1</span>
                    <small>{dictionary.tableConnected}</small>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="radar-section" id="radar">
        <div className="shell radar-grid">
          <div className="radar-copy">
            <p className="eyebrow eyebrow-light">{dictionary.radar.eyebrow}</p>
            <h2>{dictionary.radar.title}</h2>
            <p>{dictionary.radar.text}</p>
            <ul>
              {dictionary.radar.benefits.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
            <a
              className="button button-primary radar-demo-link"
              href={`/${lang}/demo/radar`}
            >
              {dictionary.radar.open}
              <span aria-hidden="true">→</span>
            </a>
          </div>

          <article className="radar-panel">
            <header>
              <div>
                <span className="panel-kicker">{dictionary.radar.date}</span>
                <h3>Service Radar</h3>
              </div>
              <span className="shift-status">{dictionary.radar.shift}</span>
            </header>
            <div className="radar-summary">
              {dictionary.radar.summary.map((item) => (
                <div key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <div className="signal-list">
              {dictionary.radar.signals.map((item) => (
                <div className={`signal ${item.tone}`} key={item.table}>
                  <span className="table-number">{item.table}</span>
                  <div>
                    <small>{item.area}</small>
                    <strong>{item.request}</strong>
                  </div>
                  <span className="wait-time">{item.wait}</span>
                  <button>{dictionary.radar.open}</button>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="pilot-section shell" id="pilot">
        <p className="eyebrow">{dictionary.pilot.eyebrow}</p>
        <h2>{dictionary.pilot.title}</h2>
        <p>{dictionary.pilot.text}</p>
        <a
          className="button button-primary"
          href="mailto:pilot@flowgastronomie.local"
        >
          {dictionary.pilot.action}
          <span aria-hidden="true">→</span>
        </a>
      </section>

      <footer className="shell footer">
        <a className="brand" href={`/${lang}#top`}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <p>{dictionary.footer}</p>
      </footer>
    </main>
  );
}

import type {
  OpeningHoursEntry,
  PlatformLocale,
  CanonicalMediaReference,
} from "@flowgastronomie/domain";
import { PremiumSite } from "./premium-site";
import type { CSSProperties } from "react";

import type { Dictionary } from "../lib/dictionaries";
import { locales, type Locale } from "../lib/i18n";
import { TrackOrderEntry } from "./track-order-entry";

export type VenueSiteData = {
  locale: PlatformLocale;
  publicSlug: string;
  pickupEnabled?: boolean;
  venue: { name: string; currency: string };
  brand: {
    premiumStyleId?: string | null | undefined;
    primaryColor: string;
    accentColor: string;
    logoUrl: string | null;
    heroImageUrl: string | null;
  };
  contact: {
    phone: string | null;
    email: string | null;
    address: string | null;
    instagramUrl: string | null;
    facebookUrl: string | null;
    openingHours: OpeningHoursEntry[];
  };
  content: {
    heroTitle: string;
    heroSubtitle: string;
    storyTitle: string;
    storyBody: string;
    seoTitle: string;
    seoDescription: string;
  };
  legal?: {
    legalName: string;
    addressLine1: string;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId: string | null;
  } | null;
  menu: Array<{
    id: string;
    name: string;
    products: Array<{
      media?: CanonicalMediaReference;
      id: string;
      name: string;
      description: string | null;
      priceMinor: number;
      currency: string;
      available: boolean;
    }>;
  }>;
};

export function VenueSiteView({
  apiUrl,
  homeHref,
  labels,
  languageHref,
  locale,
  website,
}: {
  apiUrl: string;
  homeHref: string;
  labels: Dictionary["publicSite"];
  languageHref: (locale: Locale) => string;
  locale: Locale;
  website: VenueSiteData;
}) {
  if (website.brand.premiumStyleId)
    return (
      <PremiumSite
        website={website}
        locale={locale}
        homeHref={homeHref}
        languageHref={languageHref}
        apiUrl={apiUrl}
        labels={labels}
      />
    );
  const assetUrl = (value: string | null) =>
    value?.startsWith("/v1/") ? `${apiUrl}${value}` : value;
  const logoUrl = assetUrl(website.brand.logoUrl);
  const heroImageUrl = assetUrl(website.brand.heroImageUrl);
  const style = {
    "--site-primary": website.brand.primaryColor,
    "--site-accent": website.brand.accentColor,
  } as CSSProperties;

  return (
    <main className="venue-site" style={style}>
      <nav className="venue-site-nav">
        <a className="venue-site-brand" href={languageHref(locale)}>
          {logoUrl ? (
            <img alt={website.venue.name} src={logoUrl} />
          ) : (
            <span>{website.venue.name.slice(0, 1)}</span>
          )}
          <strong>{website.venue.name}</strong>
        </a>
        <div>
          <a href="#story">{labels.story}</a>
          <a href="#menu">{labels.menu}</a>
          {website.pickupEnabled && (
            <a
              href={`/${locale}/order/${encodeURIComponent(website.publicSlug)}`}
            >
              {locale === "sq"
                ? "Porosit"
                : locale === "de"
                  ? "Bestellen"
                  : locale === "it"
                    ? "Ordina"
                    : "Order"}
            </a>
          )}
          <a href="#contact">{labels.contact}</a>
          <TrackOrderEntry locale={locale} publicSlug={website.publicSlug} />
          <div className="venue-site-languages" aria-label={labels.languages}>
            {locales.map((item) => (
              <a
                aria-current={item === locale ? "page" : undefined}
                href={languageHref(item)}
                hrefLang={item}
                key={item}
              >
                {item.toUpperCase()}
              </a>
            ))}
          </div>
        </div>
      </nav>

      <header
        className={`venue-site-hero${heroImageUrl ? " venue-site-hero-image" : ""}`}
        style={
          heroImageUrl
            ? {
                backgroundImage: `linear-gradient(rgba(10,25,20,.42), rgba(10,25,20,.58)), url("${heroImageUrl}")`,
              }
            : undefined
        }
      >
        <p>{website.venue.name}</p>
        <h1>{website.content.heroTitle}</h1>
        <span>{website.content.heroSubtitle}</span>
        <a href="#menu">{labels.menu} ↓</a>
        {website.pickupEnabled && (
          <a
            href={`/${locale}/order/${encodeURIComponent(website.publicSlug)}`}
          >
            {locale === "sq"
              ? "Porosit"
              : locale === "de"
                ? "Bestellen"
                : locale === "it"
                  ? "Ordina"
                  : "Order"}
          </a>
        )}
      </header>

      <section className="venue-site-story" id="story">
        <p>{labels.story}</p>
        <div>
          <h2>{website.content.storyTitle}</h2>
          <p>{website.content.storyBody}</p>
        </div>
      </section>

      <section className="venue-site-menu" id="menu">
        <header>
          <p>{website.venue.name}</p>
          <h2>{labels.menu}</h2>
        </header>
        <div className="venue-menu-categories">
          {website.menu.map((category) => (
            <section key={category.id}>
              <h3>{category.name}</h3>
              <div>
                {category.products.map((product) => (
                  <article
                    className={!product.available ? "unavailable" : undefined}
                    key={product.id}
                  >
                    <div>
                      <strong>{product.name}</strong>
                      {product.media && (
                        <figure>
                          <img
                            src={assetUrl(product.media.url) ?? undefined}
                            alt={product.name}
                            width={160}
                            height={120}
                            loading="lazy"
                            style={{ objectFit: "cover", borderRadius: 12 }}
                          />
                          {product.media.label && (
                            <figcaption>{product.media.label}</figcaption>
                          )}
                        </figure>
                      )}
                      {!product.available && (
                        <small>{labels.unavailable}</small>
                      )}
                    </div>
                    <span>
                      {new Intl.NumberFormat(locale, {
                        style: "currency",
                        currency: product.currency,
                      }).format(product.priceMinor / 100)}
                    </span>
                    {product.description && <p>{product.description}</p>}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="venue-site-contact" id="contact">
        <div>
          <p>{labels.contact}</p>
          <h2>{website.venue.name}</h2>
          {website.contact.address && (
            <address>{website.contact.address}</address>
          )}
          {website.contact.phone && (
            <a href={`tel:${website.contact.phone}`}>{website.contact.phone}</a>
          )}
          {website.contact.email && (
            <a href={`mailto:${website.contact.email}`}>
              {website.contact.email}
            </a>
          )}
          <div className="venue-site-socials">
            {website.contact.instagramUrl && (
              <a href={website.contact.instagramUrl}>Instagram ↗</a>
            )}
            {website.contact.facebookUrl && (
              <a href={website.contact.facebookUrl}>Facebook ↗</a>
            )}
          </div>
        </div>
        <div>
          <h3>{labels.hours}</h3>
          <dl>
            {website.contact.openingHours.map((entry) => (
              <div key={entry.day}>
                <dt>{labels.days[entry.day]}</dt>
                <dd>
                  {entry.closed
                    ? labels.closed
                    : `${entry.opensAt}–${entry.closesAt}`}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <footer className="venue-site-footer">
        <strong>{website.venue.name}</strong>
        <div>
          <a href={`/${locale}/venue/${website.publicSlug}/imprint`}>
            {labels.imprint}
          </a>
          <a href={`/${locale}/venue/${website.publicSlug}/privacy`}>
            {labels.privacy}
          </a>
          <a href={homeHref}>{labels.poweredBy}</a>
        </div>
      </footer>
    </main>
  );
}

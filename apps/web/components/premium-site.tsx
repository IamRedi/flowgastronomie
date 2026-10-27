import { formatCurrency } from "../lib/format-currency";
import { TrackOrderEntry } from "./track-order-entry";
import type { Dictionary } from "../lib/dictionaries";
import type { CSSProperties } from "react";
import { premiumStyles } from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import { premiumCopy } from "./premium-copy";
import type { VenueSiteData } from "./venue-site-view";
import "./premium-site.css";

export function PremiumSite({
  website,
  locale,
  sample = false,
  homeHref,
  languageHref,
  apiUrl = "",
  labels,
}: {
  website: VenueSiteData;
  locale: Locale;
  sample?: boolean;
  homeHref: string;
  languageHref: (locale: Locale) => string;
  apiUrl?: string;
  labels?: Dictionary["publicSite"];
}) {
  const style = premiumStyles().find(
    (s) => s.id === website.brand.premiumStyleId,
  );
  const words = premiumCopy(locale);
  const asset = (url: string | null) =>
    url?.startsWith("/v1/") ? `${apiUrl}${url}` : url;
  const hero = asset(website.brand.heroImageUrl);
  return (
    <article
      lang={locale}
      className={`premium-site premium-${style?.layout.toLowerCase() ?? "editorial"}`}
      style={
        {
          "--premium-ink": website.brand.primaryColor,
          "--premium-paper": style?.backgroundColor ?? "#faf5eb",
          "--premium-accent": website.brand.accentColor,
        } as CSSProperties
      }
    >
      <header className="premium-nav">
        <a className="premium-identity" href={homeHref}>
          {website.brand.logoUrl ? (
            <img
              alt=""
              width="48"
              height="48"
              src={asset(website.brand.logoUrl)!}
            />
          ) : (
            <span className="premium-monogram" aria-hidden="true">
              {website.venue.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
          )}
          <strong>{website.venue.name}</strong>
        </a>
        <nav aria-label={words.menu}>
          <a href="#premium-menu">{words.menu}</a>
          <a href="#premium-story">{words.story}</a>
          <a href="#premium-contact">{words.contact}</a>
        </nav>
        <nav className="premium-languages" aria-label="Language">
          {(["sq", "de", "en", "it"] as const).map((l) => (
            <a
              key={l}
              href={languageHref(l)}
              hrefLang={l}
              aria-current={locale === l ? "page" : undefined}
            >
              {l.toUpperCase()}
            </a>
          ))}
        </nav>
      </header>
      {!sample && website.pickupEnabled && (
        <nav className="premium-service">
          <a
            className="premium-button"
            href={`/${locale}/order/${website.publicSlug}`}
          >
            {
              { en: "Order", de: "Bestellen", it: "Ordina", sq: "Porosit" }[
                locale
              ]
            }
          </a>
          <TrackOrderEntry locale={locale} publicSlug={website.publicSlug} />
        </nav>
      )}
      {sample && <p className="premium-disclosure">{words.demo}</p>}
      <section className="premium-hero">
        <div className="premium-hero-copy">
          <p className="premium-kicker">{website.venue.name}</p>
          <h1>{website.content.heroTitle || website.venue.name}</h1>
          <p>{website.content.heroSubtitle}</p>
          <a className="premium-button" href="#premium-menu">
            {words.explore}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
        <figure className="premium-hero-image">
          {hero ? (
            <img
              src={hero}
              alt={sample ? words.photography : website.venue.name}
              width="1200"
              height="900"
              fetchPriority="high"
            />
          ) : (
            <div className="premium-art" aria-label={words.identity}>
              <span>{website.venue.name}</span>
              <span aria-hidden="true">✳</span>
            </div>
          )}
          {sample && hero && <figcaption>{words.photography}</figcaption>}
        </figure>
      </section>
      <section className="premium-story" id="premium-story">
        <p className="premium-kicker">01 / {words.story}</p>
        <h2>{website.content.storyTitle || words.storyBody}</h2>
        <p>{website.content.storyBody}</p>
      </section>
      <section className="premium-menu" id="premium-menu">
        <header>
          <p className="premium-kicker">02 / {words.menu}</p>
          <h2>{words.explore}</h2>
          {sample && <p>{words.disclaimer}</p>}
        </header>
        {website.menu.length === 0 && (
          <p className="premium-empty-menu">
            {
              {
                en: "Space for your own menu. Add your categories and dishes when you are ready.",
                de: "Platz für deine eigene Karte. Ergänze deine Kategorien und Gerichte, sobald du bereit bist.",
                it: "Spazio per il tuo menu. Aggiungi categorie e piatti quando vuoi.",
                sq: "Hapësirë për menunë tënde. Shto kategoritë dhe pjatat kur të jesh gati.",
              }[locale]
            }
          </p>
        )}
        <nav className="premium-category-nav" aria-label={words.menu}>
          {website.menu.map((c) => (
            <a href={`#premium-${c.id}`} key={c.id}>
              {c.name}
            </a>
          ))}
        </nav>
        <div className="premium-menu-sections">
          {website.menu.map((c, categoryIndex) => (
            <section id={`premium-${c.id}`} key={c.id}>
              <h3>
                <span className="premium-category-number" aria-hidden="true">
                  {String(categoryIndex + 1).padStart(2, "0")}
                </span>
                {c.name}
              </h3>
              <div className="premium-products">
                {c.products.map((p) => (
                  <article
                    key={p.id}
                    className={p.media ? "has-photo" : "text-only"}
                  >
                    {p.media && (
                      <figure className="premium-product-photo">
                        <img
                          loading="lazy"
                          src={asset(p.media.url)!}
                          alt={p.name}
                          width={p.media.width}
                          height={p.media.height}
                        />
                        {!sample && p.media.source === "DEMO" && (
                          <figcaption>SAMPLE</figcaption>
                        )}
                      </figure>
                    )}
                    <div>
                      <h4>{p.name}</h4>
                      <p>{p.description}</p>
                      {!sample && !p.available && labels && (
                        <small>{labels.unavailable}</small>
                      )}
                    </div>
                    <strong>
                      {formatCurrency(p.priceMinor, p.currency, locale)}
                    </strong>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
      <footer className="premium-contact" id="premium-contact">
        <div>
          <p className="premium-kicker">03 / {words.contact}</p>
          <h2>{words.visit}</h2>
          <p>{website.contact.address ?? words.contactPlaceholder}</p>
          {website.contact.phone && <p>{website.contact.phone}</p>}
          {website.contact.email && <p>{website.contact.email}</p>}
        </div>
        <div>
          <strong>{website.venue.name}</strong>
          {sample && <p>{words.demo}</p>}
          {website.contact.openingHours.map((h) => (
            <p key={h.day}>
              {labels?.days[h.day] ?? h.day} ·{" "}
              {h.closed
                ? (labels?.closed ?? "—")
                : `${h.opensAt}–${h.closesAt}`}
            </p>
          ))}
        </div>
      </footer>
      {!sample && labels && (
        <nav className="premium-legal">
          <a href={`/${locale}/venue/${website.publicSlug}/imprint`}>
            {labels.imprint}
          </a>
          <a href={`/${locale}/venue/${website.publicSlug}/privacy`}>
            {labels.privacy}
          </a>
          <a href={homeHref}>{labels.poweredBy}</a>
        </nav>
      )}
    </article>
  );
}

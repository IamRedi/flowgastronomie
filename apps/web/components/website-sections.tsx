import { WebsiteInlineText } from "./website-inline-text";
import {
  premiumStyles,
  type WebsiteDocument,
  type CanonicalMediaReference,
} from "@flowgastronomie/domain";
import type { CSSProperties, ReactNode } from "react";
import { publicOrderCopy, publicWeekday } from "../lib/public-order-copy";
import type { VenueSiteData } from "./venue-site-view";
import { premiumCopy } from "./premium-copy";
import { formatCurrency } from "../lib/format-currency";
import "./website-sections.css";

export function WebsiteSections({
  website,
  apiUrl,
  onSelect,
  selected,
  languageHref,
  onTextChange,
  onPhoto,
  onProduct,
  onImageLoad,
  publicExperience = false,
  menuContent,
  headerActions,
  footerActions,
  gallery,
}: {
  website: VenueSiteData & { document: WebsiteDocument };
  apiUrl: string;
  onSelect?: ((id: string) => void) | undefined;
  selected?: string | undefined;
  onTextChange?:
    ((id: string, field: "title" | "body", value: string) => void) | undefined;
  onPhoto?: ((id: string) => void) | undefined;
  onProduct?: ((id: string) => void) | undefined;
  onImageLoad?: (id: string) => void;
  languageHref?: (locale: typeof website.locale) => string;
  publicExperience?: boolean;
  menuContent?: ReactNode;
  headerActions?: ReactNode;
  footerActions?: ReactNode;
  gallery?: ReactNode;
}) {
  const { document: doc, locale } = website;
  const words = premiumCopy(locale);
  const style = premiumStyles().find(
    (s) => s.id === website.brand.premiumStyleId,
  );
  const asset = (url: string) =>
    url.startsWith("/v1/") ? `${apiUrl}${url}` : url;
  const media = new Map((website.sectionMedia ?? []).map((m) => [m.id, m]));
  const names = {
    HERO: website.venue.name,
    ABOUT: words.story,
    MENU: words.menu,
    GALLERY: { en: "Gallery", de: "Galerie", it: "Galleria", sq: "Galeria" }[
      locale
    ],
    CONTACT: words.contact,
  };
  const visible = doc.sections.filter(
    (s) =>
      onSelect ||
      (s.visible &&
        (s.type !== "MENU" ||
          website.menu.some((c) => c.products.length > 0)) &&
        (s.type !== "GALLERY" || s.media.length > 0) &&
        (s.type !== "CONTACT" ||
          website.contact.phone ||
          website.contact.email ||
          website.contact.address ||
          website.contact.openingHours.length > 0 ||
          website.pickupEnabled)),
  );
  if (publicExperience)
    visible.sort(
      (a, b) =>
        ["HERO", "GALLERY", "MENU", "ABOUT", "CONTACT"].indexOf(a.type) -
        ["HERO", "GALLERY", "MENU", "ABOUT", "CONTACT"].indexOf(b.type),
    );
  function photo(
    ref: CanonicalMediaReference,
    alt: string,
    x: number,
    y: number,
    hero: boolean,
    sectionId?: string,
  ) {
    return (
      <figure
        key={ref.id}
        className={
          hero && ref.url === website.brand.logoUrl ? "ws-logo-hero" : undefined
        }
        role={sectionId && onPhoto ? "button" : undefined}
        tabIndex={sectionId && onPhoto ? 0 : undefined}
        aria-label={
          sectionId && onPhoto ? `${names.GALLERY}: ${alt}` : undefined
        }
        onClick={sectionId && onPhoto ? () => onPhoto(sectionId) : undefined}
        onKeyDown={
          sectionId && onPhoto
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPhoto(sectionId);
                }
              }
            : undefined
        }
      >
        <img
          src={asset(ref.url)}
          onLoad={onImageLoad ? () => onImageLoad(ref.id) : undefined}
          alt={alt || website.venue.name}
          width={ref.width}
          height={ref.height}
          loading={hero ? "eager" : "lazy"}
          fetchPriority={hero ? "high" : "auto"}
          style={{ objectPosition: `${x}% ${y}%` }}
        />
        {ref.source === "DEMO" && <figcaption>DEMO</figcaption>}
        {ref.source === "GENERATED" && (
          <figcaption>
            {
              {
                en: "AI illustration",
                de: "KI-Illustration",
                it: "Illustrazione IA",
                sq: "Ilustrim AI",
              }[locale]
            }
          </figcaption>
        )}
      </figure>
    );
  }
  return (
    <article
      lang={locale}
      className={`website-sections ${publicExperience ? "public-experience" : ""} ${website.designVersion === 2 ? "experience-v2" : ""} ${onSelect ? "is-editing" : ""} typography-${doc.typography.toLowerCase()} design-${style?.layout.toLowerCase() ?? "editorial"}`}
      style={
        {
          "--ws-ink": website.brand.primaryColor,
          "--ws-paper": style?.backgroundColor ?? "#faf7f0",
          "--ws-accent": website.brand.accentColor,
        } as CSSProperties
      }
    >
      <header className="ws-header">
        <strong>
          {website.brand.logoUrl && (
            <img
              src={asset(website.brand.logoUrl)}
              alt=""
              width={40}
              height={40}
            />
          )}{" "}
          {website.venue.name}
        </strong>
        <nav aria-label={words.menu}>
          {visible
            .filter(
              (s) =>
                s.visible &&
                s.type !== "HERO" &&
                (!publicExperience || s.type !== "GALLERY"),
            )
            .map((s) => (
              <a key={s.id} href={`#section-${s.id}`}>
                {names[s.type]}
              </a>
            ))}
        </nav>
        {languageHref && (
          <nav aria-label="Language">
            {(["sq", "de", "en", "it"] as const).map((language) => (
              <a
                key={language}
                hrefLang={language}
                aria-current={locale === language ? "page" : undefined}
                href={languageHref(language)}
              >
                {language.toUpperCase()}
              </a>
            ))}
          </nav>
        )}
        {headerActions}
      </header>
      {visible.map((section) => {
        const copy =
          section.content.find((c) => c.locale === locale) ??
          section.content[0]!;
        return (
          <section
            key={section.id}
            id={`section-${section.id}`}
            className={`ws-section ws-${section.type.toLowerCase()} layout-${section.layout.toLowerCase()} ${selected === section.id ? "selected" : ""} ${!section.visible ? "is-hidden" : ""} ${section.type === "CONTACT" && !website.contact.phone && !website.contact.email && !website.contact.address && !website.contact.openingHours.length ? "is-empty" : ""}`}
          >
            {onSelect && (
              <button
                className="ws-select"
                type="button"
                aria-pressed={selected === section.id}
                onClick={() => onSelect(section.id)}
              >
                {names[section.type]} ·{" "}
                {
                  {
                    en: "Edit",
                    de: "Bearbeiten",
                    it: "Modifica",
                    sq: "Ndrysho",
                  }[locale]
                }
              </button>
            )}
            <div className="ws-copy">
              {section.type === "MENU" && website.demoMenu && (
                <small className="ws-preview-badge">DEMO</small>
              )}
              {section.type === "HERO" ? (
                <h1>
                  {onTextChange ? (
                    <WebsiteInlineText
                      value={copy.title}
                      placeholder={names[section.type]}
                      label={`${names[section.type]}: ${locale}`}
                      limit={120}
                      onChange={(value) =>
                        onTextChange(section.id, "title", value)
                      }
                    />
                  ) : (
                    copy.title || website.venue.name
                  )}
                </h1>
              ) : (
                <h2>
                  {onTextChange ? (
                    <WebsiteInlineText
                      value={copy.title}
                      placeholder={names[section.type]}
                      label={`${names[section.type]}: ${locale}`}
                      limit={120}
                      onChange={(value) =>
                        onTextChange(section.id, "title", value)
                      }
                    />
                  ) : (
                    copy.title || names[section.type]
                  )}
                </h2>
              )}
              {(copy.body ||
                (onTextChange && ["HERO", "ABOUT"].includes(section.type))) && (
                <p>
                  {onTextChange ? (
                    <WebsiteInlineText
                      value={copy.body}
                      label={`${names[section.type]}: ${words.story}`}
                      multiline
                      limit={section.type === "HERO" ? 280 : 2000}
                      onChange={(value) =>
                        onTextChange(section.id, "body", value)
                      }
                    />
                  ) : (
                    copy.body
                  )}
                </p>
              )}
              {section.type === "HERO" &&
                website.menu.some((c) => c.products.length > 0) &&
                doc.sections.some((s) => s.type === "MENU" && s.visible) && (
                  <a
                    className="ws-cta"
                    href={`#section-${doc.sections.find((s) => s.type === "MENU")!.id}`}
                  >
                    {words.explore} ↗
                  </a>
                )}
            </div>
            {section.media.length > 0 &&
              !(publicExperience && section.type === "GALLERY") && (
                <div className="ws-images">
                  {section.media.map((m) => {
                    const ref = media.get(m.assetId);
                    return ref
                      ? photo(
                          ref,
                          m.alt,
                          m.x,
                          m.y,
                          section.type === "HERO",
                          section.id,
                        )
                      : null;
                  })}
                </div>
              )}
            {onPhoto &&
              !section.media.length &&
              ["HERO", "ABOUT", "GALLERY"].includes(section.type) && (
                <button
                  className="ws-add-photo"
                  onClick={() => onPhoto(section.id)}
                >
                  + {names.GALLERY}
                </button>
              )}
            {publicExperience &&
              section.type === "HERO" &&
              !section.media.length &&
              website.brand.heroImageUrl && (
                <div className="ws-images">
                  <figure>
                    <img
                      src={asset(website.brand.heroImageUrl)}
                      alt={website.venue.name}
                      width={1200}
                      height={900}
                      fetchPriority="high"
                    />
                  </figure>
                </div>
              )}
            {section.type === "HERO" &&
              !section.media.length &&
              !onPhoto &&
              !(publicExperience && website.brand.heroImageUrl) && (
                <div className="ws-art" aria-hidden="true">
                  ✳
                </div>
              )}
            {section.type === "GALLERY" && publicExperience && gallery}
            {section.type === "MENU" && menuContent}
            {section.type === "MENU" && !menuContent && (
              <div className="ws-menu">
                {website.menu.map((category) => (
                  <div key={category.id}>
                    <h3>{category.name}</h3>
                    <div className="ws-products">
                      {category.products.map((p) => (
                        <article key={p.id}>
                          {onProduct && (
                            <button
                              className="ws-product-edit"
                              aria-label={`${words.menu}: ${p.name}`}
                              onClick={() => onProduct(p.id)}
                            >
                              {p.name}
                            </button>
                          )}
                          {p.media && photo(p.media, p.name, 50, 50, false)}
                          <div>
                            <h4>{p.name}</h4>
                            <p>{p.description}</p>
                          </div>
                          <strong>
                            {formatCurrency(p.priceMinor, p.currency, locale)}
                          </strong>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {section.type === "CONTACT" && (
              <address>
                {website.contact.address && (
                  <>
                    <p>{website.contact.address}</p>
                    {publicExperience && (
                      <a
                        className="public-map-link"
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(website.contact.address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        referrerPolicy="no-referrer"
                      >
                        {publicOrderCopy(locale)[12]} ↗
                      </a>
                    )}
                  </>
                )}
                {website.contact.phone && (
                  <a href={`tel:${website.contact.phone}`}>
                    {website.contact.phone}
                  </a>
                )}
                {website.contact.email && (
                  <a href={`mailto:${website.contact.email}`}>
                    {website.contact.email}
                  </a>
                )}
                {website.contact.openingHours.map((h) => (
                  <p key={h.day}>
                    {publicWeekday(locale, h.day)} ·{" "}
                    {h.closed ? "—" : `${h.opensAt}–${h.closesAt}`}
                  </p>
                ))}
                {publicExperience && website.contact.instagramUrl && (
                  <a
                    href={website.contact.instagramUrl}
                    rel="noopener noreferrer"
                  >
                    Instagram ↗
                  </a>
                )}
                {publicExperience && website.contact.facebookUrl && (
                  <a
                    href={website.contact.facebookUrl}
                    rel="noopener noreferrer"
                  >
                    Facebook ↗
                  </a>
                )}
                {website.pickupEnabled && !publicExperience && (
                  <a
                    className="ws-cta"
                    href={`/${locale}/order/${website.publicSlug}`}
                  >
                    {
                      {
                        en: "Order",
                        de: "Bestellen",
                        it: "Ordina",
                        sq: "Porosit",
                      }[locale]
                    }{" "}
                    ↗
                  </a>
                )}
              </address>
            )}
          </section>
        );
      })}
      <footer className="ws-footer">
        {footerActions}
        <strong>{website.venue.name}</strong>
        <span>© {new Date().getFullYear()}</span>
        {publicExperience && (
          <>
            <a
              href={`/${locale}/venue/${encodeURIComponent(website.publicSlug)}/privacy`}
            >
              Privacy
            </a>
            <a
              href={`/${locale}/venue/${encodeURIComponent(website.publicSlug)}/imprint`}
            >
              Impressum
            </a>
          </>
        )}
        {website.legal && (
          <span>
            {website.legal.legalName} · {website.legal.addressLine1},{" "}
            {website.legal.city}
          </span>
        )}
      </footer>
    </article>
  );
}

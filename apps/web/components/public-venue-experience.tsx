"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  WebsiteDocument,
  CanonicalMediaReference,
} from "@flowgastronomie/domain";
import {
  OnlineOrderMenuClient,
  type Website,
} from "../app/[lang]/order/[publicSlug]/online-order-menu-client";
import type { VenueSiteData } from "./venue-site-view";
import type { Locale } from "../lib/i18n";
import { WebsiteSections } from "./website-sections";
import { legacyWebsiteDocument } from "@flowgastronomie/domain";
import { premiumCopy } from "./premium-copy";
import { publicOrderCopy } from "../lib/public-order-copy";
import { TrackOrderEntry } from "./track-order-entry";
import "./public-website.css";

/** Published content is frozen by the API; catalog/media are its canonical live projection. */
export function PublicVenueExperience({
  website,
  apiUrl,
  languageLinks,
}: {
  website: VenueSiteData;
  apiUrl: string;
  languageLinks: Record<Locale, string>;
}) {
  const [catalog, setCatalog] = useState<Website>(() =>
    asOrderingWebsite(website),
  );
  const words = publicOrderCopy(website.locale);
  const document = useMemo(
    () => website.document ?? legacyDocument(website),
    [website],
  );
  const gallerySection = document.sections.find((s) => s.type === "GALLERY");
  const galleryMedia = useMemo(() => {
    if (gallerySection && !gallerySection.visible) return [];
    const approved = new Map(
      (website.sectionMedia ?? []).map((m) => [m.id, m]),
    );
    const selected = (gallerySection?.media ?? []).flatMap((ref) =>
      approved.get(ref.assetId) ? [approved.get(ref.assetId)!] : [],
    );
    const products = catalog.menu.flatMap((c) =>
      c.products.flatMap((p) => (p.media ? [p.media] : [])),
    );
    return [
      ...new Map(
        [...selected, ...products]
          .filter((m) => m.approvedForPublicUse)
          .map((m) => [m.id, m]),
      ).values(),
    ].slice(0, 16);
  }, [website.sectionMedia, gallerySection, catalog]);
  const publicDocument: WebsiteDocument = {
    ...document,
    sections:
      galleryMedia.length && !gallerySection
        ? [
            ...document.sections,
            {
              id: "public-gallery",
              type: "GALLERY",
              visible: true,
              layout: "CENTERED",
              content: (["sq", "de", "en", "it"] as const).map((locale) => ({
                locale,
                title: publicOrderCopy(locale)[13],
                body: "",
              })),
              media: [],
              generation: null,
            },
          ]
        : document.sections,
  };
  // A virtual gallery displays existing approved assets; it never writes a CMS record.
  const renderedDocument = {
    ...publicDocument,
    sections: publicDocument.sections.map((s) =>
      s.type === "GALLERY" && galleryMedia.length
        ? {
            ...s,
            media: galleryMedia.map((m) => ({
              assetId: m.id,
              alt: "",
              x: 50,
              y: 50,
            })),
          }
        : s,
    ),
  };
  return (
    <OnlineOrderMenuClient
      key={website.publicSlug}
      locale={website.locale}
      publicSlug={website.publicSlug}
      initialWebsite={catalog}
      onWebsiteChange={(next) =>
        setCatalog({
          venue: next.venue,
          menu: next.menu,
          pickupEnabled: !!next.pickupEnabled,
          deliveryEnabled: !!next.deliveryEnabled,
          cateringEnabled: !!next.cateringEnabled,
        })
      }
      render={(menu, basket) => (
        <main>
          <WebsiteSections
            website={{
              ...website,
              ...catalog,
              menu: catalog.menu.map((c) => ({
                ...c,
                products: c.products.map((p) => ({
                  ...p,
                  currency: catalog.venue.currency,
                })),
              })),
              document: renderedDocument,
            }}
            apiUrl={apiUrl}
            publicExperience
            languageHref={(locale) => languageLinks[locale]}
            menuContent={menu}
            headerActions={basket}
            footerActions={
              <TrackOrderEntry
                locale={website.locale}
                publicSlug={website.publicSlug}
              />
            }
            gallery={
              <PublicGallery
                media={galleryMedia}
                apiUrl={apiUrl}
                label={words[13]}
              />
            }
          />
        </main>
      )}
    />
  );
}
function asOrderingWebsite(site: VenueSiteData): Website {
  return {
    ...site,
    menu: site.menu.map((c) => ({
      ...c,
      products: c.products.map((p) => ({
        ...p,
        variants:
          "variants" in p
            ? (p as unknown as Website["menu"][number]["products"][number])
                .variants
            : [],
        modifierGroups:
          "modifierGroups" in p
            ? (p as unknown as Website["menu"][number]["products"][number])
                .modifierGroups
            : [],
      })),
    })),
  };
}
function legacyDocument(site: VenueSiteData): WebsiteDocument {
  const words = premiumCopy(site.locale);
  const doc = legacyWebsiteDocument(
    (["sq", "de", "en", "it"] as const).map((locale) => ({
      ...site.content,
      locale,
    })),
  );
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      visible: section.type !== "ABOUT" || !!site.content.storyBody,
      content: section.content.map((c) => ({
        ...c,
        title:
          c.title ||
          (section.type === "MENU"
            ? words.menu
            : section.type === "CONTACT"
              ? words.contact
              : site.venue.name),
      })),
    })),
  };
}
function PublicGallery({
  media,
  apiUrl,
  label,
}: {
  media: CanonicalMediaReference[];
  apiUrl: string;
  label: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () =>
      setEdges({
        left: el.scrollLeft > 1,
        right: el.scrollWidth - el.clientWidth - el.scrollLeft > 1,
      });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [media]);
  return (
    <div className="public-gallery">
      <div
        className="public-gallery-controls"
        hidden={!edges.left && !edges.right}
      >
        <button
          disabled={!edges.left}
          aria-label={`${label} ←`}
          onClick={() =>
            strip.current?.scrollBy({
              left: -320,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            })
          }
        >
          ←
        </button>
        <button
          disabled={!edges.right}
          aria-label={`${label} →`}
          onClick={() =>
            strip.current?.scrollBy({
              left: 320,
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            })
          }
        >
          →
        </button>
      </div>
      <div
        className="public-gallery-strip"
        ref={strip}
        tabIndex={0}
        aria-label={label}
      >
        {media.map((m, i) => (
          <figure key={m.id}>
            <img
              src={m.url.startsWith("/v1/") ? `${apiUrl}${m.url}` : m.url}
              alt={`${label} ${i + 1}`}
              width={m.width}
              height={m.height}
              loading="lazy"
              decoding="async"
            />
            {m.label && <figcaption>{m.label}</figcaption>}
          </figure>
        ))}
      </div>
    </div>
  );
}

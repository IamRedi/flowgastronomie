import type { PublicMenu } from "@flowgastronomie/domain";
import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import {
  hasLocale,
  localeNames,
  locales,
  type Locale,
} from "../../../../lib/i18n";

import { GuestMenuClient } from "./guest-menu-client";

async function fetchMenu(qrToken: string, locale: Locale): Promise<PublicMenu> {
  const apiUrl =
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4000";
  const response = await fetch(
    `${apiUrl}/v1/public/tables/${encodeURIComponent(qrToken)}/menu?locale=${locale}`,
    { cache: "no-store" },
  );

  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Public menu could not be loaded");

  return response.json() as Promise<PublicMenu>;
}

export default async function PublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; qrToken: string }>;
  searchParams: Promise<{ staffOrder?: string }>;
}) {
  const { lang, qrToken } = await params;
  const query = await searchParams;
  const staffOrder = query.staffOrder === "1";
  if (!hasLocale(lang)) notFound();

  const [dictionary, menu] = await Promise.all([
    getDictionary(lang),
    fetchMenu(qrToken, lang),
  ]);

  return (
    <main className="public-menu-page">
      <header className="public-menu-header shell">
        <a className="brand" href={`/${lang}`}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <div className="language-switcher" aria-label={dictionary.nav.language}>
          {locales.map((locale) => (
            <a
              aria-current={locale === lang ? "page" : undefined}
              href={`/${locale}/menu/${encodeURIComponent(qrToken)}${staffOrder ? "?staffOrder=1" : ""}`}
              hrefLang={locale}
              key={locale}
            >
              <span>{locale.toUpperCase()}</span>
              <span className="language-name">{localeNames[locale]}</span>
            </a>
          ))}
        </div>
      </header>

      <section className="menu-venue shell">
        <p className="restaurant-kicker">{menu.venue.slug}</p>
        <h1>{menu.venue.name}</h1>
        <div className="table-context">
          <span>
            {dictionary.menuPage.table} <strong>{menu.table.label}</strong>
          </span>
          {menu.table.area && <span>{menu.table.area}</span>}
          <span>
            {dictionary.menuPage.serviceMode}:{" "}
            <strong>
              {
                dictionary.menuPage.modes[
                  menu.table
                    .serviceMode as keyof typeof dictionary.menuPage.modes
                ]
              }
            </strong>
          </span>
        </div>
      </section>

      {staffOrder && (
        <div className="staff-order-banner shell">
          <strong>FG Staff</strong>
          <span>{dictionary.menuPage.staffOrderMode}</span>
        </div>
      )}

      <GuestMenuClient
        categories={menu.categories}
        currency={menu.venue.currency}
        labels={dictionary.menuPage}
        locale={lang}
        qrToken={qrToken}
        serviceMode={menu.table.serviceMode}
        staffOrder={staffOrder}
      />

      <aside className="pilot-notice shell">
        <span aria-hidden="true">i</span>
        <p>{dictionary.menuPage.orderNotice}</p>
      </aside>

      <footer className="public-menu-footer shell">
        <a href={`/${lang}`}>← {dictionary.menuPage.back}</a>
      </footer>
    </main>
  );
}

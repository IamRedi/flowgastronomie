"use client";
import { useState } from "react";
import {
  premiumCatalog,
  premiumShowcase,
  type BusinessProfileId,
} from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import { premiumPreviewData } from "./premium-preview-data";
import { PremiumSite } from "./premium-site";
import { premiumCopy } from "./premium-copy";
import "./premium-browser.css";

export function PremiumBrowser({
  locale,
  initialProfile = "RESTAURANT",
  initialStyle = 0,
}: {
  locale: Locale;
  initialProfile?: BusinessProfileId;
  initialStyle?: number;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [styleIndex, setStyleIndex] = useState(initialStyle);
  const words = premiumCopy(locale);
  const pack = premiumShowcase(profile);
  const style = pack.styles[styleIndex] ?? pack.styles[0];
  const query = `profile=${profile}&style=${style.id}`;
  return (
    <main className="premium-browser">
      <header className="premium-browser-header">
        <a href={`/${locale}`}>FG / FlowGastronomie</a>
        <a href={`/${locale}/signup`}>{words.empty} ↗</a>
      </header>
      <section className="premium-browser-intro">
        <p>{words.eyebrow} / 01</p>
        <h1>{words.title}</h1>
        <p>{words.intro}</p>
      </section>
      <section className="premium-picker" aria-label={words.business}>
        <div className="premium-businesses">
          {premiumCatalog().map((p) => (
            <button
              type="button"
              key={p.profileId}
              aria-pressed={p.profileId === profile}
              onClick={() => {
                setProfile(p.profileId);
                setStyleIndex(0);
              }}
            >
              <span>
                {p.profileId === "GENERIC"
                  ? "○"
                  : p.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
              </span>
              <strong>
                {p.profileId === "GENERIC"
                  ? {
                      en: "Your business",
                      de: "Dein Betrieb",
                      it: "La tua attività",
                      sq: "Biznesi yt",
                    }[locale]
                  : p.name}
              </strong>
            </button>
          ))}
        </div>
        <div className="premium-style-bar">
          <div>
            <p>{words.style}</p>
            <div className="premium-style-buttons">
              {pack.styles.map((s, i) => (
                <button
                  type="button"
                  key={s.id}
                  aria-pressed={style.id === s.id}
                  onClick={() => setStyleIndex(i)}
                >
                  <span
                    aria-hidden="true"
                    style={{ background: s.primaryColor }}
                  />
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <a className="premium-choose" href={`/${locale}/signup?${query}`}>
            {words.start} ↗
          </a>
        </div>
        <p className="premium-preview-status" aria-live="polite">
          {words.readonly} · {pack.name} / {style.name} ·{" "}
          {pack.categories.reduce((n, c) => n + c.products.length, 0)} SAMPLE
        </p>
      </section>
      <div className="premium-preview-frame">
        <PremiumSite
          locale={locale}
          sample
          homeHref={`/${locale}/showcase`}
          languageHref={(l) => `/${l}/showcase?${query}`}
          website={premiumPreviewData(profile, style.id, locale)}
        />
      </div>
      <footer className="premium-browser-footer">
        <p>{words.disclaimer}</p>
        <a href={`/${locale}/signup?${query}`}>{words.start} ↗</a>
      </footer>
    </main>
  );
}

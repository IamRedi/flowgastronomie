"use client";

import {
  SUBSCRIPTION_PLANS,
  suggestedBusinessRegion,
  businessProfileCatalog,
  premiumShowcase,
  type BusinessProfileId,
  type SubscriptionPlan,
} from "@flowgastronomie/domain";
import { useRef, useState, type FormEvent } from "react";

import type { Dictionary } from "../../../lib/dictionaries";
import type { Locale } from "../../../lib/i18n";

import { premiumCopy } from "../../../components/premium-copy";

import { PremiumSite } from "../../../components/premium-site";
import { premiumPreviewData } from "../../../components/premium-preview-data";
import "./signup-wizard.css";
const wizardCopy = {
  en: [
    "Business type",
    "Style preview",
    "Business details",
    "Review",
    "Continue",
    "Back",
    "Country",
    "Choose your country",
    "Currency",
    "Local time",
    "Advanced settings",
    "Create draft",
    "Nothing is published. Sample EUR prices are available only when EUR is selected.",
    "Your business",
    "Choose currency and timezone before continuing.",
    "Your selected style",
  ],
  de: [
    "Betriebsart",
    "Stilvorschau",
    "Betriebsdetails",
    "Prüfen",
    "Weiter",
    "Zurück",
    "Land",
    "Land auswählen",
    "Währung",
    "Ortszeit",
    "Erweiterte Einstellungen",
    "Entwurf erstellen",
    "Nichts wird veröffentlicht. EUR-Beispielpreise sind nur bei gewähltem EUR verfügbar.",
    "Dein Betrieb",
    "Bitte Währung und Zeitzone auswählen.",
    "Dein gewählter Stil",
  ],
  it: [
    "Tipo di attività",
    "Anteprima stile",
    "Dati attività",
    "Riepilogo",
    "Continua",
    "Indietro",
    "Paese",
    "Scegli il paese",
    "Valuta",
    "Ora locale",
    "Impostazioni avanzate",
    "Crea bozza",
    "Nulla viene pubblicato. I prezzi di esempio in EUR sono disponibili solo scegliendo EUR.",
    "La tua attività",
    "Scegli valuta e fuso orario per continuare.",
    "Il tuo stile",
  ],
  sq: [
    "Lloji i biznesit",
    "Pamja e stilit",
    "Të dhënat e biznesit",
    "Rishiko",
    "Vazhdo",
    "Prapa",
    "Shteti",
    "Zgjidh shtetin",
    "Monedha",
    "Ora lokale",
    "Cilësime të avancuara",
    "Krijo draftin",
    "Asgjë nuk publikohet. Çmimet shembull EUR ofrohen vetëm kur zgjidhet EUR.",
    "Biznesi yt",
    "Zgjidh monedhën dhe zonën kohore për të vazhduar.",
    "Stili yt i zgjedhur",
  ],
} as const;
type SignupError = "EXISTING_EMAIL" | "GENERIC" | null;

export function TrialSignupForm({
  regionOptions,
  initialPlan,
  initialProfile,
  initialStyle,
  labels,
  locale,
  planLabels,
}: {
  regionOptions: {
    countries: { code: string; name: string }[];
    currencies: { code: string; name: string }[];
    timezones: string[];
  };
  initialPlan: SubscriptionPlan;
  initialProfile: BusinessProfileId;
  initialStyle: string | null;
  labels: Dictionary["signup"];
  locale: Locale;
  planLabels: Dictionary["pricing"]["plans"];
}) {
  const words = premiumCopy(locale);
  const w = wizardCopy[locale];
  const [step, setStep] = useState(0);
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [timezone, setTimezone] = useState("");
  const [regionOpen, setRegionOpen] = useState(false);
  const [sampleMenu, setSampleMenu] = useState(false);
  const [review, setReview] = useState<Record<string, string>>({});
  const countryNames = new Intl.DisplayNames(locale, { type: "region" });
  const currencyNames = new Intl.DisplayNames(locale, { type: "currency" });
  const countries = regionOptions.countries;
  function next(form: HTMLFormElement) {
    const invalid = Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        `[data-step="${step}"] input, [data-step="${step}"] select`,
      ),
    ).find((input) => !input.checkValidity());
    if (invalid) {
      invalid.closest("details")?.setAttribute("open", "");
      invalid.reportValidity();
      return;
    }
    setReview(
      Object.fromEntries(
        Array.from(new FormData(form).entries()).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
    );
    setStep(step + 1);
    form.scrollIntoView({ behavior: "instant", block: "start" });
  }
  const [profile, setProfile] = useState(initialProfile);
  const [selectedStyle, setSelectedStyle] = useState(initialStyle);
  const [templateConfirmed, setTemplateConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef<string | null>(null);
  const profileLabels = {
    en: [
      "Business profile",
      "Start with suggested categories (editable)",
      "Other business",
    ],
    de: [
      "Betriebsprofil",
      "Mit bearbeitbaren Kategorien starten",
      "Anderer Betrieb",
    ],
    it: [
      "Profilo attività",
      "Inizia con categorie modificabili",
      "Altra attività",
    ],
    sq: [
      "Profili i biznesit",
      "Fillo me kategoritë e sugjeruara (të ndryshueshme)",
      "Biznes tjetër",
    ],
  }[locale];
  const [error, setError] = useState<SignupError>(null);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 3) {
      next(event.currentTarget);
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    requestKey.current ??= crypto.randomUUID();

    try {
      const response = await fetch(`${apiUrl}/v1/public/trials`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationName: form.get("organizationName"),
          venueName: form.get("venueName"),
          ownerDisplayName: form.get("ownerDisplayName"),
          email: form.get("email"),
          password: form.get("password"),
          plan: form.get("plan"),
          locale,
          countryCode: country,
          timezone: form.get("timezone"),
          currency: form.get("currency"),
          requestKey: requestKey.current,
          profileId: form.get("profileId") || "GENERIC",
          applyCategories: form.get("applyCategories") === "on",
          ...(selectedStyle
            ? {
                premiumTemplate: {
                  styleId: selectedStyle,
                  version: 1,
                  confirmed: form.get("confirmTemplate") === "on",
                  includeSampleMenu: sampleMenu && currency === "EUR",
                },
              }
            : {}),
        }),
      });

      if (response.status === 409) {
        setError("EXISTING_EMAIL");
        setBusy(false);
        return;
      }
      if (!response.ok) throw new Error("TRIAL_REGISTRATION_FAILED");
      window.location.assign(`/app/${locale}/onboarding`);
    } catch {
      setError("GENERIC");
      setBusy(false);
    }
  }

  return (
    <form className="signup-form signup-wizard" onSubmit={submit} noValidate>
      <ol className="signup-progress" aria-label={w[3]}>
        {w.slice(0, 4).map((name, i) => (
          <li key={name} aria-current={step === i ? "step" : undefined}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {name}
          </li>
        ))}
      </ol>
      <h2 tabIndex={-1}>{w[step]}</h2>
      <p className="signup-draft-note">{w[12]}</p>
      <fieldset disabled={busy} data-step="0" hidden={step !== 0}>
        <legend>{labels.businessSection}</legend>
        <label>
          <span>{profileLabels[0]}</span>
          <select
            name="profileId"
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value as BusinessProfileId);
              setSelectedStyle(null);
              setTemplateConfirmed(false);
            }}
          >
            <option value="GENERIC">{profileLabels[2]}</option>
            {businessProfileCatalog()
              .filter((profile) => profile.id !== "GENERIC")
              .map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
          </select>
        </label>
      </fieldset>
      <fieldset disabled={busy} data-step="1" hidden={step !== 1}>
        <legend>{w[1]}</legend>
        <label>
          <span>{words.styleLabel}</span>
          <select
            value={selectedStyle ?? ""}
            onChange={(e) => {
              setSelectedStyle(e.target.value || null);
              setTemplateConfirmed(false);
            }}
          >
            <option value="">{words.empty}</option>
            {premiumShowcase(profile).styles.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <a
          href={`/${locale}/showcase?profile=${profile}&style=${selectedStyle ?? ""}`}
        >
          {words.back}
        </a>
        {selectedStyle && (
          <>
            <label>
              <input
                type="checkbox"
                name="sampleMenu"
                checked={sampleMenu}
                onChange={(e) => setSampleMenu(e.target.checked)}
              />
              {words.samples}
            </label>
            <label>
              <input
                type="checkbox"
                name="confirmTemplate"
                checked={templateConfirmed}
                onChange={(e) => setTemplateConfirmed(e.target.checked)}
                required
              />
              {words.confirm}
            </label>
            <p>{words.importHint}</p>
          </>
        )}
        <label>
          <input type="checkbox" name="applyCategories" />
          {profileLabels[1]}
        </label>
        {selectedStyle && (
          <details className="signup-style-preview" open>
            <summary>
              {w[15]} ·{" "}
              {
                premiumShowcase(profile).styles.find(
                  (s) => s.id === selectedStyle,
                )?.name
              }
            </summary>
            <PremiumSite
              website={premiumPreviewData(profile, selectedStyle, locale)}
              locale={locale}
              sample
              homeHref={`/${locale}/showcase`}
              languageHref={(l) =>
                `/${l}/showcase?profile=${profile}&style=${selectedStyle}`
              }
            />
          </details>
        )}
      </fieldset>
      <fieldset disabled={busy} data-step="2" hidden={step !== 2}>
        <legend>{w[2]}</legend>
        <label>
          <span>{labels.organizationName}</span>
          <input
            autoComplete="organization"
            maxLength={120}
            minLength={2}
            name="organizationName"
            placeholder={labels.organizationPlaceholder}
            required
          />
        </label>
        <label>
          <span>{labels.venueName}</span>
          <input
            maxLength={120}
            minLength={2}
            name="venueName"
            placeholder={labels.venuePlaceholder}
            required
          />
        </label>
        <label>
          <span>{labels.plan}</span>
          <select defaultValue={initialPlan} name="plan">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {planLabels[plan].name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{w[6]}</span>
          <select
            name="countryCode"
            value={country}
            required
            onChange={(e) => {
              setCountry(e.target.value);
              const suggestion = suggestedBusinessRegion(e.target.value);
              setCurrency(suggestion?.currency ?? "");
              setTimezone(suggestion?.timezone ?? "");
              setRegionOpen(!suggestion);
              if (suggestion?.currency !== "EUR") setSampleMenu(false);
            }}
          >
            <option value="">{w[7]}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {country && (
          <p className="signup-region-summary" aria-live="polite">
            {currency
              ? `${currencyNames.of(currency)} · ${timezone.replaceAll("_", " ").split("/").slice(1).join(" / ") || timezone}`
              : w[14]}
          </p>
        )}
        <details
          open={regionOpen}
          onToggle={(e) => setRegionOpen(e.currentTarget.open)}
        >
          <summary>{w[10]}</summary>
          <label>
            <span>{w[8]}</span>
            <select
              name="currency"
              value={currency}
              required
              onChange={(e) => {
                setCurrency(e.target.value);
                if (e.target.value !== "EUR") setSampleMenu(false);
              }}
            >
              <option value="">—</option>
              {regionOptions.currencies.map(({ code: c, name }) => (
                <option key={c} value={c}>
                  {name} ({c})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{w[9]}</span>
            <select
              name="timezone"
              value={timezone}
              required
              onChange={(e) => setTimezone(e.target.value)}
            >
              <option value="">—</option>
              {regionOptions.timezones.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ").split("/").reverse().join(" · ")}
                </option>
              ))}
            </select>
          </label>
        </details>
        <label>
          <span>{labels.ownerName}</span>
          <input
            autoComplete="name"
            maxLength={100}
            minLength={2}
            name="ownerDisplayName"
            placeholder={labels.ownerPlaceholder}
            required
          />
        </label>
        <label>
          <span>{labels.email}</span>
          <input
            autoComplete="email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </label>
        <label>
          <span>{labels.password}</span>
          <input
            aria-describedby="signup-password-hint"
            autoComplete="new-password"
            maxLength={128}
            minLength={8}
            name="password"
            required
            type="password"
          />
          <small id="signup-password-hint">{labels.passwordHint}</small>
        </label>
      </fieldset>

      <section data-step="3" hidden={step !== 3} className="signup-review">
        <dl>
          {[
            [
              w[0],
              profile === "GENERIC"
                ? profileLabels[2]
                : (businessProfileCatalog().find((item) => item.id === profile)
                    ?.name ?? profile),
            ],
            [
              w[1],
              premiumShowcase(profile).styles.find(
                (s) => s.id === selectedStyle,
              )?.name ?? words.empty,
            ],
            [labels.organizationName, review.organizationName],
            [labels.venueName, review.venueName],
            [w[6], country ? countryNames.of(country) : ""],
            [w[8], currency ? currencyNames.of(currency) : ""],
            [
              w[9],
              timezone.replaceAll("_", " ").split("/").reverse().join(" · "),
            ],
            [labels.ownerName, review.ownerDisplayName],
            [labels.email, review.email],
            [labels.plan, planLabels[review.plan as SubscriptionPlan]?.name],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p>{sampleMenu && currency === "EUR" ? words.samples : words.empty}</p>
        <p>{words.confirm}</p>
      </section>
      {error && (
        <p className="signup-error" role="alert">
          {error === "EXISTING_EMAIL"
            ? labels.existingEmail
            : labels.genericError}
        </p>
      )}
      <div className="signup-step-actions">
        {step > 0 && (
          <button
            type="button"
            className="button button-ghost"
            disabled={busy}
            onClick={() => setStep(step - 1)}
          >
            {w[5]}
          </button>
        )}
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? labels.submitting : step < 3 ? w[4] : w[11]}
          {!busy && <span aria-hidden="true">→</span>}
        </button>
      </div>
    </form>
  );
}

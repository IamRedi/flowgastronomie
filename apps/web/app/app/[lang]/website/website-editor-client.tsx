"use client";

import {
  PLATFORM_LOCALES,
  premiumStyles,
  WEEKDAYS,
  type OpeningHoursEntry,
  type PlatformLocale,
  type WebsiteStatus,
  type WebsiteTranslation,
} from "@flowgastronomie/domain";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { OwnerSetupLinks } from "../../../../components/owner-setup-links";
import type { Dictionary } from "../../../../lib/dictionaries";
import type { Locale } from "../../../../lib/i18n";

import { WebsiteCopyImport } from "../../../../components/website-copy-import";
import { WebsiteDraftHistory } from "../../../../components/website-draft-history";
import { premiumCopy } from "../../../../components/premium-copy";
import { websiteAssetInputKey } from "./website-editor-keys";
import "../../../../components/premium-owner.css";

type WebsiteEditor = {
  updatedAt?: string;
  id: string | null;
  venueId: string;
  venueName: string;
  publicSlug: string;
  status: WebsiteStatus;
  premiumStyleId?: string | null;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  openingHours: OpeningHoursEntry[];
  publishedAt: string | null;
  translations: WebsiteTranslation[];
};

type Feedback =
  | "stale"
  | "saved"
  | "publishedSuccess"
  | "unpublishedSuccess"
  | "error"
  | "conflict"
  | "notReady"
  | "uploadSuccess"
  | null;

export function WebsiteEditorClient({
  labels,
  locale,
}: {
  labels: Dictionary["websiteAdmin"];
  locale: Locale;
}) {
  const words = premiumCopy(locale);
  const advanced = {
    en: "Advanced settings",
    de: "Erweiterte Einstellungen",
    it: "Impostazioni avanzate",
    sq: "Cilësime të avancuara",
  }[locale];
  const stale = {
    en: "This draft changed in another session. Your inputs are still here. Reload the saved version before trying again.",
    de: "Dieser Entwurf wurde in einer anderen Sitzung geändert. Deine Eingaben bleiben hier. Lade vor dem nächsten Versuch den gespeicherten Stand neu.",
    it: "La bozza è cambiata in un'altra sessione. I tuoi dati sono ancora qui. Ricarica la versione salvata prima di riprovare.",
    sq: "Drafti ndryshoi në një sesion tjetër. Shënimet e tua janë ende këtu. Ringarko versionin e ruajtur para se të provosh sërish.",
  }[locale];
  const [website, setWebsite] = useState<WebsiteEditor | null>(null);
  const [activeLocale, setActiveLocale] = useState<PlatformLocale>(locale);
  const [busy, setBusy] = useState<
    "save" | "preview" | "publish" | "unpublish" | null
  >(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [forbidden, setForbidden] = useState(false);
  const [uploading, setUploading] = useState<"LOGO" | "HERO" | null>(null);
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";

  const load = useCallback(async () => {
    const response = await fetch(`${apiUrl}/v1/workspace/website`, {
      cache: "no-store",
      credentials: "include",
    });
    if (response.status === 401) {
      window.location.assign(`/${locale}/staff/login`);
      return;
    }
    if (response.status === 403) {
      setForbidden(true);
      return;
    }
    if (!response.ok) {
      setFeedback("error");
      return;
    }
    setWebsite((await response.json()) as WebsiteEditor);
  }, [apiUrl, locale]);

  useEffect(() => {
    void load().catch(() => setFeedback("error"));
  }, [load]);

  function optional(data: FormData, name: string) {
    const value = String(data.get(name) ?? "").trim();
    return value || null;
  }

  async function save(form: HTMLFormElement): Promise<WebsiteEditor | null> {
    try {
      const data = new FormData(form);
      const response = await fetch(`${apiUrl}/v1/workspace/website`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicSlug: String(data.get("publicSlug") ?? "").trim(),
          expectedUpdatedAt: website?.updatedAt,
          premiumStyleId: optional(data, "premiumStyleId"),
          primaryColor: String(data.get("primaryColor") ?? ""),
          accentColor: String(data.get("accentColor") ?? ""),
          logoUrl: optional(data, "logoUrl"),
          heroImageUrl: optional(data, "heroImageUrl"),
          phone: optional(data, "phone"),
          contactEmail: optional(data, "contactEmail"),
          address: optional(data, "address"),
          instagramUrl: optional(data, "instagramUrl"),
          facebookUrl: optional(data, "facebookUrl"),
          openingHours: data.has("includeOpeningHours")
            ? WEEKDAYS.filter(
                (day) =>
                  data.has(`closed-${day}`) ||
                  data.get(`opensAt-${day}`) ||
                  data.get(`closesAt-${day}`),
              ).map((day) => ({
                day,
                closed: data.has(`closed-${day}`),
                opensAt: data.has(`closed-${day}`)
                  ? "00:00"
                  : String(data.get(`opensAt-${day}`) ?? ""),
                closesAt: data.has(`closed-${day}`)
                  ? "00:00"
                  : String(data.get(`closesAt-${day}`) ?? ""),
              }))
            : [],
          translations: PLATFORM_LOCALES.map((language) => ({
            locale: language,
            heroTitle: String(data.get(`heroTitle-${language}`) ?? "").trim(),
            heroSubtitle: String(
              data.get(`heroSubtitle-${language}`) ?? "",
            ).trim(),
            storyTitle: String(data.get(`storyTitle-${language}`) ?? "").trim(),
            storyBody: String(data.get(`storyBody-${language}`) ?? "").trim(),
            seoTitle: String(data.get(`seoTitle-${language}`) ?? "").trim(),
            seoDescription: String(
              data.get(`seoDescription-${language}`) ?? "",
            ).trim(),
          })),
        }),
      });
      if (response.status === 409) {
        const error = (await response.json()) as { code?: string };
        setFeedback(
          error.code === "PUBLIC_SLUG_CONFLICT" ? "conflict" : "stale",
        );
        return null;
      }
      if (!response.ok) {
        setFeedback("error");
        return null;
      }
      const saved = (await response.json()) as WebsiteEditor;
      setWebsite(saved);
      return saved;
    } catch {
      setFeedback("error");
      return null;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setFeedback(null);
    const saved = await save(event.currentTarget);
    setBusy(null);
    if (saved) setFeedback("saved");
  }

  async function publish() {
    const form = document.querySelector<HTMLFormElement>(
      "#website-editor-form",
    );
    if (!form) return;
    setBusy("publish");
    setFeedback(null);
    const saved = await save(form);
    if (!saved) {
      setBusy(null);
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/v1/workspace/website/publish`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        setFeedback(response.status === 409 ? "notReady" : "error");
        setBusy(null);
        return;
      }
      setWebsite((await response.json()) as WebsiteEditor);
      setFeedback("publishedSuccess");
    } catch {
      setFeedback("error");
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    const form = document.querySelector<HTMLFormElement>(
      "#website-editor-form",
    );
    if (!form) return;
    const previewWindow = window.open("", "_blank");
    setBusy("preview");
    setFeedback(null);
    const saved = await save(form);
    setBusy(null);
    if (!saved) {
      previewWindow?.close();
      return;
    }
    const previewUrl = `/app/${locale}/website/preview`;
    if (previewWindow) {
      previewWindow.opener = null;
      previewWindow.location.href = previewUrl;
    } else {
      window.location.assign(previewUrl);
    }
  }

  async function unpublish() {
    setBusy("unpublish");
    setFeedback(null);
    try {
      const response = await fetch(`${apiUrl}/v1/workspace/website/unpublish`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        setFeedback("error");
      } else {
        setWebsite((await response.json()) as WebsiteEditor);
        setFeedback("unpublishedSuccess");
      }
    } catch {
      setFeedback("error");
    } finally {
      setBusy(null);
    }
  }

  async function uploadAsset(kind: "LOGO" | "HERO", file: File | null) {
    if (!file) return;
    setUploading(kind);
    setFeedback(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/workspace/website/assets/${kind}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": file.type },
          body: file,
        },
      );
      if (!response.ok) {
        setFeedback("error");
        setUploading(null);
        return;
      }
      const asset = (await response.json()) as { url: string };
      setWebsite((current) =>
        current
          ? {
              ...current,
              ...(kind === "LOGO"
                ? { logoUrl: asset.url }
                : { heroImageUrl: asset.url }),
            }
          : current,
      );
      setFeedback("uploadSuccess");
    } catch {
      setFeedback("error");
    } finally {
      setUploading(null);
    }
  }

  const assetUrl = (value: string | null) =>
    value?.startsWith("/v1/") ? `${apiUrl}${value}` : value;

  if (forbidden) {
    return <main className="workspace-state">{labels.permissions}</main>;
  }
  if (!website) {
    return (
      <main className="workspace-state">
        <span className="brand-mark">FG</span>
        <p>{feedback ? labels.error : labels.loading}</p>
      </main>
    );
  }

  const translation = (language: PlatformLocale) =>
    website.translations.find((item) => item.locale === language) ?? {
      locale: language,
      heroTitle: "",
      heroSubtitle: "",
      storyTitle: "",
      storyBody: "",
      seoTitle: "",
      seoDescription: "",
    };

  return (
    <main className="website-editor-page">
      <header className="website-editor-header">
        <nav aria-label="Business workspace">
          <a href={`/app/${locale}/settings/domain`}>{labels.domainSettings}</a>
          {website.status === "PUBLISHED" && (
            <a
              className="button button-primary button-small"
              href={`/${locale}/venue/${website.publicSlug}`}
              target="_blank"
            >
              {labels.viewLive}
            </a>
          )}
        </nav>
      </header>

      <section className="website-editor-intro">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.title}</h1>
          <p>{labels.subtitle}</p>
        </div>
        <span className={`website-status ${website.status.toLowerCase()}`}>
          {website.status === "PUBLISHED" ? labels.published : labels.draft}
        </span>
      </section>

      <OwnerSetupLinks locale={locale} />
      {feedback && (
        <p
          className={`website-feedback ${["error", "conflict", "notReady", "stale"].includes(feedback) ? "error" : "success"}`}
          role="status"
        >
          {feedback === "stale" ? stale : labels[feedback]}
        </p>
      )}

      <form
        key={website.updatedAt ?? "new"}
        id="website-editor-form"
        onSubmit={submit}
      >
        {website.status === "DRAFT" && (
          <WebsiteCopyImport
            key={activeLocale}
            locale={activeLocale}
            onSaved={() => void load()}
          />
        )}
        {website.status === "DRAFT" && (
          <WebsiteDraftHistory
            locale={locale}
            updatedAt={website.updatedAt}
            onRestored={() => {
              void load()
                .then(() => setFeedback("saved"))
                .catch(() => setFeedback("error"));
            }}
          />
        )}
        <label className="premium-style-picker">
          <span>{words.styleLabel}</span>
          <select
            name="premiumStyleId"
            onChange={(event) => {
              const style = premiumStyles().find(
                (s) => s.id === event.currentTarget.value,
              );
              const form = event.currentTarget.form;
              if (!style || !form) return;
              for (const key of ["primaryColor", "accentColor"] as const) {
                const field = form.elements.namedItem(key);
                if (field instanceof HTMLInputElement) field.value = style[key];
              }
            }}
            defaultValue={website.premiumStyleId ?? ""}
            key={`style-${website.premiumStyleId}`}
          >
            <option value="">{words.empty}</option>
            {premiumStyles().map((style) => (
              <option key={style.id} value={style.id}>
                {style.name}
              </option>
            ))}
          </select>
        </label>

        <section className="website-editor-card">
          <h2>{labels.brand}</h2>
          <p className="premium-media-entry">
            <a href={`/app/${locale}/onboarding/media`}>{words.addPhotos} ↗</a>
          </p>
          <details className="premium-advanced">
            <summary>
              {advanced} · {labels.brand}
            </summary>
            <div className="website-field-grid">
              <label className="wide">
                <span>{labels.publicSlug}</span>
                <div className="slug-input">
                  <input
                    defaultValue={website.publicSlug}
                    maxLength={60}
                    name="publicSlug"
                    pattern="[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?"
                    required
                  />
                  <small>.flowgastronomie.site</small>
                </div>
              </label>
              <label>
                <span>{labels.primaryColor}</span>
                <input
                  defaultValue={website.primaryColor}
                  name="primaryColor"
                  type="color"
                />
              </label>
              <label>
                <span>{labels.accentColor}</span>
                <input
                  defaultValue={website.accentColor}
                  name="accentColor"
                  type="color"
                />
              </label>
              <EditorInput
                defaultValue={website.logoUrl}
                key={websiteAssetInputKey("logoUrl", website.logoUrl)}
                label={labels.logoUrl}
                name="logoUrl"
                type="url"
              />
              <EditorInput
                defaultValue={website.heroImageUrl}
                key={websiteAssetInputKey("heroImageUrl", website.heroImageUrl)}
                label={labels.heroImageUrl}
                name="heroImageUrl"
                type="url"
              />
              <AssetUpload
                accept="image/jpeg,image/png,image/webp"
                busy={uploading === "LOGO"}
                hint={labels.uploadHint}
                label={labels.uploadLogo}
                onChange={(file) => void uploadAsset("LOGO", file)}
                previewUrl={assetUrl(website.logoUrl)}
                uploadingLabel={labels.uploading}
              />
              <AssetUpload
                accept="image/jpeg,image/png,image/webp"
                busy={uploading === "HERO"}
                hint={labels.uploadHint}
                label={labels.uploadHero}
                onChange={(file) => void uploadAsset("HERO", file)}
                previewUrl={assetUrl(website.heroImageUrl)}
                uploadingLabel={labels.uploading}
              />
            </div>
          </details>
        </section>

        <section className="website-editor-card">
          <div className="website-card-heading">
            <h2>{labels.content}</h2>
            <div className="website-language-tabs" role="tablist">
              {PLATFORM_LOCALES.map((language) => (
                <button
                  aria-selected={activeLocale === language}
                  key={language}
                  onClick={() => setActiveLocale(language)}
                  role="tab"
                  type="button"
                >
                  {labels.languages[language]}
                </button>
              ))}
            </div>
          </div>
          {PLATFORM_LOCALES.map((language) => {
            const copy = translation(language);
            return (
              <div
                hidden={activeLocale !== language}
                key={language}
                role="tabpanel"
              >
                <div className="website-field-grid">
                  <EditorInput
                    defaultValue={copy.heroTitle}
                    label={labels.heroTitle}
                    maxLength={120}
                    name={`heroTitle-${language}`}
                  />
                  <EditorInput
                    defaultValue={copy.heroSubtitle}
                    label={labels.heroSubtitle}
                    maxLength={280}
                    name={`heroSubtitle-${language}`}
                  />
                  <EditorInput
                    defaultValue={copy.storyTitle}
                    label={labels.storyTitle}
                    maxLength={120}
                    name={`storyTitle-${language}`}
                  />
                  <label className="wide">
                    <span>{labels.storyBody}</span>
                    <textarea
                      defaultValue={copy.storyBody}
                      maxLength={2000}
                      name={`storyBody-${language}`}
                      rows={5}
                    />
                  </label>
                  <details className="premium-advanced wide">
                    <summary>{advanced} · SEO</summary>
                    <EditorInput
                      defaultValue={copy.seoTitle}
                      label={labels.seoTitle}
                      maxLength={70}
                      name={`seoTitle-${language}`}
                    />
                    <EditorInput
                      defaultValue={copy.seoDescription}
                      label={labels.seoDescription}
                      maxLength={180}
                      name={`seoDescription-${language}`}
                    />
                  </details>
                </div>
              </div>
            );
          })}
        </section>

        <section className="website-editor-card">
          <h2>{labels.contact}</h2>
          <div className="website-field-grid">
            <EditorInput
              defaultValue={website.phone}
              label={labels.phone}
              name="phone"
              type="tel"
            />
            <EditorInput
              defaultValue={website.contactEmail}
              label={labels.email}
              name="contactEmail"
              type="email"
            />
            <EditorInput
              defaultValue={website.address}
              label={labels.address}
              name="address"
            />
            <EditorInput
              defaultValue={website.instagramUrl}
              label={labels.instagram}
              name="instagramUrl"
              type="url"
            />
            <EditorInput
              defaultValue={website.facebookUrl}
              label={labels.facebook}
              name="facebookUrl"
              type="url"
            />
          </div>
        </section>

        <section className="website-editor-card">
          <details className="premium-advanced">
            <summary>{labels.hours}</summary>
            <label className="premium-hours-confirm">
              <input
                type="checkbox"
                name="includeOpeningHours"
                defaultChecked={website.openingHours.length > 0}
              />
              {
                {
                  en: "Include these opening hours (review before saving)",
                  de: "Diese Öffnungszeiten übernehmen (vor dem Speichern prüfen)",
                  it: "Includi questi orari (verifica prima di salvare)",
                  sq: "Përfshi këtë orar (kontrolloje para ruajtjes)",
                }[locale]
              }
            </label>
            <div className="website-hours-grid">
              {WEEKDAYS.map((day) => {
                const hours = website.openingHours.find(
                  (item) => item.day === day,
                );
                return (
                  <div className="website-hours-row" key={day}>
                    <strong>{labels.days[day]}</strong>
                    <input
                      defaultValue={hours?.opensAt ?? ""}
                      name={`opensAt-${day}`}
                      type="time"
                    />
                    <span>—</span>
                    <input
                      defaultValue={hours?.closesAt ?? ""}
                      name={`closesAt-${day}`}
                      type="time"
                    />
                    <label>
                      <input
                        defaultChecked={hours?.closed}
                        name={`closed-${day}`}
                        type="checkbox"
                      />
                      {labels.closed}
                    </label>
                  </div>
                );
              })}
            </div>
          </details>
        </section>

        <div className="website-editor-actions">
          <button
            className="button button-primary"
            disabled={busy !== null}
            type="submit"
          >
            {busy === "save" ? labels.saving : labels.save}
          </button>
          <button
            className="button button-ghost"
            disabled={busy !== null}
            onClick={preview}
            type="button"
          >
            {busy === "preview" ? labels.previewing : labels.preview}
          </button>
          {website.status === "PUBLISHED" ? (
            <button
              className="button website-unpublish"
              disabled={busy !== null}
              onClick={unpublish}
              type="button"
            >
              {labels.unpublish}
            </button>
          ) : (
            <button
              className="button button-primary"
              disabled={busy !== null}
              onClick={publish}
              type="button"
            >
              {busy === "publish" ? labels.publishing : labels.publish}
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

function AssetUpload({
  accept,
  busy,
  hint,
  label,
  onChange,
  previewUrl,
  uploadingLabel,
}: {
  accept: string;
  busy: boolean;
  hint: string;
  label: string;
  onChange: (file: File | null) => void;
  previewUrl: string | null;
  uploadingLabel: string;
}) {
  return (
    <label className="website-asset-upload">
      {previewUrl ? <img alt="" src={previewUrl} /> : <span>FG</span>}
      <strong>{busy ? uploadingLabel : label}</strong>
      <small>{hint}</small>
      <input
        accept={accept}
        disabled={busy}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        type="file"
      />
    </label>
  );
}

function EditorInput({
  defaultValue,
  label,
  maxLength,
  name,
  type = "text",
}: {
  defaultValue: string | null;
  label: string;
  maxLength?: number;
  name: string;
  type?: "text" | "url" | "email" | "tel";
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        defaultValue={defaultValue ?? ""}
        maxLength={maxLength}
        name={name}
        type={type}
      />
    </label>
  );
}

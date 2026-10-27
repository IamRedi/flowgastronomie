"use client";
import { useState } from "react";
import {
  premiumShowcase,
  websiteTemplate,
  type BusinessProfileId,
} from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import type { WebsiteEditor } from "../app/app/[lang]/website/website-editor-client";
import { WebsiteSections } from "./website-sections";
import { websiteTemplatePreview } from "./website-template-preview";
import type { VenueSiteData } from "./venue-site-view";
import { websiteV2Copy } from "./website-v2-copy";
export function WebsiteTemplatePicker({
  website,
  previewSite,
  apiUrl,
  profile,
  locale,
  busy,
  enabled,
  existing,
  onCreate,
  onClose,
}: {
  website: WebsiteEditor;
  previewSite: VenueSiteData;
  apiUrl: string;
  profile: BusinessProfileId;
  locale: Locale;
  busy: boolean;
  enabled: boolean;
  existing: boolean;
  onCreate: (styleId: string, ai: boolean, instruction: string) => void;
  onClose: () => void;
}) {
  const c = websiteV2Copy(locale),
    pack = premiumShowcase(profile);
  const [selected, select] = useState(
    pack.styles.find((s) => s.id === website.premiumStyleId)?.id ??
      pack.styles[0].id,
  );
  const [ai, setAi] = useState(false),
    [instruction, setInstruction] = useState("");
  return (
    <section className="v2-template-picker" aria-label={c[0]}>
      <header>
        <div>
          <small>{website.venueName}</small>
          <h1>{c[0]}</h1>
          <p>{c[1]}</p>
        </div>
        {existing && (
          <button onClick={onClose} aria-label={c[7]}>
            ×
          </button>
        )}
      </header>
      <div className="v2-template-options" role="radiogroup" aria-label={c[0]}>
        {pack.styles.map((style, i) => {
          const generated = websiteTemplate({
            profileId: profile,
            styleId: style.id,
            venueName: website.venueName,
            translations: website.translations,
            document: existing ? (website.document ?? null) : null,
          });
          const site = websiteTemplatePreview(
            {
              ...previewSite,
              brand: {
                ...previewSite.brand,
                premiumStyleId: style.id,
                primaryColor: style.primaryColor,
                accentColor: style.accentColor,
              },
              document: generated.document,
              designVersion: 2,
            },
            profile,
          ).site;
          return (
            <button
              key={style.id}
              className="v2-template-option"
              role="radio"
              aria-checked={selected === style.id}
              onClick={() => select(style.id)}
              disabled={busy}
            >
              <div className="v2-template-thumbnail" aria-hidden="true" inert>
                <WebsiteSections website={site} apiUrl={apiUrl} />
              </div>
              <span>
                <strong>{style.name}</strong>
                {i === 0 && <small>{c[2]}</small>}
                <span aria-hidden="true">
                  {selected === style.id ? "●" : "○"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="v2-template-footer">
        <div>
          <label>
            {c[5]}
            <input
              value={instruction}
              maxLength={1000}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={pack.styles.find((s) => s.id === selected)?.name}
            />
          </label>
          {!existing && enabled && (
            <label className="v2-check">
              <input
                type="checkbox"
                checked={ai}
                onChange={(e) => setAi(e.target.checked)}
              />
              {c[4]}
            </label>
          )}
          <small>{existing ? c[39] : c[26]}</small>
        </div>
        <button
          className="builder-primary"
          disabled={busy}
          onClick={() => onCreate(selected, ai, instruction)}
        >
          {busy ? "…" : existing ? c[25] : c[3]} ↗
        </button>
      </div>
    </section>
  );
}

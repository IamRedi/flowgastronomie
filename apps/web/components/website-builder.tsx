"use client";
import { useEffect, useRef, useState } from "react";
import {
  PLATFORM_LOCALES,
  websiteTemplate,
  businessProfileCatalog,
  replaceWebsiteSectionCopy,
  premiumStyles,
  websiteDocumentSchema,
  type WebsiteDocument,
  type WebsiteSection,
  type WebsitePlan,
  type CanonicalMediaReference,
} from "@flowgastronomie/domain";
import type { WebsiteEditor } from "../app/app/[lang]/website/website-editor-client";
import type { Dictionary } from "../lib/dictionaries";
import { premiumCopy } from "./premium-copy";
import type { Locale } from "../lib/i18n";
import type { VenueSiteData } from "./venue-site-view";
import { WebsiteSections } from "./website-sections";
import { WebsiteDraftHistory } from "./website-draft-history";
import { ProductPhotoEditor } from "./product-photo-editor";
import { AiTextActions } from "./ai-text-actions";
import { WebsiteBuilderSettings } from "./website-builder-settings";
import { websiteBuilderCopy } from "./website-builder-copy";
import { useWebsiteDraft } from "./use-website-draft";
import { WebsiteTemplatePicker } from "./website-template-picker";
import { websiteTemplatePreview } from "./website-template-preview";
import {
  templateDraftMedia,
  approvedDraftMediaUrl,
} from "./website-template-draft-media";
import { websiteV2Copy } from "./website-v2-copy";
import { WebsiteMenuStudio } from "./website-menu-studio";
import { PilotIcon } from "../app/[lang]/staff/pilot-icon";
import { websiteEditorCopy } from "./website-editor-copy";
import "./website-builder.css";
import "./product-catalog.css";

type Proposal = {
  imageAssetId?: string | null;
  designOnly?: boolean;
  id: string;
  title: string;
  description: string;
  provider: string;
  model: string;
  plan?: WebsitePlan;
  sectionId?: string;
  locale?: Locale;
  expectedUpdatedAt?: string;
};
type Media = {
  library: CanonicalMediaReference[];
  products?: { productId: string; media: CanonicalMediaReference }[];
  venue: { role: string; media: CanonicalMediaReference }[];
};
type Menu = {
  venue: { name: string; currency: string };
  categories: {
    id: string;
    published: boolean;
    translations: { locale: string; name: string }[];
    products: {
      id: string;
      published: boolean;
      available: boolean;
      priceMinor: number;
      currency: string;
      translations: {
        locale: string;
        name: string;
        description: string | null;
      }[];
    }[];
  }[];
};
export function WebsiteBuilder({
  website,

  labels,
  locale,
  apiUrl: api,
  onSaved,
  onReload,
}: {
  website: WebsiteEditor;
  startWithAi?: boolean;
  labels: Dictionary["websiteAdmin"];
  locale: Locale;
  apiUrl: string;
  onSaved: (website: WebsiteEditor) => void;
  onReload: () => void;
}) {
  const c = websiteBuilderCopy(locale);
  const words = premiumCopy(locale);
  const sectionNames = {
    HERO: labels.heroTitle,
    ABOUT: words.story,
    MENU: words.menu,
    GALLERY: { en: "Gallery", de: "Galerie", it: "Galleria", sq: "Galeria" }[
      locale
    ],
    CONTACT: words.contact,
  };
  const v = websiteV2Copy(locale);
  const toolbar = websiteEditorCopy(locale);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [setup, setSetup] = useState(!website.document);
  const [panel, setPanel] = useState<"section" | "settings" | "ai" | null>(
    null,
  );
  const toolsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!panel || proposal || setup) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      event.preventDefault();
      setPanel(null);
      toolsButton.current?.focus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [panel, proposal, setup]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);
  const editing = useWebsiteDraft(
    website,
    api,
    onSaved,
    busy || !!proposal || setup,
  );
  const { draft, setDraft } = editing;
  const profile =
    businessProfileCatalog().find((p) => p.id === website.businessProfileId)
      ?.id ?? "GENERIC";
  const [language, setLanguage] = useState<Locale>(locale);
  const [selected, setSelected] = useState(draft.document.sections[0]!.id);
  const description = "";
  const businessType = profile;
  const [instruction, setInstruction] = useState("");
  const [styleOnly, setStyleOnly] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [sourceLocale, setSourceLocale] = useState<Locale>(locale);

  const [enabled, setEnabled] = useState(false);
  const [feedback, setFeedback] = useState("");

  const [loadedProposalImage, setLoadedProposalImage] = useState<string | null>(
    null,
  );
  const [history, setHistory] = useState<Proposal[]>([]);
  const [media, setMedia] = useState<Media>({ library: [], venue: [] });
  const [menu, setMenu] = useState<Menu | null>(null);
  const [photo, setPhoto] = useState(false);
  const [library, setLibrary] = useState(false);

  const [previewWidth, setPreviewWidth] = useState("100%");
  async function request(path: string, body?: unknown, method = "POST") {
    const response = await fetch(`${api}${path}`, {
      credentials: "include",
      ...(body !== undefined
        ? {
            method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  }
  useEffect(() => {
    let active = true;
    void Promise.all([
      request("/v1/workspace/media"),
      request("/v1/staff/menu"),
      request("/v1/staff/website-ai/capabilities").catch(() => ({
        enabled: false,
      })),
      request("/v1/staff/website-ai/proposals").catch(() => []),
    ])
      .then(([assets, products, capabilities, proposals]) => {
        if (!active) return;
        setMedia(assets);
        setMenu(products);
        setEnabled(capabilities.enabled);
        setHistory(
          proposals.map(
            (p: { id: string; metadata: Omit<Proposal, "id"> }) => ({
              id: p.id,
              ...p.metadata,
            }),
          ),
        );
      })
      .catch(() => {
        if (active) setFeedback(c[13]!);
      });
    return () => {
      active = false;
    };
    // The authenticated venue/website identity is fixed for this editor mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, website.venueId]);
  const section =
    draft.document.sections.find((s) => s.id === selected) ??
    draft.document.sections[0]!;
  const text = section.content.find((t) => t.locale === language)!;
  function updateSection(change: Partial<WebsiteSection>) {
    setDraft((d) => ({
      ...d,
      document: {
        ...d.document,
        sections: d.document.sections.map((s) =>
          s.id === section.id ? { ...s, ...change } : s,
        ),
      },
    }));
  }
  async function save(value?: typeof draft, sourceProposalId?: string) {
    return editing.save(value, sourceProposalId);
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setFeedback("");
    try {
      await work();
    } catch {
      setFeedback(c[13]!);
    } finally {
      setBusy(false);
    }
  }
  async function generate(
    action?:
      | "WRITE"
      | "IMPROVE"
      | "SHORTEN"
      | "EXPAND"
      | "TONE"
      | "TRANSLATE"
      | "REGENERATE",
    styleInstruction?: string,
  ) {
    await run(async () => {
      const saved = await save();
      const body = {
        requestKey: crypto.randomUUID(),
        expectedUpdatedAt: saved.updatedAt,
        locale: language,
        operation: action ? "SECTION" : "SITE",
        includeImage: !action && !styleOnly,
        ...(!action && styleOnly ? { designOnly: true } : {}),
        ...(action ? { action, sectionId: section.id, sourceLocale } : {}),
        instruction:
          styleInstruction?.trim() ||
          instruction.trim() ||
          (action
            ? `${action} this section, preserve verified facts.`
            : "Create a coherent website using only this business context."),
        description,
        businessType,
      };
      const result = await request("/v1/staff/website-ai/propose", body);
      setShowCurrent(false);
      setProposal({
        ...result,
        designOnly: !action && styleOnly,
        sectionId: action ? section.id : undefined,
        locale: language,
        expectedUpdatedAt: saved.updatedAt,
      });
    });
  }
  async function accept() {
    if (!proposal) return;
    await run(async () => {
      if (
        proposal.expectedUpdatedAt &&
        proposal.expectedUpdatedAt !== draft.updatedAt
      )
        throw Error();
      const generation = {
        proposalId: proposal.id,
        provider: proposal.provider,
        model: proposal.model,
        approved: true,
      };
      let next = draft;
      if (proposal.plan) {
        const plan = proposal.plan;
        const style = premiumStyles().find((s) => s.id === plan.styleId)!;
        const doc: WebsiteDocument = websiteDocumentSchema.parse({
          version: 1,
          typography: plan.typography,
          sections: plan.sections.map((s, index) => {
            const prior = draft.document.sections.find(
              (p) => p.type === s.type,
            );
            const realHero = media.venue.find((m) => m.role === "HERO")?.media;
            return {
              ...s,
              id: prior?.id ?? `${s.type.toLowerCase()}-${index}`,
              visible: true,
              generation,
              media: prior?.media.length
                ? prior.media
                : s.type === "HERO" && realHero
                  ? [
                      {
                        assetId: realHero.id,
                        alt: website.venueName,
                        x: 50,
                        y: 50,
                      },
                    ]
                  : [],
            };
          }),
        });
        doc.sections.push(
          ...draft.document.sections.filter(
            (s) => !doc.sections.some((n) => n.type === s.type),
          ),
        );
        next = {
          ...draft,
          document: doc,
          designVersion: 2,
          premiumStyleId: style.id,
          primaryColor: style.primaryColor,
          accentColor: style.accentColor,
          translations: draft.translations.map((t) => {
            const seo = plan.seo.find((v) => v.locale === t.locale)!;
            return {
              ...t,
              seoTitle: seo.title,
              seoDescription: seo.description,
            };
          }),
        };
        setSelected(doc.sections[0]!.id);
      } else {
        next = {
          ...draft,
          document: replaceWebsiteSectionCopy(
            draft.document,
            proposal.sectionId ?? section.id,
            proposal.locale ?? language,
            { title: proposal.title, body: proposal.description },
            generation,
          ),
        };
      }
      if (proposal.plan && proposal.designOnly) {
        next = {
          ...draft,
          premiumStyleId: next.premiumStyleId ?? null,
          primaryColor: next.primaryColor,
          accentColor: next.accentColor,
          designVersion: 2,
          document: {
            ...draft.document,
            typography: proposal.plan.typography,
            sections: draft.document.sections.map((s) => ({
              ...s,
              layout:
                proposal.plan!.sections.find((p) => p.type === s.type)
                  ?.layout ?? s.layout,
            })),
          },
        };
      }
      if (proposal.imageAssetId && proposal.plan && !proposal.designOnly) {
        const promoted = await request(
          `/v1/staff/creative/assets/${proposal.imageAssetId}/promote`,
          { kind: "WEBSITE", approved: true },
        );
        const assets = (await request("/v1/workspace/media")) as Media;
        setMedia(assets);
        next = {
          ...next,
          document: {
            ...next.document,
            sections: next.document.sections.map((s) =>
              s.type === "HERO"
                ? {
                    ...s,
                    media: [
                      {
                        assetId: promoted.mediaAssetId,
                        alt:
                          s.content.find((t) => t.locale === language)?.title ||
                          website.venueName,
                        x: 50,
                        y: 50,
                      },
                    ],
                  }
                : s,
            ),
          },
        };
      }
      await save(next, proposal.id);
      setProposal(null);
      setSetup(false);
    });
  }
  function attach(ref: CanonicalMediaReference) {
    setMedia((m) => ({
      ...m,
      library: [ref, ...m.library.filter((r) => r.id !== ref.id)],
    }));
    updateSection({
      media:
        section.type === "GALLERY"
          ? [
              ...section.media.filter((m) => m.assetId !== ref.id),
              {
                assetId: ref.id,
                alt: text.title || website.venueName,
                x: 50,
                y: 50,
              },
            ].slice(-8)
          : [
              {
                assetId: ref.id,
                alt: text.title || website.venueName,
                x: 50,
                y: 50,
              },
            ],
    });
    setLibrary(false);
  }
  async function upload(blob: Blob): Promise<CanonicalMediaReference> {
    const response = await fetch(`${api}/v1/staff/creative/assets`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": blob.type },
      body: blob,
    });
    if (!response.ok) throw Error();
    const asset = await response.json();
    const result = await request(
      `/v1/staff/creative/assets/${asset.id}/promote`,
      { kind: "WEBSITE", approved: true },
    );
    const assets = (await request("/v1/workspace/media")) as Media;
    return assets.library.find((m) => m.id === result.mediaAssetId)!;
  }
  const site: VenueSiteData & { document: WebsiteDocument } = {
    locale: language,
    publicSlug: draft.publicSlug,
    document: draft.document,
    designVersion: draft.designVersion,
    sectionMedia: media.library,
    venue: menu?.venue ?? { name: website.venueName, currency: "" },
    brand: {
      premiumStyleId: draft.premiumStyleId,
      primaryColor: draft.primaryColor,
      accentColor: draft.accentColor,
      logoUrl: draft.logoUrl,
      heroImageUrl: draft.heroImageUrl,
    },
    content: draft.translations.find((t) => t.locale === language)!,
    contact: {
      phone: draft.phone,
      email: draft.contactEmail,
      address: draft.address,
      instagramUrl: draft.instagramUrl,
      facebookUrl: draft.facebookUrl,
      openingHours: draft.openingHours,
    },
    menu: (menu?.categories ?? []).map((cat) => ({
      id: cat.id,
      name:
        cat.translations.find((t) => t.locale === language)?.name ??
        cat.translations[0]?.name ??
        "",
      products: cat.products.map((p) => ({
        ...p,
        media: media.products?.find((m) => m.productId === p.id)?.media,
        name:
          p.translations.find((t) => t.locale === language)?.name ??
          p.translations[0]?.name ??
          "",
        description:
          p.translations.find((t) => t.locale === language)?.description ??
          null,
      })),
    })),
  };
  let visualSite = site;
  if (proposal?.plan) {
    const style = premiumStyles().find((s) => s.id === proposal.plan!.styleId)!;
    visualSite = {
      ...site,
      designVersion: 2,
      brand: {
        ...site.brand,
        premiumStyleId: style.id,
        primaryColor: style.primaryColor,
        accentColor: style.accentColor,
      },
      document: {
        version: 1,
        typography: proposal.plan.typography,
        sections: proposal.plan.sections.map((s, i) => ({
          ...s,
          id:
            draft.document.sections.find((p) => p.type === s.type)?.id ??
            `${s.type.toLowerCase()}-${i}`,
          visible: true,
          generation: null,
          media:
            draft.document.sections.find((p) => p.type === s.type)?.media ?? [],
        })),
      },
    };
    visualSite.document.sections.push(
      ...site.document.sections.filter(
        (s) => !visualSite.document.sections.some((n) => n.type === s.type),
      ),
    );
    if (proposal.imageAssetId) {
      const id = proposal.imageAssetId;
      visualSite = {
        ...visualSite,
        sectionMedia: [
          ...(site.sectionMedia ?? []),
          {
            id,
            url: `/v1/staff/creative/assets/${id}/content`,
            width: 1024,
            height: 1024,
            source: "GENERATED",
            approvedForPublicUse: false,
            contentHash: "",
            label: "AI",
          },
        ],
        document: {
          ...visualSite.document,
          sections: visualSite.document.sections.map((s) =>
            s.type === "HERO"
              ? {
                  ...s,
                  media: [
                    {
                      assetId: id,
                      alt:
                        s.content.find((t) => t.locale === language)?.title ??
                        "",
                      x: 50,
                      y: 50,
                    },
                  ],
                }
              : s,
          ),
        },
      };
    }
  } else if (proposal) {
    visualSite = {
      ...site,
      document: replaceWebsiteSectionCopy(
        site.document,
        proposal.sectionId ?? section.id,
        proposal.locale ?? language,
        { title: proposal.title, body: proposal.description },
        null,
      ),
    };
  }
  if (proposal?.plan && proposal.designOnly)
    visualSite = {
      ...site,
      brand: visualSite.brand,
      designVersion: 2,
      document: {
        ...site.document,
        typography: proposal.plan.typography,
        sections: site.document.sections.map((s) => ({
          ...s,
          layout:
            proposal.plan!.sections.find((p) => p.type === s.type)?.layout ??
            s.layout,
        })),
      },
    };
  const preview = websiteTemplatePreview(
    showCurrent ? site : visualSite,
    profile,
  );
  async function createTemplate(
    styleId: string,
    ai: boolean,
    preference: string,
  ) {
    await run(async () => {
      const generated = websiteTemplate({
        profileId: profile,
        styleId,
        venueName: website.venueName,
        translations: draft.translations,
        document: website.document ? draft.document : null,
      });
      const document = templateDraftMedia(
        generated.document,
        media.venue,
        website.venueName,
      );
      const approvedReferences = [
        ...media.library,
        ...media.venue.map((row) => row.media),
      ];
      await save({
        ...draft,
        document,
        translations: draft.translations.map((t) => ({
          ...t,
          seoTitle: t.seoTitle || website.venueName.slice(0, 70),
          seoDescription:
            t.seoDescription ||
            document.sections
              .find((s) => s.type === "HERO")!
              .content.find((c) => c.locale === t.locale)!
              .body.slice(0, 180),
        })),
        designVersion: 2,
        logoUrl:
          approvedDraftMediaUrl(draft.logoUrl, approvedReferences) ??
          media.venue.find(
            (m) => m.role === "LOGO" && m.media.approvedForPublicUse,
          )?.media.url ??
          null,
        heroImageUrl: approvedDraftMediaUrl(
          draft.heroImageUrl,
          approvedReferences,
        ),
        premiumStyleId: styleId,
        primaryColor: generated.style.primaryColor,
        accentColor: generated.style.accentColor,
      });
      setSetup(false);
      setPanel(null);
      setInstruction(preference);
      setFeedback(v[26]!);
    });
    if (ai) await generate(undefined, preference);
  }
  return (
    <main className="website-builder website-builder-v2">
      {!setup && (
        <header className="builder-toolbar">
          <a
            className="builder-back"
            href={`/app/${locale}`}
            aria-label={toolbar.back}
            title={toolbar.back}
          >
            <PilotIcon name="back" />
          </a>
          <div className="builder-identity">
            <h1 title={website.venueName}>{website.venueName}</h1>
            <div className="builder-draft-state">
              <span
                className="builder-publication"
                data-published={website.status === "PUBLISHED"}
              >
                {website.status === "PUBLISHED"
                  ? labels.published
                  : labels.draft}
              </span>
              <span className="v2-statusbar">
                <span role="status">
                  {
                    v[
                      editing.status === "saved"
                        ? 8
                        : editing.status === "saving"
                          ? 9
                          : editing.status === "offline"
                            ? 11
                            : editing.status === "conflict"
                              ? 12
                              : 10
                    ]
                  }
                </span>
              </span>
            </div>
          </div>
          <div
            className="builder-actions v2-devices"
            role="group"
            aria-label={toolbar.devices}
          >
            {["100%", "768px", "360px"].map((w) => (
              <button
                key={w}
                aria-label={
                  w === "100%" ? "Desktop" : w === "768px" ? "Tablet" : "Mobile"
                }
                title={
                  w === "100%" ? "Desktop" : w === "768px" ? "Tablet" : "Mobile"
                }
                aria-pressed={previewWidth === w}
                onClick={() => setPreviewWidth(w)}
              >
                <PilotIcon
                  name={
                    w === "100%"
                      ? "desktop"
                      : w === "768px"
                        ? "tablet"
                        : "mobile"
                  }
                />
              </button>
            ))}
          </div>
          <div className="builder-actions builder-history-actions">
            <button
              aria-label={v[16]}
              title={v[16]}
              disabled={!editing.canUndo || busy || !!proposal}
              onClick={editing.undo}
            >
              <PilotIcon name="undo" />
            </button>
            <button
              aria-label={v[17]}
              title={v[17]}
              disabled={!editing.canRedo || busy || !!proposal}
              onClick={editing.redo}
            >
              <PilotIcon name="redo" />
            </button>
          </div>
          <div className="builder-actions builder-release-actions">
            <button
              ref={toolsButton}
              aria-label={v[24]}
              title={toolbar.tools}
              aria-expanded={panel !== null && !proposal}
              disabled={!!proposal}
              aria-controls="website-context-tools"
              onClick={() => setPanel(panel ? null : "settings")}
            >
              <PilotIcon name="settings" />
            </button>
            <button
              disabled={busy || !!proposal}
              onClick={() =>
                void run(async () => {
                  await save();
                  window.open(
                    `/app/${language}/website/preview`,
                    "_blank",
                    "noopener",
                  );
                })
              }
            >
              {toolbar.preview}
            </button>
            <button
              className="builder-primary"
              disabled={busy || !!proposal || editing.status === "conflict"}
              onClick={() => {
                if (window.confirm(c[11]))
                  void run(async () => {
                    const saved = await save();
                    const result = await request(
                      "/v1/workspace/website/publish",
                      { expectedUpdatedAt: saved.updatedAt },
                    );
                    onSaved(result);
                  });
              }}
            >
              {toolbar.publish}
            </button>
          </div>
        </header>
      )}
      {!setup &&
        (editing.status === "offline" || editing.status === "conflict") && (
          <div className="builder-recovery-actions">
            {editing.status === "offline" && (
              <button onClick={editing.retry}>{v[13]}</button>
            )}
            {editing.status === "conflict" && (
              <>
                <button
                  onClick={() => void run(() => editing.resolveConflict(true))}
                >
                  {v[14]}
                </button>
                <button
                  onClick={() => void run(() => editing.resolveConflict(false))}
                >
                  {v[15]}
                </button>
              </>
            )}
          </div>
        )}
      {feedback && (
        <p role="status" className="builder-feedback">
          {feedback}
        </p>
      )}
      {busy && <p role="status">{c[40]}</p>}
      {setup && (
        <WebsiteTemplatePicker
          website={draft}
          previewSite={site}
          apiUrl={api}
          profile={profile}
          locale={locale}
          busy={busy}
          enabled={enabled}
          existing={!!website.document}
          onCreate={(id, ai, note) => void createTemplate(id, ai, note)}
          onClose={() => setSetup(false)}
        />
      )}
      {proposal && (
        <section className="builder-proposal v2-proposal" aria-label={c[6]}>
          <strong>{v[27]}</strong>
          <button
            aria-pressed={showCurrent}
            onClick={() => setShowCurrent(!showCurrent)}
          >
            {showCurrent ? v[57] : v[56]}
          </button>
          <button
            disabled={
              busy ||
              (!!proposal.imageAssetId &&
                loadedProposalImage !== proposal.imageAssetId)
            }
            onClick={() => void accept()}
          >
            {c[7]}
          </button>
          <button disabled={busy} onClick={() => setProposal(null)}>
            {c[8]}
          </button>
        </section>
      )}
      {!setup && (
        <div className="builder-workspace">
          {panel && !proposal && (
            <aside
              id="website-context-tools"
              className="builder-controls"
              aria-label={panel === "settings" ? v[24] : c[14]}
            >
              <div className="builder-actions">
                <strong>
                  {panel === "settings"
                    ? v[24]
                    : panel === "ai"
                      ? c[16]
                      : sectionNames[section.type]}
                </strong>
                <button
                  onClick={() => {
                    setPanel(null);
                    toolsButton.current?.focus();
                  }}
                  aria-label={v[7]}
                >
                  {v[7]}
                </button>
              </div>
              <nav aria-label={toolbar.tools}>
                <button
                  disabled={busy || !!proposal}
                  onClick={() => setSetup(true)}
                >
                  {v[6]}
                </button>
                <button onClick={() => setMenuOpen(true)}>{v[18]}</button>
                <button
                  disabled={!enabled || busy}
                  aria-pressed={panel === "ai"}
                  onClick={() => setPanel("ai")}
                >
                  AI
                </button>
                <button
                  aria-pressed={panel === "settings"}
                  onClick={() => setPanel("settings")}
                >
                  {v[24]}
                </button>
              </nav>
              <label>
                {c[25]}
                <select
                  aria-label={c[25]}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Locale)}
                >
                  {PLATFORM_LOCALES.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              {panel === "ai" ? (
                <>
                  <label className="v2-check">
                    <input
                      type="checkbox"
                      checked={styleOnly}
                      onChange={(e) => setStyleOnly(e.target.checked)}
                    />
                    {v[39]}
                  </label>
                  <label>
                    {v[5]}
                    <textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      maxLength={1000}
                    />
                  </label>
                  <button
                    disabled={busy || !enabled}
                    onClick={() => void generate()}
                  >
                    {c[5]}
                  </button>
                </>
              ) : null}
              {panel === "section" && (
                <>
                  <label>
                    {c[25]}
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as Locale)}
                    >
                      {PLATFORM_LOCALES.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                  <nav aria-label={c[14]}>
                    {draft.document.sections.map((s) => (
                      <button
                        key={s.id}
                        aria-pressed={selected === s.id}
                        onClick={() => setSelected(s.id)}
                      >
                        {s.content.find((t) => t.locale === language)?.title ||
                          sectionNames[s.type]}
                        {!s.visible ? " ◌" : ""}
                      </button>
                    ))}
                  </nav>
                  {draft.document.sections.length < 8 &&
                    !draft.document.sections.some(
                      (s) => s.type === "GALLERY",
                    ) && (
                      <button
                        type="button"
                        onClick={() => {
                          const added: WebsiteSection = {
                            id: crypto.randomUUID(),
                            type: "GALLERY",
                            visible: true,
                            layout: "EDITORIAL",
                            content: PLATFORM_LOCALES.map((locale) => ({
                              locale,
                              title: "",
                              body: "",
                            })),
                            media: [],
                            generation: null,
                          };
                          setDraft({
                            ...draft,
                            document: {
                              ...draft.document,
                              sections: [...draft.document.sections, added],
                            },
                          });
                          setSelected(added.id);
                        }}
                      >
                        + {sectionNames.GALLERY}
                      </button>
                    )}
                  <div className="builder-section-controls">
                    <div className="builder-actions">
                      <button
                        onClick={() =>
                          updateSection({ visible: !section.visible })
                        }
                      >
                        {section.visible ? c[19] : c[20]}
                      </button>
                      {[-1, 1].map((delta) => (
                        <button
                          key={delta}
                          disabled={
                            busy ||
                            draft.document.sections.indexOf(section) + delta <
                              0 ||
                            draft.document.sections.indexOf(section) + delta >=
                              draft.document.sections.length
                          }
                          onClick={() => {
                            const rows = [...draft.document.sections];
                            const i = rows.indexOf(section);
                            [rows[i], rows[i + delta]] = [
                              rows[i + delta]!,
                              rows[i]!,
                            ];
                            setDraft({
                              ...draft,
                              document: { ...draft.document, sections: rows },
                            });
                          }}
                        >
                          {delta < 0 ? c[21] : c[22]}
                        </button>
                      ))}
                    </div>
                    <details>
                      <summary>✦ {c[16]}</summary>
                      <label>
                        {c[35]}
                        <input
                          value={instruction}
                          maxLength={1000}
                          onChange={(e) => setInstruction(e.target.value)}
                        />
                      </label>
                      <label>
                        {c[36]}
                        <select
                          value={sourceLocale}
                          onChange={(e) =>
                            setSourceLocale(e.target.value as Locale)
                          }
                        >
                          {PLATFORM_LOCALES.map((l) => (
                            <option key={l}>{l}</option>
                          ))}
                        </select>
                      </label>
                      <AiTextActions
                        locale={locale}
                        disabled={busy || !enabled}
                        onAction={(action) => void generate(action)}
                      />
                    </details>
                    <div className="builder-actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await save();
                            setPhoto(true);
                          })
                        }
                      >
                        {c[17]}
                      </button>
                      <button onClick={() => setLibrary(!library)}>
                        {c[18]}
                      </button>
                    </div>
                    {library && (
                      <div className="builder-library">
                        {media.library.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => attach(m)}
                            aria-label={`${c[31]} ${m.label}`}
                          >
                            <img
                              src={`${api}${m.url}`}
                              alt={m.label ?? ""}
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {section.media.map((m) => (
                      <details key={m.assetId}>
                        <summary>{c[32]}</summary>
                        <label>
                          Alt
                          <input
                            maxLength={180}
                            value={m.alt}
                            onChange={(e) =>
                              updateSection({
                                media: section.media.map((v) =>
                                  v === m ? { ...v, alt: e.target.value } : v,
                                ),
                              })
                            }
                          />
                        </label>
                        {(["x", "y"] as const).map((axis) => (
                          <label key={axis}>
                            {axis.toUpperCase()}
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={m[axis]}
                              onChange={(e) =>
                                updateSection({
                                  media: section.media.map((v) =>
                                    v === m
                                      ? { ...v, [axis]: Number(e.target.value) }
                                      : v,
                                  ),
                                })
                              }
                            />
                          </label>
                        ))}
                        <button
                          onClick={() =>
                            updateSection({
                              media: section.media.filter((v) => v !== m),
                            })
                          }
                        >
                          {c[41]}
                        </button>
                      </details>
                    ))}
                    <label>
                      {c[23]}
                      <select
                        value={section.layout}
                        onChange={(e) =>
                          updateSection({
                            layout: e.target.value as WebsiteSection["layout"],
                          })
                        }
                      >
                        {["SPLIT", "CENTERED", "EDITORIAL"].map((l) => (
                          <option key={l}>{l}</option>
                        ))}
                      </select>
                    </label>
                    <small>{c[30]}</small>
                  </div>
                </>
              )}
              {panel === "settings" && (
                <>
                  <details>
                    <summary>{c[26]}</summary>
                    {(["phone", "contactEmail", "address"] as const).map(
                      (key) => (
                        <label key={key}>
                          {key === "contactEmail" ? labels.email : labels[key]}
                          <input
                            value={draft[key] ?? ""}
                            onChange={(e) => {
                              setDraft({
                                ...draft,
                                [key]: e.target.value || null,
                              });
                            }}
                          />
                        </label>
                      ),
                    )}
                    {(["seoTitle", "seoDescription"] as const).map((key) => (
                      <label key={key}>
                        {labels[key]}
                        <input
                          value={
                            draft.translations.find(
                              (t) => t.locale === language,
                            )?.[key] ?? ""
                          }
                          maxLength={key === "seoTitle" ? 70 : 180}
                          onChange={(e) => {
                            setDraft({
                              ...draft,
                              translations: draft.translations.map((t) =>
                                t.locale === language
                                  ? { ...t, [key]: e.target.value }
                                  : t,
                              ),
                            });
                          }}
                        />
                      </label>
                    ))}
                  </details>
                  {draft.publishedAt && (
                    <a
                      href={`/${language}/venue/${draft.publicSlug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {v[23]}
                    </a>
                  )}
                  <WebsiteDraftHistory
                    locale={locale}
                    updatedAt={draft.updatedAt}
                    onRestored={onReload}
                  />
                  <WebsiteBuilderSettings
                    website={draft}
                    labels={labels}
                    busy={busy}
                    update={(change) => {
                      setDraft({
                        ...draft,
                        ...change,
                        document: change.document ?? draft.document,
                      });
                    }}
                    unpublish={() => {
                      if (window.confirm(labels.unpublish))
                        void run(async () => {
                          await save();
                          const result = await request(
                            "/v1/workspace/website/unpublish",
                            {},
                          );
                          onSaved(result);
                        });
                    }}
                  />
                  {history.length > 0 && (
                    <details>
                      <summary>{c[38]}</summary>
                      {history.map((p) => (
                        <button
                          key={p.id}
                          disabled={
                            busy || p.expectedUpdatedAt !== draft.updatedAt
                          }
                          onClick={() => setProposal(p)}
                        >
                          {p.title || c[6]}
                        </button>
                      ))}
                    </details>
                  )}
                </>
              )}
            </aside>
          )}
          <div className="builder-preview">
            <div
              style={{
                width: previewWidth,
                maxWidth: "100%",
                margin: "0 auto",
              }}
            >
              <WebsiteSections
                website={preview.site}
                apiUrl={api}
                selected={panel === "section" ? section.id : undefined}
                onSelect={
                  proposal
                    ? undefined
                    : (id) => {
                        setSelected(id);
                        setPanel("section");
                      }
                }
                onTextChange={
                  proposal
                    ? undefined
                    : (id, field, value) =>
                        setDraft((d) => ({
                          ...d,
                          document: {
                            ...d.document,
                            sections: d.document.sections.map((s) =>
                              s.id === id
                                ? {
                                    ...s,
                                    content: s.content.map((t) =>
                                      t.locale === language
                                        ? { ...t, [field]: value }
                                        : t,
                                    ),
                                  }
                                : s,
                            ),
                          },
                        }))
                }
                onPhoto={
                  proposal
                    ? undefined
                    : (id) => {
                        setSelected(id);
                        void run(async () => {
                          await save();
                          setPhoto(true);
                        });
                      }
                }
                onProduct={
                  proposal
                    ? undefined
                    : (id) => {
                        if (
                          menu?.categories.some((cat) =>
                            cat.products.some((p) => p.id === id),
                          )
                        )
                          setProductId(id);
                        else setMenuOpen(true);
                      }
                }
                onImageLoad={(id) => {
                  if (id === proposal?.imageAssetId) setLoadedProposalImage(id);
                }}
              />
            </div>
            <p>
              {preview.demo || preview.illustrative ? v[21] : v[22]} · {v[20]}
            </p>
          </div>
        </div>
      )}
      {(menuOpen || productId) && (
        <WebsiteMenuStudio
          apiUrl={api}
          locale={locale}
          productId={productId}
          onClose={() => {
            setMenuOpen(false);
            setProductId(null);
          }}
          onChanged={async () => {
            setMenu(await request("/v1/staff/menu"));
            setMedia(await request("/v1/workspace/media"));
          }}
        />
      )}
      {photo && (
        <ProductPhotoEditor
          target="website-sections"
          productId={section.id}
          name={text.title || website.venueName}
          category={`${businessType}. ${description}. Editorial food illustration, never a real venue photograph.`}
          locale={locale}
          apiUrl={api}
          upload={upload}
          onSaved={attach}
          onClose={() => setPhoto(false)}
        />
      )}
    </main>
  );
}

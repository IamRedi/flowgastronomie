"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  hasStaffPermission,
  creativeMaterialNames,
  type CreativeBrief,
  type DesignDocument,
} from "@flowgastronomie/domain";
import { usePilotStaff } from "../../app/pilot-app-shell";
import { studioRequest, creativeApi } from "./api";
import type { StudioProject } from "./studio";
import { workspaceCopy } from "./workspace-copy";
import { WorkspacePreview } from "./workspace-preview";
import { WorkspaceArchive } from "./workspace-archive";
import {
  WorkspaceAssets,
  type WorkspaceAsset,
  type WorkspaceCatalog,
} from "./workspace-assets";
import { WorkspaceDownload } from "./workspace-download";
import "./studio.css";
import "./workspace.css";

const AdvancedEditor = dynamic(
  () => import("./studio").then((m) => m.StudioEditor),
  { ssr: false },
);
const post = (body: unknown = {}) => ({
  method: "POST",
  body: JSON.stringify(body),
});
type Proposal = {
  id: string;
  summary: string;
  proposal: { document: DesignDocument; baseVersion: number };
};
export function CreativeWorkspace({
  locale,
}: {
  locale: DesignDocument["locale"];
}) {
  const t = workspaceCopy(locale),
    staff = usePilotStaff();
  const allowed = !!staff && hasStaffPermission(staff.role, "CREATIVE_EDIT");
  const [view, setView] = useState<"create" | "archive" | "photos">("create");
  const [step, setStep] = useState(1);
  const [material, setMaterial] =
    useState<CreativeBrief["material"]>("STICKER");
  const [instruction, setInstruction] = useState("");
  const [campaignText, setCampaignText] = useState("");
  const [productIds, setProductIds] = useState<string[]>([]),
    [assetIds, setAssetIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<WorkspaceCatalog | null>(null),
    [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [project, setProject] = useState<StudioProject | null>(null);
  const [advanced, setAdvanced] = useState(false),
    [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [edit, setEdit] = useState("");
  const pending = useRef(false);
  async function task(run: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    void Promise.all([
      studioRequest<WorkspaceCatalog>(`/sources?locale=${locale}`),
      studioRequest<{ planner: boolean }>("/capabilities"),
    ])
      .then(async ([sources, capabilities]) => {
        if (!active) return;
        setCatalog(sources);
        setAi(capabilities.planner);
        await studioRequest("/sources/canonical-assets", post());
        await Promise.all(
          sources.websiteAssets.map((a) =>
            studioRequest(`/sources/brand-assets/${a.id}`, post()),
          ),
        );
        const library = await studioRequest<WorkspaceAsset[]>("/assets");
        if (active) setAssets(library);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [allowed, locale]);
  // No reconciliation while an unsaved advanced edit or AI proposal is on screen.
  useEffect(() => {
    if (!project || advanced || busy || proposal || view !== "create") return;
    const id = project.id;
    let active = true;
    const sync = async () => {
      if (document.visibilityState !== "visible" || pending.current) return;
      try {
        const result = await studioRequest<{
          project: StudioProject;
          updated: boolean;
          needsReview: boolean;
        }>(`/projects/${id}/sync`, post());
        if (!active) return;
        if (result.updated) {
          setProject(result.project);
          setNotice(t("updated"));
        }
        if (result.needsReview) setError(t("needsReview"));
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    const timer = setInterval(() => void sync(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [project?.id, advanced, busy, proposal, view, locale]);
  async function open(id: string) {
    await task(async () => {
      const result = await studioRequest<{
        project: StudioProject;
        needsReview: boolean;
      }>(`/projects/${id}/sync`, post());
      const pendingProposal = await studioRequest<Proposal | null>(
        `/projects/${id}/proposal`,
      );
      setProject(result.project);
      setProposal(pendingProposal);
      setEdit("");
      setView("create");
      setStep(3);
      if (result.needsReview) setError(t("needsReview"));
    });
  }
  async function ask(current: StudioProject, request: string) {
    return studioRequest<Proposal>(
      `/projects/${current.id}/ai`,
      post({
        instruction: request,
        mode: "PATCH",
        expectedVersion: current.version,
        productIds: productIds.slice(0, 12),
        selectedLayerIds: [],
        requestKey: crypto.randomUUID(),
        quality: false,
      }),
    );
  }
  async function generate() {
    await task(async () => {
      const created = await studioRequest<StudioProject>(
        "/compose",
        post({
          material,
          locale,
          instruction,
          campaignText,
          productIds,
          assetIds,
        }),
      );
      setProject(created);
      setStep(3);
      setProposal(null);
      if (ai && instruction.trim()) {
        try {
          setProposal(await ask(created, instruction));
        } catch (e) {
          setNotice(t("aiFallback"));
          setError((e as Error).message);
        }
      }
    });
  }
  if (!staff) return <p>{t("loading")}</p>;
  if (!allowed)
    return (
      <main className="cs-root">
        <h1>Creative Studio</h1>
        <p>Available to venue Owners and Managers.</p>
      </main>
    );
  if (advanced && project)
    return (
      <AdvancedEditor
        key={project.id}
        initial={project}
        onClose={() => {
          setAdvanced(false);
          void open(project.id);
        }}
      />
    );
  const selected = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
  return (
    <main className="cs-root cw-root">
      <header className="cw-top">
        <a href={`/app/${locale}/marketing`}>Marketing</a>
        <span>Creative Studio</span>
        <nav aria-label="Creative Studio">
          {(["create", "archive", "photos"] as const).map((tab) => (
            <button
              key={tab}
              aria-pressed={view === tab}
              disabled={busy}
              onClick={() => {
                setView(tab);
                setError("");
              }}
            >
              {t(tab)}
            </button>
          ))}
        </nav>
      </header>
      {error && (
        <p role="alert" className="cs-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="cw-notice">
          {notice}
        </p>
      )}
      {view === "archive" ? (
        <WorkspaceArchive t={t} locale={locale} open={(id) => void open(id)} />
      ) : view === "photos" ? (
        <WorkspaceAssets
          t={t}
          catalog={catalog}
          assets={assets}
          onChange={setAssets}
        />
      ) : (
        <>
          <ol className="cw-steps" aria-label="Creative workflow">
            {(["material", "brief", "review", "download"] as const).map(
              (label, i) => (
                <li
                  key={label}
                  aria-current={step === i + 1 ? "step" : undefined}
                >
                  <button
                    disabled={
                      busy || (i >= 2 && !project) || (i === 3 && !!proposal)
                    }
                    onClick={() => setStep(i + 1)}
                  >
                    <b>{i + 1}</b>
                    <span>{t(label)}</span>
                  </button>
                </li>
              ),
            )}
          </ol>
          {step === 1 && (
            <section className="cw-start">
              <p className="cs-eyebrow">CREATIVE STUDIO</p>
              <h1>{t("title")}</h1>
              <p className="cw-subtitle">{t("subtitle")}</p>
              <div className="cw-materials">
                {(["STICKER", "MENU", "BROCHURE"] as const).map((kind, i) => (
                  <button
                    key={kind}
                    className="cw-material"
                    aria-pressed={material === kind}
                    onClick={() => setMaterial(kind)}
                  >
                    <div
                      className={`cw-sample cw-sample-${kind.toLowerCase()}`}
                      aria-hidden="true"
                    >
                      <div>
                        <small>{catalog?.venue.name ?? staff.venueName}</small>
                        <strong>
                          {kind === "STICKER"
                            ? "10%"
                            : kind === "MENU"
                              ? "Menu"
                              : "Benvenuti"}
                        </strong>
                        {kind === "MENU" ? (
                          <>
                            <i />
                            <i />
                            <i />
                            <i />
                          </>
                        ) : (
                          <span>—</span>
                        )}
                      </div>
                    </div>
                    <div className="cw-material-copy">
                      <strong>
                        {t((["sticker", "menu", "brochure"] as const)[i]!)}
                      </strong>
                      <span>
                        {t(
                          (
                            [
                              "stickerDetail",
                              "menuDetail",
                              "brochureDetail",
                            ] as const
                          )[i]!,
                        )}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="cw-actions">
                <button className="cs-primary" onClick={() => setStep(2)}>
                  {t("next")} →
                </button>
                <button
                  className="cw-text-button"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      const fresh = await studioRequest<StudioProject>(
                        "/projects",
                        post({
                          title: "Untitled design",
                          format: "SOCIAL",
                          locale,
                        }),
                      );
                      setProject(fresh);
                      setAdvanced(true);
                    })
                  }
                >
                  {t("advanced")}
                </button>
              </div>
            </section>
          )}
          {step === 2 && (
            <section className="cw-brief">
              <div>
                <p className="cs-eyebrow">
                  02 / {creativeMaterialNames[locale][material]}
                </p>
                <h1>{t("brief")}</h1>
                <label>
                  {t("prompt")}
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder={t("placeholder")}
                  />
                </label>
                <label>
                  {t("campaign")}
                  <input
                    maxLength={180}
                    value={campaignText}
                    onChange={(e) => setCampaignText(e.target.value)}
                  />
                </label>
                <details>
                  <summary>{t("details")}</summary>
                  <p>{t("allProducts")}</p>
                  <div className="cw-product-picker">
                    {catalog?.products.map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          checked={productIds.includes(p.id)}
                          onChange={() =>
                            setProductIds(selected(productIds, p.id))
                          }
                        />
                        <span>
                          {p.name}
                          <small>{p.price}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="cw-photo-picker">
                    {assets
                      .filter(
                        (a) =>
                          a.approvedForPublicUse ||
                          a.provenance?.internalReview,
                      )
                      .map((a) => (
                        <button
                          key={a.id}
                          aria-pressed={assetIds.includes(a.id)}
                          onClick={() => setAssetIds(selected(assetIds, a.id))}
                        >
                          <img
                            src={`${creativeApi}/assets/${a.id}/content`}
                            alt={a.name}
                          />
                          <span>{a.name}</span>
                        </button>
                      ))}
                  </div>
                </details>
                <div className="cw-actions">
                  <button
                    disabled={busy || !catalog}
                    className="cs-primary"
                    onClick={() => void generate()}
                  >
                    {busy ? t("creating") : t("generate")} ✦
                  </button>
                  <button disabled={busy} onClick={() => setStep(1)}>
                    {t("back")}
                  </button>
                </div>
              </div>
              <aside className="cw-context">
                <span className="cw-spark">✦</span>
                <h2>{catalog?.venue.name ?? staff.venueName}</h2>
                <p>{t("sourceNote")}</p>
                <dl>
                  <div>
                    <dt>{t("products")}</dt>
                    <dd>{catalog?.products.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>{t("photos")}</dt>
                    <dd>
                      {
                        assets.filter(
                          (a) =>
                            a.approvedForPublicUse ||
                            a.provenance?.internalReview,
                        ).length
                      }
                    </dd>
                  </div>
                </dl>
              </aside>
            </section>
          )}
          {step === 3 && project && (
            <section className="cw-review">
              <div className="cw-review-header">
                <div>
                  <p className="cs-eyebrow">03 / {t("review")}</p>
                  <h1>{project.title}</h1>
                  <span className="cw-save">
                    ✓ {t("saved")} · v{project.version}
                  </span>
                </div>
                <button
                  disabled={busy || !!proposal || project.status === "ARCHIVED"}
                  className="cs-primary"
                  onClick={() => setStep(4)}
                >
                  {t("ready")} →
                </button>
              </div>
              <div className="cw-review-grid">
                <WorkspacePreview
                  projectId={project.id}
                  version={project.version}
                  alt={project.title}
                />
                <aside className="cw-assistant">
                  <span className="cw-spark">✦</span>
                  <h2>{t("request")}</h2>
                  <textarea
                    aria-label={t("request")}
                    rows={4}
                    value={edit}
                    maxLength={2000}
                    onChange={(e) => setEdit(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    className="cs-primary"
                    disabled={
                      busy ||
                      !ai ||
                      !edit.trim() ||
                      !!proposal ||
                      project.status === "ARCHIVED"
                    }
                    onClick={() =>
                      void task(async () =>
                        setProposal(await ask(project, edit)),
                      )
                    }
                  >
                    {busy ? t("creating") : t("change")}
                  </button>
                  {proposal && (
                    <div className="cw-proposal">
                      <strong>{t("suggested")}</strong>
                      <p>{proposal.summary}</p>
                      <ProposalPreview document={proposal.proposal.document} />
                      <div className="cw-actions">
                        <button
                          disabled={busy}
                          className="cs-primary"
                          onClick={() =>
                            void task(async () => {
                              setProject(
                                await studioRequest(
                                  `/projects/${project.id}/ai/accept`,
                                  post({
                                    conversationId: proposal.id,
                                    expectedVersion: project.version,
                                  }),
                                ),
                              );
                              setProposal(null);
                              setEdit("");
                            })
                          }
                        >
                          {t("apply")}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void task(async () => {
                              await studioRequest(
                                `/projects/${project.id}/ai/dismiss`,
                                post({ conversationId: proposal.id }),
                              );
                              setProposal(null);
                            })
                          }
                        >
                          {t("discard")}
                        </button>
                      </div>
                    </div>
                  )}
                  <p className="cw-muted">{t("sourceNote")}</p>
                  <button
                    disabled={
                      busy || !!proposal || project.status === "ARCHIVED"
                    }
                    onClick={() => setAdvanced(true)}
                  >
                    {t("advanced")}
                  </button>
                  <button disabled={busy} onClick={() => setView("archive")}>
                    {t("history")}
                  </button>
                </aside>
              </div>
            </section>
          )}
          {step === 4 && project && (
            <WorkspaceDownload
              key={project.id}
              project={project}
              t={t}
              onProject={setProject}
              back={() => setStep(3)}
            />
          )}
        </>
      )}
    </main>
  );
}
const ReadOnlyCanvas = dynamic(
  () => import("./design-canvas").then((m) => m.DesignCanvas),
  { ssr: false },
);
function ProposalPreview({ document }: { document: DesignDocument }) {
  return (
    <div className="cw-proposal-preview" inert>
      <ReadOnlyCanvas
        document={document}
        selected={[]}
        zoom={0.4}
        onSelect={() => {}}
        onChange={() => {}}
      />
    </div>
  );
}

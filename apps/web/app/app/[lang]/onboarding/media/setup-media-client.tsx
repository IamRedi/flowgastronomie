"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  compactMediaAssignments,
  placeSetupPhoto,
  type SetupMediaAssignment,
} from "@flowgastronomie/domain";
import { usePilotStaff } from "../../../../pilot-app-shell";
import type { Locale } from "../../../../../lib/i18n";
import { setupApi, setupRequest } from "../setup-api";
import { mediaCopy } from "./media-copy";
import type { MediaPhoto, MediaWorkspace } from "./media-types";
import { PhotoTarget } from "./photo-target";
import "../smart-setup.css";
import "./setup-media.css";

export function SetupMediaClient({ locale }: { locale: Locale }) {
  const staff = usePilotStaff(),
    words = mediaCopy(locale);
  const [data, setData] = useState<MediaWorkspace | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [search, setSearch] = useState("");
  const working = useRef(false);
  const allowed = staff?.role === "OWNER" || staff?.role === "MANAGER";
  const load = useCallback(async () => {
    setData(await setupRequest<MediaWorkspace>("setup-media"));
    setConfirmed(false);
  }, []);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setupRequest<MediaWorkspace>("setup-media")
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [allowed, staff?.tenantId, staff?.venueId]);
  const act = async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const update = async (
    rows: SetupMediaAssignment[],
    step = data?.progress.step ?? 1,
  ) => {
    if (!data) return;
    const saved = await setupRequest<MediaWorkspace>("setup-media", {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: data.progress.version,
        step,
        assignments: compactMediaAssignments(rows),
      }),
    });
    setData(saved);
    setConfirmed(false);
  };
  const finish = (action: "save" | "skip" | "reset") =>
    act(async () => {
      if (!data) return;
      setData(
        await setupRequest<MediaWorkspace>(`setup-media/${action}`, {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: data.progress.version,
            confirm: true,
          }),
        }),
      );
      setConfirmed(false);
    });
  const assign = async (
    assetId: string,
    productId: string | null,
    role: SetupMediaAssignment["role"],
    replace?: SetupMediaAssignment,
  ) => {
    if (!data) return;
    const chosen = data.assets.find((a) => a.id === assetId);
    if (!chosen) return;
    await update(
      placeSetupPhoto(data.assignments, {
        assetId,
        productId,
        role,
        source: chosen.source,
        replace,
      }),
    );
  };
  const upload =
    (productId: string | null, role: SetupMediaAssignment["role"]) =>
    (
      file: File,
      source: "UPLOAD" | "DEMO",
      publicUse: boolean,
      replace?: SetupMediaAssignment,
    ) =>
      void act(async () => {
        if (!data) return;
        const asset = await setupRequest<MediaPhoto>(
          `setup-media/uploads?source=${source}&publicUse=${publicUse}&confirmed=true`,
          {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          },
        );
        await update(
          placeSetupPhoto(data.assignments, {
            assetId: asset.id,
            productId,
            role,
            source: asset.source,
            replace,
          }),
        );
      });
  const target = (
    title: string,
    productId: string | null,
    role: SetupMediaAssignment["role"],
  ) => (
    <PhotoTarget
      key={`${productId ?? "venue"}:${role}`}
      title={title}
      productId={productId}
      role={role}
      rows={data!.assignments}
      assets={data!.assets}
      busy={busy}
      demoTenant={data!.venue.tenant.kind === "DEMO"}
      words={words}
      onUpload={upload(productId, role)}
      onChoose={(id) => void act(() => assign(id, productId, role))}
      onRemove={(row) =>
        void act(() => update(data!.assignments.filter((r) => r !== row)))
      }
      onPrimary={(row) =>
        void act(() =>
          update(
            data!.assignments.map((r) =>
              r === row
                ? {
                    ...r,
                    role: r.role === "PRIMARY" ? "GALLERY" : "PRIMARY",
                    sortOrder: 0,
                  }
                : r.productId === productId && r.role === "PRIMARY"
                  ? { ...r, role: "GALLERY" }
                  : r,
            ),
          ),
        )
      }
      onMove={(row, delta) =>
        void act(async () => {
          const rows = [...data!.assignments];
          const from = rows.indexOf(row),
            to = rows.findIndex(
              (r) =>
                r.productId === row.productId &&
                r.role === "GALLERY" &&
                r.sortOrder === row.sortOrder + delta,
            );
          if (to >= 0) {
            [rows[from], rows[to]] = [rows[to]!, rows[from]!];
            await update(rows);
          }
        })
      }
    />
  );
  if (!staff) return null;
  if (!allowed)
    return (
      <section className="smart-setup">
        <p>Owner / Manager only</p>
      </section>
    );
  const step = data?.progress.step ?? 1;
  const done =
    data?.progress.status === "COMPLETE" || data?.progress.status === "SKIPPED";
  const name = (p: MediaWorkspace["products"][number]) =>
    p.translations.find((t) => t.locale.toLowerCase() === locale)?.name ??
    p.translations.find((t) => t.locale === data?.venue.defaultLocale)?.name ??
    p.translations[0]?.name ??
    p.id;
  const products =
    data?.products.filter((p) =>
      name(p)
        .toLocaleLowerCase(locale)
        .includes(search.toLocaleLowerCase(locale)),
    ) ?? [];
  return (
    <section className="smart-setup setup-media" aria-busy={busy}>
      <header className="setup-heading">
        <p className="setup-eyebrow">{data?.venue.name}</p>
        <h1>{words.title}</h1>
        <p>{words.intro}</p>
        <Link href={`/app/${locale}/onboarding`}>{words.menu}</Link>
      </header>
      <ol className="setup-steps" aria-label={words.title}>
        {words.steps.map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? "step" : undefined}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <div className="setup-warning" role="alert">
          <p>{error}</p>
          <button disabled={busy} onClick={() => void act(load)}>
            {words.reload}
          </button>
          <button disabled={busy} onClick={() => void finish("reset")}>
            {words.reset}
          </button>
        </div>
      )}
      {!data ? (
        <p role="status">{words.busy}</p>
      ) : done ? (
        <div className="setup-panel">
          <div className="setup-success" aria-hidden="true">
            ✓
          </div>
          <h2>
            {data.progress.status === "COMPLETE" ? words.done : words.skipped}
          </h2>
          <p>{words.doneHelp}</p>
          <div className="setup-actions">
            <button
              className="setup-primary"
              disabled={busy}
              onClick={() => void act(() => update(data.assignments, 1))}
            >
              {words.edit}
            </button>
            <Link href={`/${locale}/staff/pos`}>{words.pos}</Link>
            <Link href={`/app/${locale}/website/preview`}>{words.website}</Link>
            <Link href={`/app/${locale}/marketing/creative`}>
              {words.creative}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {step === 1 && (
            <>
              <div className="media-targets">
                {target(words.logo, null, "LOGO")}
                {target(words.hero, null, "HERO")}
              </div>
              <details className="media-more">
                <summary>{words.optional}</summary>
                <div className="media-targets">
                  {target(words.profile, null, "PROFILE")}
                  {target(words.gallery, null, "GALLERY")}
                </div>
              </details>
            </>
          )}
          {step === 2 && (
            <>
              <h2>{words.productTitle}</h2>
              {!data.products.length ? (
                <p className="setup-panel">{words.empty}</p>
              ) : (
                <>
                  <label className="media-search">
                    {words.search}
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <div className="media-targets">
                    {products.map((p) => target(name(p), p.id, "GALLERY"))}
                  </div>
                  {!products.length && <p>{words.noMatches}</p>}
                </>
              )}
            </>
          )}
          {step >= 3 && (
            <div className="setup-panel">
              <h2>{words.review}</h2>
              <p>{words.reviewHelp}</p>
              <div className="media-review-grid">
                {data.assignments.map((row) => {
                  const photo = data.assets.find((a) => a.id === row.assetId);
                  const product = data.products.find(
                    (p) => p.id === row.productId,
                  );
                  const title = product
                    ? name(product)
                    : row.role === "LOGO"
                      ? words.logo
                      : row.role === "HERO"
                        ? words.hero
                        : row.role === "PROFILE"
                          ? words.profile
                          : words.gallery;
                  return (
                    photo && (
                      <figure
                        key={`${row.productId}:${row.role}:${row.sortOrder}`}
                      >
                        <img src={`${setupApi}${photo.url}`} alt={title} />
                        <figcaption>
                          <strong>{title}</strong>
                          <span>
                            {row.role === "PRIMARY"
                              ? words.primary
                              : row.role === "GALLERY"
                                ? words.gallery
                                : ""}
                          </span>
                          {photo.label && (
                            <span className="media-disclosure">
                              {photo.label}
                            </span>
                          )}
                          <span className="setup-secondary">
                            {photo.approvedForPublicUse
                              ? words.approved
                              : words.private}
                          </span>
                        </figcaption>
                      </figure>
                    )
                  );
                })}
              </div>
              <p>
                {data.assignments.length} {words.count}
              </p>
              {step === 4 && (
                <label className="setup-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  {words.confirm}
                </label>
              )}
            </div>
          )}
          <div className="setup-actions">
            {step > 1 && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(() => update(data.assignments, step - 1))
                }
              >
                {words.back}
              </button>
            )}
            {step < 4 ? (
              <button
                className="setup-primary"
                disabled={busy}
                onClick={() =>
                  void act(() => update(data.assignments, step + 1))
                }
              >
                {words.next}
              </button>
            ) : (
              <button
                className="setup-primary"
                disabled={busy || !confirmed}
                onClick={() => void finish("save")}
              >
                {words.save}
              </button>
            )}
          </div>
          <button
            className="setup-link"
            disabled={busy}
            onClick={() => void finish("skip")}
          >
            {words.skip}
          </button>
        </>
      )}
      {data && (
        <p className="setup-progress" role="status">
          {busy ? words.busy : words.saved}
        </p>
      )}
    </section>
  );
}

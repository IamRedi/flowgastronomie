"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  BusinessProfileId,
  ReviewedMenuItem,
} from "@flowgastronomie/domain";
import { usePilotStaff } from "../../../pilot-app-shell";
import type { Locale } from "../../../../lib/i18n";
import {
  setupRequest,
  type SetupData,
  type ImportData,
  type ImportRow,
} from "./setup-api";
import { setupCopy } from "./setup-copy";
import { ImportReviewRow, ImportSource } from "./import-review";
import "./smart-setup.css";
import { premiumCopy } from "../../../../components/premium-copy";

export function SmartSetupClient({ locale }: { locale: Locale }) {
  const router = useRouter();
  const staff = usePilotStaff();
  const words = setupCopy(locale);
  const premium = premiumCopy(locale);
  const [data, setData] = useState<SetupData | null>(null);
  const [session, setSession] = useState<ImportData | null>(null);
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState<BusinessProfileId>("PIZZERIA");
  const [categories, setCategories] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const requestKey = useRef<string | null>(null);
  const importId = useRef<string | null>(null);
  const allowed = staff?.role === "OWNER" || staff?.role === "MANAGER";
  const refresh = useCallback(async () => {
    const setup = await setupRequest<SetupData>("smart-setup");
    setData(setup);
    setProfile(setup.progress.profileId);
    setStep(setup.progress.step);
    if (setup.progress.activeImportSessionId) {
      const saved = await setupRequest<ImportData>(
        `menu-imports/${setup.progress.activeImportSessionId}`,
      );
      setSession(saved);
      importId.current = saved.id;
    } else {
      setSession(null);
      importId.current = null;
    }
    setDirty({});
  }, []);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    Promise.all([
      setupRequest<SetupData>("smart-setup"),
      setupRequest<{ extraction: boolean }>("menu-imports/capabilities"),
    ])
      .then(async ([setup, caps]) => {
        const saved = setup.progress.activeImportSessionId
          ? await setupRequest<ImportData>(
              `menu-imports/${setup.progress.activeImportSessionId}`,
            )
          : null;
        if (!active) return;
        setData(setup);
        setProfile(setup.progress.profileId);
        setStep(setup.progress.step);
        setEnabled(caps.extraction);
        setSession(saved);
        importId.current = saved?.id ?? null;
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [allowed, staff?.tenantId, staff?.venueId]);
  useEffect(() => {
    if (session?.businessData?.schemaVersion === 2) {
      router.replace(
        `/app/${locale}/onboarding/business-import?import=${session.id}`,
      );
      return;
    }
    if (session?.extractionState !== "RUNNING") return;
    const timer = setInterval(
      () =>
        void setupRequest<ImportData>(`menu-imports/${session.id}`)
          .then((saved) => {
            setSession(saved);
            if (saved.extractionState === "SUCCEEDED") setStep(3);
          })
          .catch((e) => setError(e.message)),
      3000,
    );
    return () => clearInterval(timer);
  }, [
    session?.id,
    session?.extractionState,
    session?.businessData?.schemaVersion,
    locale,
    router,
  ]);
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  const navigate = async (
    target: number,
    options: { skip?: boolean; complete?: boolean; apply?: boolean } = {},
  ) => {
    const saved = await setupRequest<SetupData>("smart-setup");
    await setupRequest("smart-setup", {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: saved.progress.version,
        profileId: profile,
        applyCategories: options.apply ?? false,
        step: target,
        skipped: options.skip
          ? [...new Set([...saved.progress.skipped, "MENU"])]
          : saved.progress.skipped,
        complete: options.complete ?? false,
      }),
    });
    await refresh();
  };
  const upload = async (files: File[]) =>
    act(async () => {
      if (!files.length) return;
      if (!importId.current || session?.extractionState !== "PENDING") {
        requestKey.current ??= crypto.randomUUID();
        const created = await setupRequest<{ id: string }>("menu-imports", {
          method: "POST",
          body: JSON.stringify({ requestKey: requestKey.current, locale }),
        });
        importId.current = created.id;
      }
      let saved = await setupRequest<ImportData>(
        `menu-imports/${importId.current}`,
      );
      setSession(saved);
      for (const file of files) {
        saved = await setupRequest<ImportData>(
          `menu-imports/${saved.id}/sources?expectedVersion=${saved.version}`,
          {
            method: "POST",
            headers: {
              "Content-Type": file.type,
              "X-File-Name": encodeURIComponent(file.name),
            },
            body: file,
          },
        );
        setSession(saved);
      }
      await refresh();
    });
  const extract = () =>
    act(async () => {
      if (!session) return;
      try {
        const saved = await setupRequest<ImportData>(
          `menu-imports/${session.id}/extract`,
          {
            method: "POST",
            body: JSON.stringify({
              expectedVersion: session.version,
              requestKey: crypto.randomUUID(),
            }),
          },
        );
        setSession(saved);
        if (saved.extractionState === "SUCCEEDED") setStep(3);
      } finally {
        await refresh();
      }
    });
  const review = (
    row: ImportRow,
    item: ReviewedMenuItem,
    action: "SAVE" | "APPROVE" | "REJECT",
  ) =>
    act(async () => {
      if (!session) return;
      const saved = await setupRequest<ImportData>(
        `menu-imports/${session.id}/items/${row.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            expectedVersion: session.version,
            item,
            action,
            confirm: action !== "SAVE",
          }),
        },
      );
      setSession(saved);
      setDirty((old) => ({ ...old, [row.id]: false }));
      setConfirmed(false);
    });
  const onDirty = useCallback(
    (id: string, value: boolean) =>
      setDirty((old) => (old[id] === value ? old : { ...old, [id]: value })),
    [],
  );
  const newImport = () => {
    requestKey.current = null;
    importId.current = null;
    setSession(null);
    setConfirmed(false);
    setStep(2);
  };
  if (!staff) return null;
  if (session?.businessData?.schemaVersion === 2)
    return <p role="status">{words.busy}</p>;
  if (!allowed)
    return (
      <section className="smart-setup">
        <p>{words.role}</p>
      </section>
    );
  return (
    <section className="smart-setup" aria-busy={busy}>
      <header className="setup-heading">
        <p className="setup-eyebrow">{data?.venue.name ?? "Smart Setup"}</p>
        <h1>{words.title}</h1>
        <p>{words.intro}</p>
      </header>
      <nav className="premium-workspace-nav" aria-label={premium.businessTab}>
        <Link href={`/app/${locale}/onboarding`}>{premium.businessTab}</Link>
        <Link href={`/${locale}/staff/menu`}>{premium.menu}</Link>
        <Link href={`/app/${locale}/onboarding/media`}>{premium.photos}</Link>
        <Link href={`/app/${locale}/website`}>{premium.website}</Link>
        <Link href={`/${locale}/staff/setup`}>{premium.operations}</Link>
        <Link href={`/app/${locale}/website/preview`}>{premium.readonly}</Link>
      </nav>
      <ol className="setup-steps" aria-label="Smart Setup">
        {words.steps.map((label, index) => (
          <li
            key={label}
            aria-current={step === index + 1 ? "step" : undefined}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <div className="setup-warning" role="alert">
          <p>{error}</p>
          <button onClick={() => void act(refresh)}>{words.reload}</button>
        </div>
      )}
      {!data ? (
        <p role="status">{words.busy}</p>
      ) : (
        <>
          {step === 1 && (
            <div className="setup-panel">
              <h2>{words.business}</h2>
              <div className="setup-profiles">
                {data.profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={profile === p.id}
                    disabled={busy}
                    onClick={() => setProfile(p.id)}
                  >
                    <strong>{p.name}</strong>
                    <span>
                      {p.categories
                        .slice(0, 3)
                        .map((c) => c.translations[locale])
                        .join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
              <label className="setup-check">
                <input
                  type="checkbox"
                  checked={categories}
                  onChange={(e) => setCategories(e.target.checked)}
                />
                {words.categories}
              </label>
              <div className="setup-actions">
                <button
                  className="setup-primary"
                  disabled={busy}
                  onClick={() =>
                    void act(() => navigate(2, { apply: categories }))
                  }
                >
                  {words.next}
                </button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="setup-panel">
              <h2>{words.upload}</h2>
              <p>{words.uploadHelp}</p>
              {!enabled && <p className="setup-warning">{words.disabled}</p>}
              {(!session || session.extractionState === "PENDING") && (
                <label className="setup-upload">
                  {words.upload}
                  <input
                    aria-label={words.upload}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    multiple
                    disabled={busy}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      void upload(files);
                    }}
                  />
                </label>
              )}
              {session?.sources.map((source) => (
                <div className="setup-file" key={source.id}>
                  {source.filename} <span>{source.pageCount} p.</span>
                </div>
              ))}
              {session?.extractionState === "RUNNING" && (
                <p role="status">{words.extracting}</p>
              )}
              {session?.extractionState === "FAILED" && (
                <p className="setup-warning">{words.failed}</p>
              )}
              <div className="setup-actions">
                <button
                  disabled={busy}
                  onClick={() => void act(() => navigate(1))}
                >
                  {words.back}
                </button>
                {session?.extractionState === "SUCCEEDED" ? (
                  <button
                    className="setup-primary"
                    onClick={() => void act(() => navigate(3))}
                  >
                    {words.next}
                  </button>
                ) : (
                  <button
                    className="setup-primary"
                    disabled={
                      busy ||
                      !enabled ||
                      !session?.sources.length ||
                      session.extractionState === "RUNNING"
                    }
                    onClick={() => void extract()}
                  >
                    {busy
                      ? words.busy
                      : session?.extractionState === "FAILED"
                        ? words.retry
                        : words.extract}
                  </button>
                )}
              </div>
              <button
                className="setup-link"
                disabled={busy}
                onClick={() =>
                  void act(() => navigate(4, { skip: true, complete: true }))
                }
              >
                {words.skip}
              </button>
            </div>
          )}
          {step === 3 && session && (
            <>
              <div className="setup-section-heading">
                <h2>{words.review}</h2>
                <p>{words.reviewHelp}</p>
              </div>
              <div className="setup-review-layout">
                <aside>
                  <h3>{words.source}</h3>
                  {session.sources.map((source) => (
                    <ImportSource
                      key={source.id}
                      source={source}
                      words={words}
                    />
                  ))}
                </aside>
                <div className="setup-review-items">
                  {session.items.map((row) => (
                    <ImportReviewRow
                      key={`${row.id}:${JSON.stringify(row.reviewed)}:${row.status}`}
                      row={row}
                      session={session}
                      locale={locale}
                      words={words}
                      currency={data.venue.currency}
                      busy={busy}
                      onReview={review}
                      onDirty={onDirty}
                    />
                  ))}
                  {!session.items.length && (
                    <p className="setup-warning">{words.empty}</p>
                  )}
                </div>
              </div>
              <div className="setup-actions">
                <button
                  disabled={busy}
                  onClick={() => void act(() => navigate(2))}
                >
                  {words.back}
                </button>
                <button
                  className="setup-primary"
                  disabled={
                    busy ||
                    session.status !== "APPROVED" ||
                    Object.values(dirty).some(Boolean)
                  }
                  onClick={() => void act(() => navigate(4))}
                >
                  {words.next}
                </button>
              </div>
              <button className="setup-link" onClick={newImport}>
                {words.newImport}
              </button>
            </>
          )}
          {step === 4 && (
            <div className="setup-panel">
              {session?.status === "IMPORTED" ||
              data.progress.status === "READY" ? (
                <>
                  <div className="setup-success" aria-hidden="true">
                    ✓
                  </div>
                  <h2>{words.ready}</h2>
                  <p>{words.readyHelp}</p>
                  <div className="setup-actions">
                    <Link
                      className="setup-primary"
                      href={`/app/${locale}/onboarding/media`}
                    >
                      {locale === "sq"
                        ? "Shto logon dhe fotot"
                        : locale === "de"
                          ? "Logo und Fotos hinzufügen"
                          : locale === "it"
                            ? "Aggiungi logo e foto"
                            : "Add logo & photos"}
                    </Link>
                    <Link
                      className="setup-primary"
                      href={`/${locale}/staff/menu`}
                    >
                      {words.menu}
                    </Link>
                    <Link href={`/app/${locale}/launch`}>{words.launch}</Link>
                  </div>
                  {data.progress.status !== "READY" && (
                    <button
                      onClick={() =>
                        void act(() => navigate(4, { complete: true }))
                      }
                      disabled={busy}
                    >
                      {words.finish}
                    </button>
                  )}
                  <button className="setup-link" onClick={newImport}>
                    {words.newImport}
                  </button>
                </>
              ) : (
                <>
                  <h2>{words.importTitle}</h2>
                  <p>{words.importHelp}</p>
                  <ul className="setup-import-summary">
                    {session?.items
                      .filter((i) => i.status === "APPROVED")
                      .map((row) => (
                        <li key={row.id}>
                          {row.reviewed.name}
                          <strong>
                            {new Intl.NumberFormat(locale, {
                              style: "currency",
                              currency: data.venue.currency,
                            }).format((row.reviewed.priceMinor ?? 0) / 100)}
                          </strong>
                        </li>
                      ))}
                  </ul>
                  <p className="setup-secondary">{words.translation}</p>
                  <label className="setup-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    {words.confirm}
                  </label>
                  <div className="setup-actions">
                    <button
                      disabled={busy}
                      onClick={() => void act(() => navigate(3))}
                    >
                      {words.back}
                    </button>
                    <button
                      className="setup-primary"
                      disabled={
                        busy || !confirmed || session?.status !== "APPROVED"
                      }
                      onClick={() =>
                        void act(async () => {
                          if (!session) return;
                          await setupRequest(
                            `menu-imports/${session.id}/import`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                expectedVersion: session.version,
                                confirm: true,
                              }),
                            },
                          );
                          await refresh();
                        })
                      }
                    >
                      {words.import}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <p className="setup-progress" role="status">
            {busy ? words.busy : words.saved}
          </p>
        </>
      )}
    </section>
  );
}

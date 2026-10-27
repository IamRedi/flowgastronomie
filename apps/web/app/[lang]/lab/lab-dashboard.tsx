"use client";
import { useEffect, useState } from "react";
import type {
  LabDashboardSnapshot,
  LabVenueDashboard,
  LabControlMode,
  LabJournalRow,
  LabContinuityHealth,
} from "@flowgastronomie/domain";
type Lang = "sq" | "de" | "en" | "it";
const copy = {
  en: {
    title: "Operations Lab",
    intro: "Two synthetic businesses. Live application records.",
    local: "LOCAL · TEST ONLY · NON-FISCAL",
    login: "Local operator key",
    enter: "Open lab",
    logout: "Sign out",
    connected: "Last update",
    offline: "Connection interrupted. Last observed data remains visible.",
    failed: "Action failed. Refresh and inspect the journal.",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop after day",
    review: "Mark review resolved",
    today: "Venue today",
    run: "Current simulation",
    received: "Orders received",
    accepted: "Accepted",
    cancelled: "Cancelled",
    completed: "Completed",
    queue: "Kitchen / Bar queue",
    pending: "Pending website orders",
    cash: "Cash recorded",
    card: "Manual card recorded",
    crew: "Staff on duty",
    next: "Next scheduled action",
    checkpoint: "Last checkpoint",
    receipts: "Finalized receipts today / PDF archive",
    journal: "Activity journal",
    evidence: "Evidence, explanation and impact",
    older: "Older events",
    week: "Observed week",
    events: "events",
    closed: "closes",
    incidents: "incidents",
    awaiting: "Daily reconciliation awaits closing",
    clean: "No unexplained discrepancies",
    skipped: "Missed arrivals",
    planned: "planned",
    storage: "PDF storage",
    warning: "Capacity needs attention",
    pdf: "Download test PDF",
    printer: "Printer simulator",
    retry: "Confirm possible duplicate and retry",
    confirm:
      "Confirm the printer observation before retry. This can produce duplicate output.",
    volume: "Next run traffic",
    save: "Save configuration",
    details: "Open actual application",
    needs: "Needs review",
    running: "Running",
    paused: "Paused",
    stopped: "Stopped",
    stopping: "Stopping after day",
    functional: "Short functional window",
    clock: "Real wall clock",
    source:
      "Counts and money are read from actual persisted business records. QR session payments can be unallocated and have no P2 receipt.",
  },
  sq: {
    title: "Laboratori i Operacioneve",
    intro: "Dy biznese sintetike. Të dhëna reale të aplikacionit.",
    local: "LOKAL · VETËM TEST · JOFISKAL",
    login: "Çelësi lokal i operatorit",
    enter: "Hap laboratorin",
    logout: "Dil",
    connected: "Përditësimi i fundit",
    offline: "Lidhja u ndërpre. Shfaqen të dhënat e vëzhguara së fundmi.",
    failed: "Veprimi dështoi. Rifresko dhe kontrollo journal-in.",
    start: "Nis",
    pause: "Ndalo përkohësisht",
    resume: "Rifillo",
    stop: "Ndalo pas ditës",
    review: "Shqyrtimi u zgjidh",
    today: "Biznesi sot",
    run: "Simulimi aktual",
    received: "Porosi të marra",
    accepted: "Të pranuara",
    cancelled: "Të anuluara",
    completed: "Të përfunduara",
    queue: "Radha Kitchen / Bar",
    pending: "Porosi website në pritje",
    cash: "CASH i regjistruar",
    card: "Kartë manuale e regjistruar",
    crew: "Stafi në shërbim",
    next: "Veprimi i ardhshëm",
    checkpoint: "Checkpoint-i i fundit",
    receipts: "Kuponat e sotëm / arkivi PDF",
    journal: "Journal-i i aktivitetit",
    evidence: "Prova, shpjegimi dhe ndikimi",
    older: "Ngjarje më të vjetra",
    week: "Java e vëzhguar",
    events: "ngjarje",
    closed: "mbyllje",
    incidents: "incidente",
    awaiting: "Rakordimi ditor pret mbylljen",
    clean: "Pa mospërputhje të pashpjeguara",
    skipped: "Ardhje të humbura",
    planned: "të planifikuara",
    storage: "Ruajtja e PDF-ve",
    warning: "Kapaciteti kërkon vëmendje",
    pdf: "Shkarko PDF testues",
    printer: "Simulatori i printerit",
    retry: "Konfirmo mundësinë e dublikimit dhe riprovo",
    confirm:
      "Konfirmo vëzhgimin e printerit para riprovës. Mund të prodhohet dalje e dyfishuar.",
    volume: "Trafiku i ekzekutimit të ardhshëm",
    save: "Ruaj konfigurimin",
    details: "Hap aplikacionin real",
    needs: "Kërkon shqyrtim",
    running: "Në punë",
    paused: "I ndalur përkohësisht",
    stopped: "I ndalur",
    stopping: "Ndalon pas ditës",
    functional: "Dritare e shkurtër funksionale",
    clock: "Kohë reale",
    source:
      "Numrat dhe shumat lexohen nga regjistrimet reale të biznesit. Pagesat e sesioneve QR mund të mbeten pa alokim dhe pa receipt P2.",
  },
  de: {
    title: "Operationslabor",
    intro: "Zwei synthetische Betriebe. Live-Daten der Anwendung.",
    local: "LOKAL · NUR TEST · NICHT FISKAL",
    login: "Lokaler Bedienerschlüssel",
    enter: "Labor öffnen",
    logout: "Abmelden",
    connected: "Letzte Aktualisierung",
    offline:
      "Verbindung unterbrochen. Zuletzt beobachtete Daten bleiben sichtbar.",
    failed: "Aktion fehlgeschlagen. Aktualisieren und Journal prüfen.",
    start: "Starten",
    pause: "Pausieren",
    resume: "Fortsetzen",
    stop: "Nach Tagesende stoppen",
    review: "Prüfung geklärt",
    today: "Betrieb heute",
    run: "Aktuelle Simulation",
    received: "Bestellungen erhalten",
    accepted: "Angenommen",
    cancelled: "Storniert",
    completed: "Abgeschlossen",
    queue: "Küche / Bar Warteschlange",
    pending: "Offene Website-Bestellungen",
    cash: "Erfasstes Bargeld",
    card: "Manuell erfasste Karte",
    crew: "Personal im Dienst",
    next: "Nächste geplante Aktion",
    checkpoint: "Letzter Checkpoint",
    receipts: "Finalisierte Belege heute / PDF-Archiv",
    journal: "Aktivitätsjournal",
    evidence: "Nachweise, Erklärung und Auswirkung",
    older: "Ältere Ereignisse",
    week: "Beobachtete Woche",
    events: "Ereignisse",
    closed: "Abschlüsse",
    incidents: "Vorfälle",
    awaiting: "Tagesabgleich wartet auf Abschluss",
    clean: "Keine ungeklärten Abweichungen",
    skipped: "Verpasste Ankünfte",
    planned: "geplant",
    storage: "PDF-Speicher",
    warning: "Kapazität beachten",
    pdf: "Test-PDF herunterladen",
    printer: "Druckersimulator",
    retry: "Möglichen Doppeldruck bestätigen und wiederholen",
    confirm:
      "Druckerbeobachtung vor Wiederholung bestätigen. Doppelte Ausgabe ist möglich.",
    volume: "Verkehr im nächsten Lauf",
    save: "Konfiguration speichern",
    details: "Echte Anwendung öffnen",
    needs: "Prüfung nötig",
    running: "Läuft",
    paused: "Pausiert",
    stopped: "Gestoppt",
    stopping: "Stoppt nach Tagesende",
    functional: "Kurzes Funktionsfenster",
    clock: "Echte Uhrzeit",
    source:
      "Zahlen und Beträge stammen aus echten gespeicherten Betriebsdaten. QR-Sitzungszahlungen können unzugeordnet bleiben und keinen P2-Beleg haben.",
  },
  it: {
    title: "Laboratorio operativo",
    intro: "Due attività sintetiche. Dati reali dell'applicazione.",
    local: "LOCALE · SOLO TEST · NON FISCALE",
    login: "Chiave operatore locale",
    enter: "Apri laboratorio",
    logout: "Esci",
    connected: "Ultimo aggiornamento",
    offline:
      "Connessione interrotta. Restano visibili gli ultimi dati osservati.",
    failed: "Azione fallita. Aggiorna e controlla il diario.",
    start: "Avvia",
    pause: "Pausa",
    resume: "Riprendi",
    stop: "Ferma a fine giornata",
    review: "Revisione risolta",
    today: "Attività oggi",
    run: "Simulazione corrente",
    received: "Ordini ricevuti",
    accepted: "Accettati",
    cancelled: "Annullati",
    completed: "Completati",
    queue: "Coda Cucina / Bar",
    pending: "Ordini sito in attesa",
    cash: "Contanti registrati",
    card: "Carta manuale registrata",
    crew: "Personale in servizio",
    next: "Prossima azione",
    checkpoint: "Ultimo checkpoint",
    receipts: "Ricevute di oggi / archivio PDF",
    journal: "Diario attività",
    evidence: "Prove, spiegazione e impatto",
    older: "Eventi precedenti",
    week: "Settimana osservata",
    events: "eventi",
    closed: "chiusure",
    incidents: "incidenti",
    awaiting: "Riconciliazione giornaliera in attesa di chiusura",
    clean: "Nessuna discrepanza non spiegata",
    skipped: "Arrivi persi",
    planned: "pianificati",
    storage: "Archivio PDF",
    warning: "Capacità da controllare",
    pdf: "Scarica PDF di test",
    printer: "Simulatore stampante",
    retry: "Conferma possibile duplicato e ritenta",
    confirm:
      "Conferma l'osservazione prima di ritentare. È possibile un'uscita duplicata.",
    volume: "Traffico del prossimo avvio",
    save: "Salva configurazione",
    details: "Apri applicazione reale",
    needs: "Revisione richiesta",
    running: "Attivo",
    paused: "In pausa",
    stopped: "Fermo",
    stopping: "Si ferma a fine giornata",
    functional: "Breve finestra funzionale",
    clock: "Orologio reale",
    source:
      "Numeri e importi provengono dai dati aziendali realmente persistiti. I pagamenti QR possono restare non allocati senza ricevuta P2.",
  },
};
const api = "http://127.0.0.1:4400/lab/operator";
async function request<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}
export default function LabDashboard({ lang }: { lang: Lang }) {
  const t = copy[lang],
    [data, setData] = useState<LabDashboardSnapshot | null>(null),
    [continuity, setContinuity] = useState<LabContinuityHealth | null>(null),
    [authenticated, setAuthenticated] = useState(true),
    [password, setPassword] = useState(""),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const [snapshot, health] = await Promise.all([
        request<LabDashboardSnapshot>("/status"),
        request<LabContinuityHealth>("/continuity"),
      ]);
      setData(snapshot);
      setContinuity(health);
      setError(false);
    } catch (e) {
      if ((e as Error).message === "401") {
        setAuthenticated(false);
        setData(null);
      } else setError(true);
    }
  }
  useEffect(() => {
    if (!authenticated) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (disposed) return;
      await refresh();
      if (!disposed) timer = setTimeout(load, 5000);
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [authenticated]);
  async function action(path: string, body: unknown) {
    setBusy(true);
    try {
      await request(path, body);
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function start(v: LabVenueDashboard) {
    setBusy(true);
    try {
      let version = v.version;
      if (v.config.mode === "FUNCTIONAL_WINDOW") {
        await request("/config", {
          profile: v.profile,
          expectedVersion: version,
          config: {
            ...v.config,
            mode: "WALL_CLOCK",
            cap: 200,
            graceSeconds: 300,
            weekendBusy: true,
          },
        });
        const current = await request<LabDashboardSnapshot>("/status");
        version = current.venues.find(
          (venue) => venue.profile === v.profile,
        )!.version;
      }
      await request("/control", {
        profile: v.profile,
        mode: "RUNNING",
        expectedVersion: version,
      });
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await request("/auth", { password });
      setAuthenticated(true);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  function time(value: string | null, tz: string) {
    return value
      ? new Intl.DateTimeFormat(lang, {
          dateStyle: "medium",
          timeStyle: "medium",
          timeZone: tz,
        }).format(new Date(value))
      : "—";
  }
  function money(value: number, currency: string) {
    return new Intl.NumberFormat(lang, { style: "currency", currency }).format(
      value / 100,
    );
  }
  function state(mode: LabControlMode) {
    return {
      RUNNING: t.running,
      PAUSED: t.paused,
      STOPPED: t.stopped,
      STOP_AFTER_DAY: t.stopping,
      NEEDS_REVIEW: t.needs,
    }[mode];
  }
  return (
    <main className="lab-root shell">
      <header className="lab-header">
        <div>
          <p className="lab-eyebrow">RestaurantFlow / {t.local}</p>
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
        <nav aria-label="Language">
          {(["sq", "de", "en", "it"] as const).map((l) => (
            <a
              key={l}
              href={`/${l}/lab`}
              aria-current={l === lang ? "page" : undefined}
            >
              {l.toUpperCase()}
            </a>
          ))}
        </nav>
        {authenticated && data && (
          <button
            onClick={() => {
              void request("/logout", {}).then(() => {
                setAuthenticated(false);
                setData(null);
              });
            }}
          >
            {t.logout}
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="lab-alert">
          {data ? t.offline : t.failed}
        </p>
      )}
      {!authenticated ? (
        <form className="lab-login" method="post" onSubmit={login}>
          <label htmlFor="lab-password">{t.login}</label>
          <input
            id="lab-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button className="lab-primary" disabled={busy}>
            {t.enter}
          </button>
        </form>
      ) : data ? (
        <>
          <div className="lab-update">
            {t.connected}: {time(data.now, "Europe/Berlin")}{" "}
            <span>
              {t.storage}: {data.storage.files} PDF ·{" "}
              {(data.storage.bytes / 1000000).toFixed(1)} MB{" "}
              {data.storage.warning && <strong>{t.warning}</strong>}
            </span>
          </div>
          {continuity && (
            <details className="lab-box" data-testid="lab-continuity">
              <summary>
                {
                  {
                    sq: "Shëndeti i runtime-it dhe rinovimi TEST ONLY",
                    en: "Runtime health and TEST ONLY renewal",
                    de: "Runtime-Zustand und TEST-ONLY-Verlängerung",
                    it: "Stato runtime e rinnovo TEST ONLY",
                  }[lang]
                }
              </summary>
              {continuity.monitor ? (
                <>
                  <p>
                    {time(continuity.monitor.observedAt, "Europe/Berlin")} ·{" "}
                    {Date.now() - Date.parse(continuity.monitor.observedAt) >
                    90000
                      ? t.offline
                      : "API " +
                        (continuity.monitor.api ? "OK" : "unreachable") +
                        " · Web " +
                        (continuity.monitor.web ? "OK" : "unreachable") +
                        " · PostgreSQL " +
                        (continuity.monitor.database ? "OK" : "disconnected")}
                  </p>
                  <ul>
                    {continuity.monitor.processes.map((p) => (
                      <li key={p.name}>
                        {p.name}: {p.status} · restart {p.restarts}
                      </li>
                    ))}
                  </ul>
                  {continuity.monitor.lastBackup && (
                    <p>
                      Backup:{" "}
                      {time(
                        continuity.monitor.lastBackup.createdAt,
                        "Europe/Berlin",
                      )}
                    </p>
                  )}
                </>
              ) : (
                <p>
                  {
                    {
                      sq: "Monitori background nuk është aktiv; shfaqen vetëm të dhënat canonical.",
                      en: "Background monitor is inactive; canonical data remains available.",
                      de: "Hintergrundmonitor nicht aktiv; kanonische Daten bleiben verfügbar.",
                      it: "Monitor in background inattivo; i dati canonici restano disponibili.",
                    }[lang]
                  }
                </p>
              )}
              <ul>
                {continuity.entitlements.map((e) => (
                  <li key={e.profile}>
                    {e.profile} · {e.status} · TEST ONLY opt-in{" "}
                    {e.optedIn ? "✓" : "—"} ·{" "}
                    {time(
                      e.validUntil,
                      e.profile === "DE" ? "Europe/Berlin" : "Europe/Tirane",
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="lab-venues">
            {data.venues.map((v) => (
              <section
                className="lab-venue"
                key={v.profile}
                data-profile={v.profile}
              >
                <div className="lab-venue-heading">
                  <div>
                    <p className="lab-eyebrow">
                      {v.profile} · {v.currency} · {v.timezone}
                    </p>
                    <h2>
                      {v.profile === "DE"
                        ? "TEST ONLY · Pizzeria"
                        : "TEST ONLY · Restaurant"}
                    </h2>
                    <p>{v.name}</p>
                  </div>
                  <span
                    className={`lab-state lab-state-${v.mode.toLowerCase()}`}
                  >
                    {state(v.mode)}
                  </span>
                </div>
                <div className="lab-controls">
                  {v.mode === "NEEDS_REVIEW" &&
                    v.reviews
                      ?.filter((j) => j.provenance === "WEBSITE_BROWSER")
                      .map((j) => (
                        <button
                          key={j.id}
                          disabled={busy || error}
                          onClick={() =>
                            void action("/browser-review", {
                              profile: v.profile,
                              jobId: j.id,
                            })
                          }
                        >
                          {
                            {
                              en: "Observe existing browser order",
                              sq: "Vëzhgo porosinë ekzistuese në shfletues",
                              de: "Bestehende Browserbestellung prüfen",
                              it: "Verifica ordine browser esistente",
                            }[lang]
                          }
                        </button>
                      ))}
                  {v.mode === "NEEDS_REVIEW" &&
                    v.report?.coverageIncomplete && (
                      <button
                        disabled={busy || error}
                        onClick={() =>
                          void action("/close-partial", {
                            profile: v.profile,
                            expectedVersion: v.version,
                            acknowledgeIncompleteCoverage: true,
                          })
                        }
                      >
                        {
                          {
                            en: "Close partial day · incomplete coverage",
                            sq: "Mbyll ditën e pjesshme · mbulim i paplotë",
                            de: "Teiltag schließen · Abdeckung unvollständig",
                            it: "Chiudi giorno parziale · copertura incompleta",
                          }[lang]
                        }
                      </button>
                    )}
                  {v.mode === "STOPPED" && (
                    <button
                      className="lab-primary"
                      disabled={busy || error}
                      onClick={() => void start(v)}
                    >
                      {t.start}
                    </button>
                  )}
                  {["RUNNING", "STOP_AFTER_DAY"].includes(v.mode) && (
                    <button
                      disabled={busy || error}
                      onClick={() =>
                        void action("/control", {
                          profile: v.profile,
                          mode: "PAUSED",
                          expectedVersion: v.version,
                        })
                      }
                    >
                      {t.pause}
                    </button>
                  )}
                  {v.mode === "PAUSED" && (
                    <button
                      className="lab-primary"
                      disabled={busy || error}
                      onClick={() =>
                        void action("/control", {
                          profile: v.profile,
                          mode: "RUNNING",
                          expectedVersion: v.version,
                        })
                      }
                    >
                      {t.resume}
                    </button>
                  )}
                  {["RUNNING", "PAUSED"].includes(v.mode) && (
                    <button
                      disabled={busy || error}
                      onClick={() =>
                        void action("/control", {
                          profile: v.profile,
                          mode: "STOP_AFTER_DAY",
                          expectedVersion: v.version,
                        })
                      }
                    >
                      {t.stop}
                    </button>
                  )}
                  {v.mode === "NEEDS_REVIEW" && (
                    <button
                      disabled={busy || error}
                      onClick={() =>
                        void action("/control", {
                          profile: v.profile,
                          mode: "PAUSED",
                          expectedVersion: v.version,
                        })
                      }
                    >
                      {t.review}
                    </button>
                  )}
                </div>
                <p className="lab-subtle">
                  {v.config.mode === "WALL_CLOCK" ? t.clock : t.functional} ·{" "}
                  {v.runDate ?? v.date} · {v.config.level}
                </p>
                {v.incident && (
                  <p role="status" className="lab-alert">
                    {t.needs}: <code>{v.incident}</code>
                  </p>
                )}
                <div className="lab-stats">
                  {[
                    [t.received, v.counts.received],
                    [t.accepted, v.counts.accepted],
                    [t.completed, v.counts.completed],
                    [t.queue, v.counts.activeTickets],
                    [t.pending, v.counts.pendingOnline],
                    [t.cancelled, v.counts.cancelled],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      data-testid={
                        label === t.accepted
                          ? `lab-accepted-${v.profile}`
                          : undefined
                      }
                    >
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>{t.today}</small>
                    </div>
                  ))}
                </div>
                <div className="lab-money">
                  <div>
                    <span>{t.cash}</span>
                    <strong>{money(v.money.cash, v.currency)}</strong>
                  </div>
                  <div>
                    <span>{t.card}</span>
                    <strong>{money(v.money.card, v.currency)}</strong>
                  </div>
                </div>
                <p className="lab-subtle">
                  {t.run}: {v.counts.own} / {v.counts.planned} {t.planned} ·{" "}
                  {t.skipped}: {v.counts.missed}
                </p>
                <dl className="lab-timing">
                  <div>
                    <dt>{t.next}</dt>
                    <dd>{time(v.next, v.timezone)}</dd>
                  </div>
                  <div>
                    <dt>{t.checkpoint}</dt>
                    <dd>{time(v.checkpoint, v.timezone)}</dd>
                  </div>
                </dl>
                <details className="lab-box">
                  <summary>
                    {t.crew} · {v.staff.length}
                  </summary>
                  <ul>
                    {v.staff.map((s) => (
                      <li key={s.name}>
                        {s.name} <small>{time(s.startedAt, v.timezone)}</small>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="lab-box">
                  <strong>
                    {v.report
                      ? v.report.discrepancies.length ||
                        v.report.coverageIncomplete
                        ? t.needs
                        : t.clean
                      : t.awaiting}
                  </strong>
                  {v.report?.discrepancies.map((d) => (
                    <p key={d}>{d}</p>
                  ))}
                </div>
                <details className="lab-box">
                  <summary>
                    {t.receipts} · {v.counts.finalizedReceipts} /{" "}
                    {v.counts.archivedPdfs}
                    {v.receipts.length === 100 ? "+" : ""}
                  </summary>
                  <ul className="lab-receipts">
                    {v.receipts.map((r) => (
                      <li key={r.id}>
                        <span>
                          <strong>{r.number}</strong> ·{" "}
                          {money(r.grossMinor, v.currency)} · {r.method}
                        </span>
                        {r.pdf && (
                          <a href={`${api}/pdf/${v.profile}/${r.id}`}>
                            {t.pdf}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
                <details
                  className="lab-box"
                  open={v.printer.some((p) => p.error === "UNKNOWN_RESULT")}
                >
                  <summary>
                    {t.printer} ·{" "}
                    {v.printer.filter((p) => p.status !== "PRINTED").length}
                  </summary>
                  <ul>
                    {v.printer
                      .filter((p) => p.status !== "PRINTED" || p.attempts > 1)
                      .map((p) => (
                        <li key={p.id}>
                          <span>
                            {p.status} · {p.error ?? "OK"} · {p.attempts}
                          </span>
                          {p.error === "UNKNOWN_RESULT" && (
                            <button
                              disabled={busy || error}
                              onClick={() => {
                                if (window.confirm(t.confirm))
                                  void action("/print-review", {
                                    profile: v.profile,
                                    jobId: p.id,
                                    confirmPossibleDuplicate: true,
                                  });
                              }}
                            >
                              {t.retry}
                            </button>
                          )}
                        </li>
                      ))}
                  </ul>
                </details>
                <nav className="lab-app-links" aria-label={t.details}>
                  <strong>{t.details}</strong>
                  {[
                    "pos",
                    "orders",
                    "kitchen",
                    "bar",
                    "workforce",
                    "reports",
                  ].map((path) => (
                    <a
                      key={path}
                      href={`/${lang}/staff/${path === "workforce" ? "schedule" : path}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {path === "pos"
                        ? "POS"
                        : path[0]!.toUpperCase() + path.slice(1)}{" "}
                      ↗
                    </a>
                  ))}
                </nav>
                {v.mode === "STOPPED" && (
                  <label className="lab-volume">
                    {t.volume}
                    <select
                      value={v.config.level}
                      disabled={busy}
                      onChange={(e) =>
                        void action("/config", {
                          profile: v.profile,
                          expectedVersion: v.version,
                          config: {
                            ...v.config,
                            mode: "WALL_CLOCK",
                            cap: 200,
                            graceSeconds: 300,
                            weekendBusy: true,
                            level: e.target.value,
                          },
                        })
                      }
                    >
                      <option>LOW</option>
                      <option>NORMAL</option>
                      <option>BUSY</option>
                    </select>
                  </label>
                )}
                <Journal venue={v} lang={lang} time={time} />
                <details className="lab-box">
                  <summary>{t.week}</summary>
                  <ul>
                    {v.week.map((w) => (
                      <li key={w.date}>
                        {w.date}: {w.events} {t.events} · {w.closed} {t.closed}{" "}
                        · {w.incidents} {t.incidents}
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            ))}
          </div>
          <p className="lab-footnote">{t.source}</p>
        </>
      ) : (
        <p role="status">…</p>
      )}
    </main>
  );
}
function Journal({
  venue: v,
  lang,
  time,
}: {
  venue: LabVenueDashboard;
  lang: Lang;
  time: (value: string | null, tz: string) => string;
}) {
  const t = copy[lang],
    [older, setOlder] = useState<LabJournalRow[]>([]),
    [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false);
  const rows = [...v.journal, ...older].filter(
    (r, i, a) => a.findIndex((x) => x.seq === r.seq) === i,
  );
  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const page = await request<LabJournalRow[]>(
        `/journal?profile=${v.profile}&before=${rows.at(-1)?.seq ?? "0"}`,
      );
      setOlder((previous) => [...previous, ...page]);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="lab-journal">
      <h3>{t.journal}</h3>
      <ol>
        {rows.map((r) => (
          <li key={r.seq}>
            <time dateTime={r.at}>{time(r.at, v.timezone)}</time>
            <p>{r.messages[lang]}</p>
            {typeof r.facts.items === "string" && (
              <p className="lab-subtle">{r.facts.items}</p>
            )}
            <details>
              <summary>{t.evidence}</summary>
              <dl>
                {Object.entries(r.facts).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ol>
      {failed && <p role="status">{t.offline}</p>}
      {rows.length >= 50 && (
        <button disabled={loading} onClick={() => void load()}>
          {t.older}
        </button>
      )}
    </section>
  );
}

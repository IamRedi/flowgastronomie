import { prisma } from "@flowgastronomie/database";
import {
  labRuntimeConfigSchema,
  labControlModeSchema,
  assertLabControlTransition,
  assertLabRunTransition,
  type LabControlMode,
  type LabRuntimeConfig,
} from "@flowgastronomie/domain";
import { assertLabInstance, assertLabScope, labVenues, hash } from "./guard.js";
export type Profile = "DE" | "AL";
export type Control = {
  profile: Profile;
  tenant_id: string;
  venue_id: string;
  version: number;
  mode: LabControlMode;
  config: LabRuntimeConfig;
  current_run_id: string | null;
  lease_owner: string | null;
  lease_until: Date | null;
  heartbeat_at: Date | null;
  checkpoint_at: Date | null;
  incident: string | null;
};
export const defaultRuntime: LabRuntimeConfig = {
  version: 1,
  level: "NORMAL",
  seed: 29,
  cap: 200,
  mode: "WALL_CLOCK",
  windowSeconds: 90,
  maxActive: 8,
  graceSeconds: 300,
  weekendBusy: true,
};
export async function initializeControls() {
  await assertLabInstance();
  for (const v of await labVenues())
    await prisma.$executeRaw`INSERT INTO operations_lab.control(profile,tenant_id,venue_id,config) VALUES (${v.profile},${v.tenant_id},${v.venue_id},${JSON.stringify(defaultRuntime)}::jsonb) ON CONFLICT(profile) DO NOTHING`;
}
export async function control(profile: Profile) {
  const rows = await prisma.$queryRaw<
    Control[]
  >`SELECT * FROM operations_lab.control WHERE profile=${profile}`;
  const row = rows[0];
  if (!row) throw new Error("LAB_CONTROL_NOT_FOUND");
  await assertLabScope(row.tenant_id, row.venue_id);
  row.config = labRuntimeConfigSchema.parse(row.config);
  row.mode = labControlModeSchema.parse(row.mode);
  return row;
}
const words: Record<string, [string, string, string, string]> = {
  CONFIG: [
    "The operator configured future traffic; historical activity is preserved",
    "Operatori konfiguroi trafikun e ardhshëm; aktiviteti historik ruhet",
    "Bediener hat künftigen Verkehr konfiguriert; bisherige Aktivität bleibt erhalten",
    "L'operatore ha configurato il traffico futuro; le attività precedenti restano conservate",
  ],
  START: [
    "Traffic started",
    "Trafiku u nis",
    "Verkehr gestartet",
    "Traffico avviato",
  ],
  PAUSED: [
    "Traffic paused; the current action may finish",
    "Trafiku u ndal; veprimi aktiv mund të përfundojë",
    "Verkehr pausiert; laufende Aktion darf enden",
    "Traffico in pausa; l'azione attiva può terminare",
  ],
  RUNNING: [
    "Traffic resumed",
    "Trafiku rifilloi",
    "Verkehr fortgesetzt",
    "Traffico ripreso",
  ],
  STOP_AFTER_DAY: [
    "Stop requested after the current day closes",
    "U kërkua ndalim pas mbylljes së ditës",
    "Stopp nach Tagesabschluss angefordert",
    "Arresto dopo la chiusura del giorno",
  ],
  OPEN: [
    "Staff attendance and register opened through the normal application",
    "Stafi regjistroi praninë dhe kasa u hap në aplikacion",
    "Anwesenheit und Kasse in der Anwendung geöffnet",
    "Presenze e cassa aperte nell'applicazione",
  ],
  ARRIVE: [
    "A customer order was created in the application",
    "Porosia e klientit u krijua në aplikacion",
    "Kundenbestellung in der Anwendung erstellt",
    "Ordine cliente creato nell'applicazione",
  ],
  PREPARE: [
    "Kitchen and Bar started preparation",
    "Kitchen dhe Bar nisën përgatitjen",
    "Küche und Bar beginnen die Zubereitung",
    "Cucina e Bar hanno iniziato la preparazione",
  ],
  READY: [
    "Production became ready after actual elapsed time",
    "Prodhimi u bë gati pas kohës reale të kaluar",
    "Produktion nach tatsächlich verstrichener Zeit bereit",
    "Produzione pronta dopo tempo realmente trascorso",
  ],
  SETTLE: [
    "Handover and permitted manual payment completed",
    "Dorëzimi dhe pagesa manuale e lejuar përfunduan",
    "Übergabe und erlaubte manuelle Zahlung abgeschlossen",
    "Consegna e pagamento manuale consentito completati",
  ],
  CANCELLED: [
    "The manager cancelled this unpaid order",
    "Menaxheri anuloi porosinë e papaguar",
    "Manager hat die unbezahlte Bestellung storniert",
    "Il responsabile ha annullato l'ordine non pagato",
  ],
  MISSED: [
    "An unstarted arrival was skipped; no historical order was generated",
    "Një ardhje e panisur u kapërcye; nuk u krijua porosi historike",
    "Verpasste Ankunft übersprungen; keine historische Bestellung erzeugt",
    "Arrivo perso saltato; nessun ordine storico generato",
  ],
  WAIT: [
    "Demand is waiting for available station/table capacity",
    "Kërkesa pret kapacitet të lirë të stacionit ose tavolinës",
    "Nachfrage wartet auf freie Station oder Tisch",
    "La domanda attende capacità libera di stazione o tavolo",
  ],
  RETRY: [
    "The same durable action will be retried; outcome is not yet confirmed",
    "I njëjti veprim do të riprovohet; rezultati ende nuk është konfirmuar",
    "Dieselbe dauerhafte Aktion wird wiederholt; Ergebnis noch unbestätigt",
    "La stessa azione sarà ritentata; esito non ancora confermato",
  ],
  NEEDS_REVIEW: [
    "Operation paused for review; no uncertain result is silently retried",
    "Operacioni u ndal për shqyrtim; rezultatet e pasigurta nuk riprovohen automatikisht",
    "Betrieb zur Prüfung pausiert; unsichere Ergebnisse werden nicht blind wiederholt",
    "Operazione in revisione; gli esiti incerti non vengono ritentati automaticamente",
  ],
  CLOSED: [
    "Register and attendance closed; independent reconciliation completed",
    "Kasa dhe prania u mbyllën; rakordimi i pavarur përfundoi",
    "Kasse und Anwesenheit geschlossen; unabhängiger Abgleich abgeschlossen",
    "Cassa e presenze chiuse; riconciliazione indipendente completata",
  ],
  PRINT_REVIEW: [
    "Operator explicitly confirmed a possible duplicate print retry through P3",
    "Operatori konfirmoi shprehimisht riprovën me mundësi dublikimi përmes P3",
    "Bediener hat möglichen Doppeldruck ausdrücklich über P3 bestätigt",
    "Operatore ha confermato esplicitamente un possibile duplicato tramite P3",
  ],
  RECOVERED: [
    "Persisted source identities were recovered after interruption",
    "Identitetet e ruajtura u rikuperuan pas ndërprerjes",
    "Gespeicherte Identitäten nach Unterbrechung wiederhergestellt",
    "Identità persistenti recuperate dopo interruzione",
  ],
  WARNING: [
    "Archive capacity requires attention; history is preserved",
    "Kapaciteti i arkivit kërkon vëmendje; historiku ruhet",
    "Archivkapazität erfordert Aufmerksamkeit; Historie bleibt erhalten",
    "La capacità dell'archivio richiede attenzione; la cronologia è preservata",
  ],
};
export async function journal(
  c: Pick<Control, "tenant_id" | "venue_id" | "current_run_id">,
  key: string,
  kind: string,
  facts: Record<string, unknown> = {},
  writer: Pick<typeof prisma, "$executeRaw"> = prisma,
) {
  await assertLabScope(c.tenant_id, c.venue_id);
  const w = words[kind] ?? words.NEEDS_REVIEW!;
  const messages = Object.fromEntries(
    ["en", "sq", "de", "it"].map((l, i) => [
      l,
      w[i] + (facts.reference ? " · " + String(facts.reference) : ""),
    ]),
  );
  await writer.$executeRaw`INSERT INTO operations_lab.journal(event_id,run_id,tenant_id,venue_id,kind,messages,facts) VALUES (${hash(c.tenant_id + ":" + key)},${c.current_run_id},${c.tenant_id},${c.venue_id},${kind},${JSON.stringify(messages)}::jsonb,${JSON.stringify(facts)}::jsonb) ON CONFLICT(event_id) DO NOTHING`;
}
export async function changeControl(
  profile: Profile,
  to: LabControlMode,
  expectedVersion: number,
) {
  const c = await control(profile);
  if (c.version !== expectedVersion)
    throw new Error("LAB_CONTROL_VERSION_CONFLICT");
  assertLabControlTransition(c.mode, to);
  if (to === "PAUSED" && c.mode === "NEEDS_REVIEW") {
    const jobs = await prisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM operations_lab.job WHERE run_id=${c.current_run_id} AND status='NEEDS_REVIEW'`;
    const actions = await prisma.$queryRaw<
      Array<{ event_id: string }>
    >`SELECT event_id FROM operations_lab.action WHERE run_id=${c.current_run_id} AND status IN ('NEEDS_REVIEW','FAILED')`;
    if (jobs.length || actions.length) throw new Error("LAB_UNRESOLVED_REVIEW");
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT profile FROM operations_lab.control WHERE profile=${profile} FOR UPDATE`;
    if (c.current_run_id) {
      const runs = await tx.$queryRaw<
        Array<{ status: Parameters<typeof assertLabRunTransition>[0] }>
      >`SELECT status FROM operations_lab.run WHERE id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
      const from = runs[0]?.status;
      const target =
        to === "PAUSED"
          ? "PAUSED"
          : to === "RUNNING" || to === "STOP_AFTER_DAY"
            ? "RUNNING"
            : null;
      if (from && target && from !== "COMPLETED" && from !== target) {
        assertLabRunTransition(from, target);
        await tx.$executeRaw`UPDATE operations_lab.run SET status=${target},updated_at=now() WHERE id=${c.current_run_id} AND tenant_id=${c.tenant_id} AND venue_id=${c.venue_id}`;
      }
    }
    const n =
      await tx.$executeRaw`UPDATE operations_lab.control SET mode=${to},version=version+1,incident=null WHERE profile=${profile} AND version=${expectedVersion}`;
    if (n !== 1) throw new Error("LAB_CONTROL_VERSION_CONFLICT");
    await journal(
      c,
      "control:" + (expectedVersion + 1),
      to === "RUNNING" && c.mode === "STOPPED" ? "START" : to,
      {
        actor: "local operator",
        impact:
          "Control applies between durable actions; an in-flight action may finish.",
      },
      tx,
    );
  });
  return control(profile);
}

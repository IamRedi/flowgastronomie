import type { PlatformLocale } from "./locale";
const rows = [
  [
    "title",
    "Monthly working-time account",
    "Monatliches Arbeitszeitkonto",
    "Conto mensile delle ore",
    "Llogaria mujore e orëve",
  ],
  ["month", "Month", "Monat", "Mese", "Muaji"],
  ["employee", "Employee", "Mitarbeiter", "Dipendente", "Punonjësi"],
  ["planned", "Planned", "Geplant", "Pianificato", "Planifikuar"],
  ["actual", "Actual", "Erfasst", "Registrato", "Regjistruar"],
  ["approved", "Approved", "Freigegeben", "Approvato", "Miratuar"],
  ["credited", "Credited", "Gutgeschrieben", "Accreditato", "Kredituar"],
  [
    "target",
    "Full-month contract target",
    "Vertragsziel für den ganzen Monat",
    "Obiettivo contrattuale del mese intero",
    "Objektivi kontraktual i muajit të plotë",
  ],
  ["carry", "Carryover", "Übertrag", "Riporto", "Bartja"],
  ["balance", "Time balance", "Zeitbilanz", "Saldo ore", "Bilanci i orëve"],
  [
    "overtime",
    "Configured overtime",
    "Konfigurierte Mehrstunden",
    "Straordinario configurato",
    "Orët shtesë të konfiguruara",
  ],
  ["breaks", "Breaks", "Pausen", "Pause", "Pauzat"],
  [
    "paidBreak",
    "Paid breaks",
    "Bezahlte Pausen",
    "Pause pagate",
    "Pauza të paguara",
  ],
  [
    "unpaidBreak",
    "Unpaid breaks",
    "Unbezahlte Pausen",
    "Pause non pagate",
    "Pauza të papaguara",
  ],
  [
    "notConfigured",
    "Not configured",
    "Nicht konfiguriert",
    "Non configurato",
    "Nuk është konfiguruar",
  ],
  ["draft", "PROVISIONAL", "VORLÄUFIG", "PROVVISORIO", "PROVIZOR"],
  [
    "recordedToDate",
    "Net hours recorded in the month so far",
    "Bisher im Monat erfasste Nettozeit",
    "Ore nette registrate nel mese finora",
    "Orët neto të regjistruara deri tani në muaj",
  ],
  [
    "provisionalBalance",
    "Provisional variance against full-month target",
    "Vorläufige Abweichung vom ganzen Monatsziel",
    "Scostamento provvisorio dall’obiettivo del mese intero",
    "Diferenca provizore ndaj objektivit të muajit të plotë",
  ],
  [
    "provisionalNote",
    "Approved hours and credited hours recorded so far, plus carryover, are compared with the full-month contract target. A negative variance is not an employee debt. This statement remains provisional until reviewed and closed.",
    "Bisher freigegebene und gutgeschriebene Stunden zuzüglich Übertrag werden mit dem Vertragsziel des ganzen Monats verglichen. Eine negative Abweichung ist keine Schuld des Mitarbeiters. Der Nachweis bleibt bis zur Prüfung und zum Abschluss vorläufig.",
    "Le ore approvate e accreditate finora, più il riporto, sono confrontate con l’obiettivo contrattuale del mese intero. Uno scostamento negativo non è un debito del dipendente. Il riepilogo resta provvisorio fino alla revisione e chiusura.",
    "Orët e miratuara dhe të kredituara deri tani, bashkë me bartjen, krahasohen me objektivin kontraktual të muajit të plotë. Diferenca negative nuk është borxh i punonjësit. Raporti mbetet provizor deri në shqyrtim dhe mbyllje.",
  ],
  [
    "confirmedBalance",
    "Confirmed time balance",
    "Bestätigte Zeitbilanz",
    "Saldo ore confermato",
    "Bilanci i konfirmuar i orëve",
  ],
  [
    "originalClose",
    "Original close",
    "Ursprünglicher Abschluss",
    "Chiusura originale",
    "Mbyllja origjinale",
  ],
  [
    "latestCompensation",
    "Latest compensation",
    "Neuester Ausgleich",
    "Ultima compensazione",
    "Kompensimi i fundit",
  ],
  [
    "closed",
    "Closed statement",
    "Geschlossener Nachweis",
    "Riepilogo chiuso",
    "Raport i mbyllur",
  ],
  [
    "adjustments",
    "Compensating adjustments",
    "Ausgleichskorrekturen",
    "Rettifiche compensative",
    "Korrigjime kompensuese",
  ],
  [
    "sources",
    "Source references",
    "Quellennachweise",
    "Riferimenti alle fonti",
    "Referencat e burimeve",
  ],
  ["date", "Date", "Datum", "Data", "Data"],
  ["category", "Category", "Kategorie", "Categoria", "Kategoria"],
  ["minutes", "Minutes", "Minuten", "Minuti", "Minutat"],
  ["status", "Status", "Status", "Stato", "Gjendja"],
  ["version", "Version", "Version", "Versione", "Versioni"],
  [
    "audit",
    "Audit reference",
    "Auditnachweis",
    "Riferimento audit",
    "Referenca e auditimit",
  ],
  [
    "country",
    "Employment country",
    "Beschäftigungsland",
    "Paese di lavoro",
    "Shteti i punësimit",
  ],
  [
    "note",
    "Working-time evidence; not a payroll-certified payslip.",
    "Arbeitszeitnachweis; keine zertifizierte Lohnabrechnung.",
    "Riepilogo ore; non è una busta paga certificata.",
    "Evidencë e orëve; nuk është fletëpagë e certifikuar.",
  ],
  [
    "absences",
    "Leave and absence decisions",
    "Urlaub und Abwesenheitsentscheidungen",
    "Decisioni su ferie e assenze",
    "Vendimet për leje dhe mungesa",
  ],
  ["annual", "Annual leave", "Jahresurlaub", "Ferie annuali", "Pushim vjetor"],
  [
    "personal",
    "Personal absence",
    "Persönliche Abwesenheit",
    "Assenza personale",
    "Mungesë personale",
  ],
  [
    "sickness",
    "Operational sickness absence",
    "Krankheitsbedingte Abwesenheit",
    "Assenza per malattia",
    "Mungesë nga sëmundja",
  ],
  [
    "other",
    "Other confirmed absence",
    "Andere bestätigte Abwesenheit",
    "Altra assenza confermata",
    "Mungesë tjetër e konfirmuar",
  ],
  [
    "unpaidAbsence",
    "Unpaid absence",
    "Unbezahlte Abwesenheit",
    "Assenza non retribuita",
    "Mungesë e papaguar",
  ],
  ["pendingDecision", "Pending", "Ausstehend", "In attesa", "Në pritje"],
  ["acceptedDecision", "Accepted", "Angenommen", "Accettato", "Pranuar"],
  ["rejectedDecision", "Rejected", "Abgelehnt", "Rifiutato", "Refuzuar"],
  ["cancelledDecision", "Cancelled", "Storniert", "Annullato", "Anuluar"],
] as const;
export type WorkforceMonthlyCopy = Record<(typeof rows)[number][0], string>;
export const workforceMonthlyCopy = Object.fromEntries(
  (["en", "de", "it", "sq"] as const).map((lang, i) => [
    lang,
    Object.fromEntries(rows.map((r) => [r[0], r[i + 1]])),
  ]),
) as Record<PlatformLocale, WorkforceMonthlyCopy>;

/** Fixed workforce-hour presentation for the four supported locales. Albanian
 * uses a decimal comma explicitly, including Chromium builds without sq ICU. */
export function workforceFormatHours(
  milliseconds: number | null,
  locale: PlatformLocale,
  missing: string,
) {
  if (milliseconds === null) return missing;
  return (
    new Intl.NumberFormat(locale === "sq" ? "de" : locale, {
      maximumFractionDigits: 2,
      useGrouping: false,
    }).format(milliseconds / 3600000) + " h"
  );
}

export function workforceAbsenceLabels(
  category: string,
  status: string,
  locale: PlatformLocale,
) {
  const c = workforceMonthlyCopy[locale];
  return {
    category:
      (
        {
          ANNUAL: c.annual,
          PERSONAL: c.personal,
          SICKNESS: c.sickness,
          OTHER: c.other,
          UNPAID: c.unpaidAbsence,
        } as Record<string, string>
      )[category] ?? category,
    status:
      (
        {
          PENDING: c.pendingDecision,
          ACCEPTED: c.acceptedDecision,
          APPROVED: c.approved,
          REJECTED: c.rejectedDecision,
          CANCELLED: c.cancelledDecision,
        } as Record<string, string>
      )[status] ?? status,
  };
}

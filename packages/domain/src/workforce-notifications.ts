import { z } from "zod";
import { WorkforceError, workforceDateSchema } from "./workforce";
import { workforceMonthSchema } from "./workforce-accounts";
import type { PlatformLocale } from "./locale";
export const workforceNotificationCategories = [
  "SCHEDULE_PUBLISHED",
  "SHIFT_CHANGED",
  "SHIFT_CANCELLED",
  "SHIFT_REQUEST",
  "SHIFT_DECISION",
  "LEAVE_REQUEST",
  "LEAVE_DECISION",
  "CORRECTION_DECISION",
  "ATTENDANCE_APPROVED",
  "APPROVAL_REQUIRED",
  "MISSING_PUNCH",
  "SHIFT_REMINDER",
  "MONTHLY_STATEMENT",
] as const;
export type WorkforceNotificationCategory =
  (typeof workforceNotificationCategories)[number];
export const workforceNotificationPreferenceSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    locale: z.enum(["sq", "de", "en", "it"]),
    emailEnabled: z.boolean(),
    pushEnabled: z.boolean(),
    reminderMinutes: z.number().int().min(5).max(1440),
    categories: z
      .array(z.enum(workforceNotificationCategories))
      .max(workforceNotificationCategories.length)
      .refine((v) => new Set(v).size === v.length),
    consentConfirmed: z.literal(true),
  })
  .strict();
export const workforceNoticeLinkSchema = z
  .object({
    tab: z.enum([
      "today",
      "hours",
      "leave",
      "requests",
      "month",
      "inbox",
      "operations",
    ]),
    date: workforceDateSchema.optional(),
    month: workforceMonthSchema.optional(),
    requestId: z.string().min(1).max(128).optional(),
    attendanceId: z.string().min(1).max(128).optional(),
    assignmentId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type WorkforceNoticeLink = z.infer<typeof workforceNoticeLinkSchema>;
const labels: Record<
  WorkforceNotificationCategory,
  readonly [string, string, string, string]
> = {
  SCHEDULE_PUBLISHED: [
    "Published schedule ready",
    "Veröffentlichter Dienstplan verfügbar",
    "Turni pubblicati disponibili",
    "Orari i publikuar është gati",
  ],
  SHIFT_CHANGED: [
    "Your published shift changed",
    "Dein veröffentlichter Dienst wurde geändert",
    "Il tuo turno pubblicato è cambiato",
    "Turni yt i publikuar ndryshoi",
  ],
  SHIFT_CANCELLED: [
    "Your published shift was cancelled",
    "Dein veröffentlichter Dienst wurde abgesagt",
    "Il tuo turno pubblicato è stato annullato",
    "Turni yt i publikuar u anulua",
  ],
  SHIFT_REQUEST: [
    "Shift exchange needs attention",
    "Diensttausch benötigt Aufmerksamkeit",
    "Scambio turno da controllare",
    "Shkëmbimi i turnit kërkon vëmendje",
  ],
  SHIFT_DECISION: [
    "Shift request decision ready",
    "Entscheidung zum Dienstantrag verfügbar",
    "Decisione sul turno disponibile",
    "Vendimi për turnin është gati",
  ],
  LEAVE_REQUEST: [
    "Absence request needs review",
    "Abwesenheitsantrag prüfen",
    "Richiesta di assenza da verificare",
    "Kërkesa për mungesë kërkon shqyrtim",
  ],
  LEAVE_DECISION: [
    "Absence decision ready",
    "Abwesenheitsentscheidung verfügbar",
    "Decisione sull'assenza disponibile",
    "Vendimi për mungesën është gati",
  ],
  CORRECTION_DECISION: [
    "Time correction decision ready",
    "Zeitkorrektur entschieden",
    "Decisione sulla correzione ore disponibile",
    "Vendimi për korrigjimin e orëve është gati",
  ],
  ATTENDANCE_APPROVED: [
    "Working time approved",
    "Arbeitszeit freigegeben",
    "Ore di lavoro approvate",
    "Orët e punës u miratuan",
  ],
  APPROVAL_REQUIRED: [
    "Working time needs review",
    "Arbeitszeit benötigt Freigabe",
    "Orario di lavoro da approvare",
    "Orët e punës kërkojnë miratim",
  ],
  MISSING_PUNCH: [
    "Check incomplete working time",
    "Unvollständige Arbeitszeit prüfen",
    "Controlla la registrazione incompleta",
    "Kontrollo regjistrimin e paplotë të punës",
  ],
  SHIFT_REMINDER: [
    "Upcoming published shift",
    "Nächster veröffentlichter Dienst",
    "Prossimo turno pubblicato",
    "Turni i publikuar po afrohet",
  ],
  MONTHLY_STATEMENT: [
    "Monthly statement ready",
    "Monatsnachweis verfügbar",
    "Riepilogo mensile disponibile",
    "Raporti mujor është gati",
  ],
};
const locales = ["en", "de", "it", "sq"] as const;
export function workforceNotificationCopy(
  category: WorkforceNotificationCategory,
  locale: PlatformLocale,
) {
  const index = locales.indexOf(locale),
    title = labels[category][index]!;
  const body = [
    "Open your authenticated workforce workspace to review the update.",
    "Öffne deinen geschützten Personalbereich, um die Änderung zu prüfen.",
    "Apri il tuo spazio personale autenticato per verificare l'aggiornamento.",
    "Hap hapësirën tënde të autentifikuar për të shqyrtuar përditësimin.",
  ][index]!;
  return {
    title,
    body,
    action: [
      "Review update",
      "Änderung prüfen",
      "Verifica aggiornamento",
      "Shqyrto përditësimin",
    ][index]!,
  };
}
export function workforcePrivatePushCopy(locale: PlatformLocale) {
  const index = locales.indexOf(locale);
  return {
    title: "FlowGastronomie",
    body: [
      "A workforce update is ready in your secure inbox.",
      "Eine neue Mitteilung ist im geschützten Posteingang verfügbar.",
      "Un aggiornamento è disponibile nella tua casella protetta.",
      "Një përditësim është gati në kutinë tënde të sigurt.",
    ][index]!,
  };
}
export function workforceNotificationPath(
  locale: PlatformLocale,
  link: WorkforceNoticeLink,
) {
  workforceNoticeLinkSchema.parse(link);
  const values = {
    workforceTab: link.tab,
    ...(link.date ? { date: link.date } : {}),
    ...(link.month ? { workforceMonth: link.month } : {}),
    ...(link.requestId ? { workforceRequest: link.requestId } : {}),
    ...(link.attendanceId ? { workforceAttendance: link.attendanceId } : {}),
    ...(link.assignmentId ? { workforceAssignment: link.assignmentId } : {}),
  };
  return (
    "/" +
    locale +
    "/staff/schedule?" +
    Object.entries(values)
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v))
      .join("&")
  );
}
export function workforceNoticeImportant(
  category: WorkforceNotificationCategory,
) {
  return [
    "SHIFT_CHANGED",
    "SHIFT_CANCELLED",
    "SHIFT_DECISION",
    "LEAVE_DECISION",
    "CORRECTION_DECISION",
    "MONTHLY_STATEMENT",
  ].includes(category);
}
export function workforceDeliveryRetry(
  attempt: number,
  now: Date,
  createdAt: Date,
) {
  if (now.getTime() - createdAt.getTime() >= 23 * 3600000)
    return { state: "UNCERTAIN" as const, nextAttemptAt: now };
  if (attempt >= 5) return { state: "FAILED" as const, nextAttemptAt: now };
  return {
    state: "PENDING" as const,
    nextAttemptAt: new Date(
      now.getTime() + Math.min(3600000, 30000 * 4 ** Math.max(0, attempt - 1)),
    ),
  };
}
export const workforcePushSubscriptionSchema = z
  .object({
    consentConfirmed: z.literal(true),
    subscription: z
      .object({
        endpoint: z
          .string()
          .max(4096)
          .url()
          .refine((endpoint) => {
            try {
              const u = new URL(endpoint);
              return (
                u.protocol === "https:" &&
                !u.username &&
                !u.password &&
                (!u.port || u.port === "443") &&
                !u.hash &&
                (u.hostname === "fcm.googleapis.com" ||
                  u.hostname === "updates.push.services.mozilla.com" ||
                  u.hostname.endsWith(".push.services.mozilla.com") ||
                  u.hostname === "web.push.apple.com" ||
                  u.hostname.endsWith(".notify.windows.com"))
              );
            } catch {
              return false;
            }
          }),
        expirationTime: z.number().nullable().optional(),
        keys: z
          .object({
            p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}={0,2}$/),
            auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}={0,2}$/),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export function assertWorkforceNoticeAcknowledgment(
  important: boolean,
  confirmed: boolean,
) {
  if (important && !confirmed)
    throw new WorkforceError(
      "APPROVAL",
      "Review the important change before acknowledging it.",
    );
}

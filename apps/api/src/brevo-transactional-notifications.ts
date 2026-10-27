import {
  workforceNotificationCopy,
  workforceNotificationPath,
} from "@flowgastronomie/domain";
import { createHash } from "node:crypto";

import type {
  OnlineOrderStatus,
  PlatformLocale,
  StaffRole,
} from "@flowgastronomie/domain";

import {
  disabledTransactionalNotificationService,
  type TransactionalNotification,
  type TransactionalNotificationService,
} from "./transactional-notifications.js";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_SEND_ATTEMPTS = 3;

type Fetch = typeof fetch;

type EmailCopy = {
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
};

type BrevoConfiguration = {
  apiKey: string;
  senderAddress: string;
  senderName: string;
  webOrigin: string;
  timeoutMs?: number;
};

type BrevoServiceOptions = {
  fetchImpl?: Fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class TransactionalEmailConfigurationError extends Error {}

export class TransactionalEmailDeliveryError extends Error {
  constructor(
    readonly provider: "brevo",
    readonly status: number | null,
    readonly providerCode: string | null,
  ) {
    super(
      status === null
        ? "Brevo transactional email request failed"
        : `Brevo transactional email request failed with status ${status}`,
    );
    this.name = "TransactionalEmailDeliveryError";
  }
}

const roleLabels: Record<PlatformLocale, Record<StaffRole, string>> = {
  en: {
    OWNER: "Owner",
    MANAGER: "Manager",
    WAITER: "Waiter",
    BAR: "Bar",
    KITCHEN: "Kitchen",
  },
  de: {
    OWNER: "Inhaber/in",
    MANAGER: "Manager/in",
    WAITER: "Service",
    BAR: "Bar",
    KITCHEN: "Küche",
  },
  it: {
    OWNER: "Titolare",
    MANAGER: "Responsabile",
    WAITER: "Cameriere/a",
    BAR: "Bar",
    KITCHEN: "Cucina",
  },
  sq: {
    OWNER: "Pronar/e",
    MANAGER: "Menaxher/e",
    WAITER: "Kamerier/e",
    BAR: "Bar",
    KITCHEN: "Kuzhinë",
  },
};

const statusLabels: Record<
  PlatformLocale,
  Record<OnlineOrderStatus, string>
> = {
  en: {
    PENDING_CONFIRMATION: "Awaiting confirmation",
    ACCEPTED: "Accepted",
    PREPARING: "In preparation",
    READY: "Ready",
    OUT_FOR_DELIVERY: "Out for delivery",
    COMPLETED: "Completed",
    REJECTED: "Not accepted",
    CANCELLED: "Cancelled",
  },
  de: {
    PENDING_CONFIRMATION: "Bestätigung ausstehend",
    ACCEPTED: "Angenommen",
    PREPARING: "In Zubereitung",
    READY: "Abholbereit",
    OUT_FOR_DELIVERY: "In Zustellung",
    COMPLETED: "Abgeschlossen",
    REJECTED: "Nicht angenommen",
    CANCELLED: "Storniert",
  },
  it: {
    PENDING_CONFIRMATION: "In attesa di conferma",
    ACCEPTED: "Accettato",
    PREPARING: "In preparazione",
    READY: "Pronto",
    OUT_FOR_DELIVERY: "In consegna",
    COMPLETED: "Completato",
    REJECTED: "Non accettato",
    CANCELLED: "Annullato",
  },
  sq: {
    PENDING_CONFIRMATION: "Në pritje të konfirmimit",
    ACCEPTED: "U pranua",
    PREPARING: "Në përgatitje",
    READY: "Gati",
    OUT_FOR_DELIVERY: "Në dërgesë",
    COMPLETED: "Përfundoi",
    REJECTED: "Nuk u pranua",
    CANCELLED: "U anulua",
  },
};

function localizedCopy(
  notification: TransactionalNotification,
  webOrigin: string,
): EmailCopy {
  const { locale } = notification;

  if (notification.kind === "WORKFORCE_UPDATE") {
    const copy = workforceNotificationCopy(
      notification.category,
      notification.locale,
    );
    return {
      subject: copy.title,
      heading: copy.title,
      paragraphs: [copy.body],
      action: {
        label: copy.action,
        url: link(
          webOrigin,
          workforceNotificationPath(notification.locale, notification.link),
        ),
      },
    };
  }
  if (notification.kind === "STAFF_INVITATION") {
    const invitationUrl = link(
      webOrigin,
      `/${locale}/staff/invite/${encodeURIComponent(notification.invitationToken)}`,
    );
    const role = roleLabels[locale][notification.role];
    const copies: Record<PlatformLocale, EmailCopy> = {
      en: {
        subject: `Invitation to join ${notification.venueName}`,
        heading: "Welcome to the team",
        paragraphs: [
          `You have been invited to join ${notification.venueName} as ${role}.`,
          "Use your personal invitation to create your staff access.",
        ],
        action: { label: "Accept invitation", url: invitationUrl },
      },
      de: {
        subject: `Einladung zu ${notification.venueName}`,
        heading: "Willkommen im Team",
        paragraphs: [
          `Sie wurden eingeladen, ${notification.venueName} als ${role} beizutreten.`,
          "Erstellen Sie über Ihre persönliche Einladung Ihren Mitarbeiterzugang.",
        ],
        action: { label: "Einladung annehmen", url: invitationUrl },
      },
      it: {
        subject: `Invito a entrare in ${notification.venueName}`,
        heading: "Benvenuto/a nel team",
        paragraphs: [
          `Sei stato/a invitato/a a entrare in ${notification.venueName} come ${role}.`,
          "Usa il tuo invito personale per creare l’accesso staff.",
        ],
        action: { label: "Accetta l’invito", url: invitationUrl },
      },
      sq: {
        subject: `Ftesë për t’iu bashkuar ${notification.venueName}`,
        heading: "Mirë se vini në ekip",
        paragraphs: [
          `Jeni ftuar t’i bashkoheni ${notification.venueName} si ${role}.`,
          "Përdorni ftesën tuaj personale për të krijuar aksesin e stafit.",
        ],
        action: { label: "Prano ftesën", url: invitationUrl },
      },
    };
    return copies[locale];
  }

  if (notification.kind === "ONLINE_ORDER_RECEIVED") {
    const trackingUrl = link(
      webOrigin,
      `/${locale}/order/track/${encodeURIComponent(notification.trackingToken)}`,
    );
    const copies: Record<PlatformLocale, EmailCopy> = {
      en: {
        subject: `Order request ${notification.referenceCode} received`,
        heading: "We received your order request",
        paragraphs: [
          `Reference: ${notification.referenceCode}`,
          "The restaurant will confirm your order. Follow its current status online.",
        ],
        action: { label: "Track order", url: trackingUrl },
      },
      de: {
        subject: `Bestellanfrage ${notification.referenceCode} erhalten`,
        heading: "Ihre Bestellanfrage ist eingegangen",
        paragraphs: [
          `Referenz: ${notification.referenceCode}`,
          "Das Restaurant bestätigt Ihre Bestellung. Den aktuellen Status können Sie online verfolgen.",
        ],
        action: { label: "Bestellung verfolgen", url: trackingUrl },
      },
      it: {
        subject: `Richiesta d’ordine ${notification.referenceCode} ricevuta`,
        heading: "Abbiamo ricevuto la tua richiesta d’ordine",
        paragraphs: [
          `Riferimento: ${notification.referenceCode}`,
          "Il locale confermerà l’ordine. Puoi seguirne lo stato aggiornato online.",
        ],
        action: { label: "Segui l’ordine", url: trackingUrl },
      },
      sq: {
        subject: `Kërkesa e porosisë ${notification.referenceCode} u mor`,
        heading: "E morëm kërkesën tuaj të porosisë",
        paragraphs: [
          `Referenca: ${notification.referenceCode}`,
          "Biznesi do ta konfirmojë porosinë. Statusin aktual mund ta ndiqni online.",
        ],
        action: { label: "Ndiq porosinë", url: trackingUrl },
      },
    };
    return copies[locale];
  }

  if (notification.kind === "RESERVATION_CONFIRMED") {
    const requestedFor = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: notification.timezone,
    }).format(notification.requestedFor);
    const copies: Record<PlatformLocale, EmailCopy> = {
      en: {
        subject: `Reservation confirmed at ${notification.venueName}`,
        heading: "Your reservation is confirmed",
        paragraphs: [
          `${notification.venueName} confirmed your table for ${notification.partySize}.`,
          `Date and time: ${requestedFor}`,
        ],
      },
      de: {
        subject: `Reservierung bei ${notification.venueName} bestätigt`,
        heading: "Ihre Reservierung ist bestätigt",
        paragraphs: [
          `${notification.venueName} hat Ihren Tisch für ${notification.partySize} Personen bestätigt.`,
          `Datum und Uhrzeit: ${requestedFor}`,
        ],
      },
      it: {
        subject: `Prenotazione confermata da ${notification.venueName}`,
        heading: "La tua prenotazione è confermata",
        paragraphs: [
          `${notification.venueName} ha confermato il tuo tavolo per ${notification.partySize} persone.`,
          `Data e ora: ${requestedFor}`,
        ],
      },
      sq: {
        subject: `Rezervimi te ${notification.venueName} u konfirmua`,
        heading: "Rezervimi yt u konfirmua",
        paragraphs: [
          `${notification.venueName} konfirmoi tavolinën tënde për ${notification.partySize} persona.`,
          `Data dhe ora: ${requestedFor}`,
        ],
      },
    };
    return copies[locale];
  }

  const status = statusLabels[locale][notification.status];
  const note = notification.note?.trim();
  const copies: Record<PlatformLocale, EmailCopy> = {
    en: {
      subject: `Order ${notification.referenceCode}: ${status}`,
      heading: "Your order status changed",
      paragraphs: [
        `Reference: ${notification.referenceCode}`,
        `New status: ${status}`,
        ...(note ? [`Restaurant note: ${note}`] : []),
      ],
    },
    de: {
      subject: `Bestellung ${notification.referenceCode}: ${status}`,
      heading: "Der Status Ihrer Bestellung wurde aktualisiert",
      paragraphs: [
        `Referenz: ${notification.referenceCode}`,
        `Neuer Status: ${status}`,
        ...(note ? [`Hinweis des Restaurants: ${note}`] : []),
      ],
    },
    it: {
      subject: `Ordine ${notification.referenceCode}: ${status}`,
      heading: "Lo stato del tuo ordine è stato aggiornato",
      paragraphs: [
        `Riferimento: ${notification.referenceCode}`,
        `Nuovo stato: ${status}`,
        ...(note ? [`Nota del locale: ${note}`] : []),
      ],
    },
    sq: {
      subject: `Porosia ${notification.referenceCode}: ${status}`,
      heading: "Statusi i porosisë suaj u përditësua",
      paragraphs: [
        `Referenca: ${notification.referenceCode}`,
        `Statusi i ri: ${status}`,
        ...(note ? [`Shënim nga biznesi: ${note}`] : []),
      ],
    },
  };
  return copies[locale];
}

function link(origin: string, pathname: string) {
  return new URL(pathname, origin).toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHtml(copy: EmailCopy) {
  const paragraphs = copy.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;color:#334155;line-height:1.6">${escapeHtml(paragraph)}</p>`,
    )
    .join("");
  const action = copy.action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(copy.action.url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:8px">${escapeHtml(copy.action.label)}</a></p><p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;word-break:break-all">${escapeHtml(copy.action.url)}</p>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(copy.subject)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:32px"><p style="margin:0 0 20px;color:#0f766e;font-size:15px;font-weight:700">FlowGastronomie</p><h1 style="margin:0 0 20px;color:#0f172a;font-size:26px;line-height:1.25">${escapeHtml(copy.heading)}</h1>${paragraphs}${action}</td></tr></table></td></tr></table></body></html>`;
}

function renderText(copy: EmailCopy) {
  return [
    "FlowGastronomie",
    "",
    copy.heading,
    "",
    ...copy.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(copy.action ? [copy.action.label, copy.action.url] : []),
  ].join("\n");
}

function notificationIdempotencyKey(notification: TransactionalNotification) {
  const digest = createHash("sha256")
    .update(JSON.stringify(notification))
    .digest("hex");
  return `flowgastronomie-${notification.kind.toLowerCase()}-${digest}`;
}

function parseProviderCode(body: string) {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "code" in parsed &&
      typeof parsed.code === "string"
    ) {
      return parsed.code.slice(0, 80);
    }
  } catch {
    // Non-JSON provider responses are deliberately not exposed or logged.
  }
  return null;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function defaultSleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertConfiguration(configuration: BrevoConfiguration) {
  if (!configuration.apiKey.trim()) {
    throw new TransactionalEmailConfigurationError(
      "BREVO_API_KEY is required when transactional email uses Brevo",
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(configuration.senderAddress)) {
    throw new TransactionalEmailConfigurationError(
      "TRANSACTIONAL_EMAIL_FROM_ADDRESS must be a valid email address",
    );
  }
  if (!configuration.senderName.trim()) {
    throw new TransactionalEmailConfigurationError(
      "TRANSACTIONAL_EMAIL_FROM_NAME is required",
    );
  }
  let origin: URL;
  try {
    origin = new URL(configuration.webOrigin);
  } catch {
    throw new TransactionalEmailConfigurationError(
      "WEB_ORIGIN must be an absolute HTTP(S) origin",
    );
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new TransactionalEmailConfigurationError(
      "WEB_ORIGIN must be an absolute HTTP(S) origin without a path",
    );
  }
  const timeoutMs = configuration.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
    throw new TransactionalEmailConfigurationError(
      "TRANSACTIONAL_EMAIL_TIMEOUT_MS must be an integer between 500 and 30000",
    );
  }
}

export function createBrevoTransactionalNotificationService(
  configuration: BrevoConfiguration,
  options: BrevoServiceOptions = {},
): TransactionalNotificationService {
  assertConfiguration(configuration);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = configuration.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async send(notification) {
      const copy = localizedCopy(notification, configuration.webOrigin);
      const body = JSON.stringify({
        sender: {
          email: configuration.senderAddress,
          name: configuration.senderName,
        },
        to: [{ email: notification.recipient }],
        subject: copy.subject,
        htmlContent: renderHtml(copy),
        textContent: renderText(copy),
        headers: {
          "Idempotency-Key": notificationIdempotencyKey(notification),
        },
        tags: [notification.kind.toLowerCase()],
      });
      const deadline = Date.now() + timeoutMs;

      for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
        let response: Response;
        try {
          response = await fetchImpl(BREVO_SEND_URL, {
            method: "POST",
            headers: {
              accept: "application/json",
              "api-key": configuration.apiKey,
              "content-type": "application/json",
            },
            body,
            signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          });
        } catch {
          if (attempt < MAX_SEND_ATTEMPTS && Date.now() < deadline) {
            await sleep(attempt * 250);
            continue;
          }
          throw new TransactionalEmailDeliveryError("brevo", null, null);
        }

        if (response.ok) return;

        const providerCode = parseProviderCode(await response.text());
        if (providerCode === "duplicate_parameter") return;
        if (
          isRetryableStatus(response.status) &&
          attempt < MAX_SEND_ATTEMPTS &&
          Date.now() < deadline
        ) {
          await sleep(attempt * 250);
          continue;
        }
        throw new TransactionalEmailDeliveryError(
          "brevo",
          response.status,
          providerCode,
        );
      }
    },
  };
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new TransactionalEmailConfigurationError(
      `${name} is required when transactional email uses Brevo`,
    );
  }
  return value;
}

export function createTransactionalNotificationServiceFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  options: BrevoServiceOptions = {},
): TransactionalNotificationService {
  const provider =
    environment.TRANSACTIONAL_EMAIL_PROVIDER?.trim().toLowerCase();

  if (!provider || provider === "disabled") {
    if (environment.NODE_ENV === "production" && !provider) {
      throw new TransactionalEmailConfigurationError(
        "TRANSACTIONAL_EMAIL_PROVIDER must be explicitly set in production",
      );
    }
    return disabledTransactionalNotificationService;
  }

  if (provider !== "brevo") {
    throw new TransactionalEmailConfigurationError(
      `Unsupported TRANSACTIONAL_EMAIL_PROVIDER: ${provider}`,
    );
  }

  const timeoutValue = environment.TRANSACTIONAL_EMAIL_TIMEOUT_MS?.trim();
  return createBrevoTransactionalNotificationService(
    {
      apiKey: requiredEnvironmentValue(environment, "BREVO_API_KEY"),
      senderAddress: requiredEnvironmentValue(
        environment,
        "TRANSACTIONAL_EMAIL_FROM_ADDRESS",
      ),
      senderName:
        environment.TRANSACTIONAL_EMAIL_FROM_NAME?.trim() ?? "FlowGastronomie",
      webOrigin: requiredEnvironmentValue(environment, "WEB_ORIGIN"),
      ...(timeoutValue ? { timeoutMs: Number(timeoutValue) } : {}),
    },
    options,
  );
}

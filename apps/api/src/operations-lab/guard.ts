import { prisma, staffAuthRepository } from "@flowgastronomie/database";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";

export const LAB_MARKER = "RESTAURANTFLOW_OPERATIONS_LAB_V1";
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function assertLabEnvironment(env = process.env) {
  if (env.NODE_ENV === "production" || env.OPERATIONS_LAB_ENABLED !== "true")
    throw new Error("LAB_DISABLED");
  const url = new URL(env.DATABASE_URL ?? "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "55439" ||
    url.pathname !== "/restaurantflow_operations_lab" ||
    url.username !== "operations_lab" ||
    url.searchParams.get("schema") !== "public" ||
    url.searchParams.size !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== "schema")
  )
    throw new Error("LAB_DATABASE_FORBIDDEN");
  for (const key of [
    "BREVO_API_KEY",
    "VAPID_PRIVATE_KEY",
    "STRIPE_SECRET_KEY",
    "CREATIVE_OPENAI_API_KEY",
    "MENU_IMPORT_OPENAI_API_KEY",
    "OPENAI_API_KEY",
    "SMTP_URL",
  ])
    if (env[key]) throw new Error("LAB_PROVIDER_FORBIDDEN");
}
export async function assertLabInstance() {
  assertLabEnvironment();
  const rows = await prisma.$queryRaw<Array<{ valid: boolean }>>`
    SELECT current_database() = 'restaurantflow_operations_lab'
      AND current_user = 'operations_lab'
      AND i.marker = ${LAB_MARKER}
      AND i.system_identifier = c.system_identifier::text AS valid
    FROM operations_lab.instance i CROSS JOIN pg_control_system() c`;
  if (rows.length !== 1 || !rows[0]?.valid)
    throw new Error("LAB_INSTANCE_FORBIDDEN");
}
export type LabVenue = {
  profile: "DE" | "AL";
  tenant_id: string;
  venue_id: string;
  owner_email: string;
};
export async function labVenues() {
  await assertLabInstance();
  return prisma.$queryRaw<
    LabVenue[]
  >`SELECT * FROM operations_lab.venue ORDER BY profile`;
}
export async function assertLabScope(tenantId: string, venueId: string) {
  if (
    !(await labVenues()).some(
      (v) => v.tenant_id === tenantId && v.venue_id === venueId,
    )
  )
    throw new Error("LAB_SCOPE_FORBIDDEN");
}
export const ownerEmail = (profile: string) =>
  `owner.${profile.toLowerCase()}@operations-lab.invalid`;
export const signupKey = (profile: string) =>
  `operations-lab-v1-signup-${profile}`;

// Mounted ONLY by the separate loopback lab server. Ordinary app has no lab routes.
export function installLabGuard(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    try {
      await assertLabInstance();
      const path = request.routeOptions.url ?? "";
      // Separate local operator authentication is enforced by its encapsulated hook.
      if (path.startsWith("/lab/operator/")) return;
      const body = request.body as Record<string, unknown> | undefined;
      const params = request.params as Record<string, string>;
      // Fail closed for provider-facing configuration/import/AI/push/demo routes.
      if (
        /\/demo\/|\/domain|\/assets|\/media|\/creative|\/import|\/launch\/|\/push|\/plan-change|\/legal-holds|\/customers/.test(
          path,
        ) ||
        /\/ai|\/discover|\/sources/.test(path) ||
        (path.includes("/diagnostics") &&
          !path.startsWith("/v1/staff/hardware/simulator/"))
      )
        throw new Error("LAB_ROUTE_FORBIDDEN");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        !new Set([
          "/v1/public/trials",
          "/v1/auth/login",
          "/v1/auth/logout",
          "/v1/auth/password",
          "/v1/auth/invitations/:token/accept",
          "/v1/workspace/billing/profile",
          "/v1/workspace/website",
          "/v1/workspace/website/publish",
          "/v1/staff/team/invitations",
          "/v1/staff/team/members/:membershipId",
          "/v1/staff/team/assignments",
          "/v1/staff/setup/venue",
          "/v1/staff/setup/areas",
          "/v1/staff/setup/areas/:areaId",
          "/v1/staff/setup/tables",
          "/v1/staff/setup/tables/:tableId",
          "/v1/staff/setup/tables/:tableId/rotate-qr",
          "/v1/staff/menu/categories",
          "/v1/staff/menu/categories/:categoryId",
          "/v1/staff/menu/products",
          "/v1/staff/menu/products/:productId",
          "/v1/staff/menu/products/:productId/configuration",
          "/v1/staff/online-order-settings",
          "/v1/staff/workforce/profiles/:membershipId",
          "/v1/staff/workforce/profiles/:membershipId/contracts",
          "/v1/staff/workforce/attendance/punch",
          "/v1/staff/shift/start",
          "/v1/staff/shift/end",
          "/v1/staff/register/open",
          "/v1/staff/register/:id/close",
          "/v1/staff/pos/tax",
          "/v1/staff/orders",
          "/v1/staff/orders/:orderId/status",
          "/v1/staff/production-tickets/:ticketId/status",
          "/v1/staff/pos/orders/:id/complete",
          "/v1/staff/pos/orders/:id/payment",
          "/v1/staff/online-orders/:orderId/status",
          "/v1/staff/online-production-tickets/:ticketId/status",
          "/v1/staff/online-orders/:id/payment",
          "/v1/staff/table-sessions/:sessionId/payments",
          "/v1/staff/table-sessions/:sessionId/close",
          "/v1/staff/reservations/:reservationId",
          "/v1/public/online-orders/:publicSlug",
          "/v1/public/online-orders/:publicSlug/quote",
          "/v1/public/reservations/:publicSlug",
          "/v1/public/tables/:qrToken/sessions",
          "/v1/public/sessions/:sessionId/orders",
          "/v1/public/sessions/:sessionId/requests",
          "/v1/staff/hardware/pair",
          "/v1/staff/hardware/devices/:id",
          "/v1/staff/hardware/jobs",
          "/v1/staff/hardware/jobs/:id/execute",
          "/v1/staff/hardware/command",
          "/v1/staff/hardware/simulator/:id/diagnostics",
        ]).has(path)
      )
        throw new Error("LAB_ROUTE_FORBIDDEN");
      if (
        path === "/health" ||
        path === "/ready" ||
        path === "/lab/identity" ||
        request.method === "OPTIONS"
      )
        return;
      if (path === "/v1/public/trials") {
        const profile = body?.countryCode;
        if (
          !["DE", "AL"].includes(String(profile)) ||
          body?.email !== ownerEmail(String(profile)) ||
          body?.requestKey !== signupKey(String(profile)) ||
          body?.organizationName !== `Operations Lab ${profile} TEST ONLY` ||
          body?.venueName !== `Operations Lab ${profile} TEST ONLY` ||
          body?.profileId !== (profile === "DE" ? "PIZZERIA" : "RESTAURANT") ||
          body?.currency !== (profile === "DE" ? "EUR" : "ALL") ||
          body?.timezone !==
            (profile === "DE" ? "Europe/Berlin" : "Europe/Tirane") ||
          body?.premiumTemplate ||
          body?.plan !== "RESTAURANT_PRO"
        )
          throw new Error("LAB_SYNTHETIC_SIGNUP_REQUIRED");
        return;
      }
      const venues = await labVenues();
      if (path === "/v1/auth/login") {
        const users = await prisma.user.findMany({
          where: {
            email: String(body?.email),
            ...(typeof body?.tenantSlug === "string"
              ? { tenant: { slug: body.tenantSlug } }
              : {}),
          },
        });
        if (
          !users.length ||
          users.some(
            (user) =>
              !venues.some((v) => v.tenant_id === user.tenantId) ||
              !user.email.endsWith("@operations-lab.invalid"),
          )
        )
          throw new Error("LAB_SCOPE_FORBIDDEN");
        return;
      }
      if (path === "/v1/auth/invitations/:token/accept") {
        const invitation = await prisma.staffInvitation.findUnique({
          where: { tokenHash: hash(params.token!) },
        });
        if (
          !invitation ||
          !venues.some(
            (v) =>
              v.tenant_id === invitation.tenantId &&
              v.venue_id === invitation.venueId,
          ) ||
          !invitation.email.endsWith("@operations-lab.invalid")
        )
          throw new Error("LAB_SCOPE_FORBIDDEN");
        return;
      }
      if (path.startsWith("/v1/public/")) {
        let scope: { tenantId: string; venueId: string } | null = null;
        if (params.publicSlug)
          scope = await prisma.venueWebsite.findUnique({
            where: { publicSlug: params.publicSlug },
            select: { tenantId: true, venueId: true },
          });
        if (params.qrToken)
          scope = await prisma.diningTable.findUnique({
            where: { qrTokenHash: hash(params.qrToken) },
            select: { tenantId: true, venueId: true },
          });
        if (params.sessionId)
          scope = await prisma.tableSession.findUnique({
            where: { id: params.sessionId },
            select: { tenantId: true, venueId: true },
          });
        if (params.trackingToken)
          scope = await prisma.onlineOrder.findUnique({
            where: { trackingTokenHash: hash(params.trackingToken) },
            select: { tenantId: true, venueId: true },
          });
        if (!scope) throw new Error("LAB_SCOPE_FORBIDDEN");
        await assertLabScope(scope.tenantId, scope.venueId);
        if (body?.contact) {
          const contact = body.contact as Record<string, unknown>;
          if (
            !String(contact.email).endsWith("@operations-lab.invalid") ||
            !["TEST-ONLY-0000", "0000000000"].includes(String(contact.phone)) ||
            !String(contact.name).startsWith("TEST ONLY")
          )
            throw new Error("LAB_CONTACT_FORBIDDEN");
        }
        if (
          path.includes("/reservations") &&
          request.method !== "GET" &&
          (!String(body?.email).endsWith("@operations-lab.invalid") ||
            body?.phone !== "TEST-ONLY-0000" ||
            !String(body?.guestName).startsWith("TEST ONLY"))
        )
          throw new Error("LAB_CONTACT_FORBIDDEN");
        return;
      }
      if (!/^\/v1\/(staff|workspace|auth)\//.test(path))
        throw new Error("LAB_ROUTE_FORBIDDEN");
      // Cookies are parsed by the canonical app plugin before this hook runs.
      const token =
        request.headers.authorization?.replace(/^Bearer /, "") ??
        request.cookies.flowgastronomie_staff_session;
      const staff = token
        ? await staffAuthRepository.authenticate(token)
        : null;
      if (!staff) return reply.code(401).send({ code: "LAB_AUTH_REQUIRED" });
      await assertLabScope(staff.tenantId, staff.venueId);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        const leases = await prisma.$queryRaw<
          Array<{ event_id: string; actor_session_id: string | null }>
        >`SELECT event_id,actor_session_id FROM operations_lab.action
          WHERE tenant_id=${staff.tenantId} AND venue_id=${staff.venueId} AND actor=${staff.membershipId} AND status='LEASED' AND lease_until>now()`;
        if (
          leases.some(
            (lease) =>
              lease.actor_session_id !== staff.sessionId ||
              request.headers["x-operations-lab-action"] !== lease.event_id,
          )
        )
          return reply.code(409).send({ code: "LAB_ACTOR_BUSY" });
      }
      if (
        body?.email &&
        !String(body.email).endsWith("@operations-lab.invalid")
      )
        throw new Error("LAB_CONTACT_FORBIDDEN");
      if (
        body?.billingEmail &&
        !String(body.billingEmail).endsWith("@operations-lab.invalid")
      )
        throw new Error("LAB_CONTACT_FORBIDDEN");
      if (
        path === "/v1/workspace/website" &&
        request.method === "PUT" &&
        (body?.phone ||
          body?.instagramUrl ||
          body?.facebookUrl ||
          body?.logoUrl ||
          body?.heroImageUrl ||
          (body?.contactEmail &&
            !String(body.contactEmail).endsWith("@operations-lab.invalid")))
      )
        throw new Error("LAB_CONTACT_FORBIDDEN");
    } catch (error) {
      const db = error as { code?: string; meta?: { code?: string } };
      if (
        ["P1001", "P1002", "P1017", "P2024"].includes(db.code ?? "") ||
        /^08|^57P0/.test(db.meta?.code ?? "")
      )
        return reply.code(503).send({ code: "LAB_DATABASE_UNAVAILABLE" });
      return reply.code(403).send({ code: "LAB_GUARD_REJECTED" });
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (
      request.routeOptions.url === "/v1/public/trials" &&
      reply.statusCode === 201 &&
      typeof payload === "string"
    ) {
      const result = JSON.parse(payload) as {
        staff: { tenantId: string; venueId: string; email: string };
      };
      const profile = (request.body as { countryCode: string }).countryCode;
      await assertLabInstance();
      await prisma.$executeRaw`INSERT INTO operations_lab.venue(profile, tenant_id, venue_id, owner_email)
        VALUES (${profile}, ${result.staff.tenantId}, ${result.staff.venueId}, ${result.staff.email})
        ON CONFLICT (profile) DO NOTHING`;
      await assertLabScope(result.staff.tenantId, result.staff.venueId);
    }
    return payload;
  });
}

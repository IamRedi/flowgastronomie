import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { imageProviders } from "@flowgastronomie/domain";
import {
  platformImageUsage,
  tenantImageUsage,
  setTenantImageLimit,
  setImageEmergencyDisabled,
  type StaffIdentity,
} from "@flowgastronomie/database";

export function registerPlatformAiUsageRoutes(
  app: FastifyInstance,
  requireStaff: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<StaffIdentity | null>,
) {
  async function operator(request: FastifyRequest, reply: FastifyReply) {
    const staff = await requireStaff(request, reply);
    if (!staff) return null;
    const tenantId = process.env.PLATFORM_ADMIN_TENANT_ID;
    const userId = process.env.PLATFORM_ADMIN_USER_ID;
    if (
      !tenantId ||
      !userId ||
      staff.tenantId !== tenantId ||
      staff.userId !== userId ||
      staff.role !== "OWNER"
    ) {
      await reply.code(403).send({ code: "FORBIDDEN" });
      return null;
    }
    if (request.method !== "GET") {
      const expectedOrigin = process.env.WEB_ORIGIN;
      if (!expectedOrigin || request.headers.origin !== expectedOrigin) {
        await reply.code(403).send({ code: "ORIGIN_REQUIRED" });
        return null;
      }
    }
    reply.header("Cache-Control", "private, no-store");
    return staff;
  }

  function parse<T>(
    schema: z.ZodType<T>,
    value: unknown,
    reply: FastifyReply,
  ): T | null {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    void reply.code(400).send({ code: "INVALID_INPUT" });
    return null;
  }

  app.get("/v1/platform/ai-usage", async (request, reply) => {
    if (!(await operator(request, reply))) return;
    return platformImageUsage();
  });
  app.get("/v1/platform/ai-usage/:tenantId", async (request, reply) => {
    if (!(await operator(request, reply))) return;
    const params = parse(
      z.object({ tenantId: z.string().min(1).max(100) }),
      request.params,
      reply,
    );
    if (!params) return;
    const { tenantId } = params;
    return tenantImageUsage(tenantId);
  });
  app.put(
    "/v1/platform/ai-usage/:tenantId/:provider",
    async (request, reply) => {
      const staff = await operator(request, reply);
      if (!staff) return;
      const params = parse(
        z.object({
          tenantId: z.string().min(1).max(100),
          provider: z.enum(imageProviders),
        }),
        request.params,
        reply,
      );
      if (!params) return;
      const body = parse(
        z.strictObject({
          monthlyLimit: z.number().int().min(0).max(1_000_000),
          enabled: z.boolean(),
        }),
        request.body,
        reply,
      );
      if (!body) return;
      const { tenantId, provider } = params;
      const { monthlyLimit, enabled } = body;
      await setTenantImageLimit(
        tenantId,
        provider,
        monthlyLimit,
        enabled,
        staff.userId,
      );
      return tenantImageUsage(tenantId);
    },
  );
  app.post("/v1/platform/ai-usage/emergency", async (request, reply) => {
    const staff = await operator(request, reply);
    if (!staff) return;
    const body = parse(
      z.strictObject({ disabled: z.boolean() }),
      request.body,
      reply,
    );
    if (!body) return;
    const { disabled } = body;
    await setImageEmergencyDisabled(disabled, staff.userId);
    return { emergencyDisabled: disabled };
  });
}

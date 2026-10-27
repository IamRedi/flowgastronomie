import {
  PLATFORM_LOCALES,
  staffPasswordResetSchema,
} from "@flowgastronomie/domain";
import type { StaffAuthRepository } from "@flowgastronomie/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { unauthenticatedRateLimits } from "./guest-rate-limit.js";
import type { TransactionalNotification } from "./transactional-notifications.js";

export function registerStaffPasswordResetRoutes(
  app: FastifyInstance,
  repository: StaffAuthRepository,
  notify: (notification: TransactionalNotification) => Promise<void>,
) {
  const config = {
    config: { rateLimit: unauthenticatedRateLimits.passwordReset },
  };
  app.post(
    "/v1/auth/password-reset/request",
    config,
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const input = z
        .strictObject({
          email: z.email().max(254),
          locale: z.enum(PLATFORM_LOCALES),
        })
        .safeParse(request.body);
      if (!input.success)
        return reply.code(400).send({ code: "INVALID_REQUEST" });
      // Equal status/body for missing, inactive and known accounts. No token or identity in responses.
      const messages =
        (await repository.requestPasswordReset?.(input.data.email)) ?? [];
      for (const message of messages)
        await notify({
          kind: "STAFF_PASSWORD_RESET",
          recipient: message.recipient,
          resetToken: message.token,
          locale: input.data.locale,
        });
      return reply.code(202).send({ accepted: true });
    },
  );
  app.post(
    "/v1/auth/password-reset/complete",
    config,
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const input = staffPasswordResetSchema.safeParse(request.body);
      if (!input.success)
        return reply.code(400).send({ code: "INVALID_RESET" });
      if (!(await repository.resetPassword?.(input.data)))
        return reply.code(400).send({ code: "INVALID_RESET" });
      reply.clearCookie("flowgastronomie_staff_session", { path: "/" });
      reply.clearCookie("flowgastronomie_login_choice", { path: "/v1/auth" });
      return { completed: true };
    },
  );
}

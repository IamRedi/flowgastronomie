import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  assertStaffPermission,
  SetupImportError,
  StaffPermissionDeniedError,
  type StaffPermission,
} from "@flowgastronomie/domain";
import {
  SubscriptionAccessDeniedError,
  type StaffIdentity,
} from "@flowgastronomie/database";
export type SetupAuthenticator = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<StaffIdentity | null>;
export function setupRouteAction(
  requireStaff: SetupAuthenticator,
  permission: StaffPermission,
) {
  return (
      run: (
        staff: StaffIdentity,
        request: FastifyRequest,
        reply: FastifyReply,
      ) => Promise<unknown>,
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      reply.header("Cache-Control", "private, no-store");
      try {
        assertStaffPermission(staff.role, permission);
        return await run(staff, request, reply);
      } catch (error) {
        if (
          error instanceof StaffPermissionDeniedError ||
          error instanceof SubscriptionAccessDeniedError
        )
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof z.ZodError)
          return reply.code(400).send({
            code: "INVALID_INPUT",
            message: "Check the highlighted menu fields before saving.",
          });
        if (error instanceof SetupImportError)
          return reply
            .code(
              error.code === "NOT_FOUND"
                ? 404
                : error.code === "CONFLICT"
                  ? 409
                  : error.code === "UNAVAILABLE"
                    ? 503
                    : error.code === "LIMIT"
                      ? 429
                      : 400,
            )
            .send({ code: error.code, message: error.message });
        request.log.error({ event: "setup_import_failed" });
        return reply.code(500).send({
          code: "SETUP_IMPORT_FAILED",
          message:
            "The operation could not be completed. Your saved work remains available.",
        });
      }
    };
}

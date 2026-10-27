import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  pilotOperationsRepository,
  ActiveShiftRequiredError,
  ProductionTicketConflictError,
  ProductionTicketNotFoundError,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  pilotOrderViews,
  StaffPermissionDeniedError,
} from "@flowgastronomie/domain";
export function registerPilotOperationsRoutes(
  app: FastifyInstance,
  requireStaff: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<StaffIdentity | null>,
) {
  const action =
    (
      run: (staff: StaffIdentity, request: FastifyRequest) => Promise<unknown>,
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await run(staff, request);
      } catch (error) {
        if (error instanceof z.ZodError)
          return reply.code(400).send({ code: "INVALID_INPUT" });
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "PERMISSION_DENIED" });
        if (error instanceof ProductionTicketNotFoundError)
          return reply.code(404).send({ code: "NOT_FOUND" });
        if (
          error instanceof ProductionTicketConflictError ||
          error instanceof ActiveShiftRequiredError
        )
          return reply
            .code(409)
            .send({ code: "ORDER_CONFLICT", message: error.message });
        throw error;
      }
    };
  app.get(
    "/v1/staff/pilot/orders",
    action((staff, request) =>
      pilotOperationsRepository.orders(
        staff,
        z
          .object({
            view: z.enum(pilotOrderViews).optional(),
            date: z.iso.date().optional(),
          })
          .parse(request.query),
      ),
    ),
  );
  app.get(
    "/v1/staff/production/:station",
    action((staff, request) =>
      pilotOperationsRepository.production(
        staff,
        z.object({ station: z.enum(["KITCHEN", "BAR"]) }).parse(request.params)
          .station,
      ),
    ),
  );
  app.get(
    "/v1/staff/pos/orders",
    action((staff) => pilotOperationsRepository.counter(staff)),
  );
  app.post(
    "/v1/staff/pos/orders/:id/complete",
    action((staff, request) =>
      pilotOperationsRepository.complete(
        staff,
        z.object({ id: z.string().min(1).max(100) }).parse(request.params).id,
      ),
    ),
  );
}

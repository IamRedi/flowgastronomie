import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ActiveShiftRequiredError,
  type CounterSaleRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  CounterSaleError,
  StaffPermissionDeniedError,
} from "@flowgastronomie/domain";

const minor = z.number().int().min(0).max(2_147_483_647);
const rate = z.number().int().min(0).max(10_000);
export function registerCounterSaleRoutes(
  app: FastifyInstance,
  requireStaff: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<StaffIdentity | null>,
  repository: CounterSaleRepository,
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
          return reply.code(400).send({
            code: "INVALID_COUNTER_INPUT",
            message: z.prettifyError(error),
          });
        if (error instanceof StaffPermissionDeniedError)
          return reply
            .code(403)
            .send({ code: "PERMISSION_DENIED", message: error.message });
        if (error instanceof ActiveShiftRequiredError)
          return reply
            .code(409)
            .send({ code: "ACTIVE_SHIFT_REQUIRED", message: error.message });
        if (error instanceof CounterSaleError)
          return reply
            .code(error.code === "NOT_FOUND" ? 404 : 409)
            .send({ code: error.code, message: error.message });
        throw error;
      }
    };
  app.get(
    "/v1/staff/register",
    action((staff) => repository.register(staff)),
  );
  app.post(
    "/v1/staff/register/open",
    action((staff, request) => {
      const body = z
        .object({
          openingCashMinor: minor,
          openingNote: z.string().trim().max(500).optional(),
        })
        .strict()
        .parse(request.body);
      return repository.open(staff, body.openingCashMinor, body.openingNote);
    }),
  );
  app.post(
    "/v1/staff/register/:id/close",
    action((staff, request) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const body = z
        .object({
          countedCashMinor: minor,
          closingNote: z.string().trim().max(500).optional(),
        })
        .strict()
        .parse(request.body);
      return repository.close(
        staff,
        id,
        body.countedCashMinor,
        body.closingNote,
      );
    }),
  );
  app.get(
    "/v1/staff/pos/tax",
    action((staff) => repository.taxConfiguration(staff)),
  );
  app.put(
    "/v1/staff/pos/tax",
    action((staff, request) =>
      repository.configureTax(
        staff,
        z
          .object({
            code: z.string().trim().min(1).max(50),
            rateBasisPoints: rate,
            dineInRateBasisPoints: rate.nullable().optional(),
            takeawayRateBasisPoints: rate.nullable().optional(),
            productIds: z.array(z.string().min(1)).max(500),
          })
          .strict()
          .parse(request.body),
      ),
    ),
  );
  app.post(
    "/v1/staff/pos/orders/:id/payment",
    action((staff, request) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const key = z
        .string()
        .min(8)
        .max(100)
        .parse(request.headers["idempotency-key"]);
      const body = z
        .discriminatedUnion("method", [
          z
            .object({ method: z.literal("CASH"), receivedMinor: minor })
            .strict(),
          z
            .object({
              method: z.literal("CARD_AT_COUNTER"),
              terminalConfirmed: z.literal(true),
            })
            .strict(),
        ])
        .parse(request.body);
      return repository.pay(staff, {
        orderId: id,
        idempotencyKey: key,
        ...body,
      });
    }),
  );
  app.post(
    "/v1/staff/online-orders/:id/payment",
    action((staff, request) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
      const key = z
        .string()
        .min(8)
        .max(100)
        .parse(request.headers["idempotency-key"]);
      const body = z
        .discriminatedUnion("method", [
          z
            .object({ method: z.literal("CASH"), receivedMinor: minor })
            .strict(),
          z
            .object({
              method: z.literal("CARD_AT_COUNTER"),
              terminalConfirmed: z.literal(true),
            })
            .strict(),
        ])
        .parse(request.body);
      return repository.payOnline(staff, {
        onlineOrderId: id,
        idempotencyKey: key,
        ...body,
      });
    }),
  );
  app.get(
    "/v1/staff/receipts/:id",
    action((staff, request) =>
      repository.receipt(
        staff,
        z.object({ id: z.string().min(1) }).parse(request.params).id,
      ),
    ),
  );
}

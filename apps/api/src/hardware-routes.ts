import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ActiveShiftRequiredError,
  hardwareRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  hasStaffPermission,
  HardwareError,
  StaffPermissionDeniedError,
} from "@flowgastronomie/domain";
import { HardwareService } from "./hardware-service.js";
const id = z.string().min(1).max(100);
const key = z.string().min(8).max(120);
const envelope = z
  .object({
    version: z.literal(1),
    bodyBase64: z.string().max(1_000_000),
    signatureBase64: z.string().max(2048),
  })
  .strict();
export function registerHardwareRoutes(
  app: FastifyInstance,
  requireStaff: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<StaffIdentity | null>,
  service = new HardwareService(),
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
        if (error instanceof z.ZodError || error instanceof SyntaxError)
          return reply.code(400).send({
            code: "INVALID_HARDWARE_INPUT",
            message: "Invalid hardware request",
          });
        if (error instanceof StaffPermissionDeniedError)
          return reply
            .code(403)
            .send({ code: "PERMISSION_DENIED", message: error.message });
        if (error instanceof ActiveShiftRequiredError)
          return reply
            .code(409)
            .send({ code: "ACTIVE_SHIFT_REQUIRED", message: error.message });
        if (error instanceof HardwareError)
          return reply
            .code(error.code === "NOT_FOUND" ? 404 : 409)
            .send({ code: error.code, message: error.message });
        throw error;
      }
    };
  app.get(
    "/v1/staff/hardware/key",
    action(async () => service.publicSigningKey()),
  );
  app.post(
    "/v1/staff/hardware/jobs/:id/uncertain",
    action((staff, request) =>
      hardwareRepository.uncertain(
        staff,
        z.object({ id }).parse(request.params).id,
        z.object({ commandId: z.string().uuid() }).strict().parse(request.body)
          .commandId,
      ),
    ),
  );
  app.get(
    "/v1/staff/hardware/devices",
    action(async (staff) => ({
      devices: await hardwareRepository.list(staff),
      simulatorEnabled: service.simulatorEnabled,
      canManage: hasStaffPermission(staff.role, "HARDWARE_MANAGE"),
      canDrawer: hasStaffPermission(staff.role, "DRAWER_MANUAL"),
    })),
  );
  app.post(
    "/v1/staff/hardware/pair",
    action(async (staff, request) => {
      const body = z
        .discriminatedUnion("mode", [
          z
            .object({
              mode: z.literal("SIMULATOR"),
              displayName: z.string().trim().min(1).max(80),
            })
            .strict(),
          z
            .object({
              mode: z.literal("ANDROID"),
              displayName: z.string().trim().min(1).max(80),
              proof: envelope,
            })
            .strict(),
        ])
        .parse(request.body);
      return body.mode === "SIMULATOR"
        ? service.pairSimulator(staff, body.displayName)
        : service.pairAndroid(staff, body.displayName, body.proof);
    }),
  );
  app.put(
    "/v1/staff/hardware/devices/:id",
    action((staff, request) =>
      hardwareRepository.configure(
        staff,
        z.object({ id }).parse(request.params).id,
        z
          .object({
            autoPrint: z.boolean(),
            autoDrawer: z.boolean(),
            active: z.boolean(),
          })
          .strict()
          .parse(request.body),
      ),
    ),
  );
  app.get(
    "/v1/staff/hardware/receipts/:id/jobs",
    action((staff, request) =>
      hardwareRepository.jobs(staff, z.object({ id }).parse(request.params).id),
    ),
  );
  app.post(
    "/v1/staff/hardware/jobs",
    action((staff, request) =>
      hardwareRepository.queue(
        staff,
        z
          .object({ receiptId: id, deviceId: id, key })
          .strict()
          .parse(request.body),
      ),
    ),
  );
  app.post(
    "/v1/staff/hardware/jobs/:id/execute",
    action((staff, request) => {
      const body = z
        .object({
          retry: z.boolean(),
          confirmPossibleDuplicate: z.boolean().default(false),
        })
        .strict()
        .parse(request.body);
      return service.executePrint(
        staff,
        z.object({ id }).parse(request.params).id,
        body.retry,
        body.confirmPossibleDuplicate,
      );
    }),
  );
  app.post(
    "/v1/staff/hardware/results",
    action((staff, request) =>
      service.completeNative(staff, envelope.parse(request.body)),
    ),
  );
  app.post(
    "/v1/staff/hardware/command",
    action((staff, request) =>
      service.executeCommand(
        staff,
        z
          .discriminatedUnion("kind", [
            z
              .object({ deviceId: id, kind: z.literal("printTest"), key })
              .strict(),
            z
              .object({
                deviceId: id,
                kind: z.literal("openDrawer"),
                receiptId: id.optional(),
                reason: z.string().trim().min(1).max(200).optional(),
                key,
              })
              .strict(),
          ])
          .parse(request.body),
      ),
    ),
  );
  app.post(
    "/v1/staff/hardware/simulator/:id/diagnostics",
    action((staff, request) =>
      service.diagnostics(
        staff,
        z.object({ id }).parse(request.params).id,
        z
          .object({
            nextPrintFailure: z
              .enum(["PAPER_OUT", "UNKNOWN_RESULT"])
              .nullable(),
          })
          .strict()
          .parse(request.body).nextPrintFailure,
      ),
    ),
  );
}

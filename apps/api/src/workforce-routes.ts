import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  StaffPermissionDeniedError,
  WorkforceError,
  workforceMoveSchema,
  workforceDateSchema,
  workforceStationSchema,
} from "@flowgastronomie/domain";
import {
  createWorkforceRepository,
  workforceDocumentRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import type { SetupAuthenticator } from "./setup-route-action.js";
export function registerWorkforceRoutes(
  app: FastifyInstance,
  authenticate: SetupAuthenticator,
  clock: () => Date = () => new Date(),
) {
  const workforceRepository = createWorkforceRepository(clock);
  const action =
    (
      fn: (
        staff: StaffIdentity,
        request: FastifyRequest,
        reply: FastifyReply,
      ) => Promise<unknown>,
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const staff = await authenticate(request, reply);
      if (!staff) return;
      reply.header("Cache-Control", "private, no-store");
      try {
        return await fn(staff, request, reply);
      } catch (e) {
        if (e instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (e instanceof z.ZodError)
          return reply
            .code(400)
            .send({ code: "INVALID", message: "Check the form values." });
        if (e instanceof WorkforceError)
          return reply
            .code(
              e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400,
            )
            .send({ code: e.code, message: e.message });
        request.log.error({ event: "workforce_failure" });
        return reply.code(500).send({
          code: "UNAVAILABLE",
          message: "Workforce action failed. Your saved data is preserved.",
        });
      }
    };
  app.get(
    "/v1/staff/workforce",
    action(async (s, r) => {
      const q = z
        .object({ from: workforceDateSchema, to: workforceDateSchema })
        .parse(r.query);
      return workforceRepository.workspace(s, q.from, q.to);
    }),
  );
  app.get(
    "/v1/staff/workforce/profiles/:membershipId",
    action(async (s, r) =>
      workforceRepository.profile(
        s,
        z.object({ membershipId: z.string().min(1).max(128) }).parse(r.params)
          .membershipId,
      ),
    ),
  );
  app.put(
    "/v1/staff/workforce/profiles/:membershipId",
    action(async (s, r) =>
      workforceRepository.saveProfile(
        s,
        z.object({ membershipId: z.string().min(1).max(128) }).parse(r.params)
          .membershipId,
        r.body,
      ),
    ),
  );
  app.post(
    "/v1/staff/workforce/profiles/:membershipId/contracts",
    action(async (s, r) =>
      workforceRepository.addContract(
        s,
        z.object({ membershipId: z.string().min(1).max(128) }).parse(r.params)
          .membershipId,
        r.body,
      ),
    ),
  );
  app.put(
    "/v1/staff/workforce/schedule",
    action(async (s, r) => workforceRepository.saveSchedule(s, r.body)),
  );
  app.post(
    "/v1/staff/workforce/move",
    action(async (s, r) => {
      const b = workforceMoveSchema.parse(r.body);
      return workforceRepository.move(
        s,
        b.sourceWeek,
        b.sourceVersion,
        b.targetVersion,
        b.assignment,
      );
    }),
  );
  app.post(
    "/v1/staff/workforce/copy-week",
    action(async (s, r) => {
      const b = z
        .object({
          from: workforceDateSchema,
          to: workforceDateSchema,
          expectedVersion: z.number().int().min(0),
        })
        .strict()
        .parse(r.body);
      return workforceRepository.copyWeek(s, b.from, b.to, b.expectedVersion);
    }),
  );
  app.post(
    "/v1/staff/workforce/templates",
    action(async (s, r) => workforceRepository.addTemplate(s, r.body)),
  );
  app.put(
    "/v1/staff/workforce/stations",
    action(async (s, r) => {
      const b = z
        .object({
          expectedVersion: z.number().int().min(0),
          stations: z.array(workforceStationSchema).min(1).max(20),
        })
        .strict()
        .parse(r.body);
      await workforceRepository.configure(s, b.expectedVersion, b.stations);
      return { saved: true };
    }),
  );
  app.post(
    "/v1/staff/workforce/profiles/:membershipId/documents",
    { bodyLimit: 6 * 1024 * 1024 },
    action(async (s, r) => {
      const b = z
        .object({
          expectedVersion: z.number().int().min(0),
          title: z.string().trim().min(1).max(120),
          kind: z.enum(["CERTIFICATION", "WORK_DOCUMENT"]),
          expiresOn: workforceDateSchema.nullable(),
          filename: z.string().min(1).max(120),
          base64: z.string().min(8).max(5600000),
        })
        .strict()
        .parse(r.body);
      return workforceDocumentRepository.add(
        s,
        z.object({ membershipId: z.string().min(1).max(128) }).parse(r.params)
          .membershipId,
        b,
      );
    }),
  );
  app.get(
    "/v1/staff/workforce/documents/:id",
    action(async (s, r, p) => {
      const d = await workforceDocumentRepository.read(
        s,
        z.object({ id: z.string().min(1).max(128) }).parse(r.params).id,
      );
      return p
        .header("Content-Type", "application/octet-stream")
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
        )
        .send(d.bytes);
    }),
  );
}

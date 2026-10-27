import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  StaffPermissionDeniedError,
  WorkforceError,
  workforceDateSchema,
} from "@flowgastronomie/domain";
import {
  createWorkforceOperationsRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import type { SetupAuthenticator } from "./setup-route-action.js";
export function registerWorkforceOperationsRoutes(
  app: FastifyInstance,
  authenticate: SetupAuthenticator,
  clock?: () => Date,
) {
  const repository = createWorkforceOperationsRepository(clock);
  const action =
    (
      fn: (
        s: StaffIdentity,
        r: FastifyRequest,
        p: FastifyReply,
      ) => Promise<unknown>,
    ) =>
    async (r: FastifyRequest, p: FastifyReply) => {
      const s = await authenticate(r, p);
      if (!s) return;
      p.header("Cache-Control", "private, no-store");
      try {
        return await fn(s, r, p);
      } catch (e) {
        if (e instanceof StaffPermissionDeniedError)
          return p.code(403).send({ code: "FORBIDDEN" });
        if (e instanceof z.ZodError)
          return p
            .code(400)
            .send({ code: "INVALID", message: "Check form values." });
        if (e instanceof WorkforceError)
          return p
            .code(
              e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400,
            )
            .send({ code: e.code, message: e.message, detail: e.detail });
        r.log.error({ event: "workforce_operations_failure" });
        return p.code(500).send({
          code: "UNAVAILABLE",
          message: "Action failed. Saved evidence is preserved.",
        });
      }
    };
  const id = (r: FastifyRequest) =>
    z.object({ id: z.string().min(1).max(128) }).parse(r.params).id;
  app.get(
    "/v1/staff/workforce/operations",
    action(async (s, r) => {
      const q = z
        .object({ from: workforceDateSchema, to: workforceDateSchema })
        .strict()
        .parse(r.query);
      return repository.workspace(s, q.from, q.to);
    }),
  );
  app.get(
    "/v1/staff/workforce/exchange-options",
    action(async (s, r) => {
      const q = z
        .object({
          assignmentId: z.string().min(1).max(128),
          targetMembershipId: z.string().min(1).max(128).optional(),
        })
        .strict()
        .parse(r.query);
      return repository.exchangeOptions(
        s,
        q.assignmentId,
        q.targetMembershipId,
      );
    }),
  );
  app.get(
    "/v1/staff/workforce/approved-hours",
    action(async (s, r) => {
      const q = z
        .object({ from: workforceDateSchema, to: workforceDateSchema })
        .strict()
        .parse(r.query);
      return repository.approvedHours(s, q.from, q.to);
    }),
  );
  app.post(
    "/v1/staff/workforce/attendance/punch",
    action(async (s, r) => repository.punch(s, r.body)),
  );
  app.post(
    "/v1/staff/workforce/attendance/:id/recovery-request",
    action(async (s, r) => repository.recoveryRequest(s, id(r), r.body)),
  );
  app.post(
    "/v1/staff/workforce/corrections",
    action(async (s, r) => repository.requestCorrection(s, r.body)),
  );
  app.post(
    "/v1/staff/workforce/leave",
    action(async (s, r) => repository.requestLeave(s, r.body)),
  );
  app.post(
    "/v1/staff/workforce/shift-requests",
    action(async (s, r) => repository.requestShift(s, r.body)),
  );
  app.post(
    "/v1/staff/workforce/requests/:id/decision",
    action(async (s, r) => repository.decide(s, id(r), r.body)),
  );
  app.post(
    "/v1/staff/workforce/attendance/:id/approval",
    action(async (s, r) => {
      const b = z
        .object({
          expectedVersion: z.number().int().min(0),
          reason: z.string().trim().min(3).max(300),
          reviewConfirmed: z.boolean(),
          warningsAcknowledged: z.boolean(),
        })
        .strict()
        .parse(r.body);
      return repository.approveAttendance(
        s,
        id(r),
        b.expectedVersion,
        b.reason,
        b.reviewConfirmed,
        b.warningsAcknowledged,
      );
    }),
  );
  app.get(
    "/v1/staff/workforce/leave-allowance/:id",
    action(async (s, r) => {
      const q = z
        .object({ year: z.coerce.number().int().min(2000).max(2200) })
        .strict()
        .parse(r.query);
      return repository.leaveBalance(s, id(r), q.year);
    }),
  );
  app.post(
    "/v1/staff/workforce/leave-allowance",
    action(async (s, r) => repository.grant(s, r.body)),
  );
  app.post(
    "/v1/staff/workforce/policy",
    action(async (s, r) => repository.configure(s, r.body)),
  );
}

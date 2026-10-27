import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  StaffPermissionDeniedError,
  WorkforceError,
  workforceMonthSchema,
} from "@flowgastronomie/domain";
import {
  createWorkforceAccountRepository,
  workforceNotificationRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  workforceMonthlyCsv,
  workforceMonthlyPdf,
} from "./workforce-report.js";
import type { SetupAuthenticator } from "./setup-route-action.js";
export function registerWorkforceAccountRoutes(
  app: FastifyInstance,
  authenticate: SetupAuthenticator,
  clock = () => new Date(),
) {
  const repository = createWorkforceAccountRepository(clock),
    root = "/v1/staff/workforce/";
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
      p.header("X-Content-Type-Options", "nosniff");
      try {
        return await fn(s, r, p);
      } catch (e) {
        if (e instanceof StaffPermissionDeniedError)
          return p.code(403).send({ code: "FORBIDDEN" });
        if (e instanceof z.ZodError)
          return p.code(400).send({
            code: "INVALID",
            message: "Check monthly report or preference values.",
          });
        if (e instanceof WorkforceError)
          return p
            .code(
              e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400,
            )
            .send({ code: e.code, message: e.message, detail: e.detail });
        r.log.error({ event: "workforce_account_failure" });
        return p.code(500).send({
          code: "UNAVAILABLE",
          message:
            "Could not complete the action. Saved evidence is preserved.",
        });
      }
    };
  const id = (r: FastifyRequest) =>
    z
      .object({ id: z.string().min(1).max(128) })
      .strict()
      .parse(r.params).id;
  const query = z
    .object({
      month: workforceMonthSchema,
      membershipId: z.string().min(1).max(128).optional(),
    })
    .strict();
  app.get(
    root + "monthly-account",
    action(async (s, r) => {
      const q = query.parse(r.query);
      return repository.account(s, q.membershipId ?? s.membershipId, q.month);
    }),
  );
  app.post(
    root + "monthly-account/:id/close",
    action(async (s, r) => {
      const q = z
        .object({ month: workforceMonthSchema })
        .strict()
        .parse(r.query);
      return repository.close(s, id(r), q.month, r.body);
    }),
  );
  app.get(
    root + "account-policies",
    action(async (s) => repository.policyVersions(s)),
  );
  app.post(
    root + "account-policies",
    action(async (s, r) => repository.configure(s, r.body)),
  );
  app.get(
    root + "monthly-statistics",
    action(async (s, r) => {
      const q = z
        .object({ month: workforceMonthSchema })
        .strict()
        .parse(r.query);
      return repository.statistics(s, q.month);
    }),
  );
  app.get(
    root + "monthly-account/export",
    action(async (s, r, p) => {
      const q = z
        .object({
          month: workforceMonthSchema,
          membershipId: z.string().min(1).max(128).optional(),
          format: z.enum(["csv", "pdf"]),
          locale: z.enum(["sq", "de", "en", "it"]),
          version: z.enum(["current", "original"]).default("current"),
        })
        .strict()
        .parse(r.query);
      const report = await repository.account(
        s,
        q.membershipId ?? s.membershipId,
        q.month,
      );
      if (q.version === "original" && !report.closing)
        throw new WorkforceError(
          "NOT_FOUND",
          "No closed original statement exists.",
        );
      const bytes =
        q.format === "csv"
          ? Buffer.from(
              workforceMonthlyCsv(report, q.locale, q.version === "original"),
              "utf8",
            )
          : await workforceMonthlyPdf(
              report,
              q.locale,
              q.version === "original",
            );
      await repository.logExport(
        s,
        report.employee.membershipId,
        q.month,
        q.format,
        q.version,
        report.fingerprint,
      );
      p.header(
        "Content-Disposition",
        'attachment; filename="workforce-' +
          q.month +
          "-" +
          report.employee.profileId +
          "." +
          q.format +
          '"',
      );
      return p
        .type(
          q.format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
        )
        .send(bytes);
    }),
  );
  app.get(
    root + "notifications",
    action(async (s, r) => {
      const q = z
        .object({
          locale: z.enum(["sq", "de", "en", "it"]),
          cursor: z.string().min(1).max(128).optional(),
        })
        .strict()
        .parse(r.query);
      return workforceNotificationRepository.inbox(s, q.locale, q.cursor);
    }),
  );
  app.post(
    root + "notifications/:id/read",
    action(async (s, r) => {
      z.object({})
        .strict()
        .parse(r.body ?? {});
      return workforceNotificationRepository.mark(
        s,
        id(r),
        false,
        false,
        clock(),
      );
    }),
  );
  app.post(
    root + "notifications/:id/acknowledgment",
    action(async (s, r) => {
      z.object({ reviewConfirmed: z.literal(true) })
        .strict()
        .parse(r.body);
      return workforceNotificationRepository.mark(
        s,
        id(r),
        true,
        true,
        clock(),
      );
    }),
  );
  app.put(
    root + "notification-preferences",
    action(async (s, r) =>
      workforceNotificationRepository.savePreferences(s, r.body, clock()),
    ),
  );
  app.post(
    root + "push-subscription",
    action(async (s, r) =>
      workforceNotificationRepository.subscribe(s, r.body, clock()),
    ),
  );
  app.get(
    root + "notification-configuration",
    action(async () => ({
      emailProvider: process.env.TRANSACTIONAL_EMAIL_PROVIDER ?? "disabled",
      pushProvider: process.env.WORKFORCE_PUSH_PROVIDER ?? "disabled",
      pushPublicKey:
        process.env.WORKFORCE_PUSH_PROVIDER === "webpush"
          ? (process.env.WORKFORCE_VAPID_PUBLIC_KEY ?? null)
          : null,
    })),
  );
}

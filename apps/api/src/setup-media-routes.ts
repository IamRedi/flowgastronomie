import type { FastifyInstance } from "fastify";
import {
  setupMediaConfirmSchema,
  SetupImportError,
} from "@flowgastronomie/domain";
import { setupMediaRepository } from "@flowgastronomie/database";
import {
  setupRouteAction,
  type SetupAuthenticator,
} from "./setup-route-action.js";

export function registerSetupMediaRoutes(
  app: FastifyInstance,
  requireStaff: SetupAuthenticator,
) {
  const action = setupRouteAction(requireStaff, "VENUE_SETUP_MANAGE");
  const base = "/v1/staff/setup-media";
  for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
    if (!app.hasContentTypeParser(mime))
      app.addContentTypeParser(
        mime,
        { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 },
        (_request, body, done) => done(null, body),
      );
  }
  app.get(
    base,
    action((staff) => setupMediaRepository.get(staff)),
  );
  app.put(
    base,
    action((staff, request) =>
      setupMediaRepository.update(staff, request.body),
    ),
  );
  app.post(
    `${base}/uploads`,
    { bodyLimit: 5 * 1024 * 1024 },
    action((staff, request) => {
      if (!Buffer.isBuffer(request.body))
        throw new SetupImportError("INVALID_INPUT");
      return setupMediaRepository.upload(staff, request.body, request.query);
    }),
  );
  for (const [path, operation] of [
    ["save", "SAVE"],
    ["skip", "SKIP"],
    ["reset", "RESET"],
  ] as const) {
    app.post(
      `${base}/${path}`,
      action((staff, request) => {
        const input = setupMediaConfirmSchema.parse(request.body);
        return setupMediaRepository.finish(
          staff,
          input.expectedVersion,
          operation,
        );
      }),
    );
  }
}

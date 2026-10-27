import type { FastifyInstance } from "fastify";
import { websiteAiEnabled, proposeWebsiteAi } from "./website-ai-service.js";
import {
  SetupImportError,
  websiteImportRequestSchema,
} from "@flowgastronomie/domain";
import { websiteImportProposals } from "@flowgastronomie/database";
import {
  setupRouteAction,
  type SetupAuthenticator,
} from "./setup-route-action.js";
import { proposeWebsiteCopy } from "./website-import-adapter.js";
export function registerWebsiteImportRoutes(
  app: FastifyInstance,
  requireStaff: SetupAuthenticator,
  propose = proposeWebsiteCopy,
) {
  const action = setupRouteAction(requireStaff, "WEBSITE_MANAGE");
  app.get(
    "/v1/staff/website-ai/capabilities",
    action(async (staff) => {
      await websiteImportProposals.authorize(staff);
      return { enabled: websiteAiEnabled() };
    }),
  );
  app.post(
    "/v1/staff/website-ai/propose",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    action(async (staff, request) => {
      if (!websiteAiEnabled())
        throw new SetupImportError(
          "UNAVAILABLE",
          "Website AI is not configured. Manual editing remains available.",
        );
      return proposeWebsiteAi(staff, request.body);
    }),
  );
  app.post(
    "/v1/staff/website-import/propose",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    action(async (staff, request) => {
      const input = websiteImportRequestSchema.parse(request.body);
      await websiteImportProposals.authorize(staff);
      const proposal = await propose(input);
      const id = await websiteImportProposals.record(staff, proposal);
      return { id, ...proposal };
    }),
  );
}

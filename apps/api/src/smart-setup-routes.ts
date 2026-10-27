import type { FastifyInstance } from "fastify";
import { smartSetupUpdateSchema } from "@flowgastronomie/domain";
import {
  smartSetupRepository,
  websiteDraftHistory,
} from "@flowgastronomie/database";
import {
  setupRouteAction,
  type SetupAuthenticator,
} from "./setup-route-action.js";
export function registerSmartSetupRoutes(
  app: FastifyInstance,
  requireStaff: SetupAuthenticator,
) {
  const websiteAction = setupRouteAction(requireStaff, "WEBSITE_MANAGE");
  app.get(
    "/v1/staff/website-history",
    websiteAction((staff) => websiteDraftHistory.list(staff)),
  );
  app.post(
    "/v1/staff/website-history/revert",
    websiteAction((staff, request) =>
      websiteDraftHistory.revert(staff, request.body),
    ),
  );
  const action = setupRouteAction(requireStaff, "VENUE_SETUP_MANAGE");
  app.get(
    "/v1/staff/smart-setup",
    action((staff) => smartSetupRepository.get(staff)),
  );
  app.put(
    "/v1/staff/smart-setup",
    action((staff, request) =>
      smartSetupRepository.update(
        staff,
        smartSetupUpdateSchema.parse(request.body),
      ),
    ),
  );
}

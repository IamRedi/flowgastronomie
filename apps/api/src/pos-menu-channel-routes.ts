import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { setPosMenuChannel } from "@flowgastronomie/database";
import { assertStaffPermission } from "@flowgastronomie/domain";
import {
  setupRouteAction,
  type SetupAuthenticator,
} from "./setup-route-action.js";
export function registerPosMenuChannelRoutes(
  app: FastifyInstance,
  authenticate: SetupAuthenticator,
) {
  app.post(
    "/v1/staff/menu/pos-activation",
    setupRouteAction(
      authenticate,
      "MENU_MANAGE",
    )(async (staff, request) => {
      const input = z
        .strictObject({
          productIds: z
            .array(z.string().min(1).max(100))
            .min(1)
            .max(150)
            .refine((ids) => new Set(ids).size === ids.length),
          enabled: z.boolean(),
          confirm: z.literal(true),
        })
        .parse(request.body);
      assertStaffPermission(staff.role, "MENU_MANAGE");
      return setPosMenuChannel(staff, input);
    }),
  );
}

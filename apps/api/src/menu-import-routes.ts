import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  importCommitSchema,
  importLimits,
  importReviewSchema,
  SetupImportError,
} from "@flowgastronomie/domain";
import {
  commitMenuImport,
  menuImportRepository,
} from "@flowgastronomie/database";
import {
  setupRouteAction,
  type SetupAuthenticator,
} from "./setup-route-action.js";
import {
  inspectMenuSource,
  renderMenuPdfPage,
} from "./menu-import-document-adapter.js";
import { extractMenuImport } from "./menu-import-service.js";
import {
  menuExtractionConfigured,
  type MenuExtractionProvider,
} from "./menu-extraction-provider.js";
const identity = z.object({ id: z.string().min(1).max(100) });
const version = z.object({
  expectedVersion: z.coerce.number().int().nonnegative(),
});
export function registerMenuImportRoutes(
  app: FastifyInstance,
  requireStaff: SetupAuthenticator,
  provider?: MenuExtractionProvider,
) {
  const action = setupRouteAction(requireStaff, "IMPORT_MANAGE");
  const base = "/v1/staff/menu-imports";
  for (const mime of [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
  ])
    if (!app.hasContentTypeParser(mime))
      app.addContentTypeParser(
        mime,
        { parseAs: "buffer", bodyLimit: importLimits.fileBytes },
        (_request, body, done) => done(null, body),
      );
  app.get(
    `${base}/capabilities`,
    action(async () => ({
      extraction: !!provider || menuExtractionConfigured(),
      limits: importLimits,
    })),
  );
  app.get(
    base,
    action((staff) => menuImportRepository.list(staff)),
  );
  app.post(
    base,
    action((staff, request) => {
      const input = z
        .strictObject({
          requestKey: z.string().uuid(),
          locale: z.enum(["en", "de", "it", "sq"]),
        })
        .parse(request.body);
      return menuImportRepository.create(staff, input.requestKey, input.locale);
    }),
  );
  app.get(
    `${base}/:id`,
    action((staff, request) =>
      menuImportRepository.get(staff, identity.parse(request.params).id),
    ),
  );
  app.post(
    `${base}/:id/sources`,
    { bodyLimit: importLimits.fileBytes },
    action(async (staff, request) => {
      const { id } = identity.parse(request.params);
      const input = version.parse(request.query);
      await menuImportRepository.get(staff, id);
      if (!Buffer.isBuffer(request.body))
        throw new SetupImportError("INVALID_INPUT");
      const filename = z
        .string()
        .max(1000)
        .parse(request.headers["x-file-name"] ?? "menu");
      let decoded: string;
      try {
        decoded = decodeURIComponent(filename);
      } catch {
        throw new SetupImportError("INVALID_INPUT");
      }
      const file = await inspectMenuSource(
        request.body,
        decoded,
        String(request.headers["content-type"] ?? "").split(";")[0]!,
      );
      await menuImportRepository.upload(staff, id, input.expectedVersion, file);
      return menuImportRepository.get(staff, id);
    }),
  );
  app.get(
    `${base}/:id/sources/:sourceId`,
    action(async (staff, request, reply) => {
      const { id, sourceId } = z
        .object({ id: z.string().max(100), sourceId: z.string().max(100) })
        .parse(request.params);
      const source = await menuImportRepository.source(staff, id, sourceId);
      return reply
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header(
          "Content-Disposition",
          `${source.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(source.filename)}`,
        )
        .type(source.mimeType)
        .send(source.bytes);
    }),
  );
  app.get(
    `${base}/:id/sources/:sourceId/pages/:page`,
    action(async (staff, request, reply) => {
      const { id, sourceId, page } = z
        .object({
          id: z.string().max(100),
          sourceId: z.string().max(100),
          page: z.coerce.number().int().min(1).max(importLimits.pages),
        })
        .parse(request.params);
      const source = await menuImportRepository.source(staff, id, sourceId);
      if (source.mimeType !== "application/pdf" || page > source.pageCount)
        throw new SetupImportError("NOT_FOUND");
      return reply
        .header("X-Content-Type-Options", "nosniff")
        .type("image/png")
        .send(await renderMenuPdfPage(source.bytes, page));
    }),
  );
  app.post(
    `${base}/:id/extract`,
    action((staff, request) =>
      extractMenuImport(
        staff,
        identity.parse(request.params).id,
        z
          .strictObject({
            expectedVersion: z.number().int().nonnegative(),
            requestKey: z.string().uuid(),
          })
          .parse(request.body),
        provider,
      ),
    ),
  );
  app.put(
    `${base}/:id/items/:itemId`,
    action(async (staff, request) => {
      const { id, itemId } = z
        .object({ id: z.string().max(100), itemId: z.string().max(100) })
        .parse(request.params);
      await menuImportRepository.review(
        staff,
        id,
        itemId,
        importReviewSchema.parse(request.body),
      );
      return menuImportRepository.get(staff, id);
    }),
  );
  app.post(
    `${base}/:id/import`,
    action((staff, request) => {
      const input = importCommitSchema.parse(request.body);
      return commitMenuImport(
        staff,
        identity.parse(request.params).id,
        input.expectedVersion,
        input.confirm,
      );
    }),
  );
}

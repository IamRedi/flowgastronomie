import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import sharp from "sharp";
import QRCode from "qrcode";
import {
  assertStaffPermission,
  CreativeError,
  StaffPermissionDeniedError,
  createDesign,
  creativeFormatIds,
  parseDesignDocument,
  creativeBindingSchema,
  validateCreativeSources,
  sourceChanges,
  creativeTemplates,
  instantiateCreativeTemplate,
  creativeBriefSchema,
  imageProviders,
} from "@flowgastronomie/domain";
import {
  creativeRepository,
  creativeScope,
  creativeJson,
  tenantImageUsage,
  type StaffIdentity,
  creativeSourceCatalog,
  resolveCreativeBinding,
  resolveCreativeDocument,
  resolveCreativeSave,
  syncCreativeProject,
  restoreCreativeRevision,
} from "@flowgastronomie/database";
import { prisma } from "@flowgastronomie/database";
import { creativeStorage } from "./creative-storage.js";
import {
  promoteCreativeMedia,
  isCanonicalReviewAsset,
  importCanonicalCreativeAsset,
} from "./creative-canonical-media.js";
import { creativePreflight, exportCreative } from "./creative-export.js";
import { creativeFontHashes, renderCreative } from "./creative-renderer.js";
import { planCreative } from "./creative-planner-service.js";
import { generateCreativeAsset } from "./creative-image-service.js";
import { imageProviderConfigured } from "./creative-image-provider.js";
import {
  productImageHistory,
  generateProductImage,
  approveProductImage,
} from "./product-ai-image-service.js";
import {
  composeCreativeProject,
  importCreativeBrandAsset,
} from "./creative-workspace-service.js";

const identity = z.object({ id: z.string().min(1).max(100) });
const title = z.string().trim().min(1).max(120);
export function registerCreativeRoutes(
  app: FastifyInstance,
  requireStaff: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<StaffIdentity | null>,
) {
  const action =
    (
      run: (
        staff: StaffIdentity,
        request: FastifyRequest,
        reply: FastifyReply,
      ) => Promise<unknown>,
    ) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        assertStaffPermission(
          staff.role,
          request.method === "GET" ? "CREATIVE_VIEW" : "CREATIVE_EDIT",
        );
        reply.header("Cache-Control", "private, no-store");
        return await run(staff, request, reply);
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof z.ZodError)
          return reply.code(400).send({ code: "INVALID_INPUT" });
        if (error instanceof CreativeError)
          return reply
            .code(
              error.code === "NOT_FOUND"
                ? 404
                : error.code === "CONFLICT" || error.code === "STALE_SOURCE"
                  ? 409
                  : error.code === "UNAVAILABLE"
                    ? 503
                    : error.code === "RATE_LIMIT"
                      ? 429
                      : 400,
            )
            .send({ code: error.code, message: error.message });
        request.log.error({ event: "creative_operation_failed" });
        return reply.code(500).send({
          code: "CREATIVE_FAILED",
          message: "The operation failed. Your saved design is safe.",
        });
      }
    };
  const base = "/v1/staff/creative";
  const imageTarget = z.object({
    target: z.enum(["products", "website-sections"]),
    id: z.string().min(1).max(100),
  });
  app.get(
    `${base}/:target/:id/images`,
    action((staff, request) =>
      productImageHistory(
        staff,
        imageTarget.parse(request.params).id,
        imageTarget.parse(request.params).target,
      ),
    ),
  );
  app.post(
    `${base}/:target/:id/images`,
    action((staff, request) =>
      generateProductImage(
        staff,
        identity.parse(request.params).id,
        z
          .strictObject({
            prompt: z.string().trim().min(3).max(2000),
            requestKey: z.uuid(),
            locale: z.enum(["sq", "de", "en", "it"]),
            provider: z.enum(imageProviders).optional(),
            sourceAssetId: z.string().min(1).max(100).nullable().optional(),
            editCurrent: z.boolean().optional(),
          })
          .parse(request.body),
        imageTarget.parse(request.params).target,
      ),
    ),
  );
  app.post(
    `${base}/:target/:id/images/approve`,
    action((staff, request) => {
      const input = z
        .strictObject({
          assetId: z.string().min(1).max(100),
          approved: z.literal(true),
        })
        .parse(request.body);
      return approveProductImage(
        staff,
        identity.parse(request.params).id,
        input.assetId,
        imageTarget.parse(request.params).target,
      );
    }),
  );
  app.post(
    `${base}/compose`,
    action((staff, request) =>
      composeCreativeProject(staff, creativeBriefSchema.parse(request.body)),
    ),
  );
  app.post(
    `${base}/projects/:id/sync`,
    action((staff, request) =>
      syncCreativeProject(staff, identity.parse(request.params).id),
    ),
  );
  app.post(
    `${base}/projects/:id/archive`,
    action((staff, request) => {
      const input = z
        .strictObject({
          expectedVersion: z.number().int().nonnegative(),
          archived: z.boolean(),
        })
        .parse(request.body);
      return creativeRepository.archive(
        staff,
        identity.parse(request.params).id,
        input.expectedVersion,
        input.archived,
      );
    }),
  );
  app.post(
    `${base}/projects/:id/restore`,
    action((staff, request) => {
      const input = z
        .strictObject({
          expectedVersion: z.number().int().nonnegative(),
          revisionId: z.string().min(1).max(100),
        })
        .parse(request.body);
      return restoreCreativeRevision(
        staff,
        identity.parse(request.params).id,
        input.revisionId,
        input.expectedVersion,
      );
    }),
  );
  app.post(
    `${base}/assets/:id/catalog`,
    action(async (staff, request) => {
      const input = z
        .strictObject({
          name: title,
          kind: z.enum(["PRODUCT", "VENUE", "LOGO", "ARTWORK"]),
          productId: z.string().min(1).max(100).nullable(),
        })
        .parse(request.body);
      const asset = await creativeRepository.asset(
        staff,
        identity.parse(request.params).id,
      );
      if (input.kind === "LOGO" && asset.source === "GENERATED")
        throw new CreativeError(
          "INVALID_DESIGN",
          "Generated images cannot be used as a venue logo.",
        );
      if (
        (asset.provenance as Record<string, unknown> | null)?.canonicalMediaId
      )
        throw new CreativeError(
          "INVALID_DESIGN",
          "Canonical media keeps its venue/product association. Update it in the business catalog.",
        );
      if ((input.kind === "PRODUCT") !== !!input.productId)
        throw new CreativeError("INVALID_DESIGN");
      if (
        input.productId &&
        !(await prisma.product.findFirst({
          where: { ...creativeScope(staff), id: input.productId },
          select: { id: true },
        }))
      )
        throw new CreativeError("NOT_FOUND");
      const prior =
        asset.provenance &&
        typeof asset.provenance === "object" &&
        !Array.isArray(asset.provenance)
          ? asset.provenance
          : {};
      return prisma.creativeAsset.update({
        where: { ...creativeScope(staff), id: asset.id },
        data: {
          name: input.name,
          provenance: creativeJson({
            ...prior,
            catalog: { kind: input.kind, productId: input.productId },
          }),
        },
      });
    }),
  );
  app.get(
    `${base}/exports`,
    action(async (staff) =>
      prisma.creativeExport.findMany({
        where: creativeScope(staff),
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          projectId: true,
          outputType: true,
          createdAt: true,
          project: { select: { title: true } },
        },
      }),
    ),
  );
  app.post(
    `${base}/projects/:id/images`,
    action((staff, request) => {
      const input = z
        .strictObject({
          prompt: z.string().trim().min(3).max(2000),
          requestKey: z.uuid(),
          sourceLayerId: z.string().min(1).max(100).nullable(),
          provider: z.enum(imageProviders).optional(),
        })
        .parse(request.body);
      const provider = input.provider ?? "openai";
      if (!imageProviderConfigured(provider))
        throw new CreativeError(
          "UNAVAILABLE",
          "This image provider is not configured.",
        );
      return generateCreativeAsset(staff, identity.parse(request.params).id, {
        ...input,
        provider,
      });
    }),
  );
  app.get(
    `${base}/capabilities`,
    action(async (staff) => {
      const usage = await tenantImageUsage(staff.tenantId);
      const imageProviderOptions = usage.providers.map((p) => ({
        id: p.provider,
        enabled:
          p.enabled &&
          p.used < p.limit &&
          !usage.emergencyDisabled &&
          imageProviderConfigured(p.provider),
        used: p.used,
        limit: p.limit,
      }));
      return {
        planner: !!process.env.CREATIVE_OPENAI_API_KEY,
        images: imageProviderOptions.some((p) => p.enabled),
        imageProviders: imageProviderOptions,
      };
    }),
  );
  app.post(
    `${base}/projects/:id/ai`,
    action((staff, request) =>
      planCreative(
        staff,
        identity.parse(request.params).id,
        z
          .strictObject({
            instruction: z.string().trim().min(1).max(2000),
            mode: z.enum(["PLAN", "PATCH"]),
            expectedVersion: z.number().int().nonnegative(),
            productIds: z.array(z.string().min(1).max(100)).max(12),
            selectedLayerIds: z.array(z.string().min(1).max(100)).max(40),
            requestKey: z.uuid(),
            quality: z.boolean(),
          })
          .parse(request.body),
      ),
    ),
  );
  app.get(
    `${base}/projects/:id/conversation`,
    action(async (staff, request) => {
      const project = await creativeRepository.get(
        staff,
        identity.parse(request.params).id,
      );
      return prisma.creativeConversation.findMany({
        where: { ...creativeScope(staff), projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, message: true, summary: true, createdAt: true },
      });
    }),
  );
  app.get(
    `${base}/projects/:id/proposal`,
    action(async (staff, request) => {
      const project = await creativeRepository.get(
        staff,
        identity.parse(request.params).id,
      );
      const conversation = await prisma.creativeConversation.findFirst({
        where: { ...creativeScope(staff), projectId: project.id },
        orderBy: { createdAt: "desc" },
      });
      if (!conversation) return null;
      const proposal = z
        .object({
          document: z.unknown(),
          baseVersion: z.number(),
          dismissed: z.boolean().optional(),
        })
        .safeParse(conversation.patch);
      if (
        !proposal.success ||
        proposal.data.dismissed ||
        proposal.data.baseVersion !== project.version
      )
        return null;
      return {
        id: conversation.id,
        summary: conversation.summary,
        proposal: {
          document: parseDesignDocument(proposal.data.document),
          baseVersion: project.version,
        },
      };
    }),
  );
  app.post(
    `${base}/projects/:id/ai/dismiss`,
    action(async (staff, request) => {
      const project = await creativeRepository.get(
        staff,
        identity.parse(request.params).id,
      );
      const input = z
        .strictObject({ conversationId: z.string().min(1).max(100) })
        .parse(request.body);
      const conversation = await prisma.creativeConversation.findFirst({
        where: {
          ...creativeScope(staff),
          projectId: project.id,
          id: input.conversationId,
        },
      });
      if (!conversation) throw new CreativeError("NOT_FOUND");
      const prior = z
        .object({ document: z.unknown(), baseVersion: z.number() })
        .parse(conversation.patch);
      await prisma.creativeConversation.update({
        where: { id: conversation.id, ...creativeScope(staff) },
        data: { patch: creativeJson({ ...prior, dismissed: true }) },
      });
      return { dismissed: true };
    }),
  );
  app.post(
    `${base}/projects/:id/ai/accept`,
    action(async (staff, request) => {
      assertStaffPermission(staff.role, "CREATIVE_AI_USE");
      const input = z
        .strictObject({
          conversationId: z.string().max(100),
          expectedVersion: z.number().int().nonnegative(),
        })
        .parse(request.body);
      const project = await creativeRepository.get(
        staff,
        identity.parse(request.params).id,
      );
      const conversation = await prisma.creativeConversation.findFirst({
        where: {
          ...creativeScope(staff),
          projectId: project.id,
          id: input.conversationId,
        },
      });
      if (!conversation) throw new CreativeError("NOT_FOUND");
      const proposal = z
        .object({
          baseVersion: z.number(),
          document: z.unknown(),
          dismissed: z.boolean().optional(),
        })
        .parse(conversation.patch);
      if (proposal.dismissed)
        throw new CreativeError(
          "CONFLICT",
          "This suggestion was discarded. Request a new suggestion.",
        );
      if (proposal.baseVersion !== input.expectedVersion)
        throw new CreativeError(
          "CONFLICT",
          "This suggestion belongs to an older design version.",
        );
      let document = parseDesignDocument(proposal.document);
      document = validateCreativeSources(
        document,
        project.document,
        await resolveCreativeDocument(staff, document),
      );
      await creativeRepository.validateAssets(staff, document);
      return creativeRepository.save(
        staff,
        project.id,
        input.expectedVersion,
        project.title,
        document,
        "Accepted AI suggestion",
        "AI",
      );
    }),
  );
  app.get(
    `${base}/projects/:id/preflight`,
    action(async (staff, request) => {
      const result = await creativePreflight(
        staff,
        identity.parse(request.params).id,
      );
      return {
        version: result.project.version,
        confirmationHash: result.confirmationHash,
        changes: result.changes,
        warnings: result.warnings,
      };
    }),
  );
  app.get(
    `${base}/projects/:id/preview`,
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    action(async (staff, request, reply) => {
      const { project } = await creativePreflight(
        staff,
        identity.parse(request.params).id,
      );
      const assets = await Promise.all(
        [
          ...new Set(
            project.document.pages[0]!.layers.flatMap((l) =>
              "assetId" in l ? [l.assetId] : [],
            ),
          ),
        ].map((id) => creativeRepository.asset(staff, id)),
      );
      const snapshot = {
        rendererVersion: 1 as const,
        document: project.document,
        assets,
        fontHashes: await creativeFontHashes(project.document),
        bleed: false,
        cropMarks: false,
      };
      return reply
        .type("image/svg+xml")
        .header(
          "Content-Security-Policy",
          "default-src 'none'; img-src data:; sandbox",
        )
        .send(
          await renderCreative(snapshot, "SVG", (a) =>
            creativeStorage.read(a.storageKey),
          ),
        );
    }),
  );
  app.post(
    `${base}/projects/:id/exports`,
    action((staff, request) =>
      exportCreative(
        staff,
        identity.parse(request.params).id,
        z
          .strictObject({
            type: z.enum(["PNG", "WEBP", "PDF"]),
            expectedVersion: z.number().int().nonnegative(),
            confirmationHash: z.string().length(64),
            keepStale: z.boolean(),
            bleed: z.boolean(),
            cropMarks: z.boolean(),
            requestKey: z.uuid(),
          })
          .parse(request.body),
      ),
    ),
  );
  app.get(
    `${base}/projects/:id/exports`,
    action(async (staff, request) => {
      const project = await creativeRepository.get(
        staff,
        identity.parse(request.params).id,
      );
      return prisma.creativeExport.findMany({
        where: { ...creativeScope(staff), projectId: project.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          outputType: true,
          snapshotHash: true,
          createdAt: true,
          specification: true,
        },
      });
    }),
  );
  app.get(
    `${base}/exports/:id/content`,
    action(async (staff, request, reply) => {
      assertStaffPermission(staff.role, "CREATIVE_EXPORT");
      const record = await prisma.creativeExport.findFirst({
        where: {
          ...creativeScope(staff),
          id: identity.parse(request.params).id,
        },
      });
      if (!record) throw new CreativeError("NOT_FOUND");
      return reply
        .type(
          record.outputType === "PDF"
            ? "application/pdf"
            : record.outputType === "WEBP"
              ? "image/webp"
              : "image/png",
        )
        .header(
          "Content-Disposition",
          `attachment; filename="design-${record.id}.${record.outputType.toLowerCase()}"`,
        )
        .header("X-Content-Type-Options", "nosniff")
        .send(await creativeStorage.read(record.storageKey));
    }),
  );
  app.get(
    `${base}/projects`,
    action((staff) => creativeRepository.list(staff)),
  );
  app.post(
    `${base}/projects`,
    action(async (staff, request) => {
      const input = z
        .strictObject({
          title,
          format: z.enum(creativeFormatIds),
          locale: z.enum(["en", "de", "it", "sq"]),
          template: z.enum(creativeTemplates).optional(),
        })
        .parse(request.body);
      let document = createDesign(input.format, input.locale);
      const catalog = await creativeSourceCatalog(staff, input.locale);
      if (catalog.brand)
        document.theme = {
          ...document.theme,
          primary: catalog.brand.primaryColor,
          accent: catalog.brand.accentColor,
        };
      if (input.template) {
        const venue = await resolveCreativeBinding(
          staff,
          {
            id: "venue",
            sourceType: "VENUE",
            sourceId: staff.venueId,
            field: "name",
            value: "",
            version: "",
          },
          input.locale,
        );
        document = instantiateCreativeTemplate(
          input.template,
          input.format,
          input.locale,
          [venue],
          document.theme,
        );
      }
      return creativeRepository.create(staff, input.title, document);
    }),
  );
  app.get(
    `${base}/projects/:id`,
    action((staff, request) =>
      creativeRepository.get(staff, identity.parse(request.params).id),
    ),
  );
  app.put(
    `${base}/projects/:id`,
    action(async (staff, request) => {
      const input = z
        .strictObject({
          title,
          expectedVersion: z.number().int().nonnegative(),
          document: z.unknown(),
          name: z.string().max(120).nullable().optional(),
        })
        .parse(request.body);
      let document = parseDesignDocument(input.document);
      const previous = await creativeRepository.get(
        staff,
        identity.parse(request.params).id,
      );
      const resolved = await resolveCreativeSave(staff, document);
      document = validateCreativeSources(document, previous.document, resolved);
      await creativeRepository.validateAssets(staff, document);
      return creativeRepository.save(
        staff,
        identity.parse(request.params).id,
        input.expectedVersion,
        input.title,
        document,
        input.name ?? null,
      );
    }),
  );
  app.get(
    `${base}/projects/:id/revisions`,
    action((staff, request) =>
      creativeRepository.revisions(staff, identity.parse(request.params).id),
    ),
  );
  app.get(
    `${base}/assets`,
    action((staff) => creativeRepository.assets(staff)),
  );
  app.get(
    `${base}/sources`,
    action((staff, request) =>
      creativeSourceCatalog(
        staff,
        z
          .object({ locale: z.enum(["en", "de", "it", "sq"]) })
          .parse(request.query).locale,
      ),
    ),
  );
  app.post(
    `${base}/sources/resolve`,
    action(async (staff, request) => {
      const input = z
        .strictObject({
          binding: creativeBindingSchema,
          locale: z.enum(["en", "de", "it", "sq"]),
        })
        .parse(request.body);
      return resolveCreativeBinding(staff, input.binding, input.locale);
    }),
  );
  app.post(
    `${base}/sources/check`,
    action(async (staff, request) => {
      const input = z
        .strictObject({ projectId: z.string().max(100), document: z.unknown() })
        .parse(request.body);
      await creativeRepository.get(staff, input.projectId);
      const document = parseDesignDocument(input.document);
      const resolved = await resolveCreativeDocument(staff, document);
      return { resolved, changes: sourceChanges(document, resolved) };
    }),
  );
  app.post(
    `${base}/sources/qr`,
    action(async (staff, request, reply) => {
      const input = z
        .strictObject({
          binding: creativeBindingSchema,
          locale: z.enum(["en", "de", "it", "sq"]),
        })
        .parse(request.body);
      if (!["QR", "TABLE_QR"].includes(input.binding.sourceType))
        throw new CreativeError("INVALID_DESIGN");
      const binding = await resolveCreativeBinding(
        staff,
        input.binding,
        input.locale,
      );
      return reply.type("image/png").send(
        await QRCode.toBuffer(binding.value, {
          width: 600,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      );
    }),
  );
  app.post(
    `${base}/sources/brand-assets/:id`,
    action((staff, request) =>
      importCreativeBrandAsset(staff, identity.parse(request.params).id),
    ),
  );
  app.post(
    `${base}/sources/canonical-assets`,
    action(async (staff) => {
      const catalog = await creativeSourceCatalog(staff, "de");
      for (const row of catalog.media.venue)
        await importCanonicalCreativeAsset(staff, row.media.id, {
          kind: row.role === "LOGO" ? "LOGO" : "VENUE",
          productId: null,
        });
      for (const row of catalog.media.products)
        await importCanonicalCreativeAsset(staff, row.media.id, {
          kind: "PRODUCT",
          productId: row.productId,
        });
      return creativeRepository.assets(staff);
    }),
  );
  app.get(
    `${base}/assets/:id/content`,
    action(async (staff, request, reply) => {
      const asset = await creativeRepository.asset(
        staff,
        identity.parse(request.params).id,
      );
      return reply
        .header("X-Content-Type-Options", "nosniff")
        .type(asset.mimeType)
        .send(await creativeStorage.read(asset.storageKey));
    }),
  );
  app.post(
    `${base}/assets`,
    { bodyLimit: 8 * 1024 * 1024 },
    action(async (staff, request) => {
      if (!Buffer.isBuffer(request.body))
        throw new CreativeError(
          "INVALID_DESIGN",
          "Upload a PNG, JPEG or WebP image.",
        );
      let bytes: Buffer;
      let width: number;
      let height: number;
      try {
        const decoder = sharp(request.body, { limitInputPixels: 40_000_000 });
        const metadata = await decoder.metadata();
        if (
          !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
          (metadata.pages ?? 1) > 1
        )
          throw new Error("Unsupported image");
        const result = await decoder
          .rotate()
          .resize({
            width: 4096,
            height: 4096,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer({ resolveWithObject: true });
        bytes = result.data;
        width = result.info.width;
        height = result.info.height;
      } catch {
        throw new CreativeError(
          "INVALID_DESIGN",
          "This file is not a supported image, or exceeds the image limits.",
        );
      }
      const key = await creativeStorage.put(bytes);
      return prisma.creativeAsset.create({
        data: {
          ...creativeScope(staff),
          name: "Uploaded image",
          source: "UPLOADED",
          mimeType: "image/png",
          width,
          height,
          contentHash: key,
          storageKey: key,
          provenance: creativeJson({ uploadedBy: staff.userId }),
          approvedForPublicUse: false,
          createdBy: staff.userId,
        },
      });
    }),
  );
  app.post(
    `${base}/assets/:id/approve`,
    action(async (staff, request) => {
      const asset = await creativeRepository.asset(
        staff,
        identity.parse(request.params).id,
      );
      if (isCanonicalReviewAsset(asset))
        throw new CreativeError(
          "UNAPPROVED_ASSET",
          "This canonical asset is approved for internal review only. Replace or approve it through its canonical source.",
        );
      return prisma.creativeAsset.update({
        where: { id: asset.id, ...creativeScope(staff) },
        data: { approvedForPublicUse: true, approvedBy: staff.userId },
      });
    }),
  );
  app.post(
    `${base}/assets/:id/promote`,
    action(async (staff, request) => {
      const input = z
        .discriminatedUnion("kind", [
          z.object({ kind: z.literal("WEBSITE"), approved: z.literal(true) }),
          z.object({
            kind: z.literal("PRODUCT"),
            productId: z.string().min(1),
            approved: z.literal(true),
          }),
          z.object({
            kind: z.literal("VENUE"),
            venueRole: z.enum(["LOGO", "HERO", "PROFILE"]),
            approved: z.literal(true),
          }),
        ])
        .parse(request.body);
      return promoteCreativeMedia(
        staff,
        identity.parse(request.params).id,
        input.kind === "PRODUCT"
          ? { productId: input.productId }
          : input.kind === "WEBSITE"
            ? { website: true }
            : { venueRole: input.venueRole },
        input.approved,
      );
    }),
  );
}

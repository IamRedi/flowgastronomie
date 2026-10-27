import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  SetupImportError,
  businessImportCreateSchema,
  businessReviewSchema,
  importCommitSchema,
} from "@flowgastronomie/domain";
import {
  businessImportRepository,
  commitBusinessImport,
  revertBusinessImport,
  menuImportRepository,
  setupMediaRepository,
} from "@flowgastronomie/database";
import {
  setupRouteAction,
  type SetupAuthenticator,
} from "./setup-route-action.js";
import {
  discoverBusiness,
  type BusinessDiscoveryDependencies,
} from "./business-import-discovery.js";
import {
  ImportNetwork,
  importUrl,
  businessImportLimits,
} from "./business-import-network.js";
import type { DiscoverySource } from "./business-import-extraction.js";
import {
  menuExtractionConfigured,
  OpenAIMenuExtractionProvider,
} from "./menu-extraction-provider.js";
import { configuredBusinessRenderer } from "./business-import-renderer.js";

const identity = z.object({ id: z.string().min(1).max(100) });
const version = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
});
export function registerBusinessImportRoutes(
  app: FastifyInstance,
  requireStaff: SetupAuthenticator,
  dependencies: BusinessDiscoveryDependencies = {},
) {
  const renderer = dependencies.renderer ?? configuredBusinessRenderer();
  dependencies = { ...dependencies, ...(renderer ? { renderer } : {}) };
  const action = setupRouteAction(requireStaff, "IMPORT_MANAGE");
  const jobs = new Map<string, AbortController>();
  app.addHook("onClose", async () => {
    for (const controller of jobs.values()) controller.abort();
  });
  const base = "/v1/staff/business-imports";
  app.get(
    `${base}/capabilities`,
    action(async () => ({
      documents: true,
      website: true,
      renderer: !!dependencies.renderer,
      ai:
        !!dependencies.provider ||
        (process.env.BUSINESS_IMPORT_ALLOW_PAID_AI === "true" &&
          menuExtractionConfigured()),
    })),
  );
  app.get(
    base,
    action((staff) => businessImportRepository.list(staff)),
  );
  app.post(
    base,
    action((staff, request) => {
      const input = businessImportCreateSchema.parse(request.body);
      if (input.url) importUrl(input.url);
      return businessImportRepository.create(staff, input);
    }),
  );
  app.get(
    `${base}/:id`,
    action((staff, request) =>
      businessImportRepository.get(staff, identity.parse(request.params).id),
    ),
  );
  app.put(
    `${base}/:id/review`,
    action((staff, request) =>
      businessImportRepository.review(
        staff,
        identity.parse(request.params).id,
        businessReviewSchema.parse(request.body),
      ),
    ),
  );
  app.post(
    `${base}/:id/items`,
    action((staff, request) => {
      const input = version
        .extend({ requestKey: z.string().uuid(), item: z.unknown() })
        .parse(request.body);
      return businessImportRepository.addManual(
        staff,
        identity.parse(request.params).id,
        input.expectedVersion,
        input.requestKey,
        input.item,
      );
    }),
  );
  app.post(
    `${base}/:id/commit`,
    action((staff, request) => {
      const input = importCommitSchema.parse(request.body);
      return commitBusinessImport(
        staff,
        identity.parse(request.params).id,
        input.expectedVersion,
        input.confirm,
      );
    }),
  );
  app.post(
    `${base}/:id/revert`,
    action((staff, request) => {
      const input = importCommitSchema.parse(request.body);
      return revertBusinessImport(
        staff,
        identity.parse(request.params).id,
        input.expectedVersion,
        input.confirm,
      );
    }),
  );
  app.post(
    `${base}/:id/cancel`,
    action(async (staff, request) => {
      const { id } = identity.parse(request.params);
      await businessImportRepository.cancel(
        staff,
        id,
        version.parse(request.body).expectedVersion,
      );
      jobs.get(`${staff.tenantId}:${staff.venueId}:${id}`)?.abort();
      return businessImportRepository.get(staff, id);
    }),
  );
  app.post(
    `${base}/:id/analyze`,
    action(async (staff, request, reply) => {
      const { id } = identity.parse(request.params);
      const input = version
        .extend({ requestKey: z.string().uuid() })
        .parse(request.body);
      const claim = await businessImportRepository.begin(
        staff,
        id,
        input.expectedVersion,
        input.requestKey,
        dependencies.limits ?? businessImportLimits(),
      );
      if (claim.claimed) {
        const key = `${staff.tenantId}:${staff.venueId}:${id}`;
        const controller = new AbortController();
        jobs.set(key, controller);
        const run = async () => {
          const files: DiscoverySource[] = [];
          for (const source of claim.session.sources.filter(
            (s) => s.method === "DOCUMENT",
          )) {
            const stored = await menuImportRepository.source(
              staff,
              id,
              source.id,
            );
            files.push({
              ...source,
              sourceUrl: null,
              method: "DOCUMENT",
              bytes: stored.bytes,
            });
          }
          const provider =
            dependencies.provider ??
            (process.env.BUSINESS_IMPORT_ALLOW_PAID_AI === "true" &&
            menuExtractionConfigured()
              ? new OpenAIMenuExtractionProvider()
              : undefined);
          const result = await discoverBusiness(
            {
              url: claim.state.url,
              files,
              locale: claim.session.locale.toLowerCase() as
                "en" | "sq" | "de" | "it",
              requestKey: input.requestKey,
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(210_000),
              ]),
              saveSource: (source) =>
                businessImportRepository.source(
                  staff,
                  id,
                  input.requestKey,
                  source,
                ),
              progress: async () => {
                const current = await businessImportRepository.get(staff, id);
                if (current.businessData.phase !== "ANALYZING")
                  controller.abort();
                controller.signal.throwIfAborted();
              },
            },
            { ...dependencies, ...(provider ? { provider } : {}) },
          );
          await businessImportRepository.finish(
            staff,
            id,
            input.requestKey,
            result,
          );
        };
        void run()
          .catch(async () => {
            // A lease remains resumable even after a process dies. Never log source text or credentials.
            try {
              const current = await businessImportRepository.get(staff, id);
              if (
                current.businessData.phase === "ANALYZING" &&
                current.businessData.requestKey === input.requestKey
              )
                await businessImportRepository.cancel(
                  staff,
                  id,
                  current.version,
                );
            } catch {
              app.log.error({ event: "business_import_interrupted" });
            }
          })
          .finally(() => {
            if (jobs.get(key) === controller) jobs.delete(key);
          });
      }
      return reply
        .code(202)
        .send(await businessImportRepository.get(staff, id));
    }),
  );
  app.post(
    `${base}/:id/images/:candidateId`,
    action(async (staff, request) => {
      const { id, candidateId } = identity
        .extend({ candidateId: z.string().max(100) })
        .parse(request.params);
      const input = version
        .extend({ rightsConfirmed: z.literal(true), publicUse: z.boolean() })
        .parse(request.body);
      const session = await businessImportRepository.get(staff, id);
      const candidate = session.businessData.images.find(
        (i) => i.id === candidateId,
      );
      if (!candidate) throw new SetupImportError("NOT_FOUND");
      if (candidate.assetId) return session;
      if (
        session.version !== input.expectedVersion ||
        session.businessData.phase !== "REVIEW"
      )
        throw new SetupImportError("CONFLICT");
      if (input.publicUse && session.canonical.website?.status === "PUBLISHED")
        throw new SetupImportError(
          "REVIEW_REQUIRED",
          "Unpublish before approving imported media for a new draft.",
        );
      const network = new ImportNetwork(
        candidate.url,
        AbortSignal.timeout(30_000),
        dependencies,
      );
      await network.authorize();
      const response = await network.get(candidate.url, 5 * 1024 * 1024);
      if (!/^image\/(jpeg|png|webp)(;|$)/i.test(response.type))
        throw new SetupImportError("INVALID_INPUT");
      const asset = await setupMediaRepository.upload(
        staff,
        response.bytes,
        {
          source: "UPLOAD",
          publicUse: String(input.publicUse),
          confirmed: "true",
        },
        { sourceUrl: response.url, importSessionId: id },
      );
      return businessImportRepository.attachImage(
        staff,
        id,
        session.version,
        candidateId,
        asset.id,
      );
    }),
  );
}

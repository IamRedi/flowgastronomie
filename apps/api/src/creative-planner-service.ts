import {
  applyCreativePatch,
  creativeCopy,
  creativeRequestedCopy,
  creativeMentionedProducts,
  CreativeError,
  designPlanSchema,
  designPatchSetSchema,
  instantiateCreativeTemplate,
  type CreativeBinding,
  type CreativeScope,
  type DesignDocument,
} from "@flowgastronomie/domain";
import {
  beginCreativeJob,
  finishCreativeJob,
  creativeRepository,
  creativeScope,
  creativeJson,
  resolveCreativeBinding,
  resolveCreativeDocument,
  prisma,
  creativeSourceCatalog,
} from "@flowgastronomie/database";
import {
  OpenAICreativePlanner,
  type CreativePlannerProvider,
  type CreativePlannerContext,
} from "./creative-providers.js";
import sharp from "sharp";
import { isCanonicalReviewAsset } from "./creative-canonical-media.js";
import { creativeStorage } from "./creative-storage.js";
import { creativeAssetCatalog } from "./creative-workspace-service.js";
export async function planCreative(
  staff: CreativeScope,
  projectId: string,
  input: {
    instruction: string;
    mode: "PLAN" | "PATCH";
    expectedVersion: number;
    productIds: string[];
    selectedLayerIds: string[];
    requestKey: string;
    quality: boolean;
  },
  provider: CreativePlannerProvider = new OpenAICreativePlanner(
    input.quality
      ? (process.env.CREATIVE_PLANNER_QUALITY_MODEL ?? "gpt-6-sol")
      : undefined,
  ),
) {
  const project = await creativeRepository.get(staff, projectId);
  if (project.version !== input.expectedVersion)
    throw new CreativeError(
      "CONFLICT",
      "Save or reload the design before asking the assistant.",
    );
  if (
    input.selectedLayerIds.some(
      (id) => !project.document.pages[0]!.layers.some((l) => l.id === id),
    )
  )
    throw new CreativeError("INVALID_DESIGN");
  const bindings: CreativeBinding[] = [
    ...(await resolveCreativeDocument(staff, project.document)),
  ];
  const catalog = await creativeSourceCatalog(staff, project.document.locale);
  const mentioned = creativeMentionedProducts(
    input.instruction,
    catalog.products,
  );
  for (const id of [...new Set([...input.productIds, ...mentioned])].slice(
    0,
    40,
  ))
    for (const field of ["name", "price"] as const) {
      if (!bindings.some((b) => b.sourceId === id && b.field === field))
        bindings.push(
          await resolveCreativeBinding(
            staff,
            {
              id: `product_${id}_${field}`,
              sourceType: "PRODUCT",
              sourceId: id,
              field,
              value: "",
              version: "",
            },
            project.document.locale,
          ),
        );
    }
  const usedAssets = new Set(
    project.document.pages[0]!.layers.flatMap((l) =>
      "assetId" in l ? [l.assetId] : [],
    ),
  );
  const library = await creativeRepository.assets(staff);
  const missing = await Promise.all(
    [...usedAssets]
      .filter((id) => !library.some((a) => a.id === id))
      .map((id) => creativeRepository.asset(staff, id)),
  );
  const assets = [...library, ...missing]
    .filter((a) => a.approvedForPublicUse || isCanonicalReviewAsset(a))
    .sort((a, b) => Number(usedAssets.has(b.id)) - Number(usedAssets.has(a.id)))
    .filter((a, index) => index < 20 || usedAssets.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      source: a.source,
      ...creativeAssetCatalog(a.provenance),
      preview: undefined as string | undefined,
    }));
  const references = [...assets]
    .sort((a, b) => Number(usedAssets.has(b.id)) - Number(usedAssets.has(a.id)))
    .slice(0, 4);
  await Promise.all(
    references.map(async (asset) => {
      const record = await creativeRepository.asset(staff, asset.id);
      const thumbnail = await sharp(
        await creativeStorage.read(record.storageKey),
      )
        .resize({
          width: 512,
          height: 512,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 70 })
        .toBuffer();
      asset.preview = `data:image/jpeg;base64,${thumbnail.toString("base64")}`;
    }),
  );
  const approvedCopy = creativeRequestedCopy(
    input.instruction,
    project.document.locale,
  );
  // Never send raw table credentials to a planner.
  const redact = (b: CreativeBinding) =>
    b.field === "destination" ? { ...b, value: "[approved destination]" } : b;
  const context: CreativePlannerContext = {
    locale: project.document.locale,
    format: project.document.format,
    theme: project.document.theme,
    bindings: bindings.map(redact),
    assets,
    allowedCopy: [
      ...creativeCopy[project.document.locale],
      ...approvedCopy,
      ...project.document.pages[0]!.layers.flatMap((l) =>
        "text" in l && !l.bindingId ? [l.text] : [],
      ),
    ],
    selectedLayerIds: input.selectedLayerIds,
  };
  const started = Date.now();
  const { job, existing } = await beginCreativeJob(
    staff,
    projectId,
    input.requestKey,
    input.mode,
    provider.provider,
    provider.model,
  );
  if (existing) {
    if (job.state === "SUCCEEDED" && job.resultId) {
      const prior = await prisma.creativeConversation.findFirst({
        where: { ...creativeScope(staff), id: job.resultId, projectId },
      });
      if (prior)
        return {
          id: prior.id,
          summary: prior.summary,
          proposal: prior.patch,
          baseVersion: project.version,
        };
    }
    throw new CreativeError(
      "CONFLICT",
      "This AI request is already recorded. Retry explicitly with a new request.",
    );
  }
  let usage: unknown = {};
  try {
    let document: DesignDocument;
    let summary: string;
    if (input.mode === "PLAN") {
      const result = await provider.createPlan(context, input.instruction);
      usage = result.usage;
      const plan = designPlanSchema.parse(result.value);
      if (
        plan.selectedSourceIds.some(
          (id) => !bindings.some((b) => b.sourceId === id),
        )
      )
        throw new CreativeError(
          "INVALID_DESIGN",
          "The planner selected an unknown source.",
        );
      const selectedBindings = bindings.filter((b) =>
        plan.selectedSourceIds.includes(b.sourceId),
      );
      const base = instantiateCreativeTemplate(
        plan.template,
        plan.format,
        project.document.locale,
        selectedBindings,
        project.document.theme,
      );
      document = applyCreativePatch(base, plan.patchSet, {
        bindings,
        assetIds: assets.map((a) => a.id),
        approvedCopy,
      });
      summary = plan.intent;
      usage = result.usage;
    } else {
      const safeDocument = {
        ...project.document,
        bindings: project.document.bindings.map(redact),
      };
      const result = await provider.createPatch(
        context,
        safeDocument,
        input.instruction,
      );
      usage = result.usage;
      const patch = designPatchSetSchema.parse(result.value);
      if (
        input.selectedLayerIds.length &&
        patch.patches.some(
          (p) =>
            p.op === "format" ||
            p.op === "add" ||
            !input.selectedLayerIds.includes(
              p.op === "remove" ? p.layerId : p.layer.id,
            ),
        )
      )
        throw new CreativeError(
          "INVALID_DESIGN",
          "The assistant changed a layer outside your selection.",
        );
      // Preserve saved source values; freshness updates are explicit user actions.
      document = applyCreativePatch(project.document, patch, {
        bindings: [
          ...project.document.bindings,
          ...bindings.filter(
            (b) => !project.document.bindings.some((old) => old.id === b.id),
          ),
        ],
        assetIds: assets.map((a) => a.id),
        approvedCopy,
      });
      summary = patch.summary;
      usage = result.usage;
    }
    await creativeRepository.validateAssets(staff, document);
    const proposal = { document, baseVersion: project.version };
    const conversation = await prisma.creativeConversation.create({
      data: {
        ...creativeScope(staff),
        projectId,
        message: input.instruction,
        summary,
        patch: creativeJson(proposal),
        createdBy: staff.userId,
      },
    });
    await finishCreativeJob(
      staff,
      job.id,
      "SUCCEEDED",
      Date.now() - started,
      usage,
      conversation.id,
    );
    return {
      id: conversation.id,
      summary,
      proposal,
      baseVersion: project.version,
    };
  } catch (error) {
    await finishCreativeJob(
      staff,
      job.id,
      "FAILED",
      Date.now() - started,
      usage,
    );
    if (error instanceof CreativeError) throw error;
    throw new CreativeError(
      "UNAVAILABLE",
      "The assistant could not complete this request. Your design is unchanged.",
    );
  }
}

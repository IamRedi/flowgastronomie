import sharp from "sharp";
import { createHash } from "node:crypto";
import {
  assertStaffPermission,
  CreativeError,
  creativeImageOutputPolicy,
  estimateImageCostUsd,
  type ImageProviderId,
  type CreativeScope,
} from "@flowgastronomie/domain";
import {
  beginCreativeJob,
  finishCreativeJob,
  creativeRepository,
  creativeJson,
  creativeScope,
  prisma,
} from "@flowgastronomie/database";
import {
  creativeStorage,
  type CreativeAssetStorage,
} from "./creative-storage.js";
import {
  OpenAICreativeImageProvider,
  selectCreativeImageProvider,
  type CreativeImageProvider,
} from "./creative-image-provider.js";
export async function generateCreativeAsset(
  staff: CreativeScope,
  projectId: string,
  input: {
    prompt: string;
    requestKey: string;
    sourceLayerId: string | null;
    sourceAssetId?: string | null | undefined;
    provider?: ImageProviderId | undefined;
    productId?: string;
  },
  provider: CreativeImageProvider = input.provider
    ? selectCreativeImageProvider(input.provider)
    : new OpenAICreativeImageProvider(),
  storage: CreativeAssetStorage = creativeStorage,
) {
  assertStaffPermission(staff.role, "CREATIVE_AI_USE");
  const project = await creativeRepository.get(staff, projectId);
  let source: Buffer | undefined;
  let sourceAssetId: string | null = null;
  if (input.sourceLayerId) {
    const layer = project.document.pages[0]!.layers.find(
      (l) => l.id === input.sourceLayerId,
    );
    if (!layer || layer.type !== "image")
      throw new CreativeError(
        "INVALID_DESIGN",
        "Only a photo/image layer can be edited. Logos and QR codes remain separate.",
      );
    const asset = await creativeRepository.asset(staff, layer.assetId);
    sourceAssetId = asset.id;
    source = await storage.read(asset.storageKey);
  }
  if (input.sourceAssetId) {
    if (source)
      throw new CreativeError("INVALID_DESIGN", "Choose one source image.");
    const asset = await creativeRepository.asset(staff, input.sourceAssetId);
    if (
      (asset.provenance as { catalog?: { kind?: string } } | null)?.catalog
        ?.kind === "LOGO"
    )
      throw new CreativeError(
        "INVALID_DESIGN",
        "A logo cannot be edited as a product photo.",
      );
    sourceAssetId = asset.id;
    source = await storage.read(asset.storageKey);
  }
  // Validate the requested output before reserving a paid image attempt.
  const output = creativeImageOutputPolicy(project.document);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        prompt: input.prompt,
        sourceAssetId,
        provider: provider.provider,
        model: provider.model,
      }),
    )
    .digest("hex");
  const { job, existing } = await beginCreativeJob(
    staff,
    projectId,
    input.requestKey,
    "IMAGE",
    provider.provider,
    provider.model,
    fingerprint,
  );
  if (existing) {
    if (job.state === "SUCCEEDED" && job.resultId)
      return creativeRepository.asset(staff, job.resultId);
    throw new CreativeError(
      "CONFLICT",
      "This generation is already recorded. Use a new request to retry a failed or uncertain result.",
    );
  }
  const started = Date.now();
  let usage: unknown = {};
  try {
    const request = { prompt: input.prompt, requestKey: job.id, output };
    const result = source
      ? await provider.editAsset({ ...request, source })
      : await provider.generateAsset(request);
    const providerId = provider.provider as ImageProviderId;
    usage = {
      ...result.usage,
      providerOutcome: "COMPLETED",
      operation: source ? "EDIT" : "GENERATE",
      estimatedCostUsd: ["meta", "openai", "ideogram"].includes(providerId)
        ? estimateImageCostUsd(providerId, provider.model, result.usage)
        : null,
    };
    const providerLatencyMs = Date.now() - started;
    if (result.bytes.length > 16 * 1024 * 1024)
      throw new CreativeError(
        "INVALID_DESIGN",
        "Generated image exceeds the asset size limit.",
      );
    const decoder = sharp(result.bytes, { limitInputPixels: 20_000_000 });
    const metadata = await decoder.metadata();
    if (
      !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) > 1
    )
      throw new CreativeError(
        "INVALID_DESIGN",
        "The provider did not return a supported image.",
      );
    if (
      provider.provider === "openai" &&
      (metadata.width !== output.width || metadata.height !== output.height)
    )
      throw new CreativeError(
        "INVALID_DESIGN",
        "The provider returned dimensions below or different from the requested output policy. No automatic retry was made.",
      );
    if ((metadata.width ?? 0) < 512 || (metadata.height ?? 0) < 512)
      throw new CreativeError(
        "INVALID_DESIGN",
        "The provider returned an image too small for review.",
      );
    const normalized = await decoder
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    const key = await storage.put(normalized.data);
    const asset = await prisma.creativeAsset.create({
      data: {
        ...creativeScope(staff),
        name: source ? "AI-edited image" : "Generated promotional illustration",
        source: "GENERATED",
        mimeType: "image/png",
        width: normalized.info.width,
        height: normalized.info.height,
        contentHash: key,
        storageKey: key,
        approvedForPublicUse: false,
        createdBy: staff.userId,
        provenance: creativeJson({
          provider: provider.provider,
          model: provider.model,
          prompt: input.prompt,
          generatedAt: new Date().toISOString(),
          catalog: {
            kind:
              input.productId ||
              project.document.bindings.some((b) => b.sourceType === "PRODUCT")
                ? "PRODUCT"
                : "ARTWORK",
            productId:
              input.productId ??
              project.document.bindings.find((b) => b.sourceType === "PRODUCT")
                ?.sourceId ??
              null,
          },
          sourceAssetId,
          jobId: job.id,
          providerRequestId: result.requestId ?? null,
          providerLatencyMs,
          usage: result.usage,
          outputPolicy: output,
          dimensions: {
            width: normalized.info.width,
            height: normalized.info.height,
          },
          disclosure: source
            ? "AI-edited image. Review against the original before publication."
            : `AI-generated promotional imagery; not actual ${project.document.bindings.find((binding) => binding.sourceType === "VENUE" && binding.field === "name")?.value ?? "venue"} food or photography.`,
        }),
      },
    });
    await finishCreativeJob(
      staff,
      job.id,
      "SUCCEEDED",
      Date.now() - started,
      usage,
      asset.id,
    );
    return asset;
  } catch (error) {
    await finishCreativeJob(
      staff,
      job.id,
      (usage as { providerOutcome?: string }).providerOutcome === "COMPLETED"
        ? "FAILED"
        : "UNCERTAIN",
      Date.now() - started,
      usage,
    );
    if (error instanceof CreativeError) throw error;
    throw new CreativeError(
      "UNAVAILABLE",
      "The generated asset could not be saved. Your design is unchanged.",
    );
  }
}

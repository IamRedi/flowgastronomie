import sharp from "sharp";
import {
  assertStaffPermission,
  CreativeError,
  creativeImageOutputPolicy,
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
  type CreativeImageProvider,
} from "./creative-image-provider.js";
export async function generateCreativeAsset(
  staff: CreativeScope,
  projectId: string,
  input: { prompt: string; requestKey: string; sourceLayerId: string | null },
  provider: CreativeImageProvider = new OpenAICreativeImageProvider(),
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
  const { job, existing } = await beginCreativeJob(
    staff,
    projectId,
    input.requestKey,
    "IMAGE",
    provider.provider,
    provider.model,
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
    const output = creativeImageOutputPolicy(project.document);
    const request = { prompt: input.prompt, requestKey: job.id, output };
    const result = source
      ? await provider.editAsset({ ...request, source })
      : await provider.generateAsset(request);
    usage = result.usage;
    const providerLatencyMs = Date.now() - started;
    if (result.bytes.length > 16 * 1024 * 1024)
      throw new CreativeError(
        "INVALID_DESIGN",
        "Generated image exceeds the asset size limit.",
      );
    const decoder = sharp(result.bytes, { limitInputPixels: 20_000_000 });
    const metadata = await decoder.metadata();
    if (metadata.format !== "png" || (metadata.pages ?? 1) > 1)
      throw new CreativeError(
        "INVALID_DESIGN",
        "The provider did not return a supported image.",
      );
    if (metadata.width !== output.width || metadata.height !== output.height)
      throw new CreativeError(
        "INVALID_DESIGN",
        "The provider returned dimensions below or different from the requested output policy. No automatic retry was made.",
      );
    const normalized = await decoder
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    const key = await storage.put(normalized.data);
    const asset = await prisma.creativeAsset.create({
      data: {
        ...creativeScope(staff),
        name: "Generated promotional illustration",
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
          disclosure: `AI-generated promotional imagery; not actual ${project.document.bindings.find((binding) => binding.sourceType === "VENUE" && binding.field === "name")?.value ?? "venue"} food or photography.`,
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
      "FAILED",
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

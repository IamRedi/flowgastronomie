import {
  assertStaffPermission,
  CreativeError,
  sourceChanges,
  creativeFormats,
  creativeExportWarnings,
  createTextLayer,
  canReviewGeneratedCreativeAsset,
  creativeReviewDisclosure,
  type CreativeScope,
} from "@flowgastronomie/domain";
import {
  creativeRepository,
  creativeScope,
  creativeJson,
  resolveCreativeDocument,
  prisma,
  beginCreativeJob,
} from "@flowgastronomie/database";
import { createHash } from "node:crypto";
import { isCanonicalReviewAsset } from "./creative-canonical-media.js";
import { creativeStorage } from "./creative-storage.js";
import {
  creativeFontHashes,
  creativeHash,
  renderCreative,
  type RenderSnapshot,
} from "./creative-renderer.js";

export async function creativePreflight(
  staff: CreativeScope,
  projectId: string,
) {
  assertStaffPermission(staff.role, "CREATIVE_EXPORT");
  const project = await creativeRepository.get(staff, projectId);
  const resolved = await resolveCreativeDocument(staff, project.document);
  await creativeRepository.validateAssets(staff, project.document, false);
  const changes = sourceChanges(project.document, resolved);
  const confirmationHash = creativeHash({ version: project.version, resolved });
  const assets = await Promise.all(
    [
      ...new Set(
        project.document.pages[0]!.layers.flatMap((l) =>
          "assetId" in l ? [l.assetId] : [],
        ),
      ),
    ].map((id) => creativeRepository.asset(staff, id)),
  );
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: staff.tenantId },
    select: { kind: true },
  });
  const internal = tenant.kind === "LOCAL_PILOT" || tenant.kind === "DEMO";
  if (internal) {
    const generated = assets.some(
      (asset) =>
        asset.source === "GENERATED" ||
        (asset.provenance as Record<string, unknown> | null)?.source ===
          "GENERATED",
    );
    const demo = assets.some(
      (asset) =>
        (asset.provenance as Record<string, unknown> | null)?.source === "DEMO",
    );
    const sample = await prisma.product.count({
      where: {
        ...creativeScope(staff),
        id: {
          in: project.document.bindings
            .filter((b) => b.sourceType === "PRODUCT")
            .map((b) => b.sourceId),
        },
        dataProvenance: { path: ["reviewOnly"], equals: true },
      },
    });
    // Applied by the server on every render/export, even after manual/AI edits.
    const spec = creativeFormats[project.document.format];
    const marker = createTextLayer(
      "foundation_review_disclosure",
      creativeReviewDisclosure(demo, generated, sample > 0),
    );
    if ("text" in marker)
      Object.assign(marker, {
        x: spec.safe + 4,
        y: spec.height - spec.safe - 24,
        width: spec.width - 2 * spec.safe - 8,
        height: 20,
        fontSize: project.document.format === "STICKER" ? 6 : 10,
        align: "center",
        fill: "#7b3725",
        locked: true,
      });
    project.document.pages[0]!.layers = [
      ...project.document.pages[0]!.layers.filter(
        (layer) => layer.id !== marker.id,
      ),
      marker,
    ];
  }
  const warnings = creativeExportWarnings(
    project.document,
    assets.map((asset) => ({
      ...asset,
      approvedForPublicUse:
        asset.approvedForPublicUse ||
        (internal && isCanonicalReviewAsset(asset)) ||
        canReviewGeneratedCreativeAsset(tenant.kind, asset.source),
    })),
  );
  if (internal)
    warnings.push(
      "Internal review only. Confirm menu prices and explicitly approve illustrative AI media or replace DEMO imagery before public use.",
    );
  return { project, resolved, changes, confirmationHash, warnings };
}
export async function exportCreative(
  staff: CreativeScope,
  projectId: string,
  input: {
    type: "PNG" | "WEBP" | "PDF";
    expectedVersion: number;
    confirmationHash: string;
    keepStale: boolean;
    bleed: boolean;
    cropMarks: boolean;
    requestKey: string;
  },
) {
  assertStaffPermission(staff.role, "CREATIVE_EXPORT");
  const scope = creativeScope(staff);
  const existing = await prisma.creativeExport.findFirst({
    where: { ...scope, projectId, requestKey: input.requestKey },
    select: { id: true, outputType: true, snapshotHash: true },
  });
  if (existing) return existing;
  const preflight = await creativePreflight(staff, projectId);
  if (
    preflight.project.version !== input.expectedVersion ||
    preflight.confirmationHash !== input.confirmationHash
  )
    throw new CreativeError(
      "CONFLICT",
      "The design or its sources changed. Review export again.",
    );
  if (preflight.changes.length && !input.keepStale)
    throw new CreativeError(
      "STALE_SOURCE",
      "Review changed sources before export.",
    );
  const { job, existing: existingJob } = await beginCreativeJob(
    staff,
    projectId,
    `export_${input.requestKey}`,
    "EXPORT",
    "internal",
    "renderer-v1",
  );
  if (existingJob)
    throw new CreativeError(
      "CONFLICT",
      "This export request is already recorded. Review and retry explicitly if it failed.",
    );
  const started = Date.now();
  try {
    // Freeze the revision before rendering. A renderer/storage failure leaves it intact.
    const frozen = await creativeRepository.save(
      staff,
      projectId,
      input.expectedVersion,
      preflight.project.title,
      preflight.project.document,
      "Export snapshot",
    );
    const assets = await Promise.all(
      [
        ...new Set(
          preflight.project.document.pages[0]!.layers.flatMap((l) =>
            "assetId" in l ? [l.assetId] : [],
          ),
        ),
      ].map(async (id) => {
        const asset = await creativeRepository.asset(staff, id);
        return {
          id: asset.id,
          contentHash: asset.contentHash,
          storageKey: asset.storageKey,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
        };
      }),
    );
    const snapshot: RenderSnapshot = {
      rendererVersion: 1,
      document: preflight.project.document,
      assets,
      fontHashes: await creativeFontHashes(preflight.project.document),
      bleed: input.bleed,
      cropMarks: input.cropMarks,
    };
    const snapshotHash = creativeHash(snapshot);
    const bytes = await renderCreative(snapshot, input.type, (asset) =>
      creativeStorage.read(asset.storageKey),
    );
    const storageKey = await creativeStorage.put(bytes);
    return await prisma.$transaction(async (tx) => {
      const record = await tx.creativeExport.create({
        data: {
          ...scope,
          projectId,
          revisionId: frozen.currentRevisionId!,
          outputType: input.type,
          snapshot: creativeJson(snapshot),
          snapshotHash,
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          specification: creativeJson({
            ...creativeFormats[preflight.project.document.format],
            bleed: input.bleed,
            cropMarks: input.cropMarks,
            keptSources: preflight.changes.map((c) => c.previous.id),
          }),
          storageKey,
          requestKey: input.requestKey,
          createdBy: staff.userId,
        },
      });
      await tx.creativeJob.update({
        where: { id: job.id, ...scope },
        data: {
          state: "SUCCEEDED",
          resultId: record.id,
          durationMs: Date.now() - started,
        },
      });
      await tx.creativeProject.updateMany({
        where: { id: projectId, ...scope, version: frozen.version },
        data: { status: "READY" },
      });
      return {
        id: record.id,
        outputType: record.outputType,
        snapshotHash,
        version: frozen.version,
      };
    });
  } catch (error) {
    await prisma.creativeJob.update({
      where: { id: job.id, ...scope },
      data: { state: "FAILED", durationMs: Date.now() - started },
    });
    throw error;
  }
}

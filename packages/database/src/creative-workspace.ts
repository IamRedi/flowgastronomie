import {
  assertStaffPermission,
  applyResolvedBindings,
  sourceChanges,
  parseDesignDocument,
  CreativeError,
  type CreativeScope,
} from "@flowgastronomie/domain";
import { creativeRepository, creativeScope } from "./creative-repository.js";
import { resolveCreativeDocument } from "./creative-sources.js";
import { prisma } from "./client.js";

// Reconciliation is explicit POST work. It never rewrites an export or invokes AI.
export async function syncCreativeProject(staff: CreativeScope, id: string) {
  assertStaffPermission(staff.role, "CREATIVE_EDIT");
  const project = await creativeRepository.get(staff, id);
  if (project.status === "ARCHIVED")
    return { project, updated: false, needsReview: false };
  try {
    const resolved = await resolveCreativeDocument(staff, project.document);
    const changes = sourceChanges(project.document, resolved);
    if (!changes.length) return { project, updated: false, needsReview: false };
    const document = applyResolvedBindings(project.document, resolved);
    const saved = await creativeRepository.save(
      staff,
      id,
      project.version,
      project.title,
      document,
      `Source update: ${changes
        .map((c) => c.current.field)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", ")}`,
      "SYSTEM",
    );
    return {
      project: { ...saved, document },
      updated: true,
      needsReview: false,
    };
  } catch (error) {
    if (error instanceof CreativeError && error.code === "UNRESOLVED_SOURCE")
      return { project, updated: false, needsReview: true };
    throw error;
  }
}

export async function restoreCreativeRevision(
  staff: CreativeScope,
  projectId: string,
  revisionId: string,
  expectedVersion: number,
) {
  assertStaffPermission(staff.role, "CREATIVE_EDIT");
  const project = await creativeRepository.get(staff, projectId);
  const revision = await prisma.creativeRevision.findFirst({
    where: { ...creativeScope(staff), projectId, id: revisionId },
  });
  if (!revision) throw new CreativeError("NOT_FOUND");
  // Restore composition, while retaining current canonical prices and destinations.
  const prior = parseDesignDocument(revision.document);
  const document = applyResolvedBindings(
    prior,
    await resolveCreativeDocument(staff, prior),
  );
  await creativeRepository.validateAssets(staff, document);
  return creativeRepository.save(
    staff,
    projectId,
    expectedVersion,
    project.title,
    document,
    `Restored version ${revision.number}`,
  );
}

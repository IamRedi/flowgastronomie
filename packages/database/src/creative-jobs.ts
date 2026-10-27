import {
  assertStaffPermission,
  CreativeError,
  type CreativeScope,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  creativeScope,
  creativeJson,
  creativeRepository,
} from "./creative-repository.js";
export async function beginCreativeJob(
  staff: CreativeScope,
  projectId: string,
  requestKey: string,
  category: "PLAN" | "PATCH" | "IMAGE" | "EXPORT",
  provider: string,
  model: string,
) {
  assertStaffPermission(
    staff.role,
    category === "EXPORT" ? "CREATIVE_EXPORT" : "CREATIVE_AI_USE",
  );
  await creativeRepository.get(staff, projectId);
  const scope = creativeScope(staff);
  return prisma.$transaction(async (tx) => {
    // Serialize budget/concurrency checks across API processes for this venue.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.tenantId}:${scope.venueId}:creative`}))`;
    const previous = await tx.creativeJob.findFirst({
      where: { ...scope, projectId, requestKey },
    });
    if (previous) return { job: previous, existing: true };
    const recent = {
      ...scope,
      createdAt: { gt: new Date(Date.now() - 60_000) },
    };
    const venueCount = await tx.creativeJob.count({ where: recent });
    const userCount = await tx.creativeJob.count({
      where: { ...recent, createdBy: staff.userId },
    });
    if (venueCount >= 10 || userCount >= 6)
      throw new CreativeError(
        "RATE_LIMIT",
        "Please wait before making another generation or export request.",
      );
    await tx.creativeJob.updateMany({
      where: {
        ...scope,
        state: "PENDING",
        createdAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      data: { state: "UNCERTAIN" },
    });
    if (
      category === "IMAGE" &&
      (await tx.creativeJob.count({
        where: { ...scope, projectId, category: "IMAGE", state: "PENDING" },
      }))
    )
      throw new CreativeError(
        "CONFLICT",
        "An image is already being generated for this design.",
      );
    return {
      job: await tx.creativeJob.create({
        data: {
          ...scope,
          projectId,
          requestKey,
          category,
          provider,
          model,
          usage: {},
          createdBy: staff.userId,
        },
      }),
      existing: false,
    };
  });
}
export async function finishCreativeJob(
  staff: CreativeScope,
  id: string,
  state: "SUCCEEDED" | "FAILED",
  durationMs: number,
  usage: unknown = {},
  resultId: string | null = null,
) {
  assertStaffPermission(staff.role, "CREATIVE_AI_USE");
  await prisma.creativeJob.updateMany({
    where: { ...creativeScope(staff), id, state: "PENDING" },
    data: { state, durationMs, usage: creativeJson(usage), resultId },
  });
}

import {
  assertStaffPermission,
  assertCreativeDailyBudget,
  assertImageAllowance,
  defaultMonthlyImageLimits,
  imageMonthStart,
  nextImageMonthStart,
  imageProviders,
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
  requestFingerprint?: string,
) {
  assertStaffPermission(
    staff.role,
    category === "EXPORT" ? "CREATIVE_EXPORT" : "CREATIVE_AI_USE",
  );
  await creativeRepository.get(staff, projectId);
  const scope = creativeScope(staff);
  return prisma.$transaction(async (tx) => {
    if (category === "IMAGE")
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('creative-image-global'))`;
    // Image quotas serialize by tenant across venues; other creative budgets
    // retain the existing per-venue lock.
    if (category === "IMAGE")
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.tenantId}:creative-image`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.tenantId}:${scope.venueId}:creative`}))`;
    const previous = await tx.creativeJob.findFirst({
      where: { ...scope, projectId, requestKey },
    });
    if (previous) {
      if (
        category === "IMAGE" &&
        (previous.category !== category ||
          previous.provider !== provider ||
          previous.model !== model ||
          previous.requestFingerprint !== requestFingerprint)
      )
        throw new CreativeError(
          "CONFLICT",
          "This request key was used for a different image request.",
        );
      return { job: previous, existing: true };
    }
    if (category === "IMAGE") {
      if (!imageProviders.includes(provider as (typeof imageProviders)[number]))
        throw new CreativeError(
          "INVALID_DESIGN",
          "Unsupported image provider.",
        );
      const dbTime = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT CURRENT_TIMESTAMP AS now`;
      const now = dbTime[0]?.now;
      if (!now) throw new Error("Database clock unavailable");
      const override = await tx.aiImageProviderLimit.findUnique({
        where: { tenantId_provider: { tenantId: scope.tenantId, provider } },
      });
      const control = await tx.aiImageControl.findUnique({
        where: { id: "global" },
      });
      const attempts = await tx.creativeJob.count({
        where: {
          tenantId: scope.tenantId,
          category: "IMAGE",
          provider,
          createdAt: {
            gte: imageMonthStart(now),
            lt: nextImageMonthStart(now),
          },
        },
      });
      assertImageAllowance({
        provider: provider as (typeof imageProviders)[number],
        attempts,
        limit:
          override?.monthlyLimit ??
          defaultMonthlyImageLimits[
            provider as (typeof imageProviders)[number]
          ],
        enabled: override?.enabled ?? true,
        emergencyDisabled: control?.emergencyDisabled ?? false,
      });
    }
    if (category !== "EXPORT")
      assertCreativeDailyBudget(
        category,
        await tx.creativeJob.count({
          where: {
            ...scope,
            category:
              category === "IMAGE" ? "IMAGE" : { in: ["PLAN", "PATCH"] },
            createdAt: { gte: new Date(Date.now() - 86_400_000) },
          },
        }),
      );
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
          requestFingerprint: requestFingerprint ?? null,
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
  state: "SUCCEEDED" | "FAILED" | "UNCERTAIN",
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

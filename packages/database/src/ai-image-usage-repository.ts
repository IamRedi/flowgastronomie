import {
  defaultMonthlyImageLimits,
  imageMonthStart,
  nextImageMonthStart,
  imageProviders,
  type ImageProviderId,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";

export async function tenantImageUsage(tenantId: string, at = new Date()) {
  const [settings, control, jobs] = await Promise.all([
    prisma.aiImageProviderLimit.findMany({ where: { tenantId } }),
    prisma.aiImageControl.findUnique({ where: { id: "global" } }),
    prisma.creativeJob.findMany({
      where: {
        tenantId,
        category: "IMAGE",
        createdAt: { gte: imageMonthStart(at), lt: nextImageMonthStart(at) },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        venueId: true,
        projectId: true,
        provider: true,
        model: true,
        state: true,
        usage: true,
        createdAt: true,
        resultId: true,
      },
    }),
  ]);
  const providers = imageProviders.map((provider) => {
    const setting = settings.find((s) => s.provider === provider);
    const own = jobs.filter((j) => j.provider === provider);
    const estimates = own.map(
      (j) =>
        (j.usage as { estimatedCostUsd?: unknown } | null)?.estimatedCostUsd,
    );
    return {
      provider,
      used: own.length,
      limit: setting?.monthlyLimit ?? defaultMonthlyImageLimits[provider],
      enabled: setting?.enabled ?? true,
      successful: own.filter((j) => j.state === "SUCCEEDED").length,
      uncertain: own.filter((j) => j.state === "UNCERTAIN").length,
      estimatedCostUsd: estimates.reduce<number>(
        (sum, amount) => sum + (typeof amount === "number" ? amount : 0),
        0,
      ),
      unknownCostCount: estimates.filter(
        (amount) => amount === undefined || amount === null,
      ).length,
    };
  });
  return {
    tenantId,
    month: imageMonthStart(at).toISOString().slice(0, 7),
    emergencyDisabled: control?.emergencyDisabled ?? false,
    providers,
    estimatedTotalUsd: providers.reduce(
      (sum, p) => sum + p.estimatedCostUsd,
      0,
    ),
    history: jobs.slice(0, 100).map((j) => ({
      ...j,
      operation:
        (j.usage as { operation?: string } | null)?.operation ?? "UNKNOWN",
      estimatedCostUsd:
        (j.usage as { estimatedCostUsd?: number } | null)?.estimatedCostUsd ??
        null,
      usage: undefined,
    })),
  };
}

export async function platformImageUsage(at = new Date()) {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const businesses = await Promise.all(
    tenants.map(async (tenant) => ({
      name: tenant.name,
      ...(await tenantImageUsage(tenant.id, at)),
    })),
  );
  return {
    month: imageMonthStart(at).toISOString().slice(0, 7),
    businesses,
    totals: imageProviders.map((provider) => ({
      provider,
      used: businesses.reduce(
        (sum, b) =>
          sum + b.providers.find((p) => p.provider === provider)!.used,
        0,
      ),
      estimatedCostUsd: businesses.reduce(
        (sum, b) =>
          sum +
          b.providers.find((p) => p.provider === provider)!.estimatedCostUsd,
        0,
      ),
    })),
    estimatedTotalUsd: businesses.reduce(
      (sum, b) => sum + b.estimatedTotalUsd,
      0,
    ),
    emergencyDisabled:
      businesses[0]?.emergencyDisabled ??
      (await prisma.aiImageControl.findUnique({ where: { id: "global" } }))
        ?.emergencyDisabled ??
      false,
  };
}

export async function setTenantImageLimit(
  tenantId: string,
  provider: ImageProviderId,
  monthlyLimit: number,
  enabled: boolean,
  actor: string,
) {
  if (
    !Number.isSafeInteger(monthlyLimit) ||
    monthlyLimit < 0 ||
    monthlyLimit > 1_000_000
  )
    throw new Error("Invalid monthly image limit");
  if (!imageProviders.includes(provider)) throw new Error("Invalid provider");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('creative-image-global'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:creative-image`}))`;
    if (
      !(await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      }))
    )
      throw new Error("Business not found");
    return tx.aiImageProviderLimit.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      create: { tenantId, provider, monthlyLimit, enabled, updatedBy: actor },
      update: { monthlyLimit, enabled, updatedBy: actor },
    });
  });
}

export async function setImageEmergencyDisabled(
  disabled: boolean,
  actor: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('creative-image-global'))`;
    return tx.aiImageControl.upsert({
      where: { id: "global" },
      create: { id: "global", emergencyDisabled: disabled, updatedBy: actor },
      update: { emergencyDisabled: disabled, updatedBy: actor },
    });
  });
}

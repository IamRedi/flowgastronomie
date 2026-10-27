import { createHash, randomBytes } from "node:crypto";
import type { Prisma, TenantKind } from "@prisma/client";
import {
  businessProvisionSchema,
  assertBusinessProvisionKind,
  businessProfileDefaults,
  resolvePremiumSelection,
  BusinessProvisionConflict,
  createWorkspaceSlug,
  addWorkspaceSlugSuffix,
  entitlementsForPlan,
  PLAN_DEFINITIONS,
  type BusinessProvisionInput,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { hashPassword, verifyPassword } from "./password.js";
import { applyBusinessProfileCategories } from "./business-profile-application.js";

import { applyPremiumTemplate } from "./premium-template-application.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
// Shared by guarded synthetic demo adapters. Public registration uses REAL only;
// callers never provide database IDs or copy a source tenant.
export async function provisionBusinessInTransaction(
  tx: Prisma.TransactionClient,
  value: BusinessProvisionInput,
  kind: TenantKind = "REAL",
) {
  assertBusinessProvisionKind(kind);
  const input = businessProvisionSchema.parse(value);
  if (input.premiumTemplate)
    resolvePremiumSelection(
      input.profileId,
      input.premiumTemplate,
      input.currency,
    );
  const { password, requestKey, ...details } = input;
  const requestKeyHash = hash(requestKey);
  const fingerprint = hash(JSON.stringify({ ...details, kind }));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKeyHash}, 0))`;
  const prior = await tx.businessProvision.findUnique({
    where: { requestKeyHash },
    include: { tenant: true, venue: true, owner: true },
  });
  if (prior) {
    // Pre-review creation receipts omitted region fields. Upgrade a matching
    // retry only when the caller explicitly confirms the stored venue values.
    const { timezone, currency, ...legacyDetails } = details;
    const legacyMatch =
      prior.fingerprint === hash(JSON.stringify({ ...legacyDetails, kind })) &&
      prior.venue.timezone === timezone &&
      prior.venue.currency === currency;
    if (
      (prior.fingerprint !== fingerprint && !legacyMatch) ||
      !(await verifyPassword(password, prior.owner.passwordHash))
    )
      throw new BusinessProvisionConflict();
    if (legacyMatch)
      await tx.businessProvision.update({
        where: { requestKeyHash },
        data: { fingerprint },
      });
    const membership = await tx.membership.findFirstOrThrow({
      where: {
        tenantId: prior.tenantId,
        venueId: prior.venueId,
        userId: prior.ownerId,
        role: "OWNER",
      },
    });
    return {
      tenant: prior.tenant,
      venue: prior.venue,
      owner: prior.owner,
      membership,
      created: false,
    };
  }
  const template = businessProfileDefaults(
    input.profileId,
    input.applyCategories || input.premiumTemplate?.includeSampleMenu === true,
  );
  const passwordHash = await hashPassword(password);
  const baseSlug = createWorkspaceSlug(input.organizationName);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`tenant-slug:${baseSlug}`}, 0))`;
  const existing = await tx.tenant.findUnique({
    where: { slug: baseSlug },
    select: { id: true },
  });
  const slug = existing
    ? addWorkspaceSlugSuffix(baseSlug, randomBytes(6).toString("hex"))
    : baseSlug;
  const tenant = await tx.tenant.create({
    data: {
      name: input.organizationName,
      slug,
      kind,
      businessProfileId: template.id,
      businessProfileVersion: template.version,
    },
  });
  const venue = await tx.venue.create({
    data: {
      tenantId: tenant.id,
      name: input.venueName,
      slug: createWorkspaceSlug(input.venueName),
      defaultLocale: input.locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
      countryCode: input.countryCode ?? null,
      timezone: input.timezone,
      currency: input.currency,
      defaultServiceMode: "MENU_ONLY",
      onlinePickupEnabled: false,
      onlineDeliveryEnabled: false,
      onlineCateringEnabled: false,
    },
  });
  const scope = { tenantId: tenant.id, venueId: venue.id };
  const owner = await tx.user.create({
    data: {
      tenantId: tenant.id,
      email: input.email,
      displayName: input.ownerDisplayName,
      passwordHash,
    },
  });
  const membership = await tx.membership.create({
    data: { ...scope, userId: owner.id, role: "OWNER" },
  });
  await tx.staffProfile.create({
    data: {
      ...scope,
      userId: owner.id,
      membershipId: membership.id,
      preferredLocale: venue.defaultLocale,
    },
  });
  await tx.venueWebsite.create({
    data: {
      ...scope,
      publicSlug: createWorkspaceSlug(`${tenant.slug}-${venue.slug}`),
      primaryColor: template.website.primaryColor,
      accentColor: template.website.accentColor,
      openingHours: [],
    },
  });
  await applyBusinessProfileCategories(tx, scope, template);
  if (input.premiumTemplate)
    await applyPremiumTemplate(
      tx,
      scope,
      input.profileId,
      input.premiumTemplate,
      input.currency,
      { userId: owner.id, membershipId: membership.id },
    );
  await tx.smartSetup.create({
    data: {
      ...scope,
      profileId: template.id,
      profileVersion: template.version,
      appliedProfiles:
        input.applyCategories ||
        input.premiumTemplate?.includeSampleMenu === true
          ? [`${template.id}:${template.version}`]
          : [],
      updatedBy: owner.id,
    },
  });
  const now = new Date();
  const subscription = await tx.subscription.create({
    data: {
      tenantId: tenant.id,
      plan: input.plan,
      status: "TRIALING",
      trialStartedAt: now,
      trialEndsAt: new Date(
        now.getTime() + PLAN_DEFINITIONS[input.plan].trialDays * 86_400_000,
      ),
    },
  });
  await tx.entitlement.createMany({
    data: entitlementsForPlan(input.plan).map((e) => ({
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      featureKey: e.featureKey,
      enabled: e.enabled,
      limitInt: e.limit,
    })),
  });
  await tx.subscriptionUsage.createMany({
    data: [
      { usageKey: "VENUES", quantity: 1 },
      { usageKey: "STAFF_SEATS", quantity: 1 },
      { usageKey: "PUBLISHED_SITES", quantity: 0 },
    ].map((row) => ({
      ...row,
      tenantId: tenant.id,
      subscriptionId: subscription.id,
    })),
  });
  await tx.businessProvision.create({
    data: {
      requestKeyHash,
      fingerprint,
      ...scope,
      ownerId: owner.id,
      profileSnapshot: {
        ...template,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        ...(input.premiumTemplate
          ? { premiumTemplate: input.premiumTemplate }
          : {}),
      } as Prisma.InputJsonValue,
    },
  });
  await tx.auditEvent.create({
    data: {
      ...scope,
      actorUserId: owner.id,
      actorMembershipId: membership.id,
      action: "BUSINESS_PROVISIONED",
      entityType: "Tenant",
      entityId: tenant.id,
      metadata: {
        kind,
        profileId: template.id,
        profileVersion: template.version,
        categoriesApplied: input.applyCategories,
      },
    },
  });
  return { tenant, venue, owner, membership, created: true };
}
export async function provisionBusiness(value: BusinessProvisionInput) {
  return prisma.$transaction(
    (tx) => provisionBusinessInTransaction(tx, value, "REAL"),
    { timeout: 15_000 },
  );
}

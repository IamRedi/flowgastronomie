import {
  assertFoundationLocalEnvironment,
  flagshipProfileIds,
  premiumShowcase,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { provisionBusinessInTransaction } from "./business-provisioner.js";

export const demoProfiles = flagshipProfileIds;
type DemoProfile = (typeof demoProfiles)[number];
export async function bootstrapDemo(
  profile: DemoProfile,
  password: string,
  reset = false,
  env = process.env,
) {
  assertFoundationLocalEnvironment(env);
  if (!demoProfiles.includes(profile)) throw new Error("Unknown demo profile");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`demo:${profile}`}, 0))`;
      const current = await tx.demoWorkspace.findUnique({
        where: { profileId: profile },
        include: { tenant: true },
      });
      if (
        current &&
        (current.tenant.kind !== "DEMO" ||
          current.tenant.businessProfileId !== profile)
      )
        throw new Error("Demo registry ownership mismatch");
      if (current && !reset) {
        const venue = await tx.venue.findFirstOrThrow({
          where: { tenantId: current.tenantId },
        });
        const owner = await tx.membership.findFirstOrThrow({
          where: { tenantId: current.tenantId, role: "OWNER" },
          include: { user: true },
        });
        return {
          tenantId: current.tenantId,
          tenantSlug: current.tenant.slug,
          venueId: venue.id,
          venueSlug: venue.slug,
          email: owner.user.email,
          generation: current.generation,
          created: false,
        };
      }
      const generation =
        (current?.generation ?? 1) + (current && reset ? 1 : 0);
      if (current && reset) {
        const tenantId = current.tenantId;
        const owner = await tx.membership.findFirstOrThrow({
          where: { tenantId, role: "OWNER" },
        });
        // Retire the old generation, preserving operational/financial history.
        await tx.tenant.update({
          where: { id: tenantId },
          data: { retiredAt: new Date() },
        });
        await tx.staffSession.updateMany({
          where: { tenantId },
          data: { revokedAt: new Date() },
        });
        await tx.diningTable.updateMany({
          where: { tenantId },
          data: { qrRevokedAt: new Date() },
        });
        await tx.membership.updateMany({
          where: { tenantId },
          data: { active: false },
        });
        await tx.user.updateMany({
          where: { tenantId },
          data: { active: false },
        });
        await tx.venueWebsite.updateMany({
          where: { tenantId },
          data: { status: "DRAFT" },
        });
        await tx.product.updateMany({
          where: { tenantId },
          data: { published: false, available: false },
        });
        await tx.venue.updateMany({
          where: { tenantId },
          data: {
            defaultServiceMode: "MENU_ONLY",
            onlinePickupEnabled: false,
            onlineDeliveryEnabled: false,
            onlineCateringEnabled: false,
          },
        });
        await tx.auditEvent.create({
          data: {
            tenantId,
            venueId: owner.venueId,
            actorUserId: owner.userId,
            actorMembershipId: owner.id,
            action: "DEMO_GENERATION_RETIRED",
            entityType: "Tenant",
            entityId: tenantId,
            metadata: { profile, generation: current.generation },
          },
        });
      }
      const name = `${premiumShowcase(profile).name} · DEMO`;
      const business = await provisionBusinessInTransaction(
        tx,
        {
          requestKey: `foundation:demo:${profile}:v1:g${generation}`,
          organizationName: name,
          venueName: name,
          ownerDisplayName: "DEMO Owner",
          email: `owner@${profile.toLowerCase().replaceAll("_", "-")}.demo.local`,
          password,
          locale: "de",
          timezone: "Europe/Berlin",
          currency: "EUR",
          plan: "RESTAURANT_PRO",
          profileId: profile,
          applyCategories: true,
          premiumTemplate: {
            styleId: premiumShowcase(profile).styles[0].id,
            version: 1,
            confirmed: true,
            includeSampleMenu: true,
          },
        },
        "DEMO",
      );
      if (business.created) {
        await tx.demoWorkspace.upsert({
          where: { profileId: profile },
          create: {
            profileId: profile,
            generation,
            tenantId: business.tenant.id,
          },
          update: { generation, tenantId: business.tenant.id },
        });
      }
      return {
        tenantId: business.tenant.id,
        tenantSlug: business.tenant.slug,
        venueId: business.venue.id,
        venueSlug: business.venue.slug,
        email: business.owner.email,
        generation,
        created: business.created,
      };
    },
    { timeout: 20_000 },
  );
}

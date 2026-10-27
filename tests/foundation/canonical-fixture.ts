import { assertFoundationLocalEnvironment } from "@flowgastronomie/domain";
import { prisma } from "../../packages/database/src/client.js";
import { provisionBusinessInTransaction } from "../../packages/database/src/business-provisioner.js";
import { hashPassword } from "../../packages/database/src/password.js";
import { normalizeCanonicalImage } from "../../packages/database/src/media-storage-adapter.js";
import {
  assignCanonicalMedia,
  storeCanonicalMedia,
  canonicalMediaRepository,
} from "../../packages/database/src/canonical-media-repository.js";

export async function provisionCanonicalFixture(
  input: {
    ownerPassword: string;
    managerPassword: string;
    logo: Buffer;
    margheritaDemoImage: Buffer;
    confirmedMargheritaPriceMinor?: number;
  },
  env = process.env,
) {
  assertFoundationLocalEnvironment(env);
  if (
    !/^foundation_gate_\d+$/.test(
      new URL(env.DATABASE_URL ?? "").searchParams.get("schema") ?? "",
    )
  )
    throw new Error(
      "Canonical fixtures require an isolated foundation test schema",
    );
  if (input.ownerPassword.length < 12 || input.managerPassword.length < 12)
    throw new Error("Use local passwords of at least 12 characters.");
  if (
    input.confirmedMargheritaPriceMinor !== undefined &&
    (!Number.isSafeInteger(input.confirmedMargheritaPriceMinor) ||
      input.confirmedMargheritaPriceMinor < 1 ||
      input.confirmedMargheritaPriceMinor > 100000)
  )
    throw new Error("Invalid confirmed menu price");
  const [logo, photo, managerHash] = await Promise.all([
    normalizeCanonicalImage(input.logo),
    normalizeCanonicalImage(input.margheritaDemoImage),
    hashPassword(input.managerPassword),
  ]);
  const result = await prisma.$transaction(
    async (tx) => {
      const business = await provisionBusinessInTransaction(
        tx,
        {
          requestKey: "foundation:synthetic-fixture:v1",
          organizationName: "Synthetic Pizza Fixture",
          venueName: "Synthetic Pizza Fixture",
          ownerDisplayName: "Synthetic Fixture Owner",
          email: "owner@fixture.example",
          password: input.ownerPassword,
          locale: "de",
          timezone: "Europe/Berlin",
          currency: "EUR",
          plan: "RESTAURANT_PRO",
          profileId: "PIZZERIA",
          applyCategories: true,
        },
        "DEMO",
      );
      const scope = {
        tenantId: business.tenant.id,
        venueId: business.venue.id,
      };
      if (business.created) {
        await tx.venue.update({
          where: { id: business.venue.id },
          data: { city: "Sample City", entrance: "Sample entrance" },
        });
        await tx.venueWebsite.update({
          where: { venueId: business.venue.id },
          data: {
            address: "Sample Street 1, 12345 Sample City, Germany",
            phone: "+49 30 000000",
            contactEmail: "pizza@fixture.example",
            primaryColor: "#243c30",
            accentColor: "#b54c32",
            publicSlug: "synthetic-pizza-fixture",
            translations: {
              create: (["EN", "DE", "IT", "SQ"] as const).map((locale) => ({
                ...scope,
                locale,
                heroTitle: "Synthetic Pizza Fixture",
                heroSubtitle: "Sample City · Sample entrance",
                storyTitle: "Synthetic Pizza Fixture",
                storyBody: "Sample Street 1, 12345 Sample City, Germany",
                seoTitle: "Synthetic Pizza Fixture · Local review",
                seoDescription:
                  "Synthetic fixture for internal product review.",
              })),
            },
          },
        });
        const manager = await tx.user.create({
          data: {
            tenantId: scope.tenantId,
            email: "manager@fixture.example",
            displayName: "Synthetic Fixture Manager",
            passwordHash: managerHash,
          },
        });
        const membership = await tx.membership.create({
          data: { ...scope, userId: manager.id, role: "MANAGER" },
        });
        await tx.staffProfile.create({
          data: {
            ...scope,
            userId: manager.id,
            membershipId: membership.id,
            preferredLocale: "SQ",
          },
        });
        await tx.subscriptionUsage.updateMany({
          where: { tenantId: scope.tenantId, usageKey: "STAFF_SEATS" },
          data: { quantity: 2 },
        });
        const category = await tx.menuCategory.findFirstOrThrow({
          where: scope,
          orderBy: { sortOrder: "asc" },
        });
        const priceMinor = input.confirmedMargheritaPriceMinor ?? 950;
        const product = await tx.product.create({
          data: {
            ...scope,
            categoryId: category.id,
            station: "KITCHEN",
            priceMinor,
            currency: business.venue.currency,
            published: true,
            dataProvenance: {
              priceSource:
                input.confirmedMargheritaPriceMinor === undefined
                  ? "DEMO_FIXTURE"
                  : "OWNER_CONFIRMED",
              reviewOnly: input.confirmedMargheritaPriceMinor === undefined,
            },
            translations: {
              create: (["EN", "DE", "IT", "SQ"] as const).map((locale) => ({
                ...scope,
                locale,
                name: "Margherita",
                description:
                  input.confirmedMargheritaPriceMinor === undefined
                    ? "Local review · sample price, pending owner confirmation"
                    : "",
              })),
            },
          },
        });
        await tx.menuCategory.update({
          where: { id: category.id },
          data: { published: true },
        });
        const actor = {
          ...scope,
          userId: business.owner.id,
          membershipId: business.membership.id,
          role: "OWNER" as const,
        };
        const logoAsset = await storeCanonicalMedia(tx, actor, {
          image: logo,
          sourceKey: "fixture:provided-logo:v1",
          provenance: {
            source: "IMPORT",
            description:
              "User-provided Synthetic Pizza Fixture logo imported by the guarded synthetic fixture setup.",
            originalAssetId: "synthetic-logo-v1",
          },
          approvedForPublicUse: false,
          confirmed: true,
        });
        await assignCanonicalMedia(tx, actor, logoAsset.id, {
          venueRole: "LOGO",
        });
        const imageAsset = await storeCanonicalMedia(tx, actor, {
          image: photo,
          sourceKey: "fixture:margherita-demo:v1",
          provenance: {
            source: "DEMO",
            description:
              "Existing synthetic Margherita illustration for internal review. Not a photograph of fixture food.",
            originalAssetId: "pilot/demo-food/margherita.webp",
          },
          approvedForPublicUse: false,
          confirmed: true,
        });
        await assignCanonicalMedia(tx, actor, imageAsset.id, {
          productId: product.id,
        });
        await tx.auditEvent.create({
          data: {
            ...scope,
            actorUserId: actor.userId,
            actorMembershipId: actor.membershipId,
            action: "DEMO_CREATED",
            entityType: "Venue",
            entityId: scope.venueId,
            metadata: {
              identitySource: "BUSINESS_PROFILE_DEMO_FOUNDATION.md",
              priceNeedsConfirmation:
                input.confirmedMargheritaPriceMinor === undefined,
              productionActivation: false,
            },
          },
        });
      }
      return {
        ...scope,
        tenantSlug: business.tenant.slug,
        venueSlug: business.venue.slug,
        created: business.created,
      };
    },
    { timeout: 20_000 },
  );
  return { ...result, media: await canonicalMediaRepository.resolve(result) };
}

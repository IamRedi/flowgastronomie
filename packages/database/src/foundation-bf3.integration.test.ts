import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "./client.js";
import { provisionBusiness } from "./business-provisioner.js";
import {
  canonicalMediaRepository,
  storeCanonicalMedia,
  assignCanonicalMedia,
} from "./canonical-media-repository.js";
import { normalizeCanonicalImage } from "./media-storage-adapter.js";
import { mapPublishedMenuCategories } from "./public-menu-repository.js";
describe.skipIf(process.env.FOUNDATION_DB_GATE !== "true")(
  "BF3 canonical media",
  () => {
    afterAll(() => prisma.$disconnect());
    it("isolates ownership, retains provenance and replaces associations without rewriting history", async () => {
      const input = {
        organizationName: "Media venue",
        venueName: "Media venue",
        ownerDisplayName: "Owner",
        email: "owner@media.test",
        password: "media-test-password",
        locale: "de" as const,
        timezone: "Europe/Berlin",
        currency: "EUR",
        plan: "RESTAURANT_PRO" as const,
        profileId: "PIZZERIA" as const,
        applyCategories: true,
      };
      const a = await provisionBusiness({
        ...input,
        requestKey: "bf3-media-business-a",
      });
      const b = await provisionBusiness({
        ...input,
        requestKey: "bf3-media-business-b",
      });
      const actor = {
        tenantId: a.tenant.id,
        venueId: a.venue.id,
        userId: a.owner.id,
        membershipId: a.membership.id,
        role: "OWNER" as const,
      };
      const category = await prisma.menuCategory.findFirstOrThrow({
        where: { venueId: a.venue.id },
      });
      const product = await prisma.product.create({
        data: {
          tenantId: a.tenant.id,
          venueId: a.venue.id,
          categoryId: category.id,
          priceMinor: 950,
          station: "KITCHEN",
          published: true,
        },
      });
      const bytes = await sharp({
        create: { width: 100, height: 80, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const image = await normalizeCanonicalImage(bytes);
      const store = () =>
        prisma.$transaction(async (tx) => {
          const asset = await storeCanonicalMedia(tx, actor, {
            image,
            sourceKey: "demo-photo-v1",
            provenance: {
              source: "DEMO",
              description: "Internal demo illustration",
            },
            approvedForPublicUse: false,
            confirmed: true,
          });
          await assignCanonicalMedia(tx, actor, asset.id, {
            productId: product.id,
          });
          return asset;
        });
      const original = await store();
      expect((await store()).id).toBe(original.id);
      const canonical = await canonicalMediaRepository.resolve(actor);
      expect(canonical.products[0]?.media.label).toBe("DEMO illustration");
      expect(
        (await canonicalMediaRepository.resolve(actor, true)).products,
      ).toHaveLength(0);
      expect(await canonicalMediaRepository.content(original.id)).toBeNull();
      expect(
        await canonicalMediaRepository.content(original.id, {
          tenantId: b.tenant.id,
          venueId: b.venue.id,
        }),
      ).toBeNull();
      await expect(
        prisma.productMedia.create({
          data: {
            tenantId: b.tenant.id,
            venueId: b.venue.id,
            productId: product.id,
            mediaAssetId: original.id,
            role: "PRIMARY",
          },
        }),
      ).rejects.toThrow();
      const replacement = await canonicalMediaRepository.upload(
        actor,
        bytes,
        { productId: product.id },
        true,
      );
      expect(replacement.id).not.toBe(original.id);
      expect(
        (
          await prisma.mediaAsset.findUniqueOrThrow({
            where: { id: original.id },
          })
        ).contentHash,
      ).toBe(original.contentHash);
      const published = await canonicalMediaRepository.resolve(actor, true);
      expect(published.products[0]?.media.id).toBe(replacement.id);
      const mapped = mapPublishedMenuCategories(
        [
          {
            id: category.id,
            translations: [{ locale: "DE", name: "Pizza" }],
            products: [
              {
                ...product,
                translations: [{ locale: "DE", name: "Margherita" }],
                allergens: [],
                variants: [],
                modifierGroups: [],
              },
            ],
          },
        ],
        "DE",
        "DE",
        new Map(published.products.map((row) => [row.productId, row.media])),
      );
      expect(mapped[0]?.products[0]?.media).toEqual(
        published.products[0]?.media,
      );
      await expect(
        normalizeCanonicalImage(Buffer.from("not an image")),
      ).rejects.toThrow();
      await expect(
        canonicalMediaRepository.upload(
          { ...actor, venueId: b.venue.id },
          bytes,
          { productId: product.id },
          true,
        ),
      ).rejects.toThrow();
    });
  },
);

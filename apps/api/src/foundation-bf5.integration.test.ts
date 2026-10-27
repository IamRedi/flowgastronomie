import { afterAll, describe, expect, it } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseDesignDocument } from "@flowgastronomie/domain";
import {
  prisma,
  staffAuthRepository,
  creativeSourceCatalog,
  creativeRepository,
} from "@flowgastronomie/database";
import { provisionCanonicalFixture } from "../../../tests/foundation/canonical-fixture.js";
import { composeCreativeProject } from "./creative-workspace-service.js";
import { creativePreflight, exportCreative } from "./creative-export.js";
import { creativeStorage } from "./creative-storage.js";
import { promoteCreativeMedia } from "./creative-canonical-media.js";
import sharp from "sharp";
describe.skipIf(process.env.FOUNDATION_DB_GATE !== "true")(
  "BF5 canonical Creative handoff",
  () => {
    afterAll(() => prisma.$disconnect());
    it("renders first-generation Synthetic Pizza Fixture/Margherita from canonical identity, media and live price", async () => {
      const env = {
        ...process.env,
        NODE_ENV: "development",
        FOUNDATION_LOCAL_ENABLE: "1",
        CI: undefined,
      };
      const input = {
        ownerPassword: "bf5-owner-local-password",
        managerPassword: "bf5-manager-local-password",
        logo: await readFile("../../tests/foundation/synthetic-logo.jpg"),
        margheritaDemoImage: await readFile(
          "../../apps/web/public/pilot/demo-food/margherita.webp",
        ),
      };
      const fixture = await provisionCanonicalFixture(input, env);
      const { staff } = await staffAuthRepository.login({
        ...fixture,
        email: "owner@fixture.example",
        password: input.ownerPassword,
      });
      const catalog = await creativeSourceCatalog(staff, "de");
      expect(catalog.venue.name).toBe("Synthetic Pizza Fixture");
      expect(catalog.brand?.address).toBe(
        "Sample Street 1, 12345 Sample City, Germany",
      );
      const project = await composeCreativeProject(staff, {
        material: "BROCHURE",
        locale: "de",
        instruction: "Margherita",
        campaignText: "Margherita",
        productIds: [],
        assetIds: [],
      });
      const document = parseDesignDocument(project.document);
      expect(
        document.bindings.find((b) => b.field === "price")?.value,
      ).toContain("9,50");
      expect(
        document.bindings.find((b) => b.id === "directions_qr")?.value,
      ).toContain(encodeURIComponent(catalog.brand!.address!));
      const preflight = await creativePreflight(staff, project.id);
      expect(preflight.project.document.theme).toMatchObject({
        primary: "#243c30",
        accent: "#b54c32",
      });
      const layers = preflight.project.document.pages[0]!.layers;
      expect(layers.some((l) => l.type === "logo")).toBe(true);
      expect(layers.some((l) => l.type === "image")).toBe(true);
      expect(layers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "feature_card",
            type: "shape",
            radius: 30,
          }),
          expect.objectContaining({
            id: "product_0",
            type: "product",
            fontSize: 44,
          }),
          expect.objectContaining({
            id: "price_0",
            type: "price",
            fontSize: 38,
          }),
        ]),
      );
      expect(
        layers.find((l) => l.id === "foundation_review_disclosure"),
      ).toMatchObject({ text: "INTERNAL REVIEW · DEMO image · SAMPLE PRICE" });
      const assets = await creativeRepository.assets(staff);
      expect(assets).toHaveLength(2);
      for (const asset of assets)
        expect(asset.provenance).toHaveProperty("canonicalMediaId");
      await mkdir("../../artifacts/foundation", { recursive: true });
      for (const type of ["PNG", "PDF"] as const) {
        const current = await creativePreflight(staff, project.id);
        const exported = await exportCreative(staff, project.id, {
          type,
          expectedVersion: current.project.version,
          confirmationHash: current.confirmationHash,
          keepStale: false,
          bleed: true,
          cropMarks: true,
          requestKey: randomUUID(),
        });
        const record = await prisma.creativeExport.findUniqueOrThrow({
          where: { id: exported.id },
        });
        const bytes = await creativeStorage.read(record.storageKey);
        expect(bytes.length).toBeGreaterThan(10000);
        await writeFile(
          `../../artifacts/foundation/synthetic-first-generation.${type.toLowerCase()}`,
          bytes,
        );
      }
      const productId = catalog.products[0]!.id;
      await prisma.product.update({
        where: { id: productId },
        data: { priceMinor: 1050 },
      });
      const changed = await creativePreflight(staff, project.id);
      expect(
        changed.changes.some((c) => c.current?.value?.includes("10,50")),
      ).toBe(true);
      // Approval cannot be bypassed when promoting a Creative asset.
      await expect(
        promoteCreativeMedia(staff, assets[0]!.id, { productId }, false),
      ).rejects.toThrow();
      const generatedBytes = await sharp(input.margheritaDemoImage)
        .png()
        .toBuffer();
      const key = await creativeStorage.put(generatedBytes);
      const generated = await prisma.creativeAsset.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          name: "Test generated illustration",
          source: "GENERATED",
          mimeType: "image/png",
          width: 480,
          height: 360,
          contentHash: key,
          storageKey: key,
          createdBy: staff.userId,
          provenance: {
            provider: "acceptance-fixture",
            model: "fixture-v1",
            prompt: "Synthetic test fixture",
          },
        },
      });
      const promoted = await promoteCreativeMedia(
        staff,
        generated.id,
        { productId },
        true,
      );
      const canonical = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: promoted.mediaAssetId },
      });
      expect(canonical.source).toBe("GENERATED");
      expect(canonical.provenance).toMatchObject({
        provider: "acceptance-fixture",
        model: "fixture-v1",
        originalAssetId: generated.id,
      });
      await expect(
        promoteCreativeMedia(staff, generated.id, { venueRole: "LOGO" }, true),
      ).rejects.toThrow();
    }, 60_000);
  },
);

import { randomUUID, createHash } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import Fastify from "fastify";
import {
  prisma,
  creativeRepository,
  resolveCreativeBinding,
  creativeScope,
  beginCreativeJob,
  finishCreativeJob,
  syncCreativeProject,
  restoreCreativeRevision,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  createDesign,
  createTextLayer,
  instantiateCreativeTemplate,
  type CreativeBinding,
} from "@flowgastronomie/domain";
import { registerCreativeRoutes } from "./creative-routes.js";
import { planCreative } from "./creative-planner-service.js";
import { creativePreflight, exportCreative } from "./creative-export.js";
import { creativeStorage } from "./creative-storage.js";
import { generateCreativeAsset } from "./creative-image-service.js";
import sharp from "sharp";
import { composeCreativeProject } from "./creative-workspace-service.js";
describe.skipIf(process.env.CREATIVE_DB_GATE !== "true")(
  "CS6 isolated PostgreSQL acceptance",
  () => {
    afterAll(() => prisma.$disconnect());
    it("completes a real product design, reviewed AI edit, price change, PNG/PDF and role/scope checks", async () => {
      const tenant = await prisma.tenant.create({
        data: { name: "Acceptance restaurant", slug: randomUUID() },
      });
      const venue = await prisma.venue.create({
        data: {
          tenantId: tenant.id,
          name: "Olive acceptance",
          slug: randomUUID(),
          defaultLocale: "EN",
        },
      });
      const staff = {
        tenantId: tenant.id,
        venueId: venue.id,
        userId: "acceptance",
        role: "MANAGER",
      } as StaffIdentity;
      const foreign = await prisma.tenant.create({
        data: { name: "Other", slug: randomUUID() },
      });
      const foreignVenue = await prisma.venue.create({
        data: { tenantId: foreign.id, name: "Other", slug: randomUUID() },
      });
      const other = {
        ...staff,
        tenantId: foreign.id,
        venueId: foreignVenue.id,
      };
      const category = await prisma.menuCategory.create({
        data: {
          ...creativeScope(staff),
          published: true,
          translations: {
            create: { ...creativeScope(staff), locale: "EN", name: "Pizza" },
          },
        },
      });
      const product = await prisma.product.create({
        data: {
          ...creativeScope(staff),
          categoryId: category.id,
          priceMinor: 1050,
          currency: "EUR",
          station: "KITCHEN",
          published: true,
          translations: {
            create: {
              ...creativeScope(staff),
              locale: "EN",
              name: "Margherita",
              description: "Tomato, mozzarella and basil",
            },
          },
        },
      });
      const binding = (field: "name" | "price"): CreativeBinding => ({
        id: field,
        sourceType: "PRODUCT",
        sourceId: product.id,
        field,
        value: "",
        version: "",
      });
      const bindings = await Promise.all([
        resolveCreativeBinding(staff, binding("name"), "en"),
        resolveCreativeBinding(staff, binding("price"), "en"),
      ]);
      let document = instantiateCreativeTemplate(
        "Product spotlight",
        "SOCIAL",
        "en",
        bindings,
      );
      const project = await creativeRepository.create(
        staff,
        "Margherita spotlight",
        document,
      );
      const proposal = await planCreative(
        staff,
        project.id,
        {
          instruction: "Make this more minimal",
          mode: "PATCH",
          expectedVersion: 0,
          productIds: [],
          selectedLayerIds: [],
          requestKey: randomUUID(),
          quality: false,
        },
        {
          provider: "mock",
          model: "acceptance",
          createPlan: async () => {
            throw new Error("not used");
          },
          createPatch: async () => ({
            value: {
              summary: "Removed the call to action",
              patches: [{ op: "remove", layerId: "cta" }],
            },
            usage: { inputTokens: 100, outputTokens: 30, images: 0 },
          }),
        },
      );
      const app = Fastify();
      registerCreativeRoutes(app, async (request) =>
        request.headers["x-test-role"] === "WAITER"
          ? { ...staff, role: "WAITER" }
          : request.headers["x-test-role"] === "FOREIGN"
            ? other
            : staff,
      );
      const recovered = await app.inject({
        url: `/v1/staff/creative/projects/${project.id}/proposal`,
      });
      expect(recovered.json().id).toBe(proposal.id);
      expect(
        (
          await app.inject({
            url: `/v1/staff/creative/projects/${project.id}/proposal`,
            headers: { "x-test-role": "FOREIGN" },
          })
        ).statusCode,
      ).toBe(404);
      const accepted = await app.inject({
        method: "POST",
        url: `/v1/staff/creative/projects/${project.id}/ai/accept`,
        payload: { conversationId: proposal.id, expectedVersion: 0 },
      });
      expect(accepted.statusCode).toBe(200);
      expect(
        (
          await app.inject({
            url: `/v1/staff/creative/projects/${project.id}/proposal`,
          })
        ).json(),
      ).toBeNull();
      document = accepted.json().document;
      document.pages[0]!.layers.push({
        ...createTextLayer("manual", "An evening together"),
        y: 600,
      });
      let saved = await creativeRepository.save(
        staff,
        project.id,
        1,
        project.title,
        document,
      );
      await prisma.product.update({
        where: { id: product.id },
        data: { priceMinor: 1100 },
      });
      const stale = await creativePreflight(staff, project.id);
      expect(stale.changes).toHaveLength(1);
      await expect(
        exportCreative(staff, project.id, {
          type: "PNG",
          expectedVersion: saved.version,
          confirmationHash: stale.confirmationHash,
          keepStale: false,
          bleed: false,
          cropMarks: false,
          requestKey: randomUUID(),
        }),
      ).rejects.toThrow("Review changed");
      document = {
        ...document,
        bindings: stale.resolved,
        pages: [
          {
            ...document.pages[0]!,
            layers: document.pages[0]!.layers.map((l) =>
              "text" in l && l.bindingId
                ? {
                    ...l,
                    text: stale.resolved.find((b) => b.id === l.bindingId)!
                      .value,
                  }
                : l,
            ),
          },
        ],
      };
      saved = await creativeRepository.save(
        staff,
        project.id,
        saved.version,
        project.title,
        document,
      );
      const ready = await creativePreflight(staff, project.id);
      const key = randomUUID();
      const png = await exportCreative(staff, project.id, {
        type: "PNG",
        expectedVersion: saved.version,
        confirmationHash: ready.confirmationHash,
        keepStale: false,
        bleed: false,
        cropMarks: false,
        requestKey: key,
      });
      expect(
        (
          await exportCreative(staff, project.id, {
            type: "PNG",
            expectedVersion: saved.version,
            confirmationHash: ready.confirmationHash,
            keepStale: false,
            bleed: false,
            cropMarks: false,
            requestKey: key,
          })
        ).id,
      ).toBe(png.id);
      const pngRecord = await prisma.creativeExport.findFirstOrThrow({
        where: { ...creativeScope(staff), id: png.id },
      });
      const bytes = await creativeStorage.read(pngRecord.storageKey);
      expect(await sharp(bytes).metadata()).toMatchObject({
        width: 1080,
        height: 1350,
      });
      const originalHash = pngRecord.snapshotHash;
      for (const format of ["STORY", "A4", "A5"] as const) {
        const current = await creativeRepository.get(staff, project.id);
        const next = instantiateCreativeTemplate(
          format === "STORY" ? "Product spotlight" : "Printed menu",
          format,
          "en",
          stale.resolved,
        );
        saved = await creativeRepository.save(
          staff,
          project.id,
          current.version,
          project.title,
          next,
        );
      }
      const print = await creativePreflight(staff, project.id);
      const pdf = await exportCreative(staff, project.id, {
        type: "PDF",
        expectedVersion: print.project.version,
        confirmationHash: print.confirmationHash,
        keepStale: false,
        bleed: true,
        cropMarks: true,
        requestKey: randomUUID(),
      });
      expect(pdf.outputType).toBe("PDF");
      const qrStaff = { ...staff, userId: "acceptance-qr" };
      const token = "creative_acceptance_table_token_123456789";
      const table = await prisma.diningTable.create({
        data: {
          ...creativeScope(staff),
          label: "12",
          qrTokenHash: createHash("sha256").update(token).digest("hex"),
        },
      });
      const qrBinding = await resolveCreativeBinding(
        qrStaff,
        {
          id: "table_qr",
          sourceType: "TABLE_QR",
          sourceId: table.id,
          field: "destination",
          value: `http://localhost:3400/en/menu/${token}`,
          version: "",
        },
        "en",
      );
      const qrProject = await creativeRepository.create(
        qrStaff,
        "Table 12",
        instantiateCreativeTemplate("QR table card", "TABLE_CARD", "en", [
          qrBinding,
        ]),
      );
      const qrReady = await creativePreflight(qrStaff, qrProject.id);
      const qrPdf = await exportCreative(qrStaff, qrProject.id, {
        type: "PDF",
        expectedVersion: 0,
        confirmationHash: qrReady.confirmationHash,
        keepStale: false,
        bleed: false,
        cropMarks: false,
        requestKey: randomUUID(),
      });
      expect(qrPdf.outputType).toBe("PDF");
      await prisma.diningTable.update({
        where: { id: table.id },
        data: { qrRevokedAt: new Date() },
      });
      await expect(creativePreflight(qrStaff, qrProject.id)).rejects.toThrow(
        "unavailable",
      );
      const foreignSource = await app.inject({
        method: "POST",
        url: "/v1/staff/creative/sources/resolve",
        headers: { "x-test-role": "FOREIGN" },
        payload: { locale: "en", binding: bindings[0] },
      });
      expect(foreignSource.statusCode).toBe(400);
      expect(foreignSource.json().code).toBe("UNRESOLVED_SOURCE");
      expect(
        (
          await prisma.creativeExport.findFirstOrThrow({
            where: { id: png.id, ...creativeScope(staff) },
          })
        ).snapshotHash,
      ).toBe(originalHash);
      const imageBytes = await sharp({
        create: {
          width: 1024,
          height: 1024,
          channels: 4,
          background: "#b78b52",
        },
      })
        .png()
        .toBuffer();
      const image = await generateCreativeAsset(
        staff,
        project.id,
        {
          prompt: "Decorative basil",
          requestKey: randomUUID(),
          sourceLayerId: null,
        },
        {
          provider: "openai",
          model: "gpt-image-2.5-flare",
          generateAsset: async ({ output }) => {
            expect(output).toMatchObject({
              width: 1024,
              height: 1024,
              quality: "medium",
            });
            return {
              bytes: imageBytes,
              mimeType: "image/png",
              usage: { inputTokens: 0, outputTokens: 0, images: 1 },
            };
          },
          editAsset: async () => {
            throw new Error("not used");
          },
        },
      );
      expect(image.approvedForPublicUse).toBe(false);
      for (const path of [
        `projects/${project.id}`,
        `assets/${image.id}/content`,
        `exports/${png.id}/content`,
      ]) {
        expect(
          (
            await app.inject({
              url: `/v1/staff/creative/${path}`,
              headers: { "x-test-role": "WAITER" },
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await app.inject({
              url: `/v1/staff/creative/${path}`,
              headers: { "x-test-role": "FOREIGN" },
            })
          ).statusCode,
        ).toBe(404);
      }
      const menu = await composeCreativeProject(staff, {
        material: "MENU",
        locale: "en",
        instruction: "",
        campaignText: "",
        productIds: [product.id],
        assetIds: [],
      });
      const firstRevision = (
        await creativeRepository.revisions(staff, menu.id)
      )[0]!;
      await prisma.product.update({
        where: { id: product.id },
        data: { priceMinor: 1450 },
      });
      const synced = await syncCreativeProject(staff, menu.id);
      expect(synced.updated).toBe(true);
      expect(
        synced.project.document.bindings.find((b) => b.field === "price")
          ?.value,
      ).toContain("14.50");
      expect((await syncCreativeProject(staff, menu.id)).updated).toBe(false);
      expect(
        (await creativeRepository.revisions(staff, menu.id))[0]?.actor,
      ).toBe("SYSTEM");
      const restored = await restoreCreativeRevision(
        staff,
        menu.id,
        firstRevision.id,
        synced.project.version,
      );
      expect(
        (await creativeRepository.get(staff, menu.id)).document.bindings.find(
          (b) => b.field === "price",
        )?.value,
      ).toContain("14.50");
      await expect(
        restoreCreativeRevision(
          other,
          menu.id,
          firstRevision.id,
          restored.version,
        ),
      ).rejects.toThrow("NOT_FOUND");
      await creativeRepository.archive(staff, menu.id, restored.version, true);
      await prisma.product.update({
        where: { id: product.id },
        data: { priceMinor: 1500 },
      });
      expect((await syncCreativeProject(staff, menu.id)).updated).toBe(false);
      await expect(
        creativeRepository.save(
          staff,
          menu.id,
          restored.version,
          menu.title,
          synced.project.document,
        ),
      ).rejects.toThrow("another tab");
      await creativeRepository.archive(staff, menu.id, restored.version, false);
      expect((await syncCreativeProject(staff, menu.id)).updated).toBe(true);
      await prisma.product.update({
        where: { id: product.id },
        data: { published: false },
      });
      expect((await syncCreativeProject(staff, menu.id)).needsReview).toBe(
        true,
      );
      const photoLabel = await app.inject({
        method: "POST",
        url: `/v1/staff/creative/assets/${image.id}/catalog`,
        payload: { name: "Pizza", kind: "PRODUCT", productId: product.id },
      });
      expect(photoLabel.statusCode).toBe(200);
      expect(photoLabel.json().provenance.provider).toBe("openai");
      const foreignLabel = await app.inject({
        method: "POST",
        url: `/v1/staff/creative/assets/${image.id}/catalog`,
        headers: { "x-test-role": "FOREIGN" },
        payload: { name: "Pizza", kind: "PRODUCT", productId: product.id },
      });
      expect(foreignLabel.statusCode).toBe(404);
      expect(
        (
          await prisma.creativeExport.findFirstOrThrow({
            where: { id: png.id },
          })
        ).snapshotHash,
      ).toBe(originalHash);
      const jobs = await Promise.allSettled([
        beginCreativeJob(
          staff,
          project.id,
          randomUUID(),
          "IMAGE",
          "openai",
          "gpt-image-2.5-flare",
        ),
        beginCreativeJob(
          staff,
          project.id,
          randomUUID(),
          "IMAGE",
          "openai",
          "gpt-image-2.5-flare",
        ),
      ]);
      expect(jobs.filter((j) => j.status === "fulfilled")).toHaveLength(1);
      for (const job of jobs)
        if (job.status === "fulfilled")
          await finishCreativeJob(staff, job.value.job.id, "FAILED", 1);
      expect(
        await prisma.creativeRevision.count({
          where: {
            ...creativeScope(staff),
            projectId: project.id,
            actor: "AI",
          },
        }),
      ).toBe(1);
      await app.close();
    }, 30000);
  },
);

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  prisma,
  menuImportRepository,
  smartSetupRepository,
  type StaffIdentity,
} from "@flowgastronomie/database";
import { provisionBusinessInTransaction } from "../../../packages/database/src/business-provisioner.js";
import { registerMenuImportRoutes } from "./menu-import-routes.js";
import { registerSmartSetupRoutes } from "./smart-setup-routes.js";
import {
  ControlledMenuExtractor,
  controlledMenuPng,
  controlledMenuPdf,
} from "../../../tests/setup/fixtures.js";
import { inspectMenuSource } from "./menu-import-document-adapter.js";
import type { ReviewedMenuItem } from "@flowgastronomie/domain";

async function business(name: string, kind: "DEMO" | "REAL") {
  const result = await prisma.$transaction(
    (tx) =>
      provisionBusinessInTransaction(
        tx,
        {
          requestKey: randomUUID(),
          organizationName: name,
          venueName: name,
          ownerDisplayName: "Test Owner",
          email: `${randomUUID()}@example.test`,
          password: "test-password-import",
          locale: "en",
          timezone: "Europe/Berlin",
          currency: "EUR",
          plan: "WEBSITE",
          profileId: "PIZZERIA",
          applyCategories: false,
        },
        kind,
      ),
    { timeout: 15000 },
  );
  return {
    ...result,
    staff: {
      tenantId: result.tenant.id,
      venueId: result.venue.id,
      userId: result.owner.id,
      membershipId: result.membership.id,
      role: "OWNER",
    } as StaffIdentity,
  };
}
describe.skipIf(process.env.SMART_SETUP_DB_GATE !== "true")(
  "SI1 PostgreSQL import acceptance",
  () => {
    afterAll(() => prisma.$disconnect());
    for (const [name, kind, mime] of [
      ["Pizzeria Aurora · DEMO", "DEMO", "image/png"],
      ["Synthetic Pizza Fixture", "REAL", "application/pdf"],
    ] as const) {
      it(`${name}: upload → proposal only → correction → approval → scoped draft import → replay`, async () => {
        const a = await business(name, kind),
          b = await business("Other business", "DEMO");
        if (kind === "REAL") {
          await prisma.membership.update({
            where: { id: a.staff.membershipId },
            data: { role: "MANAGER" },
          });
          a.staff.role = "MANAGER";
        }
        let identity = a.staff;
        const provider = new ControlledMenuExtractor();
        const app = Fastify();
        registerMenuImportRoutes(app, async () => identity, provider);
        registerSmartSetupRoutes(app, async () => identity);
        try {
          const initial = await smartSetupRepository.get(a.staff);
          await smartSetupRepository.update(a.staff, {
            expectedVersion: initial.progress.version,
            profileId: "PIZZERIA",
            applyCategories: true,
            step: 2,
            skipped: [],
            complete: false,
          });
          const creation = { requestKey: randomUUID(), locale: "en" };
          const created = await app.inject({
            method: "POST",
            url: "/v1/staff/menu-imports",
            payload: creation,
          });
          expect(created.statusCode).toBe(200);
          const id = created.json().id;
          expect(
            (
              await app.inject({
                method: "POST",
                url: "/v1/staff/menu-imports",
                payload: creation,
              })
            ).json().id,
          ).toBe(id);
          const bytes =
            mime === "application/pdf"
              ? await controlledMenuPdf()
              : await controlledMenuPng();
          const uploaded = await app.inject({
            method: "POST",
            url: `/v1/staff/menu-imports/${id}/sources?expectedVersion=0`,
            headers: {
              "Content-Type": mime,
              "X-File-Name":
                mime === "application/pdf"
                  ? "controlled-menu.pdf"
                  : "controlled-menu.png",
            },
            payload: bytes,
          });
          expect(uploaded.statusCode).toBe(200);
          let saved = uploaded.json();
          expect(saved.sources).toHaveLength(1);
          const download = await app.inject({
            method: "GET",
            url: saved.sources[0].url,
          });
          expect(download.rawPayload.equals(bytes)).toBe(true);
          expect(download.headers["cache-control"]).toContain("no-store");
          const key = randomUUID();
          const extracted = await app.inject({
            method: "POST",
            url: `/v1/staff/menu-imports/${id}/extract`,
            payload: { expectedVersion: saved.version, requestKey: key },
          });
          expect(extracted.statusCode).toBe(200);
          saved = extracted.json();
          expect(saved.status).toBe("NEEDS_REVIEW");
          expect(saved.provenance.usage).toEqual({ paidCalls: 0 });
          await app.inject({
            method: "POST",
            url: `/v1/staff/menu-imports/${id}/extract`,
            payload: { expectedVersion: 1, requestKey: key },
          });
          expect(provider.calls).toBe(1);
          expect(
            await prisma.product.count({ where: { tenantId: a.tenant.id } }),
          ).toBe(0);
          expect(
            (
              await app.inject({
                method: "POST",
                url: `/v1/staff/menu-imports/${id}/import`,
                payload: { expectedVersion: saved.version, confirm: true },
              })
            ).statusCode,
          ).toBe(400);
          const missing = saved.items.find(
            (i: { proposalItemId: string }) => i.proposalItemId === "seasonal",
          );
          const approveMissing = await app.inject({
            method: "PUT",
            url: `/v1/staff/menu-imports/${id}/items/${missing.id}`,
            payload: {
              expectedVersion: saved.version,
              item: missing.reviewed,
              action: "APPROVE",
              confirm: true,
            },
          });
          expect(approveMissing.statusCode).toBe(400);
          saved = (
            await app.inject({
              method: "PUT",
              url: `/v1/staff/menu-imports/${id}/items/${missing.id}`,
              payload: {
                expectedVersion: saved.version,
                item: missing.reviewed,
                action: "REJECT",
                confirm: true,
              },
            })
          ).json();
          const row = saved.items.find(
            (i: { proposalItemId: string }) =>
              i.proposalItemId === "margherita",
          );
          const correction: ReviewedMenuItem = {
            ...row.reviewed,
            name: "Margherita classica test",
            priceMinor: 1050,
            approvedAllergens: ["MILK"],
          };
          const review = await app.inject({
            method: "PUT",
            url: `/v1/staff/menu-imports/${id}/items/${row.id}`,
            payload: {
              expectedVersion: saved.version,
              item: correction,
              action: "APPROVE",
              confirm: true,
            },
          });
          expect(review.statusCode).toBe(200);
          saved = review.json();
          expect(saved.status).toBe("APPROVED");
          const reloaded = (
            await app.inject({
              method: "GET",
              url: `/v1/staff/menu-imports/${id}`,
            })
          ).json();
          expect(
            reloaded.items.find((i: { id: string }) => i.id === row.id)
              .reviewed,
          ).toEqual(correction);
          expect(
            reloaded.items.find((i: { id: string }) => i.id === row.id).original
              .priceMinor.value,
          ).toBe(950);
          expect(
            (await smartSetupRepository.get(a.staff)).progress
              .activeImportSessionId,
          ).toBe(id);
          identity = b.staff;
          expect(
            (
              await app.inject({
                method: "GET",
                url: `/v1/staff/menu-imports/${id}`,
              })
            ).statusCode,
          ).toBe(404);
          expect(
            (await app.inject({ method: "GET", url: saved.sources[0].url }))
              .statusCode,
          ).toBe(404);
          expect(
            (
              await app.inject({
                method: "POST",
                url: `/v1/staff/menu-imports/${id}/import`,
                payload: { expectedVersion: saved.version, confirm: true },
              })
            ).statusCode,
          ).toBe(404);
          identity = { ...a.staff, role: "WAITER" };
          expect(
            (
              await app.inject({
                method: "GET",
                url: `/v1/staff/menu-imports/${id}`,
              })
            ).statusCode,
          ).toBe(403);
          identity = a.staff;
          // Saving an approved row invalidates its approval, even if values match.
          await menuImportRepository.review(a.staff, id, row.id, {
            expectedVersion: saved.version,
            item: correction,
            action: "SAVE",
            confirm: false,
          });
          const edited = await menuImportRepository.get(a.staff, id);
          expect(edited.status).toBe("NEEDS_REVIEW");
          expect(
            edited.items.find((item) => item.id === row.id)?.approvedAt,
          ).toBeNull();
          await menuImportRepository.review(a.staff, id, row.id, {
            expectedVersion: edited.version,
            item: correction,
            action: "APPROVE",
            confirm: true,
          });
          saved = await menuImportRepository.get(a.staff, id);
          const [first, retry] = await Promise.all(
            [1, 2].map(() =>
              app.inject({
                method: "POST",
                url: `/v1/staff/menu-imports/${id}/import`,
                payload: { expectedVersion: saved.version, confirm: true },
              }),
            ),
          );
          expect(first!.statusCode).toBe(200);
          expect(retry!.statusCode).toBe(200);
          expect(first!.json().productIds).toEqual(retry!.json().productIds);
          const product = await prisma.product.findUniqueOrThrow({
            where: { id: first!.json().productIds[0] },
            include: {
              translations: true,
              allergens: true,
              variants: true,
              modifierGroups: { include: { options: true } },
            },
          });
          expect(product).toMatchObject({
            tenantId: a.tenant.id,
            venueId: a.venue.id,
            priceMinor: 1050,
            currency: "EUR",
            published: false,
            available: false,
          });
          expect(
            product.translations.every((t) => t.name === correction.name),
          ).toBe(true);
          expect(product.allergens.map((x) => x.allergen)).toEqual(["MILK"]);
          expect(product.variants).toHaveLength(2);
          expect(product.modifierGroups[0]!.options[0]!.priceDeltaMinor).toBe(
            100,
          );
          expect(product.dataProvenance).toMatchObject({
            source: "MENU_IMPORT",
            sessionId: id,
            sourceLocale: "EN",
            approvedBy: a.owner.id,
          });
          expect(
            await prisma.product.count({ where: { tenantId: a.tenant.id } }),
          ).toBe(1);
          expect(
            await prisma.product.count({ where: { tenantId: b.tenant.id } }),
          ).toBe(0);
          const venue = await prisma.venue.findUniqueOrThrow({
            where: { id: a.venue.id },
            include: { website: true, launch: true },
          });
          expect(venue).toMatchObject({
            defaultServiceMode: "MENU_ONLY",
            onlinePickupEnabled: false,
            website: { status: "DRAFT" },
          });
          expect(venue.launch?.launchedAt ?? null).toBeNull();
          const progress = await smartSetupRepository.get(a.staff);
          expect(progress.progress.step).toBe(4);
          // A new import gets duplicate suggestions; it never merges with or reprices the product.
          const again = await menuImportRepository.create(
            a.staff,
            randomUUID(),
            "en",
          );
          await menuImportRepository.upload(
            a.staff,
            again.id,
            0,
            await inspectMenuSource(bytes, "again", mime),
          );
          const second = (
            await app.inject({
              method: "POST",
              url: `/v1/staff/menu-imports/${again.id}/extract`,
              payload: { expectedVersion: 1, requestKey: randomUUID() },
            })
          ).json();
          const secondRow = second.items.find(
            (i: { proposalItemId: string }) =>
              i.proposalItemId === "margherita",
          );
          const rejected = await app.inject({
            method: "PUT",
            url: `/v1/staff/menu-imports/${again.id}/items/${secondRow.id}`,
            payload: {
              expectedVersion: second.version,
              item: { ...secondRow.reviewed, name: correction.name },
              action: "APPROVE",
              confirm: true,
            },
          });
          expect(rejected.statusCode).toBe(400);
          expect(
            await prisma.product.count({ where: { tenantId: a.tenant.id } }),
          ).toBe(1);
        } finally {
          await app.close();
        }
      }, 60000);
    }
    it("failed provider attempts are persisted, same-key retry is free, explicit retries are capped", async () => {
      const a = await business("Failure safety", "DEMO");
      let calls = 0;
      const app = Fastify();
      registerMenuImportRoutes(app, async () => a.staff, {
        provider: "test",
        model: "failure",
        extract: async () => {
          calls++;
          throw new Error("private provider detail");
        },
      });
      try {
        const session = await menuImportRepository.create(
          a.staff,
          randomUUID(),
          "en",
        );
        await menuImportRepository.upload(
          a.staff,
          session.id,
          0,
          await inspectMenuSource(
            await controlledMenuPng(),
            "source.png",
            "image/png",
          ),
        );
        const key = randomUUID();
        const run = (requestKey: string, expectedVersion: number) =>
          app.inject({
            method: "POST",
            url: `/v1/staff/menu-imports/${session.id}/extract`,
            payload: { requestKey, expectedVersion },
          });
        expect((await run(key, 1)).statusCode).toBe(503);
        expect((await run(key, 1)).statusCode).toBe(200);
        expect(calls).toBe(1);
        for (let i = 0; i < 2; i++) {
          const saved = await menuImportRepository.get(a.staff, session.id);
          expect((await run(randomUUID(), saved.version)).statusCode).toBe(503);
        }
        const saved = await menuImportRepository.get(a.staff, session.id);
        expect(saved.extractionState).toBe("FAILED");
        expect(saved.items).toHaveLength(0);
        expect((await run(randomUUID(), saved.version)).statusCode).toBe(429);
        expect(calls).toBe(3);
        expect(
          await prisma.product.count({ where: { tenantId: a.tenant.id } }),
        ).toBe(0);
      } finally {
        await app.close();
      }
    });
  },
);

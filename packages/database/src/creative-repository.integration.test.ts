import { randomUUID, createHash } from "node:crypto";
import { it, expect, afterAll } from "vitest";
import {
  createDesign,
  type CreativeScope,
  type CreativeBinding,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { creativeRepository } from "./creative-repository.js";
import { resolveCreativeBinding } from "./creative-sources.js";
afterAll(() => prisma.$disconnect());
it("PostgreSQL: scoped revisions, concurrent saves, source changes and QR revocation", async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Studio acceptance", slug: randomUUID() },
  });
  const venue = await prisma.venue.create({
    data: {
      tenantId: tenant.id,
      name: "Studio restaurant",
      slug: randomUUID(),
      defaultLocale: "EN",
    },
  });
  const other = await prisma.venue.create({
    data: { tenantId: tenant.id, name: "Other venue", slug: randomUUID() },
  });
  const staff: CreativeScope = {
    tenantId: tenant.id,
    venueId: venue.id,
    userId: "acceptance",
    role: "MANAGER",
  };
  const project = await creativeRepository.create(
    staff,
    "Menu",
    createDesign("A4", "en"),
  );
  await expect(
    creativeRepository.get({ ...staff, venueId: other.id }, project.id),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    creativeRepository.get({ ...staff, tenantId: "foreign" }, project.id),
  ).rejects.toThrow("NOT_FOUND");
  const attempts = await Promise.allSettled([
    creativeRepository.save(
      staff,
      project.id,
      0,
      "First",
      createDesign("A4", "en"),
    ),
    creativeRepository.save(
      staff,
      project.id,
      0,
      "Second",
      createDesign("A4", "en"),
    ),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  expect(await creativeRepository.revisions(staff, project.id)).toHaveLength(1);
  const category = await prisma.menuCategory.create({
    data: { tenantId: tenant.id, venueId: venue.id, published: true },
  });
  const product = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      categoryId: category.id,
      priceMinor: 1050,
      published: true,
      station: "KITCHEN",
    },
  });
  const binding: CreativeBinding = {
    id: "price",
    sourceType: "PRODUCT",
    sourceId: product.id,
    field: "price",
    value: "forged",
    version: "",
  };
  const first = await resolveCreativeBinding(staff, binding, "en");
  await prisma.product.update({
    where: { id: product.id },
    data: { priceMinor: 1100 },
  });
  const second = await resolveCreativeBinding(staff, binding, "en");
  expect(first.value).toBe("€10.50");
  expect(second.value).toBe("€11.00");
  expect(first.version).not.toBe(second.version);
  await expect(
    resolveCreativeBinding({ ...staff, venueId: other.id }, binding, "en"),
  ).rejects.toThrow();
  const token = "creative_acceptance_token_123456789";
  const table = await prisma.diningTable.create({
    data: {
      tenantId: tenant.id,
      venueId: venue.id,
      label: "4",
      qrTokenHash: createHash("sha256").update(token).digest("hex"),
    },
  });
  const qr: CreativeBinding = {
    ...binding,
    id: "qr",
    sourceType: "TABLE_QR",
    sourceId: table.id,
    field: "destination",
    value: `http://localhost:3400/en/menu/${token}`,
  };
  expect((await resolveCreativeBinding(staff, qr, "en")).value).toBe(qr.value);
  await prisma.diningTable.update({
    where: { id: table.id },
    data: { qrRevokedAt: new Date() },
  });
  await expect(resolveCreativeBinding(staff, qr, "en")).rejects.toThrow();
});

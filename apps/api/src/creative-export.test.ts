import { beforeEach, expect, it, vi } from "vitest";
import { createDesign, type CreativeScope } from "@flowgastronomie/domain";
const db = vi.hoisted(() => ({
  get: vi.fn(),
  asset: vi.fn(),
  validate: vi.fn(),
  tenant: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@flowgastronomie/database", () => ({
  creativeRepository: {
    get: db.get,
    asset: db.asset,
    validateAssets: db.validate,
  },
  creativeScope: (staff: CreativeScope) => ({
    tenantId: staff.tenantId,
    venueId: staff.venueId,
  }),
  creativeJson: (value: unknown) => value,
  resolveCreativeDocument: async (
    _staff: CreativeScope,
    document: { bindings: unknown[] },
  ) => document.bindings,
  beginCreativeJob: vi.fn(),
  prisma: {
    tenant: { findUniqueOrThrow: db.tenant },
    product: { count: db.count },
  },
}));
import { creativePreflight } from "./creative-export.js";
const staff: CreativeScope = {
  tenantId: "local",
  venueId: "fixture",
  userId: "owner",
  role: "OWNER",
};
const asset = {
  id: "generated",
  source: "GENERATED",
  approvedForPublicUse: false,
  width: 1536,
  height: 1024,
  provenance: {
    provider: "openai",
    model: "gpt-image-2.5-flare",
    jobId: "job",
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  const document = createDesign("A4", "de");
  document.pages[0]!.layers = [
    {
      id: "hero",
      name: "Hero",
      type: "image",
      assetId: "generated",
      x: 60,
      y: 150,
      width: 675,
      height: 480,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      bindingId: null,
      groupId: null,
      fit: "cover",
      focalX: 0.5,
      focalY: 0.5,
      radius: 28,
    },
  ];
  db.get.mockResolvedValue({ id: "project", version: 3, document });
  db.asset.mockResolvedValue(asset);
  db.tenant.mockResolvedValue({ kind: "LOCAL_PILOT" });
  db.count.mockResolvedValue(1);
});
it("allows a local AI proof with mandatory disclosure without approving or promoting the asset", async () => {
  const proof = await creativePreflight(staff, "project");
  expect(
    proof.project.document.pages[0]!.layers.find(
      (layer) => layer.id === "foundation_review_disclosure",
    ),
  ).toMatchObject({
    text: "INTERNAL REVIEW · AI-generated image · not actual venue food · SAMPLE PRICE",
    locked: true,
  });
  expect(proof.warnings.some((warning) => warning.includes("dpi"))).toBe(false);
  expect(asset.approvedForPublicUse).toBe(false);
});
it("retains explicit public approval for real tenants and rejects unrelated unapproved uploads in pilots", async () => {
  db.tenant.mockResolvedValue({ kind: "REAL" });
  await expect(creativePreflight(staff, "project")).rejects.toThrow(
    "UNAPPROVED_ASSET",
  );
  db.tenant.mockResolvedValue({ kind: "LOCAL_PILOT" });
  db.asset.mockResolvedValue({ ...asset, source: "UPLOAD" });
  await expect(creativePreflight(staff, "project")).rejects.toThrow(
    "UNAPPROVED_ASSET",
  );
});

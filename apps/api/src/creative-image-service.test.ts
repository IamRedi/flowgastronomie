import { vi, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { createDesign, type CreativeScope } from "@flowgastronomie/domain";
const db = vi.hoisted(() => ({
  get: vi.fn(),
  asset: vi.fn(),
  begin: vi.fn(),
  finish: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@flowgastronomie/database", () => ({
  creativeRepository: { get: db.get, asset: db.asset },
  creativeScope: (s: CreativeScope) => ({
    tenantId: s.tenantId,
    venueId: s.venueId,
  }),
  creativeJson: (v: unknown) => v,
  beginCreativeJob: db.begin,
  finishCreativeJob: db.finish,
  prisma: { creativeAsset: { create: db.create } },
}));
import { generateCreativeAsset } from "./creative-image-service.js";
import type { CreativeImageProvider } from "./creative-image-provider.js";
const staff: CreativeScope = {
  tenantId: "t1",
  venueId: "v1",
  userId: "manager",
  role: "MANAGER",
};
const input = {
  prompt: "Basil illustration",
  requestKey: "request",
  sourceLayerId: null,
};
const storage = {
  put: vi.fn(async () => "hash"),
  read: vi.fn(),
  delete: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  db.get.mockResolvedValue({ document: createDesign("A4", "en") });
  db.begin.mockResolvedValue({ job: { id: "job" }, existing: false });
  db.create.mockImplementation(async (data) => ({ id: "asset", ...data.data }));
  storage.put.mockResolvedValue("hash");
});
it("stores provenance and an unapproved asset without modifying the design", async () => {
  const bytes = await sharp({
    create: { width: 1536, height: 1024, channels: 4, background: "#17382f" },
  })
    .png()
    .toBuffer();
  const provider: CreativeImageProvider = {
    provider: "mock",
    model: "image-test",
    generateAsset: vi.fn(async () => ({
      bytes,
      mimeType: "image/png" as const,
      usage: { inputTokens: 1, outputTokens: 2, images: 1 },
    })),
    editAsset: vi.fn(),
  };
  const asset = await generateCreativeAsset(
    staff,
    "project",
    input,
    provider,
    storage,
  );
  expect(asset).toMatchObject({
    tenantId: "t1",
    venueId: "v1",
    source: "GENERATED",
    approvedForPublicUse: false,
    provenance: {
      provider: "mock",
      model: "image-test",
      prompt: input.prompt,
      outputPolicy: { width: 1536, height: 1024, quality: "high" },
      dimensions: { width: 1536, height: 1024 },
      providerLatencyMs: expect.any(Number),
      disclosure:
        "AI-generated promotional imagery; not actual venue food or photography.",
    },
  });
  db.begin.mockResolvedValue({
    job: { id: "job", state: "SUCCEEDED", resultId: "asset" },
    existing: true,
  });
  db.asset.mockResolvedValue(asset);
  await generateCreativeAsset(staff, "project", input, provider, storage);
  expect(provider.generateAsset).toHaveBeenCalledTimes(1);
  expect(provider.generateAsset).toHaveBeenCalledWith(
    expect.objectContaining({
      output: {
        width: 1536,
        height: 1024,
        quality: "high",
        purpose: "PRINT_HERO",
      },
    }),
  );
});
it("records failure without creating assets and denies non-image edit targets", async () => {
  const provider: CreativeImageProvider = {
    provider: "mock",
    model: "image-test",
    generateAsset: vi.fn(async () => {
      throw new Error("provider secret");
    }),
    editAsset: vi.fn(),
  };
  await expect(
    generateCreativeAsset(staff, "project", input, provider, storage),
  ).rejects.toThrow("Your design is unchanged");
  expect(db.create).not.toHaveBeenCalled();
  expect(db.finish).toHaveBeenCalledWith(
    staff,
    "job",
    "UNCERTAIN",
    expect.any(Number),
    {},
  );
  db.begin.mockResolvedValue({
    job: { id: "job", state: "FAILED" },
    existing: true,
  });
  await expect(
    generateCreativeAsset(staff, "project", input, provider, storage),
  ).rejects.toThrow("already recorded");
  expect(provider.generateAsset).toHaveBeenCalledTimes(1);
  await expect(
    generateCreativeAsset(
      staff,
      "project",
      { ...input, sourceLayerId: "logo" },
      provider,
      storage,
    ),
  ).rejects.toThrow("Only a photo/image layer");
});
it("rejects provider resolution downgrades without retrying or saving", async () => {
  const bytes = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const provider: CreativeImageProvider = {
    provider: "openai",
    model: "test",
    generateAsset: vi.fn(async () => ({
      bytes,
      mimeType: "image/png" as const,
      usage: { inputTokens: 1, outputTokens: 2, images: 1 },
    })),
    editAsset: vi.fn(),
  };
  await expect(
    generateCreativeAsset(staff, "project", input, provider, storage),
  ).rejects.toThrow("dimensions");
  expect(provider.generateAsset).toHaveBeenCalledTimes(1);
  expect(storage.put).not.toHaveBeenCalled();
  expect(db.create).not.toHaveBeenCalled();
  expect(db.finish).toHaveBeenCalledWith(
    staff,
    "job",
    "FAILED",
    expect.any(Number),
    expect.objectContaining({ images: 1 }),
  );
});
it("edits an uploaded photo as a new unapproved asset and preserves its source", async () => {
  const bytes = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: "#aabbcc" },
  })
    .png()
    .toBuffer();
  db.asset.mockResolvedValue({
    id: "original",
    source: "UPLOADED",
    provenance: { uploadedBy: "manager" },
    storageKey: "original-key",
  });
  storage.read.mockResolvedValue(bytes);
  const provider: CreativeImageProvider = {
    provider: "ideogram",
    model: "ideogram-4-5",
    generateAsset: vi.fn(),
    editAsset: vi.fn(async () => ({
      bytes,
      mimeType: "image/png" as const,
      usage: { inputTokens: 0, outputTokens: 0, images: 1 },
    })),
  };
  const asset = await generateCreativeAsset(
    staff,
    "project",
    { ...input, sourceAssetId: "original", provider: "ideogram" },
    provider,
    storage,
  );
  expect(provider.editAsset).toHaveBeenCalledOnce();
  expect(asset).toMatchObject({
    id: "asset",
    approvedForPublicUse: false,
    provenance: {
      sourceAssetId: "original",
      provider: "ideogram",
      disclosure:
        "AI-edited image. Review against the original before publication.",
    },
  });
  expect(db.asset).toHaveBeenCalledWith(staff, "original");
  expect(db.create).toHaveBeenCalledOnce();
});

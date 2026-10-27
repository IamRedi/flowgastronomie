import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDesign, type CreativeScope } from "@flowgastronomie/domain";
const db = vi.hoisted(() => ({
  creativeProject: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  creativeRevision: { create: vi.fn() },
  creativeAsset: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("./client.js", () => ({ prisma: db }));
import { creativeRepository } from "./creative-repository.js";
const staff: CreativeScope = {
  tenantId: "tenant-a",
  venueId: "venue-a",
  userId: "owner",
  role: "OWNER",
};
describe("Creative scoped repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation((fn) => fn(db));
  });
  it("scopes project and asset reads and denies missing/cross-tenant records", async () => {
    await expect(creativeRepository.get(staff, "foreign")).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(db.creativeProject.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        id: "foreign",
      },
    });
    await expect(creativeRepository.asset(staff, "foreign")).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(db.creativeAsset.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        id: "foreign",
      },
    });
  });
  it("rejects restricted staff before querying", async () => {
    await expect(
      creativeRepository.list({ ...staff, role: "WAITER" }),
    ).rejects.toThrow();
    expect(db.creativeProject.findMany).not.toHaveBeenCalled();
  });
  it("does not append a revision on a stale write", async () => {
    db.creativeProject.findFirst.mockResolvedValue({ id: "project" });
    db.creativeProject.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      creativeRepository.save(
        staff,
        "project",
        3,
        "Poster",
        createDesign("A4", "en"),
      ),
    ).rejects.toThrow("another tab");
    expect(db.creativeRevision.create).not.toHaveBeenCalled();
    expect(db.creativeProject.updateMany.mock.calls[0]![0].where).toEqual({
      tenantId: "tenant-a",
      venueId: "venue-a",
      id: "project",
      version: 3,
      status: { not: "ARCHIVED" },
    });
  });
});

import {
  SetupImportError,
  websiteRevertSchema,
  assertStaffPermission,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  venueWebsiteRepository,
  type VenueWebsiteInput,
} from "./venue-website-repository.js";
import type { StaffIdentity } from "./staff-auth-repository.js";

export const websiteDraftHistory = {
  async list(staff: StaffIdentity) {
    assertStaffPermission(staff.role, "WEBSITE_MANAGE");
    await venueWebsiteRepository.getEditor(staff);
    const events = await prisma.auditEvent.findMany({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        action: "WEBSITE_UPDATED",
        entityType: "VenueWebsite",
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, metadata: true },
    });
    return events
      .filter((e) => (e.metadata as { before?: unknown }).before)
      .map((e) => ({ id: e.id, createdAt: e.createdAt }));
  },
  async revert(staff: StaffIdentity, value: unknown) {
    assertStaffPermission(staff.role, "WEBSITE_MANAGE");
    const input = websiteRevertSchema.parse(value);
    const website = await venueWebsiteRepository.getEditor(staff);
    if (website.status !== "DRAFT")
      throw new SetupImportError(
        "REVIEW_REQUIRED",
        "Unpublish before restoring a draft revision.",
      );
    const event = await prisma.auditEvent.findFirst({
      where: {
        id: input.revisionId,
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        action: "WEBSITE_UPDATED",
        entityType: "VenueWebsite",
        entityId: website.id!,
      },
    });
    const before = (event?.metadata as { before?: VenueWebsiteInput } | null)
      ?.before;
    if (!before) throw new SetupImportError("NOT_FOUND");
    return venueWebsiteRepository.update({
      staff,
      website: { ...before, expectedUpdatedAt: input.expectedUpdatedAt },
      draftOnly: true,
    });
  },
};

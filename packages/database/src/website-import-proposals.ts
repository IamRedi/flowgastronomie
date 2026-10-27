import {
  assertStaffPermission,
  SetupImportError,
  websiteCopyProposalSchema,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { venueWebsiteRepository } from "./venue-website-repository.js";

// Read evidence lives in the existing immutable audit ledger. Only the website
// editor's separately confirmed, version-checked save changes canonical copy.
export const websiteImportProposals = {
  async authorize(staff: StaffIdentity) {
    assertStaffPermission(staff.role, "WEBSITE_MANAGE");
    const membership = await prisma.membership.findFirst({
      where: {
        id: staff.membershipId,
        userId: staff.userId,
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        active: true,
        role: { in: ["OWNER", "MANAGER"] },
      },
    });
    if (!membership) throw new SetupImportError("NOT_FOUND");
    const website = await venueWebsiteRepository.getEditor(staff);
    if (website.status !== "DRAFT")
      throw new SetupImportError(
        "REVIEW_REQUIRED",
        "Website imports require an unpublished draft.",
      );
  },
  async record(staff: StaffIdentity, value: unknown) {
    await this.authorize(staff);
    const proposal = websiteCopyProposalSchema.parse(value);
    const event = await prisma.auditEvent.create({
      data: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        actorUserId: staff.userId,
        actorMembershipId: staff.membershipId,
        action: "WEBSITE_IMPORT_PROPOSED",
        entityType: "VenueWebsite",
        entityId: staff.venueId,
        metadata: { ...proposal, authorized: true },
      },
    });
    return event.id;
  },
};

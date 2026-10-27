import { prisma } from "./client.js";
import {
  assertStaffPermission,
  SetupImportError,
  assertPosActivation,
} from "@flowgastronomie/domain";
import type { StaffIdentity } from "./staff-auth-repository.js";
export async function setPosMenuChannel(
  staff: StaffIdentity,
  input: { productIds: string[]; enabled: boolean },
) {
  assertStaffPermission(staff.role, "MENU_MANAGE");
  // Set semantics are naturally idempotent; transaction validates every scoped ID before any write.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Venue" WHERE id=${staff.venueId} AND "tenantId"=${staff.tenantId} FOR UPDATE`;
    const scope = {
      tenantId: staff.tenantId,
      venueId: staff.venueId,
      id: { in: input.productIds },
      archivedAt: null,
    };
    const products = await tx.product.findMany({
      where: scope,
      select: {
        id: true,
        priceMinor: true,
        variants: { select: { isDefault: true, available: true } },
      },
    });
    if (products.length !== input.productIds.length)
      throw new SetupImportError("NOT_FOUND");
    if (input.enabled) assertPosActivation(products);
    await tx.product.updateMany({
      where: scope,
      data: {
        posEnabled: input.enabled,
        ...(input.enabled ? { available: true } : {}),
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        actorUserId: staff.userId,
        actorMembershipId: staff.membershipId,
        action: "MENU_POS_CHANNEL_SET",
        entityType: "Venue",
        entityId: staff.venueId,
        metadata: {
          productIds: input.productIds,
          enabled: input.enabled,
          publicPublicationChanged: false,
        },
      },
    });
    return {
      productIds: products.map((p) => p.id),
      enabled: input.enabled,
      publicPublicationChanged: false,
    };
  });
}

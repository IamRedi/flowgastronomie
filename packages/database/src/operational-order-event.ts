import type { Prisma } from "@prisma/client";
import type {
  OperationalOrderEvent,
  OperationalOrderEventType,
  OperationalOrderFulfillment,
  OperationalOrderSource,
  OperationalOrderStatus,
} from "@flowgastronomie/domain";

export function publishOperationalOrderEvent(
  transaction: Prisma.TransactionClient,
  input: Omit<OperationalOrderEvent, "id" | "occurredAt" | "actor"> & {
    actor?: OperationalOrderEvent["actor"] | undefined;
    occurredAt?: Date | undefined;
  },
) {
  return transaction.operationalOrderEvent.create({
    data: {
      tenantId: input.tenantId,
      venueId: input.venueId,
      orderId: input.orderId,
      orderKind: input.orderKind,
      type: input.type,
      source: input.source,
      fulfillment: input.fulfillment,
      status: input.status,
      totalMinor: input.totalMinor,
      currency: input.currency,
      actorUserId: input.actor?.userId ?? null,
      actorMembershipId: input.actor?.membershipId ?? null,
      actorShiftId: input.actor?.shiftId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}

export type OperationalOrderEventRecord = {
  type: OperationalOrderEventType;
  source: OperationalOrderSource;
  fulfillment: OperationalOrderFulfillment;
  status: OperationalOrderStatus;
};

import { randomBytes } from "node:crypto";

import {
  Prisma,
  type OrderStatus,
  type ServiceSignalType,
} from "@prisma/client";
import {
  assertGuestActionAllowed,
  initialOrderStatus,
  operationalStatusFromTableOrder,
  resolveServiceMode,
  SERVICE_MODE_CAPABILITIES,
  type GuestServiceRequest,
  type PlatformLocale,
  type ServiceMode,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import {
  ProductUnavailableError,
  resolveOrderItems,
} from "./order-item-resolution.js";
import { publishOperationalOrderEvent } from "./operational-order-event.js";
import { hashQrToken } from "./public-menu-repository.js";

export { ProductUnavailableError };

export class PublicTableNotFoundError extends Error {
  constructor() {
    super("The QR code is invalid or has been revoked");
    this.name = "PublicTableNotFoundError";
  }
}

export class GuestSessionNotFoundError extends Error {
  constructor() {
    super("The table session or guest token is no longer valid");
    this.name = "GuestSessionNotFoundError";
  }
}

export type OpenGuestSessionResult = {
  sessionId: string;
  guestToken: string;
  tableLabel: string;
  serviceMode: ServiceMode;
  capabilities: {
    canOrder: boolean;
    canRequestService: boolean;
    requiresConfirmation: boolean;
  };
};

export type SubmitGuestOrderInput = {
  sessionId: string;
  guestToken: string;
  idempotencyKey: string;
  locale: PlatformLocale;
  items: Array<{
    productId: string;
    quantity: number;
    notes?: string | undefined;
    variantId?: string | undefined;
    modifierOptionIds?: string[] | undefined;
  }>;
};

export type GuestOrderResult = {
  id: string;
  status: OrderStatus;
  totalMinor: number;
  currency: string;
  createdAt: Date;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    variantName: string | null;
    modifiers: Array<{
      groupName: string;
      optionName: string;
      priceDeltaMinor: number;
    }>;
  }>;
};

export type CreateGuestRequestInput = {
  sessionId: string;
  guestToken: string;
  idempotencyKey: string;
  type: GuestServiceRequest;
};

export type GuestRequestResult = {
  id: string;
  type: GuestServiceRequest;
  createdAt: Date;
};

export type GuestServiceRepository = {
  openSession(qrToken: string): Promise<OpenGuestSessionResult>;
  submitOrder(input: SubmitGuestOrderInput): Promise<GuestOrderResult>;
  createRequest(input: CreateGuestRequestInput): Promise<GuestRequestResult>;
};

function resolveMode(context: {
  tableSession: {
    table: {
      serviceModeOverride: ServiceMode | null;
      area: { serviceModeOverride: ServiceMode | null } | null;
      venue: { defaultServiceMode: ServiceMode };
    };
  };
}): ServiceMode {
  const { table } = context.tableSession;
  return resolveServiceMode({
    venueDefault: table.venue.defaultServiceMode,
    ...(table.area?.serviceModeOverride
      ? {
          areaOverride: {
            active: true,
            mode: table.area.serviceModeOverride,
          },
        }
      : {}),
    ...(table.serviceModeOverride
      ? {
          tableOverride: { active: true, mode: table.serviceModeOverride },
        }
      : {}),
  });
}

async function findGuestContext(
  transaction: Prisma.TransactionClient,
  sessionId: string,
  guestToken: string,
) {
  const guest = await transaction.tableGuest.findFirst({
    where: {
      tableSessionId: sessionId,
      tokenHash: hashQrToken(guestToken),
      tableSession: { status: "OPEN" },
    },
    include: {
      tableSession: {
        include: {
          table: {
            include: { area: true, venue: true },
          },
        },
      },
    },
  });

  if (!guest) throw new GuestSessionNotFoundError();

  await transaction.tableGuest.update({
    where: { id: guest.id },
    data: { lastSeenAt: new Date() },
  });

  return guest;
}

function mapOrder(order: {
  id: string;
  status: OrderStatus;
  totalMinor: number;
  currency: string;
  createdAt: Date;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    variantName: string | null;
    modifiers: Array<{
      groupName: string;
      optionName: string;
      priceDeltaMinor: number;
    }>;
  }>;
}): GuestOrderResult {
  return {
    id: order.id,
    status: order.status,
    totalMinor: order.totalMinor,
    currency: order.currency,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      variantName: item.variantName,
      modifiers: item.modifiers,
    })),
  };
}

export const guestServiceRepository: GuestServiceRepository = {
  async openSession(qrToken) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const table = await transaction.diningTable.findUnique({
            where: { qrTokenHash: hashQrToken(qrToken) },
            include: { area: true, venue: true },
          });

          if (!table || table.qrRevokedAt) throw new PublicTableNotFoundError();

          let session = await transaction.tableSession.findUnique({
            where: { activeTableKey: table.id },
          });

          if (!session) {
            session = await transaction.tableSession.create({
              data: {
                tenantId: table.tenantId,
                venueId: table.venueId,
                tableId: table.id,
                activeTableKey: table.id,
              },
            });
          }

          const guestToken = randomBytes(32).toString("base64url");
          await transaction.tableGuest.create({
            data: {
              tenantId: table.tenantId,
              venueId: table.venueId,
              tableSessionId: session.id,
              tokenHash: hashQrToken(guestToken),
            },
          });

          const serviceMode = resolveServiceMode({
            venueDefault: table.venue.defaultServiceMode,
            ...(table.area?.serviceModeOverride
              ? {
                  areaOverride: {
                    active: true,
                    mode: table.area.serviceModeOverride,
                  },
                }
              : {}),
            ...(table.serviceModeOverride
              ? {
                  tableOverride: {
                    active: true,
                    mode: table.serviceModeOverride,
                  },
                }
              : {}),
          });

          return {
            sessionId: session.id,
            guestToken,
            tableLabel: table.label,
            serviceMode,
            capabilities: SERVICE_MODE_CAPABILITIES[serviceMode],
          };
        });
      } catch (error) {
        const isActiveSessionRace =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002";

        if (!isActiveSessionRace || attempt === 1) throw error;
      }
    }

    throw new Error("Guest session could not be opened");
  },

  async submitOrder(input) {
    return prisma.$transaction(async (transaction) => {
      const guest = await findGuestContext(
        transaction,
        input.sessionId,
        input.guestToken,
      );
      const mode = resolveMode(guest);
      assertGuestActionAllowed(mode, "ORDER");

      const existingOrder = await transaction.order.findUnique({
        where: {
          tableSessionId_guestId_idempotencyKey: {
            tableSessionId: input.sessionId,
            guestId: guest.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: { items: { include: { modifiers: true } } },
      });

      if (existingOrder) return mapOrder(existingOrder);

      const items = await resolveOrderItems(transaction, {
        tenantId: guest.tenantId,
        venueId: guest.venueId,
        requestedLocale: input.locale,
        fallbackLocale: guest.tableSession.table.venue.defaultLocale,
        items: input.items,
      });
      const totalMinor = items.reduce(
        (total, item) => total + item.unitPriceMinor * item.quantity,
        0,
      );
      const status = initialOrderStatus(mode);
      const productionStations = [
        ...new Set(items.map((item) => item.station)),
      ];

      const order = await transaction.order.create({
        data: {
          tenantId: guest.tenantId,
          venueId: guest.venueId,
          tableSessionId: input.sessionId,
          guestId: guest.id,
          idempotencyKey: input.idempotencyKey,
          status,
          totalMinor,
          currency: guest.tableSession.table.venue.currency,
          statusEvents: {
            create: {
              tenantId: guest.tenantId,
              venueId: guest.venueId,
              status,
              kind: "INITIAL",
            },
          },
          items: { create: items },
          productionTickets: {
            create: productionStations.map((station) => ({
              tenantId: guest.tenantId,
              venueId: guest.venueId,
              station,
            })),
          },
          signals: {
            create: {
              tenantId: guest.tenantId,
              venueId: guest.venueId,
              tableId: guest.tableSession.tableId,
              tableSessionId: input.sessionId,
              guestId: guest.id,
              type: "NEW_ORDER",
            },
          },
        },
        include: { items: { include: { modifiers: true } } },
      });

      await publishOperationalOrderEvent(transaction, {
        tenantId: guest.tenantId,
        venueId: guest.venueId,
        orderId: order.id,
        orderKind: "TABLE",
        type: "ORDER_CREATED",
        source: "TABLE_GUEST_QR",
        fulfillment: "DINE_IN",
        status: operationalStatusFromTableOrder(order.status),
        totalMinor: order.totalMinor,
        currency: order.currency,
      });

      return mapOrder(order);
    });
  },

  async createRequest(input) {
    return prisma.$transaction(async (transaction) => {
      const guest = await findGuestContext(
        transaction,
        input.sessionId,
        input.guestToken,
      );
      const mode = resolveMode(guest);
      assertGuestActionAllowed(mode, input.type);

      const existingSignal = await transaction.serviceSignal.findUnique({
        where: {
          tableSessionId_guestId_idempotencyKey: {
            tableSessionId: input.sessionId,
            guestId: guest.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });

      if (existingSignal) {
        return {
          id: existingSignal.id,
          type: existingSignal.type as GuestServiceRequest,
          createdAt: existingSignal.createdAt,
        };
      }

      const signal = await transaction.serviceSignal.create({
        data: {
          tenantId: guest.tenantId,
          venueId: guest.venueId,
          tableId: guest.tableSession.tableId,
          tableSessionId: input.sessionId,
          guestId: guest.id,
          idempotencyKey: input.idempotencyKey,
          type: input.type as ServiceSignalType,
        },
      });

      return {
        id: signal.id,
        type: signal.type as GuestServiceRequest,
        createdAt: signal.createdAt,
      };
    });
  },
};

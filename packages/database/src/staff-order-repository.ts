import { Prisma, type OrderStatus } from "@prisma/client";
import {
  assertStaffPermission,
  operationalStatusFromTableOrder,
  snapshotTax,
  type PlatformLocale,
  type CanonicalMediaReference,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { publishOperationalOrderEvent } from "./operational-order-event.js";
import { resolveOrderItems } from "./order-item-resolution.js";
import { mapPublishedMenuCategories } from "./public-menu-repository.js";
import { canonicalMediaRepository } from "./canonical-media-repository.js";
import {
  requireActiveShift,
  type StaffActor,
} from "./staff-work-repository.js";

const prismaLocales: Record<PlatformLocale, "EN" | "DE" | "IT" | "SQ"> = {
  en: "EN",
  de: "DE",
  it: "IT",
  sq: "SQ",
};

export class StaffTableNotFoundError extends Error {
  constructor() {
    super("The table was not found in this venue");
    this.name = "StaffTableNotFoundError";
  }
}

export type StaffOrderType = "DINE_IN" | "TAKEAWAY";

export type StaffPosMenu = {
  locale: PlatformLocale;
  venue: { id: string; name: string; currency: string };
  tables: Array<{ id: string; label: string; area: string | null }>;
  categories: Array<{
    id: string;
    name: string;
    products: Array<{
      media?: CanonicalMediaReference;
      id: string;
      name: string;
      description: string | null;
      priceMinor: number;
      currency: string;
      available: boolean;
      station: "BAR" | "KITCHEN" | "DESSERT";
      allergens: string[];
      variants: Array<{
        id: string;
        name: string;
        priceDeltaMinor: number;
        available: boolean;
        isDefault: boolean;
      }>;
      modifierGroups: Array<{
        id: string;
        name: string;
        minSelect: number;
        maxSelect: number;
        options: Array<{
          id: string;
          name: string;
          priceDeltaMinor: number;
          available: boolean;
        }>;
      }>;
    }>;
  }>;
};

export type CreateStaffOrderInput = {
  staff: StaffActor;
  orderType: StaffOrderType;
  tableId?: string | undefined;
  locale: PlatformLocale;
  idempotencyKey: string;
  items: Array<{
    productId: string;
    quantity: number;
    notes?: string | undefined;
    variantId?: string | undefined;
    modifierOptionIds?: string[] | undefined;
  }>;
};

export type StaffOrderCreation = {
  id: string;
  reference: string;
  status: OrderStatus;
  orderType: StaffOrderType;
  source: "STAFF_TABLET";
  totalMinor: number;
  currency: string;
  tableId: string | null;
  tableLabel: string | null;
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

type OrderWithItems = Prisma.OrderGetPayload<{
  include: {
    items: { include: { modifiers: true } };
    table: { select: { label: true } };
  };
}>;

function mapStaffOrder(order: OrderWithItems): StaffOrderCreation {
  return {
    id: order.id,
    reference: order.id,
    status: order.status,
    orderType: order.tableSessionId ? "DINE_IN" : "TAKEAWAY",
    source: "STAFF_TABLET",
    totalMinor: order.totalMinor,
    currency: order.currency,
    tableId: order.tableId,
    tableLabel: order.table?.label ?? null,
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

export type StaffOrderRepository = {
  posMenu(staff: StaffActor, locale: PlatformLocale): Promise<StaffPosMenu>;
  createOrder(input: CreateStaffOrderInput): Promise<StaffOrderCreation>;
};

export const staffOrderRepository: StaffOrderRepository = {
  async posMenu(staff, requestedLocale) {
    assertStaffPermission(staff.role, "ORDER_CREATE");

    const venue = await prisma.venue.findFirst({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: {
        id: true,
        name: true,
        currency: true,
        defaultLocale: true,
        categories: {
          where: {
            products: {
              some: {
                archivedAt: null,
                OR: [
                  { posEnabled: true },
                  {
                    posEnabled: null,
                    published: true,
                    category: { published: true },
                  },
                ],
              },
            },
          },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: {
            translations: true,
            products: {
              where: {
                archivedAt: null,
                OR: [
                  { posEnabled: true },
                  {
                    posEnabled: null,
                    published: true,
                    category: { published: true },
                  },
                ],
              },
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              include: {
                translations: true,
                allergens: true,
                variants: {
                  orderBy: { sortOrder: "asc" },
                  include: { translations: true },
                },
                modifierGroups: {
                  orderBy: { sortOrder: "asc" },
                  include: {
                    translations: true,
                    options: {
                      orderBy: { sortOrder: "asc" },
                      include: { translations: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!venue) throw new StaffTableNotFoundError();

    const tables = await prisma.diningTable.findMany({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        qrRevokedAt: null,
      },
      orderBy: { label: "asc" },
      select: { id: true, label: true, area: { select: { name: true } } },
    });

    const requested = prismaLocales[requestedLocale];
    const canonical = await canonicalMediaRepository.resolve(staff);
    return {
      locale: requestedLocale,
      venue: { id: venue.id, name: venue.name, currency: venue.currency },
      tables: tables.map((table) => ({
        id: table.id,
        label: table.label,
        area: table.area?.name ?? null,
      })),
      categories: mapPublishedMenuCategories(
        venue.categories,
        requested,
        venue.defaultLocale,
        new Map(canonical.products.map((row) => [row.productId, row.media])),
      ),
    };
  },

  async createOrder(input) {
    assertStaffPermission(input.staff.role, "ORDER_CREATE");

    const staffOrderKey = `${input.staff.membershipId}:${input.idempotencyKey}`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const shift = await requireActiveShift(transaction, input.staff);

          const existing = await transaction.order.findUnique({
            where: { staffOrderKey },
            include: {
              items: { include: { modifiers: true } },
              table: { select: { label: true } },
            },
          });
          if (existing) return mapStaffOrder(existing);

          let tableSessionId: string | null = null;
          let tableId: string | null = null;
          let venueCurrency: string;
          let venueFallbackLocale: "EN" | "DE" | "IT" | "SQ";

          if (input.orderType === "DINE_IN") {
            const table = await transaction.diningTable.findFirst({
              where: {
                id: input.tableId ?? "",
                tenantId: input.staff.tenantId,
                venueId: input.staff.venueId,
              },
              include: { venue: true },
            });
            if (!table) throw new StaffTableNotFoundError();

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

            tableSessionId = session.id;
            tableId = table.id;
            venueCurrency = table.venue.currency;
            venueFallbackLocale = table.venue.defaultLocale;
          } else {
            const venue = await transaction.venue.findFirst({
              where: {
                id: input.staff.venueId,
                tenantId: input.staff.tenantId,
              },
            });
            if (!venue) throw new StaffTableNotFoundError();
            venueCurrency = venue.currency;
            venueFallbackLocale = venue.defaultLocale;
          }

          const items = await resolveOrderItems(transaction, {
            tenantId: input.staff.tenantId,
            venueId: input.staff.venueId,
            requestedLocale: input.locale,
            fallbackLocale: venueFallbackLocale,
            items: input.items,
            channel: "POS",
          });
          // Snapshot configured product treatment at order creation. Missing
          // configuration leaves a visible payment-readiness error, never zero tax.
          const taxProducts = await transaction.product.findMany({
            where: {
              tenantId: input.staff.tenantId,
              venueId: input.staff.venueId,
              id: { in: items.map((item) => item.productId) },
            },
            include: { taxCategory: true },
          });
          const saleItems = items.map((item) => {
            const category = taxProducts.find(
              (product) => product.id === item.productId,
            )?.taxCategory;
            if (
              !category ||
              category.tenantId !== input.staff.tenantId ||
              category.venueId !== input.staff.venueId
            )
              return item;
            const rate =
              (input.orderType === "DINE_IN"
                ? category.dineInRateBasisPoints
                : category.takeawayRateBasisPoints) ?? category.rateBasisPoints;
            return {
              ...item,
              taxSnapshot: snapshotTax(
                category.code,
                rate,
                item.unitPriceMinor,
                item.quantity,
              ),
            };
          });
          const totalMinor = items.reduce(
            (total, item) => total + item.unitPriceMinor * item.quantity,
            0,
          );
          // A staff member entering the order is the confirmation itself, so
          // the order starts accepted and the kitchen claims preparation next.
          const status: OrderStatus = "ACCEPTED";
          const productionStations = [
            ...new Set(items.map((item) => item.station)),
          ];

          const order = await transaction.order.create({
            data: {
              tenantId: input.staff.tenantId,
              venueId: input.staff.venueId,
              tableSessionId,
              guestId: null,
              tableId,
              staffOrderKey,
              idempotencyKey: input.idempotencyKey,
              status,
              totalMinor,
              currency: venueCurrency,
              source: "STAFF_TABLET",
              createdByUserId: input.staff.userId,
              createdByMembershipId: input.staff.membershipId,
              createdByShiftId: shift.id,
              serviceOwnerUserId: input.staff.userId,
              serviceOwnerMembershipId: input.staff.membershipId,
              serviceOwnerShiftId: shift.id,
              statusEvents: {
                create: {
                  tenantId: input.staff.tenantId,
                  venueId: input.staff.venueId,
                  status,
                  kind: "INITIAL",
                  actorUserId: input.staff.userId,
                  actorMembershipId: input.staff.membershipId,
                  actorShiftId: shift.id,
                },
              },
              items: { create: saleItems },
              productionTickets: {
                create: productionStations.map((station) => ({
                  tenantId: input.staff.tenantId,
                  venueId: input.staff.venueId,
                  station,
                })),
              },
            },
            include: {
              items: { include: { modifiers: true } },
              table: { select: { label: true } },
            },
          });

          await publishOperationalOrderEvent(transaction, {
            tenantId: input.staff.tenantId,
            venueId: input.staff.venueId,
            orderId: order.id,
            orderKind: "TABLE",
            type: "ORDER_CREATED",
            source: "TABLE_STAFF_TABLET",
            fulfillment: input.orderType === "DINE_IN" ? "DINE_IN" : "PICKUP",
            status: operationalStatusFromTableOrder(order.status),
            totalMinor: order.totalMinor,
            currency: order.currency,
            actor: {
              userId: input.staff.userId,
              membershipId: input.staff.membershipId,
              shiftId: shift.id,
            },
          });

          await transaction.auditEvent.create({
            data: {
              tenantId: input.staff.tenantId,
              venueId: input.staff.venueId,
              actorUserId: input.staff.userId,
              actorMembershipId: input.staff.membershipId,
              actorShiftId: shift.id,
              action: "STAFF_ORDER_CREATED",
              entityType: "Order",
              entityId: order.id,
              metadata: {
                orderType: input.orderType,
                tableId,
                totalMinor,
                itemCount: items.length,
              },
            },
          });

          return mapStaffOrder(order);
        });
      } catch (error) {
        const isDuplicateKey =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002";

        if (!isDuplicateKey || attempt === 1) throw error;
      }
    }

    throw new Error("Staff order could not be created");
  },
};

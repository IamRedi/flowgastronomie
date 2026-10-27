import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

import {
  Locale,
  Prisma,
  type OnlineOrderMessageAuthor,
  type OnlineOrderStatus,
} from "@prisma/client";
import {
  assertOnlineOrderRequest,
  assertOnlineOrderQuote,
  assertOnlinePickupHandoffPaid,
  assertStaffPermission,
  canTransitionOnlineOrder,
  isWithinOpeningHours,
  operationalSourceFromOnlineFulfillment,
  operationalStatusFromOnlineOrder,
  resolveDeliveryZone,
  snapshotTax,
  pickupAvailability,
  resolvePickupTime,
  resolveLegacyPickupTime,
  onlineProductionCanStart,
  normalizeOrderRecoveryPhone,
  type PickupAvailability,
  type PickupTimingMode,
  type OpeningHoursEntry,
  type OnlineFulfillmentType,
  type PlatformLocale,
  type OnlineOrderPublicStatus,
} from "@flowgastronomie/domain";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { requireActiveShift } from "./staff-work-repository.js";
import { hashOpaqueToken } from "./public-menu-repository.js";
import { prisma } from "./client.js";
import { createCustomerProfileFromContact } from "./customer-profile-repository.js";
import { publishOperationalOrderEvent } from "./operational-order-event.js";

export class OnlineOrderTrackingNotFoundError extends Error {
  constructor() {
    super("The online order tracking link is invalid or expired");
    this.name = "OnlineOrderTrackingNotFoundError";
  }
}

export class OnlineOrderUnavailableError extends Error {}
export class OnlineOrderProductError extends Error {}
export { OnlineOrderQuoteChangedError } from "@flowgastronomie/domain";
export type OnlineOrderQuote = {
  fingerprint: string;
  totalMinor: number;
  deliveryFeeMinor: number;
  currency: string;
  requestedFor?: string;
  timingMode?: PickupTimingMode;
  timezone?: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    variantName: string | null;
  }>;
};
export class OnlineOrderDeliveryUnavailableError extends Error {}
export class OnlineOrderNotFoundError extends Error {}

export type OnlineOrderTracking = {
  venue?: { name: string; publicSlug: string; timezone: string };
  referenceCode: string;
  fulfillmentType: "PICKUP" | "DELIVERY" | "CATERING";
  status: OnlineOrderStatus;
  locale: PlatformLocale;
  totalMinor: number;
  currency: string;
  contact: { name: string; phone: string; email: string | null };
  requestedFor: Date;
  timingMode: PickupTimingMode;
  deliveryAddress: { line1: string; postalCode: string; city: string } | null;
  cateringGuestCount: number | null;
  guestNotes: string | null;
  items: Array<{
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
  timeline: Array<{
    status: OnlineOrderStatus;
    note: string | null;
    createdAt: Date;
  }>;
  messages: Array<{
    author: OnlineOrderMessageAuthor;
    body: string;
    createdAt: Date;
  }>;
};

export type OnlineOrderRepository = {
  quote(
    input: Parameters<OnlineOrderRepository["submit"]>[0],
  ): Promise<OnlineOrderQuote>;
  findPublicStatus(input: {
    publicSlug: string;
    referenceCode: string;
  }): Promise<OnlineOrderPublicStatus>;
  pickupAvailability(
    publicSlug: string,
    fulfillmentType?: OnlineFulfillmentType,
  ): Promise<PickupAvailability>;
  recover(input: {
    publicSlug: string;
    referenceCode: string;
    phone: string;
  }): Promise<{ sessionToken: string; referenceCode: string }>;
  createDeliveryZone(input: {
    staff: StaffIdentity;
    name: string;
    postalPrefixes: string[];
    feeMinor: number;
    minimumOrderMinor: number;
  }): Promise<{ id: string }>;
  updateDeliveryZone(input: {
    staff: StaffIdentity;
    zoneId: string;
    name: string;
    postalPrefixes: string[];
    feeMinor: number;
    minimumOrderMinor: number;
    active: boolean;
    sortOrder: number;
  }): Promise<void>;
  listDeliveryZones(staff: StaffIdentity): Promise<
    Array<{
      id: string;
      name: string;
      postalPrefixes: string[];
      feeMinor: number;
      minimumOrderMinor: number;
      active: boolean;
    }>
  >;
  getFulfillmentSettings(staff: StaffIdentity): Promise<{
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    cateringEnabled: boolean;
    pickupLeadMinutes?: number | null | undefined;
  }>;
  updateFulfillmentSettings(input: {
    staff: StaffIdentity;
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    cateringEnabled: boolean;
    pickupLeadMinutes?: number | null | undefined;
  }): Promise<{
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    cateringEnabled: boolean;
  }>;
  listProductionForStaff(input: {
    staff: StaffIdentity;
    station: "BAR" | "KITCHEN" | "DESSERT";
  }): Promise<
    Array<{
      id: string;
      version: number;
      status: "NEW" | "PREPARING" | "READY" | "SERVED";
      referenceCode: string;
      fulfillmentType: "PICKUP" | "DELIVERY" | "CATERING";
      requestedFor: Date;
      timingMode: PickupTimingMode;
      createdAt: Date;
      items: Array<{
        productName: string;
        quantity: number;
        notes: string | null;
        variantName: string | null;
        modifiers: Array<{ optionName: string }>;
      }>;
    }>
  >;
  transitionProductionForStaff(input: {
    staff: StaffIdentity;
    ticketId: string;
    status: "PREPARING" | "READY";
    expectedVersion: number;
  }): Promise<{
    order: OnlineOrderTracking;
    customerStatusChanged: boolean;
  }>;
  listForStaff(staff: StaffIdentity): Promise<OnlineOrderTracking[]>;
  transitionForStaff(input: {
    staff: StaffIdentity;
    orderId: string;
    status: Exclude<OnlineOrderStatus, "PENDING_CONFIRMATION">;
    note?: string | undefined;
  }): Promise<OnlineOrderTracking>;
  addStaffMessage(input: {
    staff: StaffIdentity;
    orderId: string;
    body: string;
  }): Promise<OnlineOrderTracking>;
  submit(input: {
    publicSlug: string;
    locale: PlatformLocale;
    idempotencyKey: string;
    expectedQuote?: string | undefined;
    fulfillmentType: OnlineFulfillmentType;
    contact: { name: string; phone: string; email?: string | null | undefined };
    requestedFor?: Date | undefined;
    timingMode?: PickupTimingMode | undefined;
    deliveryAddress?:
      | {
          line1: string;
          postalCode: string;
          city: string;
        }
      | null
      | undefined;
    cateringGuestCount?: number | null | undefined;
    guestNotes?: string | null | undefined;
    items: Array<{
      productId: string;
      quantity: number;
      notes?: string | undefined;
      variantId?: string | undefined;
      modifierOptionIds?: string[] | undefined;
    }>;
  }): Promise<{
    referenceCode: string;
    trackingToken: string | null;
    status: OnlineOrderStatus;
  }>;
  findTracking(trackingToken: string): Promise<OnlineOrderTracking>;
  addGuestMessage(input: {
    trackingToken: string;
    body: string;
  }): Promise<OnlineOrderTracking>;
};

function mapTracking(order: {
  venue?: {
    name: string;
    timezone: string;
    website: { publicSlug: string } | null;
  };
  referenceCode: string;
  fulfillmentType: "PICKUP" | "DELIVERY" | "CATERING";
  status: OnlineOrderStatus;
  locale: Locale;
  totalMinor: number;
  currency: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  requestedFor: Date;
  productionNotBefore: Date | null;
  deliveryAddressLine: string | null;
  deliveryPostalCode: string | null;
  deliveryCity: string | null;
  cateringGuestCount: number | null;
  guestNotes: string | null;
  items: Array<{
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
  statusEvents: Array<{
    status: OnlineOrderStatus;
    note: string | null;
    createdAt: Date;
  }>;
  messages: Array<{
    author: OnlineOrderMessageAuthor;
    body: string;
    createdAt: Date;
  }>;
}): OnlineOrderTracking {
  const deliveryAddress =
    order.deliveryAddressLine && order.deliveryPostalCode && order.deliveryCity
      ? {
          line1: order.deliveryAddressLine,
          postalCode: order.deliveryPostalCode,
          city: order.deliveryCity,
        }
      : null;
  return {
    ...(order.venue?.website
      ? {
          venue: {
            name: order.venue.name,
            publicSlug: order.venue.website.publicSlug,
            timezone: order.venue.timezone,
          },
        }
      : {}),
    referenceCode: order.referenceCode,
    fulfillmentType: order.fulfillmentType,
    status: order.status,
    locale: order.locale.toLowerCase() as PlatformLocale,
    totalMinor: order.totalMinor,
    currency: order.currency,
    contact: {
      name: order.contactName,
      phone: order.contactPhone,
      email: order.contactEmail,
    },
    requestedFor: order.requestedFor,
    timingMode:
      order.fulfillmentType === "PICKUP" && order.productionNotBefore === null
        ? "ASAP"
        : "SCHEDULED",
    deliveryAddress,
    cateringGuestCount: order.cateringGuestCount,
    guestNotes: order.guestNotes,
    items: order.items,
    timeline: order.statusEvents,
    messages: order.messages,
  };
}

const include = {
  venue: {
    select: {
      name: true,
      timezone: true,
      website: { select: { publicSlug: true } },
    },
  },
  items: { include: { modifiers: true } },
  statusEvents: { orderBy: { createdAt: "asc" as const } },
  messages: { orderBy: { createdAt: "asc" as const } },
};

async function byToken(trackingToken: string) {
  const original = await prisma.onlineOrder.findUnique({
    where: { trackingTokenHash: hashOpaqueToken(trackingToken) },
    include,
  });
  if (original) return original;
  const session = await prisma.onlineOrderRecoverySession.findUnique({
    where: { tokenHash: hashOpaqueToken(trackingToken) },
    include: { onlineOrder: { include } },
  });
  const order =
    session &&
    session.expiresAt > new Date() &&
    session.tenantId === session.onlineOrder.tenantId &&
    session.venueId === session.onlineOrder.venueId
      ? session.onlineOrder
      : null;
  if (!order) throw new OnlineOrderTrackingNotFoundError();
  return order;
}

async function onlineWebsite(
  publicSlug: string,
  db: Prisma.TransactionClient = prisma,
) {
  const website = await db.venueWebsite.findUnique({
    where: { publicSlug },
    include: {
      venue: true,
      revisions: { orderBy: { revision: "desc" }, take: 1 },
      tenant: {
        include: { subscription: { include: { entitlements: true } } },
      },
    },
  });
  const subscription = website?.tenant.subscription;
  if (
    !website ||
    website.status !== "PUBLISHED" ||
    !subscription ||
    !(
      subscription.status === "ACTIVE" ||
      (subscription.status === "TRIALING" &&
        subscription.trialEndsAt &&
        subscription.trialEndsAt > new Date())
    ) ||
    !["PUBLIC_WEBSITE", "ONLINE_ORDERING"].every((key) =>
      subscription.entitlements.some(
        (item) => item.featureKey === key && item.enabled,
      ),
    )
  )
    throw new OnlineOrderUnavailableError();
  return website;
}
function publishedHours(website: Awaited<ReturnType<typeof onlineWebsite>>) {
  const snapshot = website.revisions[0]?.snapshot as unknown as
    { openingHours: OpeningHoursEntry[] } | undefined;
  return (
    snapshot?.openingHours ??
    (website.openingHours as unknown as OpeningHoursEntry[])
  );
}

export const ORDER_RECOVERY_SECONDS = 30 * 60;

async function resolveOnlineCheckout(
  supplied: Parameters<OnlineOrderRepository["submit"]>[0],
  db: Prisma.TransactionClient,
) {
  const website = await onlineWebsite(supplied.publicSlug, db);
  const now = new Date();
  const resolved =
    supplied.fulfillmentType === "PICKUP" && supplied.timingMode
      ? resolvePickupTime({
          now,
          timezone: website.venue.timezone,
          openingHours: publishedHours(website),
          pickupLeadMinutes: website.venue.pickupLeadMinutes,
          timingMode: supplied.timingMode,
          requestedFor: supplied.requestedFor,
        })
      : supplied.fulfillmentType === "PICKUP" && supplied.requestedFor
        ? resolveLegacyPickupTime({
            now,
            timezone: website.venue.timezone,
            openingHours: publishedHours(website),
            pickupLeadMinutes: website.venue.pickupLeadMinutes,
            requestedFor: supplied.requestedFor,
          })
        : {
            requestedFor: supplied.requestedFor,
            productionNotBefore: null,
          };
  if (!resolved.requestedFor) throw new OnlineOrderProductError();
  const input = { ...supplied, requestedFor: resolved.requestedFor };
  assertOnlineOrderRequest(
    {
      fulfillmentType: input.fulfillmentType,
      contact: { ...input.contact, email: input.contact.email ?? null },
      requestedFor: input.requestedFor,
      deliveryAddress: input.deliveryAddress ?? null,
      cateringGuestCount: input.cateringGuestCount ?? null,
    },
    now,
  );
  if (
    !isWithinOpeningHours({
      at: input.requestedFor,
      timezone: website.venue.timezone,
      openingHours: publishedHours(website),
    })
  ) {
    throw new OnlineOrderUnavailableError();
  }
  const channelEnabled =
    input.fulfillmentType === "PICKUP"
      ? website.venue.onlinePickupEnabled
      : input.fulfillmentType === "DELIVERY"
        ? website.venue.onlineDeliveryEnabled
        : website.venue.onlineCateringEnabled;
  if (!channelEnabled) throw new OnlineOrderUnavailableError();
  const products = await db.product.findMany({
    where: {
      id: { in: input.items.map((item) => item.productId) },
      tenantId: website.tenantId,
      venueId: website.venueId,
      published: true,
      archivedAt: null,
      category: {
        published: true,
        tenantId: website.tenantId,
        venueId: website.venueId,
      },
      available: true,
    },
    include: {
      taxCategory: true,
      translations: true,
      variants: { include: { translations: true } },
      modifierGroups: {
        include: {
          translations: true,
          options: { include: { translations: true } },
        },
      },
    },
  });
  if (
    products.length !== new Set(input.items.map((item) => item.productId)).size
  )
    throw new OnlineOrderProductError();
  const requested = (
    { en: Locale.EN, de: Locale.DE, it: Locale.IT, sq: Locale.SQ } as const
  )[input.locale];
  const items = input.items.map((item) => {
    const product = products.find(
      (candidate) => candidate.id === item.productId,
    );
    const translation =
      product?.translations.find((entry) => entry.locale === requested) ??
      product?.translations.find(
        (entry) => entry.locale === website.venue.defaultLocale,
      );
    if (!product || !translation) throw new OnlineOrderProductError();
    const variant = item.variantId
      ? product.variants.find(
          (entry) => entry.id === item.variantId && entry.available,
        )
      : product.variants.find((entry) => entry.isDefault && entry.available);
    if (product.variants.length > 0 && !variant) {
      throw new OnlineOrderProductError();
    }
    const variantTranslation = variant
      ? (variant.translations.find((entry) => entry.locale === requested) ??
        variant.translations.find(
          (entry) => entry.locale === website.venue.defaultLocale,
        ))
      : null;
    if (variant && !variantTranslation) throw new OnlineOrderProductError();

    const selectedIds = [...new Set(item.modifierOptionIds ?? [])];
    const selectedModifiers: Array<{
      modifierOptionId: string;
      groupName: string;
      optionName: string;
      priceDeltaMinor: number;
    }> = [];
    for (const group of product.modifierGroups) {
      const selected = group.options.filter((option) =>
        selectedIds.includes(option.id),
      );
      if (
        selected.length < group.minSelect ||
        selected.length > group.maxSelect ||
        selected.some((option) => !option.available)
      ) {
        throw new OnlineOrderProductError();
      }
      const groupTranslation =
        group.translations.find((entry) => entry.locale === requested) ??
        group.translations.find(
          (entry) => entry.locale === website.venue.defaultLocale,
        );
      if (!groupTranslation && selected.length > 0) {
        throw new OnlineOrderProductError();
      }
      for (const option of selected) {
        const optionTranslation =
          option.translations.find((entry) => entry.locale === requested) ??
          option.translations.find(
            (entry) => entry.locale === website.venue.defaultLocale,
          );
        if (!optionTranslation || !groupTranslation) {
          throw new OnlineOrderProductError();
        }
        selectedModifiers.push({
          modifierOptionId: option.id,
          groupName: groupTranslation.name,
          optionName: optionTranslation.name,
          priceDeltaMinor: option.priceDeltaMinor,
        });
      }
    }
    if (
      selectedModifiers.length !== selectedIds.length ||
      selectedIds.some(
        (id) =>
          !product.modifierGroups.some((group) =>
            group.options.some((option) => option.id === id),
          ),
      )
    ) {
      throw new OnlineOrderProductError();
    }
    const optionTotal = selectedModifiers.reduce(
      (total, option) => total + option.priceDeltaMinor,
      0,
    );
    return {
      product: { connect: { id: product.id } },
      productName: translation.name,
      quantity: item.quantity,
      unitPriceMinor:
        product.priceMinor + (variant?.priceDeltaMinor ?? 0) + optionTotal,
      ...(product.taxCategory?.tenantId === website.tenantId &&
      product.taxCategory.venueId === website.venueId
        ? {
            taxSnapshot: snapshotTax(
              product.taxCategory.code,
              product.taxCategory.takeawayRateBasisPoints ??
                product.taxCategory.rateBasisPoints,
              product.priceMinor +
                (variant?.priceDeltaMinor ?? 0) +
                optionTotal,
              item.quantity,
            ),
          }
        : {}),
      station: product.station,
      variantId: variant?.id ?? null,
      variantName: variantTranslation?.name ?? null,
      modifiers: { create: selectedModifiers },
      ...(item.notes ? { notes: item.notes } : {}),
    };
  });
  const itemTotalMinor = items.reduce(
    (sum, item) => sum + item.unitPriceMinor * item.quantity,
    0,
  );
  const deliveryZone =
    input.fulfillmentType === "DELIVERY" && input.deliveryAddress
      ? resolveDeliveryZone(
          input.deliveryAddress.postalCode.trim(),
          await db.deliveryZone.findMany({
            where: { tenantId: website.tenantId, venueId: website.venueId },
            select: {
              id: true,
              postalPrefixes: true,
              feeMinor: true,
              minimumOrderMinor: true,
              active: true,
            },
          }),
        )
      : undefined;
  if (
    input.fulfillmentType === "DELIVERY" &&
    (!deliveryZone || itemTotalMinor < deliveryZone.minimumOrderMinor)
  )
    throw new OnlineOrderDeliveryUnavailableError();

  const quoteItems = items.map(
    ({ productName, quantity, unitPriceMinor, variantName, modifiers }) => ({
      productName,
      quantity,
      unitPriceMinor,
      variantName,
      modifiers: modifiers.create,
    }),
  );
  const quote = {
    totalMinor: itemTotalMinor + (deliveryZone?.feeMinor ?? 0),
    deliveryFeeMinor: deliveryZone?.feeMinor ?? 0,
    currency: website.venue.currency,
    items: quoteItems,
  };
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        tenantId: website.tenantId,
        venueId: website.venueId,
        fulfillmentType: input.fulfillmentType,
        items: input.items,
        quote,
      }),
    )
    .digest("hex");
  return {
    website,
    input,
    resolved,
    requested,
    items,
    itemTotalMinor,
    deliveryZone,
    quote: {
      ...quote,
      fingerprint,
      ...(input.fulfillmentType === "PICKUP" && input.timingMode === "ASAP"
        ? { timingMode: "ASAP" as const }
        : { requestedFor: input.requestedFor.toISOString() }),
      timezone: website.venue.timezone,
    },
  };
}

export const onlineOrderRepository: OnlineOrderRepository = {
  async quote(input) {
    return prisma.$transaction(
      async (tx) => (await resolveOnlineCheckout(input, tx)).quote,
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  },
  async findPublicStatus({ publicSlug, referenceCode }) {
    // Resolve scope and status in one read. Do not load the private tracking
    // graph or create a recovery credential from a public reference.
    const order = await prisma.onlineOrder.findFirst({
      where: {
        referenceCode: referenceCode.trim().toUpperCase(),
        personalDataRedactedAt: null,
        venue: { website: { publicSlug, status: "PUBLISHED" } },
      },
      select: {
        tenantId: true,
        venueId: true,
        status: true,
        fulfillmentType: true,
        requestedFor: true,
        productionNotBefore: true,
        venue: {
          select: {
            id: true,
            tenantId: true,
            name: true,
            timezone: true,
            website: { select: { tenantId: true, venueId: true } },
          },
        },
      },
    });
    if (
      !order ||
      order.tenantId !== order.venue.tenantId ||
      order.tenantId !== order.venue.website?.tenantId ||
      order.venueId !== order.venue.website.venueId
    )
      throw new OnlineOrderTrackingNotFoundError();
    return {
      status: order.status,
      requestedFor: order.requestedFor.toISOString(),
      timingMode:
        order.fulfillmentType === "PICKUP" && order.productionNotBefore === null
          ? "ASAP"
          : "SCHEDULED",
      venue: { name: order.venue.name, timezone: order.venue.timezone },
    };
  },
  async pickupAvailability(publicSlug, fulfillmentType = "PICKUP") {
    const website = await onlineWebsite(publicSlug);
    if (
      !(fulfillmentType === "PICKUP"
        ? website.venue.onlinePickupEnabled
        : fulfillmentType === "DELIVERY"
          ? website.venue.onlineDeliveryEnabled
          : website.venue.onlineCateringEnabled)
    )
      throw new OnlineOrderUnavailableError();
    return pickupAvailability({
      now: new Date(),
      timezone: website.venue.timezone,
      pickupLeadMinutes:
        fulfillmentType === "PICKUP" ? website.venue.pickupLeadMinutes : 1,
      openingHours: publishedHours(website),
    });
  },
  async recover({ publicSlug, referenceCode, phone }) {
    const website = await prisma.venueWebsite.findUnique({
      where: { publicSlug },
      select: { tenantId: true, venueId: true },
    });
    const order = website
      ? await prisma.onlineOrder.findFirst({
          where: {
            tenantId: website.tenantId,
            venueId: website.venueId,
            referenceCode: referenceCode.trim().toUpperCase(),
            personalDataRedactedAt: null,
          },
        })
      : null;
    const normalized = normalizeOrderRecoveryPhone(phone);
    const expected = order
      ? normalizeOrderRecoveryPhone(order.contactPhone)
      : null;
    const digest = (value: string) =>
      createHash("sha256").update(value).digest();
    const matches = timingSafeEqual(
      digest(normalized ?? "invalid-input"),
      digest(expected ?? "missing-order"),
    );
    if (!order || !normalized || !expected || !matches)
      throw new OnlineOrderTrackingNotFoundError();
    const sessionToken = randomBytes(32).toString("base64url");
    await prisma.$transaction([
      prisma.onlineOrderRecoverySession.deleteMany({
        where: {
          tenantId: order.tenantId,
          venueId: order.venueId,
          expiresAt: { lte: new Date() },
        },
      }),
      prisma.onlineOrderRecoverySession.create({
        data: {
          tenantId: order.tenantId,
          venueId: order.venueId,
          onlineOrderId: order.id,
          tokenHash: hashOpaqueToken(sessionToken),
          expiresAt: new Date(Date.now() + ORDER_RECOVERY_SECONDS * 1000),
        },
      }),
    ]);
    return { sessionToken, referenceCode: order.referenceCode };
  },
  async createDeliveryZone({
    staff,
    name,
    postalPrefixes,
    feeMinor,
    minimumOrderMinor,
  }) {
    assertStaffPermission(staff.role, "ONLINE_ORDER_MANAGE");
    const zone = await prisma.deliveryZone.create({
      data: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        name: name.trim(),
        postalPrefixes: [
          ...new Set(
            postalPrefixes.map((prefix) => prefix.trim()).filter(Boolean),
          ),
        ],
        feeMinor,
        minimumOrderMinor,
      },
    });
    await prisma.auditEvent.create({
      data: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        actorUserId: staff.userId,
        actorMembershipId: staff.membershipId,
        action: "DELIVERY_ZONE_CREATED",
        entityType: "DeliveryZone",
        entityId: zone.id,
        metadata: {},
      },
    });
    return { id: zone.id };
  },
  async updateDeliveryZone({
    staff,
    zoneId,
    name,
    postalPrefixes,
    feeMinor,
    minimumOrderMinor,
    active,
    sortOrder,
  }) {
    assertStaffPermission(staff.role, "ONLINE_ORDER_MANAGE");
    const changed = await prisma.deliveryZone.updateMany({
      where: { id: zoneId, tenantId: staff.tenantId, venueId: staff.venueId },
      data: {
        name: name.trim(),
        postalPrefixes: [
          ...new Set(
            postalPrefixes.map((prefix) => prefix.trim()).filter(Boolean),
          ),
        ],
        feeMinor,
        minimumOrderMinor,
        active,
        sortOrder,
      },
    });
    if (!changed.count) throw new OnlineOrderNotFoundError();
    await prisma.auditEvent.create({
      data: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        actorUserId: staff.userId,
        actorMembershipId: staff.membershipId,
        action: "DELIVERY_ZONE_UPDATED",
        entityType: "DeliveryZone",
        entityId: zoneId,
        metadata: { active },
      },
    });
  },
  async listDeliveryZones(staff) {
    assertStaffPermission(staff.role, "ONLINE_ORDER_VIEW");
    return prisma.deliveryZone.findMany({
      where: { tenantId: staff.tenantId, venueId: staff.venueId },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        postalPrefixes: true,
        feeMinor: true,
        minimumOrderMinor: true,
        active: true,
      },
    });
  },
  async getFulfillmentSettings(staff) {
    assertStaffPermission(staff.role, "ONLINE_ORDER_VIEW");
    const venue = await prisma.venue.findFirst({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: {
        onlinePickupEnabled: true,
        onlineDeliveryEnabled: true,
        onlineCateringEnabled: true,
        pickupLeadMinutes: true,
      },
    });
    if (!venue) throw new OnlineOrderNotFoundError();
    return {
      pickupEnabled: venue.onlinePickupEnabled,
      deliveryEnabled: venue.onlineDeliveryEnabled,
      cateringEnabled: venue.onlineCateringEnabled,
      pickupLeadMinutes: venue.pickupLeadMinutes,
    };
  },
  async updateFulfillmentSettings({
    staff,
    pickupEnabled,
    deliveryEnabled,
    cateringEnabled,
    pickupLeadMinutes,
  }) {
    assertStaffPermission(staff.role, "ONLINE_ORDER_MANAGE");
    const venue = await prisma.venue.update({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      data: {
        onlinePickupEnabled: pickupEnabled,
        onlineDeliveryEnabled: deliveryEnabled,
        onlineCateringEnabled: cateringEnabled,
        ...(pickupLeadMinutes !== undefined ? { pickupLeadMinutes } : {}),
      },
      select: {
        id: true,
        onlinePickupEnabled: true,
        onlineDeliveryEnabled: true,
        onlineCateringEnabled: true,
        pickupLeadMinutes: true,
      },
    });
    await prisma.auditEvent.create({
      data: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        actorUserId: staff.userId,
        actorMembershipId: staff.membershipId,
        action: "ONLINE_FULFILLMENT_SETTINGS_UPDATED",
        entityType: "Venue",
        entityId: venue.id,
        metadata: {
          pickupEnabled,
          deliveryEnabled,
          cateringEnabled,
          pickupLeadMinutes: venue.pickupLeadMinutes,
        },
      },
    });
    return {
      pickupEnabled: venue.onlinePickupEnabled,
      deliveryEnabled: venue.onlineDeliveryEnabled,
      cateringEnabled: venue.onlineCateringEnabled,
      pickupLeadMinutes: venue.pickupLeadMinutes,
    };
  },
  async transitionProductionForStaff({
    staff,
    ticketId,
    status,
    expectedVersion,
  }) {
    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      // Serialize sibling tickets on their parent before reading any status.
      // Under READ COMMITTED the next query then sees the preceding commit,
      // including its station aggregate and customer-facing event.
      await transaction.$queryRaw`
        SELECT o."id" FROM "OnlineOrder" o
        JOIN "OnlineOrderStationTicket" t ON t."onlineOrderId" = o."id"
        WHERE t."id" = ${ticketId}
          AND t."tenantId" = ${staff.tenantId} AND t."venueId" = ${staff.venueId}
          AND o."tenantId" = ${staff.tenantId} AND o."venueId" = ${staff.venueId}
        FOR UPDATE OF o
      `;
      const ticket = await transaction.onlineOrderStationTicket.findFirst({
        where: {
          id: ticketId,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
        },
        include: {
          onlineOrder: {
            select: {
              status: true,
              fulfillmentType: true,
              totalMinor: true,
              currency: true,
              productionNotBefore: true,
            },
          },
        },
      });
      if (!ticket) throw new OnlineOrderNotFoundError();
      if (
        !onlineProductionCanStart(
          ticket.onlineOrder.productionNotBefore,
          new Date(),
        )
      )
        throw new OnlineOrderProductError();
      if (
        (staff.role === "BAR" && ticket.station !== "BAR") ||
        (staff.role === "KITCHEN" && ticket.station === "BAR")
      )
        throw new OnlineOrderNotFoundError();
      assertStaffPermission(
        staff.role,
        status === "PREPARING" ? "ORDER_PREPARE" : "ORDER_READY",
      );
      if (
        !["ACCEPTED", "PREPARING"].includes(ticket.onlineOrder.status) ||
        !(
          (ticket.status === "NEW" && status === "PREPARING") ||
          (ticket.status === "PREPARING" && status === "READY")
        )
      )
        throw new OnlineOrderProductError();
      const changed = await transaction.onlineOrderStationTicket.updateMany({
        where: {
          id: ticket.id,
          version: expectedVersion,
          status: ticket.status,
        },
        data: {
          status,
          version: { increment: 1 },
          ...(status === "READY" ? { readyAt: new Date() } : {}),
        },
      });
      if (!changed.count) throw new OnlineOrderProductError();
      const open = await transaction.onlineOrderStationTicket.count({
        where: {
          onlineOrderId: ticket.onlineOrderId,
          status: { in: ["NEW", "PREPARING"] },
        },
      });
      const orderStatus = open === 0 ? "READY" : "PREPARING";
      const customerStatusChanged = ticket.onlineOrder.status !== orderStatus;
      if (customerStatusChanged) {
        await transaction.onlineOrder.update({
          where: { id: ticket.onlineOrderId },
          data: { status: orderStatus },
        });
        await transaction.onlineOrderStatusEvent.create({
          data: {
            onlineOrderId: ticket.onlineOrderId,
            status: orderStatus,
            actorUserId: staff.userId,
            actorMembershipId: staff.membershipId,
          },
        });
        await publishOperationalOrderEvent(transaction, {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          orderId: ticket.onlineOrderId,
          orderKind: "ONLINE",
          type: "ORDER_STATUS_CHANGED",
          source: operationalSourceFromOnlineFulfillment(
            ticket.onlineOrder.fulfillmentType,
          ),
          fulfillment: ticket.onlineOrder.fulfillmentType,
          status: operationalStatusFromOnlineOrder(orderStatus),
          totalMinor: ticket.onlineOrder.totalMinor,
          currency: ticket.onlineOrder.currency,
          actor: {
            userId: staff.userId,
            membershipId: staff.membershipId,
            shiftId: shift.id,
          },
        });
      }
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          actorShiftId: shift.id,
          action:
            status === "READY"
              ? "ONLINE_PRODUCTION_TICKET_READY"
              : "ONLINE_PRODUCTION_TICKET_STARTED",
          entityType: "OnlineOrderStationTicket",
          entityId: ticket.id,
          metadata: {
            station: ticket.station,
            onlineOrderId: ticket.onlineOrderId,
            from: ticket.status,
            to: status,
          },
        },
      });
      return {
        order: mapTracking(
          await transaction.onlineOrder.findUniqueOrThrow({
            where: { id: ticket.onlineOrderId },
            include,
          }),
        ),
        customerStatusChanged,
      };
    });
  },
  async listProductionForStaff({ staff, station }) {
    assertStaffPermission(staff.role, "RADAR_VIEW");
    if (staff.role === "BAR" && station !== "BAR") {
      throw new OnlineOrderNotFoundError();
    }
    if (staff.role === "KITCHEN" && station === "BAR") {
      throw new OnlineOrderNotFoundError();
    }
    const tickets = await prisma.onlineOrderStationTicket.findMany({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        station,
        status: { in: ["NEW", "PREPARING", "READY"] },
        onlineOrder: {
          status: { in: ["ACCEPTED", "PREPARING", "READY"] },
          OR: [
            { productionNotBefore: null },
            { productionNotBefore: { lte: new Date() } },
          ],
        },
      },
      include: {
        onlineOrder: {
          include: {
            items: { where: { station }, include: { modifiers: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return tickets.map((ticket) => ({
      id: ticket.id,
      version: ticket.version,
      status: ticket.status,
      referenceCode: ticket.onlineOrder.referenceCode,
      fulfillmentType: ticket.onlineOrder.fulfillmentType,
      requestedFor: ticket.onlineOrder.requestedFor,
      timingMode:
        ticket.onlineOrder.fulfillmentType === "PICKUP" &&
        ticket.onlineOrder.productionNotBefore === null
          ? "ASAP"
          : "SCHEDULED",
      createdAt: ticket.onlineOrder.createdAt,
      items: ticket.onlineOrder.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        notes: item.notes,
        variantName: item.variantName,
        modifiers: item.modifiers.map((m) => ({ optionName: m.optionName })),
      })),
    }));
  },
  async listForStaff(staff) {
    assertStaffPermission(staff.role, "ONLINE_ORDER_VIEW");
    const orders = await prisma.onlineOrder.findMany({
      where: { tenantId: staff.tenantId, venueId: staff.venueId },
      include,
      orderBy: { createdAt: "desc" },
    });
    return orders.map(mapTracking);
  },
  async transitionForStaff({ staff, orderId, status, note }) {
    assertStaffPermission(staff.role, "ONLINE_ORDER_MANAGE");
    return prisma.$transaction(async (transaction) => {
      const shift = await requireActiveShift(transaction, staff);
      const order = await transaction.onlineOrder.findFirst({
        where: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          OR: [{ id: orderId }, { referenceCode: orderId }],
        },
        include: { counterPayment: true },
      });
      if (!order) throw new OnlineOrderNotFoundError();
      if (
        ["PREPARING", "READY"].includes(status) &&
        !onlineProductionCanStart(order.productionNotBefore, new Date())
      )
        throw new OnlineOrderProductError();
      assertOnlinePickupHandoffPaid(
        order.fulfillmentType,
        status,
        !!order.counterPayment,
      );
      if (
        !canTransitionOnlineOrder(order.status, status, order.fulfillmentType)
      ) {
        throw new OnlineOrderProductError();
      }
      const stations =
        status === "ACCEPTED"
          ? await transaction.onlineOrderItem.findMany({
              where: { onlineOrderId: order.id },
              distinct: ["station"],
              select: { station: true },
            })
          : [];
      const changed = await transaction.onlineOrder.updateMany({
        where: { id: order.id, status: order.status },
        data: {
          status,
          decisionNote: note?.trim() || null,
          decidedAt: new Date(),
          decidedByUserId: staff.userId,
          decidedByMembershipId: staff.membershipId,
        },
      });
      if (!changed.count) throw new OnlineOrderProductError();
      await transaction.onlineOrderStatusEvent.create({
        data: {
          onlineOrderId: order.id,
          status,
          note: note?.trim() || null,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
        },
      });
      await publishOperationalOrderEvent(transaction, {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        orderId: order.id,
        orderKind: "ONLINE",
        type: "ORDER_STATUS_CHANGED",
        source: operationalSourceFromOnlineFulfillment(order.fulfillmentType),
        fulfillment: order.fulfillmentType,
        status: operationalStatusFromOnlineOrder(status),
        totalMinor: order.totalMinor,
        currency: order.currency,
        actor: {
          userId: staff.userId,
          membershipId: staff.membershipId,
          shiftId: shift.id,
        },
      });
      if (status === "ACCEPTED") {
        await transaction.onlineOrderStationTicket.createMany({
          data: stations.map((item) => ({
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            onlineOrderId: order.id,
            station: item.station,
          })),
          skipDuplicates: true,
        });
      }
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          actorShiftId: shift.id,
          action: "ONLINE_ORDER_STATUS_CHANGED",
          entityType: "OnlineOrder",
          entityId: order.id,
          metadata: { from: order.status, to: status },
        },
      });
      return mapTracking(
        await transaction.onlineOrder.findUniqueOrThrow({
          where: { id: order.id },
          include,
        }),
      );
    });
  },
  async addStaffMessage({ staff, orderId, body }) {
    assertStaffPermission(staff.role, "ONLINE_ORDER_MANAGE");
    const order = await prisma.onlineOrder.findFirst({
      where: {
        tenantId: staff.tenantId,
        venueId: staff.venueId,
        OR: [{ id: orderId }, { referenceCode: orderId }],
      },
    });
    if (!order) throw new OnlineOrderNotFoundError();
    await prisma.onlineOrderMessage.create({
      data: {
        onlineOrderId: order.id,
        author: "STAFF",
        body,
        actorUserId: staff.userId,
        actorMembershipId: staff.membershipId,
      },
    });
    return mapTracking(
      await prisma.onlineOrder.findUniqueOrThrow({
        where: { id: order.id },
        include,
      }),
    );
  },
  async submit(supplied) {
    const website = await onlineWebsite(supplied.publicSlug);
    const existing = await prisma.onlineOrder.findUnique({
      where: {
        tenantId_venueId_idempotencyKey: {
          tenantId: website.tenantId,
          venueId: website.venueId,
          idempotencyKey: supplied.idempotencyKey,
        },
      },
    });
    if (existing)
      return {
        referenceCode: existing.referenceCode,
        trackingToken: null,
        status: existing.status,
      };
    const trackingToken = randomBytes(32).toString("base64url");
    let replayed = false;
    const created = await prisma
      .$transaction(
        async (transaction) => {
          const {
            website,
            input,
            resolved,
            requested,
            items,
            itemTotalMinor,
            deliveryZone,
            quote,
          } = await resolveOnlineCheckout(supplied, transaction);
          assertOnlineOrderQuote(supplied.expectedQuote, quote.fingerprint);
          const customerProfile = await createCustomerProfileFromContact(
            transaction,
            {
              tenantId: website.tenantId,
              venueId: website.venueId,
              displayName: input.contact.name,
              email: input.contact.email ?? null,
              phone: input.contact.phone,
              preferredLocale: input.locale,
            },
          );
          const order = await transaction.onlineOrder.create({
            data: {
              tenantId: website.tenantId,
              venueId: website.venueId,
              idempotencyKey: input.idempotencyKey,
              referenceCode: `RF-${randomBytes(3).toString("hex").toUpperCase()}`,
              trackingTokenHash: hashOpaqueToken(trackingToken),
              fulfillmentType: input.fulfillmentType,
              locale: requested,
              totalMinor: itemTotalMinor + (deliveryZone?.feeMinor ?? 0),
              currency: website.venue.currency,
              contactName: input.contact.name.trim(),
              contactPhone: input.contact.phone.trim(),
              contactEmail: input.contact.email?.trim() || null,
              customerProfileId: customerProfile.id,
              requestedFor: input.requestedFor,
              productionNotBefore: resolved.productionNotBefore,
              deliveryAddressLine: input.deliveryAddress?.line1 ?? null,
              deliveryPostalCode: input.deliveryAddress?.postalCode ?? null,
              deliveryCity: input.deliveryAddress?.city ?? null,
              deliveryZoneId: deliveryZone?.id ?? null,
              deliveryFeeMinor: deliveryZone?.feeMinor ?? 0,
              cateringGuestCount: input.cateringGuestCount ?? null,
              guestNotes: input.guestNotes?.trim() || null,
              items: { create: items },
              statusEvents: { create: { status: "PENDING_CONFIRMATION" } },
            },
          });
          await publishOperationalOrderEvent(transaction, {
            tenantId: website.tenantId,
            venueId: website.venueId,
            orderId: order.id,
            orderKind: "ONLINE",
            type: "ORDER_CREATED",
            source: operationalSourceFromOnlineFulfillment(
              order.fulfillmentType,
            ),
            fulfillment: order.fulfillmentType,
            status: operationalStatusFromOnlineOrder(order.status),
            totalMinor: order.totalMinor,
            currency: order.currency,
          });
          return order;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      )
      .catch(async (error: unknown) => {
        // A simultaneous retry can pass the initial lookup before the first
        // transaction commits. Recover only a committed order in this exact scope.
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2002"
        )
          throw error;
        const winner = await prisma.onlineOrder.findUnique({
          where: {
            tenantId_venueId_idempotencyKey: {
              tenantId: website.tenantId,
              venueId: website.venueId,
              idempotencyKey: supplied.idempotencyKey,
            },
          },
        });
        if (!winner) throw error;
        replayed = true;
        return winner;
      });
    return {
      referenceCode: created.referenceCode,
      trackingToken: replayed ? null : trackingToken,
      status: created.status,
    };
  },
  async findTracking(trackingToken) {
    return mapTracking(await byToken(trackingToken));
  },
  async addGuestMessage({ trackingToken, body }) {
    const order = await byToken(trackingToken);
    await prisma.onlineOrderMessage.create({
      data: { onlineOrderId: order.id, author: "GUEST", body },
    });
    return mapTracking(await byToken(trackingToken));
  },
};

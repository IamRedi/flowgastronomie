import {
  websiteDocumentSchema,
  OnlineOrderRequestInvalidError,
} from "@flowgastronomie/domain";
import { registerPosMenuChannelRoutes } from "./pos-menu-channel-routes.js";
import { registerStaffLoginRoutes } from "./staff-login-routes.js";
import { registerStaffPasswordResetRoutes } from "./staff-password-reset-routes.js";
import { registerWorkforceAccountRoutes } from "./workforce-account-routes.js";
import { registerWorkforceOperationsRoutes } from "./workforce-operations-routes.js";
import { WorkforceError } from "@flowgastronomie/domain";
import { registerWorkforceRoutes } from "./workforce-routes.js";
import { registerCreativeRoutes } from "./creative-routes.js";
import { registerPlatformAiUsageRoutes } from "./platform-ai-usage-routes.js";
import { registerWebsiteImportRoutes } from "./website-import-routes.js";
import { registerBusinessImportRoutes } from "./business-import-routes.js";
import type { BusinessDiscoveryDependencies } from "./business-import-discovery.js";
import {
  SetupImportError,
  businessHoursSchema,
  premiumStyleIdSchema,
  PremiumSelectionError,
  resolvePremiumSelection,
  staffPasswordChangeSchema,
} from "@flowgastronomie/domain";
import { registerSmartSetupRoutes } from "./smart-setup-routes.js";
import { registerSetupMediaRoutes } from "./setup-media-routes.js";
import { registerMenuImportRoutes } from "./menu-import-routes.js";
import type { MenuExtractionProvider } from "./menu-extraction-provider.js";
import cookie from "@fastify/cookie";
import {
  canonicalMediaRepository,
  bridgeWebsiteMedia,
} from "@flowgastronomie/database";
import {
  businessProfileIds,
  businessProvisionSchema,
  BusinessProvisionConflict,
} from "@flowgastronomie/domain";
import { orderRecoveryCookieName } from "./order-recovery-cookie.js";
import { PickupTimeUnavailableError } from "@flowgastronomie/domain";
import cors from "@fastify/cors";
import {
  ActiveShiftExistsError,
  ActiveShiftRequiredError,
  billingWorkspaceRepository,
  counterSaleRepository,
  type CounterSaleRepository,
  databaseReadinessProbe,
  BillingProfileInvalidError,
  BillingWorkspaceNotFoundError,
  ConcurrentOrderUpdateError,
  customerProfileRepository,
  CustomerProfileNotFoundError,
  guestServiceRepository,
  legalHoldRepository,
  GuestSessionNotFoundError,
  InvalidStaffCredentialsError,
  PaymentBalanceError,
  onlineOrderRepository,
  ORDER_RECOVERY_SECONDS,
  ownerDiagnosticsRepository,
  operationalOrderRepository,
  OnlineOrderNotFoundError,
  OnlineOrderDeliveryUnavailableError,
  OnlineOrderTrackingNotFoundError,
  OnlineOrderProductError,
  OnlineOrderQuoteChangedError,
  OnlineOrderUnavailableError,
  PlanChangeConflictError,
  ProductUnavailableError,
  ProductionTicketConflictError,
  ProductionTicketNotFoundError,
  publicMenuRepository,
  reservationRepository,
  ReservationNotFoundError,
  ReservationUnavailableError,
  PublicTableNotFoundError,
  RadarAssignmentConflictError,
  SessionHasOpenOrdersError,
  SessionPaymentOutstandingError,
  staffAuthRepository,
  staffMenuRepository,
  staffCostRepository,
  staffScheduleRepository,
  StaffCostConflictError,
  StaffCostResourceNotFoundError,
  ScheduleConflictError,
  ScheduleResourceNotFoundError,
  StaffMenuResourceNotFoundError,
  staffOperationsRepository,
  staffOrderRepository,
  staffProductionRepository,
  staffRadarRepository,
  staffReportRepository,
  staffTeamRepository,
  staffVenueSetupRepository,
  staffWorkRepository,
  StaffResourceNotFoundError,
  StaffTableNotFoundError,
  TeamConflictError,
  TeamResourceNotFoundError,
  trialRegistrationRepository,
  TrialEmailAlreadyRegisteredError,
  SubscriptionAccessDeniedError,
  websiteAssetRepository,
  WebsiteAssetInvalidError,
  WebsiteAssetNotFoundError,
  websiteDomainRepository,
  WebsiteDomainConflictError,
  WebsiteDomainInvalidError,
  WebsiteDomainNotFoundError,
  WebsiteDomainNotVerifiedError,
  venueWebsiteRepository,
  venueLaunchRepository,
  VenueLaunchBlockedError,
  VenueLaunchNotFoundError,
  VenueWebsiteConflictError,
  VenueWebsiteNotFoundError,
  VenueWebsitePublicationError,
  VenueSetupConflictError,
  VenueSetupResourceNotFoundError,
  workspaceOverviewRepository,
  WorkspaceOverviewNotFoundError,
  WorkResourceNotFoundError,
  type GuestServiceRepository,
  type LegalHoldRepository,
  type OnlineOrderRepository,
  type OwnerDiagnosticsRepository,
  type OperationalOrderRepository,
  type BillingWorkspaceRepository,
  type CustomerProfileRepository,
  type DatabaseReadinessProbe,
  type PublicMenuRepository,
  type ReservationRepository,
  type StaffAuthRepository,
  type StaffIdentity,
  type StaffMenuRepository,
  type StaffCostRepository,
  type StaffScheduleRepository,
  type StaffOperationsRepository,
  type StaffOrderRepository,
  type StaffProductionRepository,
  type StaffRadarRepository,
  type StaffReportRepository,
  type StaffTeamRepository,
  type StaffVenueSetupRepository,
  type StaffWorkRepository,
  type TrialRegistrationRepository,
  type WebsiteAssetRepository,
  type WebsiteDomainRepository,
  type VenueWebsiteRepository,
  type VenueLaunchRepository,
  type WorkspaceOverviewRepository,
} from "@flowgastronomie/database";
import {
  assertStaffPermission,
  CounterSaleError,
  ALLERGEN_CODES,
  GUEST_SERVICE_REQUESTS,
  GuestActionNotAllowedError,
  InvalidOrderTransitionError,
  IncompatibleIngredientUnitsError,
  InvalidScheduleAssignmentError,
  INGREDIENT_UNITS,
  InvalidIngredientQuantityError,
  InvalidCustomerContactError,
  InvalidLegalHoldError,
  LEGAL_HOLD_TARGETS,
  MenuConfigurationInvalidError,
  ORDER_STATUSES,
  PLAN_DEFINITIONS,
  PLATFORM_LOCALES,
  SERVICE_MODES,
  ONLINE_FULFILLMENT_TYPES,
  STAFF_ROLES,
  SUBSCRIPTION_PLANS,
  StaffPermissionDeniedError,
  transitionOrder,
  WEBSITE_ASSET_KINDS,
  WEBSITE_ASSET_MAX_BYTES,
  type OrderStatus,
  type ReservationStatus,
} from "@flowgastronomie/domain";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import {
  disabledTransactionalNotificationService,
  type TransactionalNotification,
  type TransactionalNotificationService,
} from "./transactional-notifications.js";
import {
  registerUnauthenticatedRateLimiting,
  unauthenticatedRateLimits,
} from "./guest-rate-limit.js";
import { retainsLiveStaffScope } from "./live-session.js";
import { createBoundedDatabaseReadinessProbe } from "./readiness.js";
import { registerHardwareRoutes } from "./hardware-routes.js";
import { registerCounterSaleRoutes } from "./counter-sale-routes.js";
import { registerPilotOperationsRoutes } from "./pilot-operations-routes.js";

const transitionSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

const staffOrderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().trim().max(200).optional(),
  variantId: z.string().min(1).optional(),
  modifierOptionIds: z.array(z.string().min(1)).max(20).optional(),
});

const staffOrderSchema = z.object({
  orderType: z.enum(["DINE_IN", "TAKEAWAY"]),
  tableId: z.string().min(1).optional(),
  locale: z.enum(PLATFORM_LOCALES).default("sq"),
  items: z.array(staffOrderItemSchema).min(1).max(50),
});

const staffOrderKeySchema = z.string().trim().min(8).max(100);

const publicMenuQuerySchema = z.object({
  locale: z.enum(PLATFORM_LOCALES).default("sq"),
});

const guestCredentialsSchema = z.object({
  guestToken: z.string().min(32).max(128),
  idempotencyKey: z.string().min(8).max(128),
});

const submitOrderSchema = z.object({
  locale: z.enum(PLATFORM_LOCALES).default("sq"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(128),
        quantity: z.number().int().min(1).max(20),
        notes: z.string().trim().max(200).optional(),
        variantId: z.string().min(1).max(128).optional(),
        modifierOptionIds: z
          .array(z.string().min(1).max(128))
          .max(20)
          .optional(),
      }),
    )
    .min(1)
    .max(30),
});

const serviceRequestSchema = z.object({
  type: z.enum(GUEST_SERVICE_REQUESTS),
});
const onlineOrderMessageSchema = z.object({
  body: z.string().trim().min(1).max(500),
});
const onlineOrderTransitionSchema = z.object({
  status: z.enum([
    "ACCEPTED",
    "REJECTED",
    "CANCELLED",
    "PREPARING",
    "READY",
    "OUT_FOR_DELIVERY",
    "COMPLETED",
  ]),
  note: z.string().trim().max(500).optional(),
});
const onlineFulfillmentSettingsSchema = z.object({
  pickupLeadMinutes: z.number().int().min(1).max(240).nullable().optional(),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  cateringEnabled: z.boolean(),
});
const deliveryZoneSchema = z.object({
  name: z.string().trim().min(2).max(80),
  postalPrefixes: z.array(z.string().trim().min(1).max(20)).min(1).max(50),
  feeMinor: z.number().int().min(0).max(100_000),
  minimumOrderMinor: z.number().int().min(0).max(1_000_000),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
const onlineOrderSubmitSchema = z.object({
  expectedQuote: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  locale: z.enum(PLATFORM_LOCALES).default("sq"),
  idempotencyKey: z.string().min(8).max(128),
  fulfillmentType: z.enum(ONLINE_FULFILLMENT_TYPES),
  contact: z.object({
    name: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(6).max(40),
    email: z.email().max(254).optional(),
  }),
  requestedFor: z.coerce.date().optional(),
  timingMode: z.enum(["ASAP", "SCHEDULED"]).optional(),
  deliveryAddress: z
    .object({
      line1: z.string().trim().min(2).max(160),
      postalCode: z.string().trim().min(2).max(20),
      city: z.string().trim().min(2).max(80),
    })
    .optional(),
  cateringGuestCount: z.number().int().min(1).max(500).optional(),
  guestNotes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(128),
        quantity: z.number().int().min(1).max(20),
        notes: z.string().trim().max(200).optional(),
        variantId: z.string().min(1).max(128).optional(),
        modifierOptionIds: z
          .array(z.string().min(1).max(128))
          .max(20)
          .optional(),
      }),
    )
    .min(1)
    .max(30),
});

const trialRegistrationSchema = z.object({
  countryCode: businessProvisionSchema.shape.countryCode,
  timezone: businessProvisionSchema.shape.timezone,
  currency: businessProvisionSchema.shape.currency,
  requestKey: z.string().min(16).max(200).optional(),
  profileId: z.enum(businessProfileIds).optional(),
  applyCategories: z.boolean().optional(),
  premiumTemplate: businessProvisionSchema.shape.premiumTemplate,
  organizationName: z.string().trim().min(2).max(120),
  venueName: z.string().trim().min(2).max(120),
  ownerDisplayName: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  locale: z.enum(PLATFORM_LOCALES),
  plan: z.enum(SUBSCRIPTION_PLANS),
});

const websiteTranslationSchema = z.object({
  locale: z.enum(PLATFORM_LOCALES),
  heroTitle: z.string().trim().max(120),
  heroSubtitle: z.string().trim().max(280),
  storyTitle: z.string().trim().max(120),
  storyBody: z.string().trim().max(2_000),
  seoTitle: z.string().trim().max(70),
  seoDescription: z.string().trim().max(180),
});
const websiteImageUrlSchema = z.union([
  z.url().max(2_000),
  z
    .string()
    .max(200)
    .regex(/^\/v1\/(?:public\/website-assets|media)\/[a-zA-Z0-9_-]+$/),
]);
const websiteInputSchema = z.object({
  designVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  document: websiteDocumentSchema.nullable().optional(),
  publicSlug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/),
  sourceProposalId: z.string().min(1).max(128).optional(),
  expectedUpdatedAt: z.iso.datetime().optional(),
  premiumStyleId: premiumStyleIdSchema.nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  logoUrl: websiteImageUrlSchema.nullable(),
  heroImageUrl: websiteImageUrlSchema.nullable(),
  phone: z.string().trim().max(60).nullable(),
  contactEmail: z.email().max(254).nullable(),
  address: z.string().trim().max(300).nullable(),
  instagramUrl: z.url().max(2_000).nullable(),
  facebookUrl: z.url().max(2_000).nullable(),
  openingHours: businessHoursSchema,
  translations: z
    .array(websiteTranslationSchema)
    .length(PLATFORM_LOCALES.length)
    .refine(hasEveryPlatformLocale, "Each platform language is required"),
});

const websiteDomainSchema = z.object({
  hostname: z.string().trim().min(4).max(253),
});

const websiteAssetParamsSchema = z.object({
  kind: z.enum(WEBSITE_ASSET_KINDS),
});

const billingProfileSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(160),
  billingEmail: z.email().max(254),
  addressLine1: z.string().trim().min(2).max(200),
  postalCode: z.string().trim().min(2).max(20),
  city: z.string().trim().min(2).max(100),
  countryCode: z.string().trim().length(2),
  vatId: z.string().trim().max(40).nullable(),
});

const planChangeSchema = z.object({
  requestedPlan: z.enum(SUBSCRIPTION_PLANS),
});

const staffOrderStatusSchema = z.object({
  status: z
    .enum(ORDER_STATUSES)
    .refine((status) => status !== "NEW", "Status cannot return to NEW"),
  expectedVersion: z.number().int().min(1),
});

const categoryTranslationSchema = z.object({
  locale: z.enum(PLATFORM_LOCALES),
  name: z.string().trim().min(1).max(120),
});

const productTranslationSchema = categoryTranslationSchema.extend({
  description: z.string().trim().max(500).nullable().optional(),
});

function hasEveryPlatformLocale(translations: Array<{ locale: string }>) {
  return (
    new Set(translations.map((translation) => translation.locale)).size ===
      PLATFORM_LOCALES.length &&
    PLATFORM_LOCALES.every((locale) =>
      translations.some((translation) => translation.locale === locale),
    )
  );
}

const staffCategorySchema = z.object({
  published: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  translations: z
    .array(categoryTranslationSchema)
    .length(PLATFORM_LOCALES.length)
    .refine(hasEveryPlatformLocale, "Each platform language is required"),
});

const staffProductSchema = z.object({
  categoryId: z.string().min(1).max(128),
  priceMinor: z.number().int().min(0).max(100_000_000),
  sortOrder: z.number().int().min(0).max(10_000),
  available: z.boolean(),
  published: z.boolean(),
  station: z.enum(["BAR", "KITCHEN", "DESSERT"]),
  translations: z
    .array(productTranslationSchema)
    .length(PLATFORM_LOCALES.length)
    .refine(hasEveryPlatformLocale, "Each platform language is required"),
});

const menuConfigurationTranslationSchema = z.object({
  locale: z.enum(PLATFORM_LOCALES),
  name: z.string().trim().min(1).max(120),
});
const menuConfigurationTranslations = z
  .array(menuConfigurationTranslationSchema)
  .length(PLATFORM_LOCALES.length)
  .refine(hasEveryPlatformLocale, "Each platform language is required");
const productConfigurationSchema = z.object({
  variants: z
    .array(
      z.object({
        priceDeltaMinor: z.number().int().min(-100_000_000).max(100_000_000),
        sortOrder: z.number().int().min(0).max(10_000),
        available: z.boolean(),
        isDefault: z.boolean(),
        translations: menuConfigurationTranslations,
      }),
    )
    .max(20),
  modifierGroups: z
    .array(
      z.object({
        minSelect: z.number().int().min(0).max(20),
        maxSelect: z.number().int().min(0).max(20),
        sortOrder: z.number().int().min(0).max(10_000),
        translations: menuConfigurationTranslations,
        options: z
          .array(
            z.object({
              priceDeltaMinor: z.number().int().min(0).max(100_000_000),
              sortOrder: z.number().int().min(0).max(10_000),
              available: z.boolean(),
              translations: menuConfigurationTranslations,
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .max(20),
});

const serviceModeSchema = z.enum(SERVICE_MODES);
const staffVenueSchema = z.object({ defaultServiceMode: serviceModeSchema });
const staffAreaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  serviceModeOverride: serviceModeSchema.nullable(),
});
const staffTableSchema = z.object({
  label: z.string().trim().min(1).max(30),
  areaId: z.string().min(1).max(128).nullable(),
  serviceModeOverride: serviceModeSchema.nullable(),
});
const shiftNoteSchema = z.object({
  note: z.string().trim().max(300).optional(),
});
const paymentSchema = z.object({
  amountMinor: z.number().int().positive().max(100_000_000),
  method: z.enum(["CASH", "CARD_AT_TABLE", "OTHER"]),
  idempotencyKey: z.string().min(8).max(128),
  externalReference: z.string().trim().max(120).optional(),
});
const voidPaymentSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});
const staffInvitationSchema = z.object({
  email: z.email().max(254),
  role: z.enum(STAFF_ROLES),
  preferredLocale: z.enum(PLATFORM_LOCALES),
});
const acceptInvitationSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  password: z.string().min(8).max(128),
});
const updateTeamMemberSchema = z
  .object({
    role: z.enum(STAFF_ROLES).optional(),
    active: z.boolean().optional(),
    preferredLocale: z.enum(PLATFORM_LOCALES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "A change is required");
const tableAssignmentSchema = z.object({
  membershipId: z.string().min(1).max(128),
  tableId: z.string().min(1).max(128),
});
const signalAssignmentSchema = z.object({
  membershipId: z.string().min(1).max(128),
});
const productionTicketStatusSchema = z.object({
  status: z.enum(["PREPARING", "READY", "SERVED"]),
  expectedVersion: z.number().int().positive(),
});
const dailyReportQuerySchema = z.object({ date: z.iso.date().optional() });
const ingredientBaseUnitSchema = z.enum(["GRAM", "MILLILITER", "PIECE"]);
const staffIngredientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseUnit: ingredientBaseUnitSchema,
  allergens: z.array(z.enum(ALLERGEN_CODES)).max(ALLERGEN_CODES.length),
  active: z.boolean(),
});
const staffIngredientUpdateSchema = staffIngredientSchema.omit({
  baseUnit: true,
});
const staffSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(120).nullable(),
  phone: z.string().trim().min(1).max(60).nullable(),
  email: z.email().max(254).nullable(),
  address: z.string().trim().min(1).max(300).nullable(),
  active: z.boolean(),
});
const supplierItemPriceSchema = z.object({
  supplierId: z.string().min(1).max(128),
  ingredientId: z.string().min(1).max(128),
  packQuantity: z.number().int().positive().max(10_000_000),
  unit: z.enum(INGREDIENT_UNITS),
  priceMinor: z.number().int().min(0).max(100_000_000),
  effectiveFrom: z.coerce.date(),
});
const recipeSchema = z.object({
  yieldBasisPoints: z.number().int().min(1).max(10_000),
  wastageBasisPoints: z.number().int().min(0).max(10_000),
  ingredients: z
    .array(
      z.object({
        ingredientId: z.string().min(1).max(128),
        quantityBaseUnits: z.number().int().positive().max(10_000_000),
      }),
    )
    .min(1)
    .refine(
      (items) =>
        new Set(items.map((item) => item.ingredientId)).size === items.length,
      "Each ingredient may appear once",
    ),
});
const scheduleAssignmentSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  membershipId: z.string().min(1).max(128),
  role: z.enum(STAFF_ROLES),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});
const scheduleSchema = z.object({
  expectedVersion: z.number().int().min(0).optional(),
  weekStartsOn: z.coerce.date(),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  assignments: z.array(scheduleAssignmentSchema).max(500),
});
const scheduleQuerySchema = z.object({ weekStartsOn: z.coerce.date() });
const availabilitySchema = z.object({
  membershipId: z.string().min(1).max(128),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  note: z.string().trim().min(1).max(500),
});
const operationalTaskSchema = z.object({
  scope: z.enum(["VENUE", "SHIFT", "TABLE", "ORDER"]),
  scopeId: z.string().trim().min(1).max(128).nullable(),
  title: z.string().trim().min(1).max(240),
  dueAt: z.coerce.date().nullable(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]),
  assigneeMembershipId: z.string().min(1).max(128).nullable(),
});
const handoverSchema = z.object({
  shiftId: z.string().min(1).max(128).nullable(),
  body: z.string().trim().min(1).max(1_000),
});
const publicReservationSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  guestName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(6).max(40),
  email: z.email().max(254).nullable(),
  locale: z.enum(PLATFORM_LOCALES),
  requestedFor: z.coerce.date(),
  partySize: z.number().int().min(1).max(50),
  guestNotes: z.string().trim().max(500).nullable(),
});
const reservationStatusSchema = z.object({
  status: z.enum([
    "CONFIRMED",
    "SEATED",
    "COMPLETED",
    "REJECTED",
    "CANCELLED",
    "NO_SHOW",
  ]),
  tableId: z.string().min(1).max(128).nullable(),
});
const reservationDateSchema = z.object({ date: z.coerce.date() });
const reservationAutoConfirmSchema = z.object({ enabled: z.boolean() });
const customerProfileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(2).max(100),
    email: z.email().max(254).nullable(),
    phone: z.string().trim().min(6).max(40).nullable(),
    preferredLocale: z.enum(PLATFORM_LOCALES),
    internalNotes: z.string().trim().max(2_000).nullable(),
  })
  .refine((value) => value.email || value.phone, {
    message: "An email address or phone number is required",
  });
const legalHoldCreateSchema = z.object({
  target: z.enum(LEGAL_HOLD_TARGETS),
  targetId: z.string().min(1).max(128),
  reason: z.string().trim().min(3).max(1_000),
  reviewAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});

const demoOrders = new Map<string, OrderStatus>([["order-1", "NEW"]]);
const demoVenue = {
  tenantId: "demo-tenant",
  venueId: "demo-venue",
  membershipId: "demo-membership",
};

type AppDependencies = {
  counterSaleRepository: CounterSaleRepository;
  publicMenuRepository: PublicMenuRepository;
  reservationRepository: ReservationRepository;
  customerProfileRepository: CustomerProfileRepository;
  legalHoldRepository: LegalHoldRepository;
  guestServiceRepository: GuestServiceRepository;
  onlineOrderRepository: OnlineOrderRepository;
  operationalOrderRepository: OperationalOrderRepository;
  staffAuthRepository: StaffAuthRepository;
  staffMenuRepository: StaffMenuRepository;
  staffCostRepository: StaffCostRepository;
  staffScheduleRepository: StaffScheduleRepository;
  staffOperationsRepository: StaffOperationsRepository;
  staffOrderRepository: StaffOrderRepository;
  staffProductionRepository: StaffProductionRepository;
  staffRadarRepository: StaffRadarRepository;
  staffReportRepository: StaffReportRepository;
  staffTeamRepository: StaffTeamRepository;
  staffVenueSetupRepository: StaffVenueSetupRepository;
  staffWorkRepository: StaffWorkRepository;
  trialRegistrationRepository: TrialRegistrationRepository;
  workspaceOverviewRepository: WorkspaceOverviewRepository;
  ownerDiagnosticsRepository: OwnerDiagnosticsRepository;
  venueWebsiteRepository: VenueWebsiteRepository;
  websiteDomainRepository: WebsiteDomainRepository;
  websiteAssetRepository: WebsiteAssetRepository;
  billingWorkspaceRepository: BillingWorkspaceRepository;
  venueLaunchRepository: VenueLaunchRepository;
  transactionalNotificationService: TransactionalNotificationService;
  databaseReadinessProbe: DatabaseReadinessProbe;
};

type AppConfiguration = {
  logger?: boolean;
  hardwareService?: import("./hardware-service.js").HardwareService;
  /** Trusted application clock port for isolated acceptance; never an HTTP/env override. */
  workforceClock?: () => Date;
  businessImport?: BusinessDiscoveryDependencies;
  websiteAiProvider?: import("./website-ai-provider.js").WebsiteAiProvider;
  menuExtractionProvider?: MenuExtractionProvider;
  trustProxy?: string | false;
  readinessTimeoutMs?: number;
};

export function buildApp(
  overrides: Partial<AppDependencies> = {},
  configuration: AppConfiguration = {},
) {
  const dependencies: AppDependencies = {
    counterSaleRepository,
    publicMenuRepository,
    reservationRepository,
    customerProfileRepository,
    legalHoldRepository,
    guestServiceRepository,
    onlineOrderRepository,
    operationalOrderRepository,
    staffAuthRepository,
    staffMenuRepository,
    staffCostRepository,
    staffScheduleRepository,
    staffOperationsRepository,
    staffOrderRepository,
    staffProductionRepository,
    staffRadarRepository,
    staffReportRepository,
    staffTeamRepository,
    staffVenueSetupRepository,
    staffWorkRepository,
    trialRegistrationRepository,
    workspaceOverviewRepository,
    ownerDiagnosticsRepository,
    venueWebsiteRepository,
    websiteDomainRepository,
    websiteAssetRepository,
    billingWorkspaceRepository,
    venueLaunchRepository,
    transactionalNotificationService: disabledTransactionalNotificationService,
    databaseReadinessProbe,
    ...overrides,
  };
  const app = Fastify({
    logger: configuration.logger ?? true,
    trustProxy: configuration.trustProxy ?? false,
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SubscriptionAccessDeniedError) {
      return reply.code(403).send({ code: "SUBSCRIPTION_UPGRADE_REQUIRED" });
    }
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    return reply.code(statusCode).send(error);
  });
  registerUnauthenticatedRateLimiting(app);
  const readinessProbe = createBoundedDatabaseReadinessProbe(
    dependencies.databaseReadinessProbe,
    configuration.readinessTimeoutMs,
  );

  async function notify(notification: TransactionalNotification) {
    try {
      await dependencies.transactionalNotificationService.send(notification);
    } catch (error) {
      app.log.error(
        { err: error, notificationKind: notification.kind },
        "Transactional notification delivery failed after commit",
      );
    }
  }

  function startSsePolling(input: {
    request: FastifyRequest;
    reply: FastifyReply;
    event: string;
    initial: unknown;
    poll: () => Promise<unknown | undefined>;
  }) {
    const { request, reply, event, initial, poll } = input;
    let closed = false;
    let eventId = 0;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    const close = () => {
      if (closed) return;
      closed = true;
      if (updateTimer) clearTimeout(updateTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };
    const send = (data: unknown) => {
      if (closed || reply.raw.destroyed || reply.raw.writableEnded) return;
      eventId += 1;
      reply.raw.write(
        `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      );
    };
    const schedule = () => {
      if (closed) return;
      updateTimer = setTimeout(async () => {
        if (closed) return;
        if (reply.raw.writableNeedDrain) {
          schedule();
          return;
        }
        try {
          const data = await poll();
          if (data === undefined) {
            close();
            reply.raw.end();
            return;
          }
          send(data);
        } catch (error) {
          app.log.warn({ err: error, event }, "SSE refresh failed");
        }
        schedule();
      }, 5_000);
    };

    // Hijacking bypasses Fastify's normal send path. Preserve the headers
    // already validated by CORS, including credential support for recovery.
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    reply.raw.write("retry: 3000\n\n");
    send(initial);
    schedule();
    heartbeatTimer = setInterval(() => {
      if (!closed && !reply.raw.writableNeedDrain) {
        reply.raw.write(": heartbeat\n\n");
      }
    }, 15_000);
    request.raw.once("close", close);
    reply.raw.once("error", close);
  }

  function sessionToken(request: FastifyRequest) {
    const authorization = request.headers.authorization;
    return authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : (request.cookies.flowgastronomie_staff_session ??
          request.cookies.restaurantflow_staff_session);
  }

  async function refreshLiveStaff(
    request: FastifyRequest,
    original: StaffIdentity,
  ) {
    const token = sessionToken(request);
    if (!token) return undefined;
    const current = await dependencies.staffAuthRepository.authenticate(token);
    if (!retainsLiveStaffScope(original, current)) {
      return undefined;
    }
    return current;
  }

  app.addContentTypeParser(
    ["image/jpeg", "image/png", "image/webp"],
    { parseAs: "buffer", bodyLimit: WEBSITE_ASSET_MAX_BYTES },
    (_request, body, done) => done(null, body),
  );

  void app.register(cookie);
  void app.register(cors, {
    origin:
      process.env.WEB_ORIGIN ??
      (process.env.NODE_ENV === "production" ? false : true),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  async function requireStaff(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<StaffIdentity | null> {
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : undefined;
    const sessionToken =
      request.cookies.flowgastronomie_staff_session ??
      request.cookies.restaurantflow_staff_session ??
      bearerToken;

    if (!sessionToken) {
      await reply.code(401).send({
        code: "AUTHENTICATION_REQUIRED",
        message: "A valid staff session is required",
      });
      return null;
    }

    const staff =
      await dependencies.staffAuthRepository.authenticate(sessionToken);
    if (!staff) {
      await reply.code(401).send({
        code: "INVALID_STAFF_SESSION",
        message: "The staff session is invalid or expired",
      });
      return null;
    }

    return staff;
  }

  function sendStaffMenuError(error: unknown, reply: FastifyReply) {
    if (error instanceof SetupImportError && error.code === "CONFLICT")
      return reply.code(409).send({ code: "CONFLICT", message: error.message });
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof StaffMenuResourceNotFoundError) {
      return reply
        .code(404)
        .send({ code: "MENU_RESOURCE_NOT_FOUND", message: error.message });
    }
    if (error instanceof MenuConfigurationInvalidError) {
      return reply.code(400).send({
        code: "INVALID_PRODUCT_CONFIGURATION",
        message: error.message,
        issues: error.issues,
      });
    }
    throw error;
  }

  function sendStaffCostError(error: unknown, reply: FastifyReply) {
    if (error instanceof SubscriptionAccessDeniedError) {
      return reply.code(403).send({ code: "SUBSCRIPTION_UPGRADE_REQUIRED" });
    }
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof StaffCostResourceNotFoundError) {
      return reply
        .code(404)
        .send({ code: "COST_RESOURCE_NOT_FOUND", message: error.message });
    }
    if (error instanceof StaffCostConflictError) {
      return reply
        .code(409)
        .send({ code: "COST_CONFLICT", message: error.message });
    }
    if (
      error instanceof IncompatibleIngredientUnitsError ||
      error instanceof InvalidIngredientQuantityError
    ) {
      return reply
        .code(400)
        .send({ code: "INVALID_SUPPLIER_PRICE", message: error.message });
    }
    throw error;
  }

  function sendScheduleError(error: unknown, reply: FastifyReply) {
    if (error instanceof WorkforceError)
      return reply
        .code(
          error.code === "NOT_FOUND"
            ? 404
            : error.code === "CONFLICT"
              ? 409
              : 400,
        )
        .send({ code: error.code, message: error.message });
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof ScheduleResourceNotFoundError) {
      return reply
        .code(404)
        .send({ code: "SCHEDULE_RESOURCE_NOT_FOUND", message: error.message });
    }
    if (error instanceof ScheduleConflictError) {
      return reply
        .code(409)
        .send({ code: "SCHEDULE_CONFLICT", message: error.message });
    }
    if (error instanceof InvalidScheduleAssignmentError) {
      return reply
        .code(400)
        .send({ code: "INVALID_SCHEDULE_ASSIGNMENT", message: error.message });
    }
    throw error;
  }

  function sendVenueSetupError(error: unknown, reply: FastifyReply) {
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof VenueSetupResourceNotFoundError) {
      return reply
        .code(404)
        .send({ code: "SETUP_RESOURCE_NOT_FOUND", message: error.message });
    }
    if (error instanceof VenueSetupConflictError) {
      return reply
        .code(409)
        .send({ code: "SETUP_CONFLICT", message: error.message });
    }
    throw error;
  }

  function sendWorkError(error: unknown, reply: FastifyReply) {
    if (error instanceof CounterSaleError)
      return reply.code(409).send({ code: error.code, message: error.message });
    if (error instanceof SubscriptionAccessDeniedError) {
      return reply.code(403).send({ code: "SUBSCRIPTION_UPGRADE_REQUIRED" });
    }
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof ActiveShiftRequiredError) {
      return reply
        .code(409)
        .send({ code: "ACTIVE_SHIFT_REQUIRED", message: error.message });
    }
    if (error instanceof ActiveShiftExistsError) {
      return reply
        .code(409)
        .send({ code: "ACTIVE_SHIFT_EXISTS", message: error.message });
    }
    if (error instanceof PaymentBalanceError) {
      return reply
        .code(409)
        .send({ code: "PAYMENT_EXCEEDS_BALANCE", message: error.message });
    }
    if (error instanceof WorkResourceNotFoundError) {
      return reply
        .code(404)
        .send({ code: "WORK_RESOURCE_NOT_FOUND", message: error.message });
    }
    throw error;
  }

  function sendStaffOrderError(error: unknown, reply: FastifyReply) {
    if (error instanceof CounterSaleError)
      return reply.code(409).send({ code: error.code, message: error.message });
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof ActiveShiftRequiredError) {
      return reply
        .code(409)
        .send({ code: "ACTIVE_SHIFT_REQUIRED", message: error.message });
    }
    if (error instanceof StaffTableNotFoundError) {
      return reply
        .code(404)
        .send({ code: "TABLE_NOT_FOUND", message: error.message });
    }
    if (error instanceof ProductUnavailableError) {
      return reply
        .code(409)
        .send({ code: "PRODUCT_UNAVAILABLE", message: error.message });
    }
    throw error;
  }

  function sendTeamError(error: unknown, reply: FastifyReply) {
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof TeamResourceNotFoundError) {
      return reply
        .code(404)
        .send({ code: "TEAM_RESOURCE_NOT_FOUND", message: error.message });
    }
    if (error instanceof TeamConflictError) {
      return reply
        .code(409)
        .send({ code: "TEAM_CONFLICT", message: error.message });
    }
    throw error;
  }

  function sendProductionError(error: unknown, reply: FastifyReply) {
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof ActiveShiftRequiredError) {
      return sendWorkError(error, reply);
    }
    if (error instanceof ProductionTicketNotFoundError) {
      return reply
        .code(404)
        .send({ code: "PRODUCTION_TICKET_NOT_FOUND", message: error.message });
    }
    if (error instanceof ProductionTicketConflictError) {
      return reply
        .code(409)
        .send({ code: "PRODUCTION_TICKET_CONFLICT", message: error.message });
    }
    throw error;
  }

  function sendWorkspaceError(error: unknown, reply: FastifyReply) {
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof WorkspaceOverviewNotFoundError) {
      return reply.code(404).send({
        code: "WORKSPACE_NOT_FOUND",
        message: error.message,
      });
    }
    throw error;
  }

  function sendWebsiteError(error: unknown, reply: FastifyReply) {
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof SubscriptionAccessDeniedError) {
      return reply.code(403).send({
        code: "SUBSCRIPTION_UPGRADE_REQUIRED",
        message: error.message,
      });
    }
    if (error instanceof VenueWebsiteNotFoundError) {
      return reply
        .code(404)
        .send({ code: "WEBSITE_NOT_FOUND", message: error.message });
    }
    if (error instanceof SetupImportError)
      return reply
        .code(
          error.code === "CONFLICT"
            ? 409
            : error.code === "NOT_FOUND"
              ? 404
              : 400,
        )
        .send({ code: error.code, message: error.message });
    if (error instanceof VenueWebsiteConflictError) {
      return reply
        .code(409)
        .send({ code: "PUBLIC_SLUG_CONFLICT", message: error.message });
    }
    if (error instanceof VenueWebsitePublicationError) {
      return reply.code(409).send({
        code: "WEBSITE_NOT_READY",
        message: error.message,
        issues: error.issues,
      });
    }
    if (error instanceof WebsiteAssetInvalidError) {
      return reply
        .code(400)
        .send({ code: "INVALID_WEBSITE_ASSET", message: error.message });
    }
    if (error instanceof WebsiteAssetNotFoundError) {
      return reply
        .code(404)
        .send({ code: "WEBSITE_ASSET_NOT_FOUND", message: error.message });
    }
    throw error;
  }

  function sendWebsiteDomainError(error: unknown, reply: FastifyReply) {
    if (
      error instanceof StaffPermissionDeniedError ||
      error instanceof SubscriptionAccessDeniedError
    ) {
      return reply.code(403).send({
        code:
          error instanceof SubscriptionAccessDeniedError
            ? "SUBSCRIPTION_UPGRADE_REQUIRED"
            : "FORBIDDEN",
        message: error.message,
      });
    }
    if (error instanceof WebsiteDomainNotFoundError) {
      return reply
        .code(404)
        .send({ code: "WEBSITE_DOMAIN_NOT_FOUND", message: error.message });
    }
    if (error instanceof WebsiteDomainInvalidError) {
      return reply
        .code(400)
        .send({ code: "INVALID_WEBSITE_DOMAIN", message: error.message });
    }
    if (error instanceof WebsiteDomainConflictError) {
      return reply
        .code(409)
        .send({ code: "WEBSITE_DOMAIN_CONFLICT", message: error.message });
    }
    if (error instanceof WebsiteDomainNotVerifiedError) {
      return reply
        .code(409)
        .send({ code: "WEBSITE_DOMAIN_NOT_VERIFIED", message: error.message });
    }
    throw error;
  }

  function sendBillingError(error: unknown, reply: FastifyReply) {
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof BillingWorkspaceNotFoundError) {
      return reply
        .code(404)
        .send({ code: "BILLING_WORKSPACE_NOT_FOUND", message: error.message });
    }
    if (error instanceof BillingProfileInvalidError) {
      return reply
        .code(400)
        .send({ code: "INVALID_BILLING_PROFILE", message: error.message });
    }
    if (error instanceof PlanChangeConflictError) {
      return reply.code(409).send({
        code: "PLAN_CHANGE_CONFLICT",
        message: error.message,
        issues: error.issues,
      });
    }
    throw error;
  }

  function sendLaunchError(error: unknown, reply: FastifyReply) {
    if (error instanceof StaffPermissionDeniedError) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: error.message });
    }
    if (error instanceof VenueLaunchNotFoundError) {
      return reply
        .code(404)
        .send({ code: "LAUNCH_WORKSPACE_NOT_FOUND", message: error.message });
    }
    if (error instanceof VenueLaunchBlockedError) {
      return reply.code(409).send({
        code: "VENUE_LAUNCH_BLOCKED",
        message: error.message,
        issues: error.issues,
      });
    }
    throw error;
  }

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async (request, reply) => {
    reply.header("cache-control", "no-store");
    try {
      await readinessProbe.check();
      return { status: "ready", checks: { database: "ok" } };
    } catch {
      request.log.warn(
        { check: "database" },
        "Database readiness check failed",
      );
      return reply.code(503).send({
        status: "not_ready",
        checks: { database: "unavailable" },
      });
    }
  });

  app.get(
    "/v1/capabilities",
    { config: { rateLimit: unauthenticatedRateLimits.publicRead } },
    async () => ({ serviceModes: SERVICE_MODES }),
  );

  app.get(
    "/v1/public/plans",
    { config: { rateLimit: unauthenticatedRateLimits.publicRead } },
    async () => ({
      plans: SUBSCRIPTION_PLANS.map((plan) => PLAN_DEFINITIONS[plan]),
    }),
  );

  app.get<{ Params: { publicSlug: string } }>(
    "/v1/public/websites/:publicSlug",
    { config: { rateLimit: unauthenticatedRateLimits.publicRead } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const query = publicMenuQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply
          .code(400)
          .send({ code: "INVALID_LOCALE", message: "Unsupported locale" });
      }
      const website = await dependencies.venueWebsiteRepository.findPublic(
        request.params.publicSlug,
        query.data.locale,
      );
      if (!website) {
        return reply.code(404).send({
          code: "PUBLIC_WEBSITE_NOT_FOUND",
          message: "The published restaurant website was not found",
        });
      }
      return website;
    },
  );

  app.get<{ Params: { hostname: string } }>(
    "/v1/public/domains/:hostname",
    { config: { rateLimit: unauthenticatedRateLimits.publicRead } },
    async (request, reply) => {
      const resolved = await dependencies.websiteDomainRepository.resolvePublic(
        request.params.hostname,
      );
      return resolved ?? reply.code(404).send({ code: "DOMAIN_NOT_ACTIVE" });
    },
  );

  function trackingCredential(request: {
    params: { trackingToken: string };
    query: unknown;
    cookies: Record<string, string | undefined>;
  }) {
    if (request.params.trackingToken !== "recovered")
      return request.params.trackingToken;
    const query = z
      .object({ venue: z.string().min(1).max(60) })
      .safeParse(request.query);
    if (!query.success) throw new OnlineOrderTrackingNotFoundError();
    return request.cookies[orderRecoveryCookieName(query.data.venue)] ?? "";
  }
  async function publicTracking(
    request: Parameters<typeof trackingCredential>[0],
  ) {
    const order = await dependencies.onlineOrderRepository.findTracking(
      trackingCredential(request),
    );
    if (
      request.params.trackingToken === "recovered" &&
      order.venue?.publicSlug !== (request.query as { venue: string }).venue
    )
      throw new OnlineOrderTrackingNotFoundError();
    return order.timingMode === "ASAP"
      ? { ...order, requestedFor: undefined }
      : order;
  }

  app.get<{ Params: { publicSlug: string } }>(
    "/v1/public/online-orders/:publicSlug/pickup-times",
    { config: { rateLimit: unauthenticatedRateLimits.publicRead } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      try {
        const query = z
          .object({
            fulfillmentType: z.enum(ONLINE_FULFILLMENT_TYPES).default("PICKUP"),
          })
          .safeParse(request.query);
        if (!query.success)
          return reply.code(400).send({ code: "INVALID_FULFILLMENT" });
        return await dependencies.onlineOrderRepository.pickupAvailability(
          request.params.publicSlug,
          query.data.fulfillmentType,
        );
      } catch (error) {
        if (error instanceof OnlineOrderUnavailableError)
          return reply.code(404).send({ code: "ONLINE_ORDERING_UNAVAILABLE" });
        throw error;
      }
    },
  );
  app.post<{ Params: { publicSlug: string } }>(
    "/v1/public/online-orders/:publicSlug/status",
    { config: { rateLimit: unauthenticatedRateLimits.publicOrderStatus } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const body = z
        .object({
          referenceCode: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^RF-[A-Z0-9]{6,20}$/),
        })
        .strict()
        .safeParse(request.body);
      if (!body.success)
        return reply.code(404).send({ code: "ORDER_STATUS_UNAVAILABLE" });
      try {
        const result =
          await dependencies.onlineOrderRepository.findPublicStatus({
            publicSlug: request.params.publicSlug,
            referenceCode: body.data.referenceCode,
          });
        // Explicit transport allowlist even if a repository gains more fields.
        return {
          status: result.status,
          ...(result.timingMode === "ASAP"
            ? {}
            : { requestedFor: result.requestedFor }),
          timingMode: result.timingMode,
          venue: { name: result.venue.name, timezone: result.venue.timezone },
        };
      } catch (error) {
        if (error instanceof OnlineOrderTrackingNotFoundError)
          return reply.code(404).send({ code: "ORDER_STATUS_UNAVAILABLE" });
        throw error;
      }
    },
  );
  app.post<{ Params: { publicSlug: string } }>(
    "/v1/public/online-orders/:publicSlug/recover",
    { config: { rateLimit: unauthenticatedRateLimits.trackingRecovery } },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const body = z
        .object({
          referenceCode: z.string().trim().min(1).max(40),
          phone: z.string().trim().min(6).max(40),
        })
        .safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_ORDER_RECOVERY" });
      try {
        const result = await dependencies.onlineOrderRepository.recover({
          publicSlug: request.params.publicSlug,
          ...body.data,
        });
        reply.setCookie(
          orderRecoveryCookieName(request.params.publicSlug),
          result.sessionToken,
          {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/v1/public/online-orders/track",
            maxAge: ORDER_RECOVERY_SECONDS,
          },
        );
        return { referenceCode: result.referenceCode };
      } catch (error) {
        if (error instanceof OnlineOrderTrackingNotFoundError)
          return reply.code(404).send({ code: "ORDER_RECOVERY_FAILED" });
        throw error;
      }
    },
  );
  app.get<{ Params: { trackingToken: string } }>(
    "/v1/public/online-orders/track/:trackingToken",
    { config: { rateLimit: unauthenticatedRateLimits.trackingRead } },
    async (request, reply) => {
      try {
        reply.header("cache-control", "private, no-store");
        return await publicTracking(request);
      } catch (error) {
        if (error instanceof OnlineOrderTrackingNotFoundError) {
          return reply.code(404).send({ code: "ONLINE_ORDER_NOT_FOUND" });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { trackingToken: string } }>(
    "/v1/public/online-orders/track/:trackingToken/events",
    { config: { rateLimit: unauthenticatedRateLimits.trackingRead } },
    async (request, reply) => {
      try {
        const initial = await publicTracking(request);
        startSsePolling({
          request,
          reply,
          event: "order",
          initial,
          async poll() {
            try {
              return await publicTracking(request);
            } catch (error) {
              if (error instanceof OnlineOrderTrackingNotFoundError) {
                return undefined;
              }
              throw error;
            }
          },
        });
      } catch (error) {
        if (error instanceof OnlineOrderTrackingNotFoundError) {
          return reply.code(404).send({ code: "ONLINE_ORDER_NOT_FOUND" });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { publicSlug: string } }>(
    "/v1/public/online-orders/:publicSlug/quote",
    { config: { rateLimit: unauthenticatedRateLimits.onlineOrderWrite } },
    async (request, reply) => {
      const body = onlineOrderSubmitSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_ONLINE_ORDER" });
      try {
        if (
          (!body.data.requestedFor &&
            !(
              body.data.fulfillmentType === "PICKUP" &&
              body.data.timingMode === "ASAP"
            )) ||
          (body.data.timingMode && body.data.fulfillmentType !== "PICKUP")
        )
          return reply.code(400).send({ code: "INVALID_ONLINE_ORDER" });
        const result = await dependencies.onlineOrderRepository.quote({
          publicSlug: request.params.publicSlug,
          ...body.data,
        });
        return reply.send(result);
      } catch (error) {
        if (error instanceof OnlineOrderQuoteChangedError)
          return reply.code(409).send({ code: "ONLINE_ORDER_QUOTE_CHANGED" });
        if (error instanceof PickupTimeUnavailableError)
          return reply.code(409).send({
            code: "PICKUP_TIME_UNAVAILABLE",
            availability: error.availability,
          });
        if (error instanceof OnlineOrderUnavailableError)
          return reply.code(404).send({ code: "ONLINE_ORDERING_UNAVAILABLE" });
        if (error instanceof OnlineOrderProductError)
          return reply.code(400).send({ code: "ONLINE_ORDER_PRODUCT_INVALID" });
        if (error instanceof OnlineOrderDeliveryUnavailableError)
          return reply.code(400).send({ code: "DELIVERY_UNAVAILABLE" });
        if (error instanceof OnlineOrderRequestInvalidError)
          return reply.code(400).send({ code: "INVALID_ONLINE_ORDER" });
        return reply.code(503).send({ code: "ONLINE_ORDER_RESULT_UNKNOWN" });
      }
    },
  );

  app.post<{ Params: { publicSlug: string } }>(
    "/v1/public/online-orders/:publicSlug",
    { config: { rateLimit: unauthenticatedRateLimits.onlineOrderWrite } },
    async (request, reply) => {
      const body = onlineOrderSubmitSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_ONLINE_ORDER" });
      try {
        if (
          (!body.data.requestedFor &&
            !(
              body.data.fulfillmentType === "PICKUP" &&
              body.data.timingMode === "ASAP"
            )) ||
          (body.data.timingMode && body.data.fulfillmentType !== "PICKUP")
        )
          return reply.code(400).send({ code: "INVALID_ONLINE_ORDER" });
        const result = await dependencies.onlineOrderRepository.submit({
          publicSlug: request.params.publicSlug,
          ...body.data,
        });
        if (body.data.contact.email && result.trackingToken) {
          await notify({
            kind: "ONLINE_ORDER_RECEIVED",
            recipient: body.data.contact.email,
            locale: body.data.locale,
            referenceCode: result.referenceCode,
            trackingToken: result.trackingToken,
          });
        }
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof OnlineOrderQuoteChangedError)
          return reply.code(409).send({ code: "ONLINE_ORDER_QUOTE_CHANGED" });
        if (error instanceof PickupTimeUnavailableError)
          return reply.code(409).send({
            code: "PICKUP_TIME_UNAVAILABLE",
            availability: error.availability,
          });
        if (error instanceof OnlineOrderUnavailableError)
          return reply.code(404).send({ code: "ONLINE_ORDERING_UNAVAILABLE" });
        if (error instanceof OnlineOrderProductError)
          return reply.code(400).send({ code: "ONLINE_ORDER_PRODUCT_INVALID" });
        if (error instanceof OnlineOrderDeliveryUnavailableError)
          return reply.code(400).send({ code: "DELIVERY_UNAVAILABLE" });
        if (error instanceof OnlineOrderRequestInvalidError)
          return reply.code(400).send({ code: "INVALID_ONLINE_ORDER" });
        return reply.code(503).send({ code: "ONLINE_ORDER_RESULT_UNKNOWN" });
      }
    },
  );

  app.post<{ Params: { publicSlug: string } }>(
    "/v1/public/reservations/:publicSlug",
    { config: { rateLimit: unauthenticatedRateLimits.onlineOrderWrite } },
    async (request, reply) => {
      const body = publicReservationSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_RESERVATION" });
      try {
        const result = await dependencies.reservationRepository.create({
          publicSlug: request.params.publicSlug,
          ...body.data,
        });
        if (result.confirmation) {
          await notify({
            kind: "RESERVATION_CONFIRMED",
            ...result.confirmation,
          });
        }
        return reply.code(201).send(result.reservation);
      } catch (error) {
        if (error instanceof ReservationUnavailableError)
          return reply.code(404).send({ code: "RESERVATIONS_UNAVAILABLE" });
        return reply.code(400).send({ code: "INVALID_RESERVATION" });
      }
    },
  );

  app.post<{ Params: { trackingToken: string } }>(
    "/v1/public/online-orders/track/:trackingToken/messages",
    {
      config: {
        rateLimit: unauthenticatedRateLimits.trackingMessageWrite,
      },
    },
    async (request, reply) => {
      const body = onlineOrderMessageSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ code: "INVALID_ONLINE_ORDER_MESSAGE" });
      }
      try {
        await publicTracking(request);
        return await dependencies.onlineOrderRepository.addGuestMessage({
          trackingToken: trackingCredential(request),
          body: body.data.body,
        });
      } catch (error) {
        if (error instanceof OnlineOrderTrackingNotFoundError) {
          return reply.code(404).send({ code: "ONLINE_ORDER_NOT_FOUND" });
        }
        throw error;
      }
    },
  );

  app.get("/v1/staff/online-orders", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.onlineOrderRepository.listForStaff(staff);
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });

  app.get("/v1/staff/operational-orders", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.operationalOrderRepository.listForStaff(staff);
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError) {
        return reply.code(403).send({ code: "FORBIDDEN" });
      }
      throw error;
    }
  });

  app.get("/v1/staff/online-order-settings", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.onlineOrderRepository.getFulfillmentSettings(
        staff,
      );
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });
  app.get("/v1/staff/delivery-zones", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.onlineOrderRepository.listDeliveryZones(staff);
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });
  app.post("/v1/staff/delivery-zones", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = deliveryZoneSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ code: "INVALID_DELIVERY_ZONE" });
    try {
      return reply.code(201).send(
        await dependencies.onlineOrderRepository.createDeliveryZone({
          staff,
          ...body.data,
        }),
      );
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });
  app.put<{ Params: { zoneId: string } }>(
    "/v1/staff/delivery-zones/:zoneId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = deliveryZoneSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_DELIVERY_ZONE" });
      try {
        await dependencies.onlineOrderRepository.updateDeliveryZone({
          staff,
          zoneId: request.params.zoneId,
          ...body.data,
          active: body.data.active ?? true,
          sortOrder: body.data.sortOrder ?? 0,
        });
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof OnlineOrderNotFoundError)
          return reply.code(404).send({ code: "DELIVERY_ZONE_NOT_FOUND" });
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        throw error;
      }
    },
  );
  app.put("/v1/staff/online-order-settings", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = onlineFulfillmentSettingsSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ code: "INVALID_ONLINE_ORDER_SETTINGS" });
    try {
      return await dependencies.onlineOrderRepository.updateFulfillmentSettings(
        { staff, ...body.data },
      );
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });

  app.get("/v1/staff/online-orders/events", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      const sendData =
        await dependencies.onlineOrderRepository.listForStaff(staff);
      startSsePolling({
        request,
        reply,
        event: "orders",
        initial: sendData,
        async poll() {
          const current = await refreshLiveStaff(request, staff);
          return current
            ? dependencies.onlineOrderRepository.listForStaff(current)
            : undefined;
        },
      });
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });

  app.patch<{ Params: { orderId: string } }>(
    "/v1/staff/online-orders/:orderId/status",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = onlineOrderTransitionSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_ONLINE_ORDER_STATUS" });
      try {
        const order =
          await dependencies.onlineOrderRepository.transitionForStaff({
            staff,
            orderId: request.params.orderId,
            ...body.data,
          });
        if (order.contact.email) {
          await notify({
            kind: "ONLINE_ORDER_STATUS_CHANGED",
            recipient: order.contact.email,
            locale: order.locale,
            referenceCode: order.referenceCode,
            status: order.status,
            note: body.data.note ?? null,
          });
        }
        return order;
      } catch (error) {
        if (error instanceof OnlineOrderNotFoundError)
          return reply.code(404).send({ code: "ONLINE_ORDER_NOT_FOUND" });
        if (error instanceof ActiveShiftRequiredError)
          return sendWorkError(error, reply);
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof CounterSaleError)
          return reply
            .code(409)
            .send({ code: error.code, message: error.message });
        return reply
          .code(409)
          .send({ code: "ONLINE_ORDER_TRANSITION_INVALID" });
      }
    },
  );

  app.post<{ Params: { orderId: string } }>(
    "/v1/staff/online-orders/:orderId/messages",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = onlineOrderMessageSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_ONLINE_ORDER_MESSAGE" });
      try {
        return await dependencies.onlineOrderRepository.addStaffMessage({
          staff,
          orderId: request.params.orderId,
          body: body.data.body,
        });
      } catch (error) {
        if (error instanceof OnlineOrderNotFoundError)
          return reply.code(404).send({ code: "ONLINE_ORDER_NOT_FOUND" });
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        throw error;
      }
    },
  );

  app.get<{ Params: { assetId: string } }>(
    "/v1/public/website-assets/:assetId",
    { config: { rateLimit: unauthenticatedRateLimits.publicRead } },
    async (request, reply) => {
      const asset = await dependencies.websiteAssetRepository.findPublic(
        request.params.assetId,
      );
      if (!asset) return reply.code(404).send({ code: "ASSET_NOT_FOUND" });
      return reply
        .header("content-type", asset.mimeType)
        .header("cache-control", "public, max-age=3600, must-revalidate")
        .header("last-modified", asset.updatedAt.toUTCString())
        .send(Buffer.from(asset.bytes));
    },
  );

  app.post(
    "/v1/public/trials",
    { config: { rateLimit: unauthenticatedRateLimits.trialRegistration } },
    async (request, reply) => {
      const body = trialRegistrationSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_TRIAL_REGISTRATION",
          message: z.prettifyError(body.error),
        });
      }

      try {
        if (body.data.premiumTemplate)
          resolvePremiumSelection(
            body.data.profileId ?? "GENERIC",
            body.data.premiumTemplate,
            body.data.currency,
          );
        const result = await dependencies.trialRegistrationRepository.register(
          body.data,
        );
        reply.setCookie("flowgastronomie_staff_session", result.sessionToken, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          expires: result.expiresAt,
        });
        return reply.code(201).send({
          staff: result.staff,
          subscription: result.subscription,
          expiresAt: result.expiresAt,
        });
      } catch (error) {
        if (error instanceof PremiumSelectionError)
          return reply
            .code(400)
            .send({ code: "INVALID_TEMPLATE", message: error.message });
        if (error instanceof TrialEmailAlreadyRegisteredError) {
          return reply.code(409).send({
            code: "EMAIL_ALREADY_REGISTERED",
            message: error.message,
          });
        }
        if (error instanceof BusinessProvisionConflict)
          return reply
            .code(409)
            .send({ code: "PROVISION_CONFLICT", message: error.message });
        throw error;
      }
    },
  );

  registerStaffLoginRoutes(app, dependencies.staffAuthRepository);
  registerStaffPasswordResetRoutes(
    app,
    dependencies.staffAuthRepository,
    notify,
  );

  app.post<{ Params: { token: string } }>(
    "/v1/auth/invitations/:token/accept",
    {
      config: {
        rateLimit: unauthenticatedRateLimits.invitationAcceptance,
      },
    },
    async (request, reply) => {
      const body = acceptInvitationSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_INVITATION_ACCEPTANCE",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffTeamRepository.acceptInvitation({
          token: request.params.token,
          ...body.data,
        });
      } catch (error) {
        return sendTeamError(error, reply);
      }
    },
  );

  app.get("/v1/staff/me", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    return { staff };
  });

  app.get("/v1/workspace/overview", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return {
        actor: {
          displayName: staff.displayName,
          email: staff.email,
          role: staff.role,
        },
        ...(await dependencies.workspaceOverviewRepository.get(staff)),
      };
    } catch (error) {
      return sendWorkspaceError(error, reply);
    }
  });

  app.get("/v1/workspace/diagnostics", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      const diagnostics =
        await dependencies.ownerDiagnosticsRepository.get(staff);
      const provider = process.env.TRANSACTIONAL_EMAIL_PROVIDER ?? "disabled";
      return {
        ...diagnostics,
        notification: {
          enabled:
            provider !== "disabled" &&
            Boolean(process.env.TRANSACTIONAL_EMAIL_FROM_ADDRESS),
          provider: provider === "brevo" ? "BREVO" : "DISABLED",
        },
      };
    } catch (error) {
      return sendWorkspaceError(error, reply);
    }
  });

  app.get("/v1/workspace/website", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.venueWebsiteRepository.getEditor(staff);
    } catch (error) {
      return sendWebsiteError(error, reply);
    }
  });

  app.put("/v1/workspace/website", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = websiteInputSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_WEBSITE",
        message: z.prettifyError(body.error),
      });
    }
    try {
      return await dependencies.venueWebsiteRepository.update({
        staff,
        website: body.data,
      });
    } catch (error) {
      return sendWebsiteError(error, reply);
    }
  });

  app.post("/v1/workspace/website/publish", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      const body = z
        .object({ expectedUpdatedAt: z.iso.datetime().optional() })
        .safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ code: "INVALID_INPUT" });
      return await (body.data.expectedUpdatedAt
        ? dependencies.venueWebsiteRepository.publish(
            staff,
            body.data.expectedUpdatedAt,
          )
        : dependencies.venueWebsiteRepository.publish(staff));
    } catch (error) {
      return sendWebsiteError(error, reply);
    }
  });

  app.post("/v1/workspace/website/unpublish", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.venueWebsiteRepository.unpublish(staff);
    } catch (error) {
      return sendWebsiteError(error, reply);
    }
  });

  app.put<{ Params: { kind: string } }>(
    "/v1/workspace/website/assets/:kind",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const params = websiteAssetParamsSchema.safeParse(request.params);
      if (!params.success || !Buffer.isBuffer(request.body)) {
        return reply.code(400).send({ code: "INVALID_WEBSITE_ASSET" });
      }
      try {
        return await dependencies.websiteAssetRepository.upload({
          staff,
          kind: params.data.kind,
          mimeType: request.headers["content-type"] ?? "",
          bytes: request.body,
        });
      } catch (error) {
        return sendWebsiteError(error, reply);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/media/:id",
    async (request, reply) => {
      const token = request.cookies.flowgastronomie_staff_session;
      const staff = token
        ? await dependencies.staffAuthRepository.authenticate(token)
        : null;
      const asset = await canonicalMediaRepository.content(
        request.params.id,
        staff ?? undefined,
      );
      if (!asset) return reply.code(404).send({ code: "MEDIA_NOT_FOUND" });
      return reply
        .header("content-type", asset.mimeType)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .send(Buffer.from(asset.bytes));
    },
  );
  app.get("/v1/workspace/media", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    return canonicalMediaRepository.resolve(staff);
  });
  app.post("/v1/workspace/media/bridge-website", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    if (
      !z.object({ approved: z.literal(true) }).safeParse(request.body).success
    )
      return reply.code(400).send({ code: "MEDIA_APPROVAL_REQUIRED" });
    return bridgeWebsiteMedia(staff);
  });
  app.put<{
    Params: { productId: string };
    Querystring: { approved?: string };
  }>("/v1/workspace/products/:productId/media", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    if (!Buffer.isBuffer(request.body) || request.query.approved !== "true")
      return reply.code(400).send({ code: "MEDIA_APPROVAL_REQUIRED" });
    try {
      return await canonicalMediaRepository.upload(
        staff,
        request.body,
        { productId: request.params.productId },
        true,
      );
    } catch {
      return reply.code(400).send({ code: "INVALID_MEDIA_UPLOAD" });
    }
  });

  app.get("/v1/workspace/website/domain", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return { domain: await dependencies.websiteDomainRepository.get(staff) };
    } catch (error) {
      return sendWebsiteDomainError(error, reply);
    }
  });

  app.put("/v1/workspace/website/domain", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = websiteDomainSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ code: "INVALID_WEBSITE_DOMAIN" });
    }
    try {
      return {
        domain: await dependencies.websiteDomainRepository.configure({
          staff,
          hostname: body.data.hostname,
        }),
      };
    } catch (error) {
      return sendWebsiteDomainError(error, reply);
    }
  });

  for (const [action, method] of [
    ["verify", "verify"],
    ["activate", "activate"],
  ] as const) {
    app.post(
      `/v1/workspace/website/domain/${action}`,
      async (request, reply) => {
        const staff = await requireStaff(request, reply);
        if (!staff) return;
        try {
          return {
            domain: await dependencies.websiteDomainRepository[method](staff),
          };
        } catch (error) {
          return sendWebsiteDomainError(error, reply);
        }
      },
    );
  }

  app.delete("/v1/workspace/website/domain", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      await dependencies.websiteDomainRepository.remove(staff);
      return reply.code(204).send();
    } catch (error) {
      return sendWebsiteDomainError(error, reply);
    }
  });

  app.get("/v1/workspace/billing", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.billingWorkspaceRepository.get(staff);
    } catch (error) {
      return sendBillingError(error, reply);
    }
  });

  app.put("/v1/workspace/billing/profile", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = billingProfileSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_BILLING_PROFILE",
        message: z.prettifyError(body.error),
      });
    }
    try {
      return await dependencies.billingWorkspaceRepository.updateProfile({
        staff,
        profile: body.data,
      });
    } catch (error) {
      return sendBillingError(error, reply);
    }
  });

  app.post("/v1/workspace/billing/plan-change", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = planChangeSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ code: "INVALID_PLAN_CHANGE" });
    }
    try {
      return await dependencies.billingWorkspaceRepository.requestPlanChange({
        staff,
        requestedPlan: body.data.requestedPlan,
      });
    } catch (error) {
      return sendBillingError(error, reply);
    }
  });

  app.delete<{ Params: { requestId: string } }>(
    "/v1/workspace/billing/plan-change/:requestId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.billingWorkspaceRepository.cancelPlanChange({
          staff,
          requestId: request.params.requestId,
        });
      } catch (error) {
        return sendBillingError(error, reply);
      }
    },
  );

  for (const path of ["onboarding", "launch"] as const) {
    app.get(`/v1/workspace/${path}`, async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.venueLaunchRepository.get(staff);
      } catch (error) {
        return sendLaunchError(error, reply);
      }
    });
  }

  app.post("/v1/workspace/launch/rehearsal", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.venueLaunchRepository.confirmRehearsal(staff);
    } catch (error) {
      return sendLaunchError(error, reply);
    }
  });

  app.post("/v1/workspace/launch/activate", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.venueLaunchRepository.launch(staff);
    } catch (error) {
      return sendLaunchError(error, reply);
    }
  });

  app.get("/v1/staff/shift", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return {
        shift: await dependencies.staffWorkRepository.currentShift(staff),
      };
    } catch (error) {
      return sendWorkError(error, reply);
    }
  });

  app.get("/v1/staff/reports/daily", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const query = dailyReportQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        code: "INVALID_REPORT_DATE",
        message: "The report date must use YYYY-MM-DD",
      });
    }
    try {
      return await dependencies.staffReportRepository.daily({
        staff,
        ...(query.data.date ? { date: query.data.date } : {}),
      });
    } catch (error) {
      return sendWorkError(error, reply);
    }
  });

  app.get("/v1/staff/team", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.staffTeamRepository.list(staff);
    } catch (error) {
      return sendTeamError(error, reply);
    }
  });

  app.get("/v1/staff/reservations", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const query = reservationDateSchema.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({ code: "INVALID_RESERVATION_DATE" });
    try {
      return await dependencies.reservationRepository.list({
        staff,
        ...query.data,
      });
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });

  app.put(
    "/v1/staff/reservations/settings/auto-confirm",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = reservationAutoConfirmSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_RESERVATION_SETTING" });
      try {
        return await dependencies.reservationRepository.setAutoConfirm({
          staff,
          ...body.data,
        });
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        throw error;
      }
    },
  );
  app.get(
    "/v1/staff/reservations/settings/auto-confirm",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.reservationRepository.getAutoConfirm(staff);
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        throw error;
      }
    },
  );

  app.patch<{ Params: { reservationId: string } }>(
    "/v1/staff/reservations/:reservationId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = reservationStatusSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_RESERVATION" });
      try {
        const result = await dependencies.reservationRepository.transition({
          staff,
          reservationId: request.params.reservationId,
          ...body.data,
        });
        if (result.confirmation) {
          await notify({
            kind: "RESERVATION_CONFIRMED",
            ...result.confirmation,
          });
        }
        return result.reservation;
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof ReservationNotFoundError)
          return reply.code(404).send({ code: "RESERVATION_NOT_FOUND" });
        return reply.code(409).send({ code: "INVALID_RESERVATION_TRANSITION" });
      }
    },
  );

  app.get("/v1/staff/customers/export", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.customerProfileRepository.list(staff);
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });

  app.get("/v1/staff/customers", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.customerProfileRepository.list(staff);
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });

  app.get<{ Params: { customerProfileId: string } }>(
    "/v1/staff/customers/:customerProfileId/duplicates",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.customerProfileRepository.findDuplicateCandidates(
          {
            staff,
            customerProfileId: request.params.customerProfileId,
          },
        );
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof CustomerProfileNotFoundError)
          return reply.code(404).send({ code: "CUSTOMER_NOT_FOUND" });
        throw error;
      }
    },
  );

  app.get<{ Params: { customerProfileId: string } }>(
    "/v1/staff/customers/:customerProfileId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.customerProfileRepository.get({
          staff,
          customerProfileId: request.params.customerProfileId,
        });
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof CustomerProfileNotFoundError)
          return reply.code(404).send({ code: "CUSTOMER_NOT_FOUND" });
        throw error;
      }
    },
  );

  app.put<{ Params: { customerProfileId: string } }>(
    "/v1/staff/customers/:customerProfileId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = customerProfileUpdateSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ code: "INVALID_CUSTOMER_PROFILE" });
      try {
        return await dependencies.customerProfileRepository.update({
          staff,
          customerProfileId: request.params.customerProfileId,
          ...body.data,
        });
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof CustomerProfileNotFoundError)
          return reply.code(404).send({ code: "CUSTOMER_NOT_FOUND" });
        if (error instanceof InvalidCustomerContactError)
          return reply.code(400).send({ code: "INVALID_CUSTOMER_CONTACT" });
        throw error;
      }
    },
  );

  app.delete<{ Params: { customerProfileId: string } }>(
    "/v1/staff/customers/:customerProfileId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        await dependencies.customerProfileRepository.remove({
          staff,
          customerProfileId: request.params.customerProfileId,
        });
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof CustomerProfileNotFoundError)
          return reply.code(404).send({ code: "CUSTOMER_NOT_FOUND" });
        throw error;
      }
    },
  );

  app.get("/v1/staff/legal-holds", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.legalHoldRepository.list(staff);
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      throw error;
    }
  });

  app.post("/v1/staff/legal-holds", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = legalHoldCreateSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ code: "INVALID_LEGAL_HOLD" });
    try {
      return reply.code(201).send(
        await dependencies.legalHoldRepository.create({
          staff,
          ...body.data,
        }),
      );
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError)
        return reply.code(403).send({ code: "FORBIDDEN" });
      if (error instanceof InvalidLegalHoldError)
        return reply.code(400).send({ code: "INVALID_LEGAL_HOLD" });
      if (
        error instanceof Error &&
        error.message === "LEGAL_HOLD_TARGET_NOT_FOUND"
      )
        return reply.code(404).send({ code: "LEGAL_HOLD_TARGET_NOT_FOUND" });
      throw error;
    }
  });

  app.delete<{ Params: { holdId: string } }>(
    "/v1/staff/legal-holds/:holdId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        await dependencies.legalHoldRepository.release({
          staff,
          holdId: request.params.holdId,
        });
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        if (error instanceof Error && error.message === "LEGAL_HOLD_NOT_FOUND")
          return reply.code(404).send({ code: "LEGAL_HOLD_NOT_FOUND" });
        throw error;
      }
    },
  );

  app.get("/v1/staff/schedule", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const query = scheduleQuerySchema.safeParse(request.query);
    if (!query.success)
      return reply.code(400).send({
        code: "INVALID_SCHEDULE",
        message: z.prettifyError(query.error),
      });
    try {
      return await dependencies.staffScheduleRepository.list({
        staff,
        ...query.data,
      });
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  app.put("/v1/staff/schedule", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = scheduleSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({
        code: "INVALID_SCHEDULE",
        message: z.prettifyError(body.error),
      });
    try {
      return await dependencies.staffScheduleRepository.save({
        staff,
        ...body.data,
      });
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  app.post("/v1/staff/schedule/availability", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = availabilitySchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({
        code: "INVALID_AVAILABILITY",
        message: z.prettifyError(body.error),
      });
    try {
      return reply.code(201).send(
        await dependencies.staffScheduleRepository.addAvailability({
          staff,
          ...body.data,
        }),
      );
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  app.post("/v1/staff/tasks", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = operationalTaskSchema.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send({ code: "INVALID_TASK", message: z.prettifyError(body.error) });
    try {
      return reply.code(201).send(
        await dependencies.staffScheduleRepository.createTask({
          staff,
          ...body.data,
        }),
      );
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  app.post<{ Params: { taskId: string } }>(
    "/v1/staff/tasks/:taskId/complete",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.staffScheduleRepository.completeTask({
          staff,
          taskId: request.params.taskId,
        });
      } catch (error) {
        return sendScheduleError(error, reply);
      }
    },
  );

  app.post("/v1/staff/handover-notes", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = handoverSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({
        code: "INVALID_HANDOVER",
        message: z.prettifyError(body.error),
      });
    try {
      return reply.code(201).send(
        await dependencies.staffScheduleRepository.addHandover({
          staff,
          ...body.data,
        }),
      );
    } catch (error) {
      return sendScheduleError(error, reply);
    }
  });

  app.post("/v1/staff/team/invitations", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffInvitationSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_STAFF_INVITATION",
        message: z.prettifyError(body.error),
      });
    }
    try {
      const result = await dependencies.staffTeamRepository.invite({
        staff,
        ...body.data,
      });
      await notify({
        kind: "STAFF_INVITATION",
        recipient: body.data.email,
        locale: body.data.preferredLocale,
        venueName: staff.venueName,
        role: body.data.role,
        invitationToken: result.invitationToken,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return sendTeamError(error, reply);
    }
  });

  app.patch<{ Params: { membershipId: string } }>(
    "/v1/staff/team/members/:membershipId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = updateTeamMemberSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_TEAM_MEMBER_UPDATE",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffTeamRepository.updateMember({
          staff,
          membershipId: request.params.membershipId,
          ...(body.data.role ? { role: body.data.role } : {}),
          ...(body.data.active !== undefined
            ? { active: body.data.active }
            : {}),
          ...(body.data.preferredLocale
            ? { preferredLocale: body.data.preferredLocale }
            : {}),
        });
      } catch (error) {
        return sendTeamError(error, reply);
      }
    },
  );

  app.post("/v1/staff/team/assignments", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = tableAssignmentSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_TABLE_ASSIGNMENT",
        message: z.prettifyError(body.error),
      });
    }
    try {
      const result = await dependencies.staffTeamRepository.assignTable({
        staff,
        ...body.data,
      });
      return reply.code(201).send(result);
    } catch (error) {
      return sendTeamError(error, reply);
    }
  });

  app.delete<{ Params: { assignmentId: string } }>(
    "/v1/staff/team/assignments/:assignmentId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        await dependencies.staffTeamRepository.endAssignment({
          staff,
          assignmentId: request.params.assignmentId,
        });
        return reply.code(204).send();
      } catch (error) {
        return sendTeamError(error, reply);
      }
    },
  );

  app.post("/v1/staff/shift/start", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = shiftNoteSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send({ code: "INVALID_SHIFT", message: z.prettifyError(body.error) });
    }
    try {
      return await dependencies.staffWorkRepository.startShift({
        staff,
        ...(body.data.note ? { openingNote: body.data.note } : {}),
      });
    } catch (error) {
      return sendWorkError(error, reply);
    }
  });

  app.post("/v1/staff/shift/end", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = shiftNoteSchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply
        .code(400)
        .send({ code: "INVALID_SHIFT", message: z.prettifyError(body.error) });
    }
    try {
      return await dependencies.staffWorkRepository.endShift({
        staff,
        ...(body.data.note ? { closingNote: body.data.note } : {}),
      });
    } catch (error) {
      return sendWorkError(error, reply);
    }
  });

  app.post<{ Params: { sessionId: string } }>(
    "/v1/staff/table-sessions/:sessionId/payments",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = paymentSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_PAYMENT_RECORD",
          message: z.prettifyError(body.error),
        });
      }
      try {
        const payment = await dependencies.staffWorkRepository.recordPayment({
          staff,
          tableSessionId: request.params.sessionId,
          ...body.data,
        });
        return reply.code(201).send(payment);
      } catch (error) {
        return sendWorkError(error, reply);
      }
    },
  );

  app.get("/v1/staff/payments", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const query = dailyReportQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        code: "INVALID_PAYMENT_DATE",
        message: "The payment date must use YYYY-MM-DD",
      });
    }
    try {
      return await dependencies.staffWorkRepository.listPayments({
        staff,
        ...(query.data.date ? { date: query.data.date } : {}),
      });
    } catch (error) {
      return sendWorkError(error, reply);
    }
  });

  app.post<{ Params: { paymentId: string } }>(
    "/v1/staff/payments/:paymentId/void",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = voidPaymentSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_PAYMENT_VOID",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffWorkRepository.voidPayment({
          staff,
          paymentId: request.params.paymentId,
          reason: body.data.reason,
        });
      } catch (error) {
        return sendWorkError(error, reply);
      }
    },
  );

  app.get("/v1/staff/menu", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.staffMenuRepository.list(staff);
    } catch (error) {
      return sendStaffMenuError(error, reply);
    }
  });

  app.post("/v1/staff/menu/categories", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffCategorySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_MENU_CATEGORY",
        message: z.prettifyError(body.error),
      });
    }
    try {
      const category = await dependencies.staffMenuRepository.createCategory({
        staff,
        ...body.data,
      });
      return reply.code(201).send(category);
    } catch (error) {
      return sendStaffMenuError(error, reply);
    }
  });

  app.put<{ Params: { categoryId: string } }>(
    "/v1/staff/menu/categories/:categoryId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = staffCategorySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_MENU_CATEGORY",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffMenuRepository.updateCategory({
          staff,
          categoryId: request.params.categoryId,
          ...body.data,
        });
      } catch (error) {
        return sendStaffMenuError(error, reply);
      }
    },
  );

  app.post("/v1/staff/menu/products", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffProductSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_MENU_PRODUCT",
        message: z.prettifyError(body.error),
      });
    }
    try {
      const product = await dependencies.staffMenuRepository.createProduct({
        staff,
        ...body.data,
      });
      return reply.code(201).send(product);
    } catch (error) {
      return sendStaffMenuError(error, reply);
    }
  });

  app.put<{ Params: { productId: string } }>(
    "/v1/staff/menu/products/:productId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = staffProductSchema
        .extend({
          expectedRevision: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_MENU_PRODUCT",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffMenuRepository.updateProduct({
          staff,
          productId: request.params.productId,
          ...body.data,
        });
      } catch (error) {
        return sendStaffMenuError(error, reply);
      }
    },
  );

  app.get<{ Params: { productId: string } }>(
    "/v1/staff/menu/products/:productId/configuration",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.staffMenuRepository.getConfiguration({
          staff,
          productId: request.params.productId,
        });
      } catch (error) {
        return sendStaffMenuError(error, reply);
      }
    },
  );

  app.put<{ Params: { productId: string } }>(
    "/v1/staff/menu/products/:productId/configuration",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = productConfigurationSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_PRODUCT_CONFIGURATION",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffMenuRepository.replaceConfiguration({
          staff,
          productId: request.params.productId,
          ...body.data,
        });
      } catch (error) {
        return sendStaffMenuError(error, reply);
      }
    },
  );

  app.get("/v1/staff/costs", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.staffCostRepository.list(staff);
    } catch (error) {
      return sendStaffCostError(error, reply);
    }
  });

  app.post("/v1/staff/costs/ingredients", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffIngredientSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_INGREDIENT",
        message: z.prettifyError(body.error),
      });
    }
    try {
      return reply.code(201).send(
        await dependencies.staffCostRepository.createIngredient({
          staff,
          ...body.data,
        }),
      );
    } catch (error) {
      return sendStaffCostError(error, reply);
    }
  });

  app.put<{ Params: { ingredientId: string } }>(
    "/v1/staff/costs/ingredients/:ingredientId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = staffIngredientUpdateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_INGREDIENT",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffCostRepository.updateIngredient({
          staff,
          ingredientId: request.params.ingredientId,
          ...body.data,
        });
      } catch (error) {
        return sendStaffCostError(error, reply);
      }
    },
  );

  app.post("/v1/staff/costs/suppliers", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffSupplierSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_SUPPLIER",
        message: z.prettifyError(body.error),
      });
    }
    try {
      return reply.code(201).send(
        await dependencies.staffCostRepository.createSupplier({
          staff,
          ...body.data,
        }),
      );
    } catch (error) {
      return sendStaffCostError(error, reply);
    }
  });

  app.put<{ Params: { supplierId: string } }>(
    "/v1/staff/costs/suppliers/:supplierId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = staffSupplierSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_SUPPLIER",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffCostRepository.updateSupplier({
          staff,
          supplierId: request.params.supplierId,
          ...body.data,
        });
      } catch (error) {
        return sendStaffCostError(error, reply);
      }
    },
  );

  app.post("/v1/staff/costs/prices", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = supplierItemPriceSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_SUPPLIER_PRICE",
        message: z.prettifyError(body.error),
      });
    }
    try {
      return reply.code(201).send(
        await dependencies.staffCostRepository.addPrice({
          staff,
          ...body.data,
        }),
      );
    } catch (error) {
      return sendStaffCostError(error, reply);
    }
  });

  app.get<{ Params: { productId: string } }>(
    "/v1/staff/costs/products/:productId/recipe",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.staffCostRepository.getRecipe({
          staff,
          productId: request.params.productId,
        });
      } catch (error) {
        return sendStaffCostError(error, reply);
      }
    },
  );

  app.put<{ Params: { productId: string } }>(
    "/v1/staff/costs/products/:productId/recipe",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = recipeSchema.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({
          code: "INVALID_RECIPE",
          message: z.prettifyError(body.error),
        });
      try {
        return await dependencies.staffCostRepository.replaceRecipe({
          staff,
          productId: request.params.productId,
          ...body.data,
        });
      } catch (error) {
        return sendStaffCostError(error, reply);
      }
    },
  );

  app.get("/v1/staff/setup", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    try {
      return await dependencies.staffVenueSetupRepository.list(staff);
    } catch (error) {
      return sendVenueSetupError(error, reply);
    }
  });

  app.put("/v1/staff/setup/venue", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffVenueSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_VENUE_SETUP",
        message: z.prettifyError(body.error),
      });
    }
    try {
      return await dependencies.staffVenueSetupRepository.updateVenue({
        staff,
        ...body.data,
      });
    } catch (error) {
      return sendVenueSetupError(error, reply);
    }
  });

  app.post("/v1/staff/setup/areas", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffAreaSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_AREA",
        message: z.prettifyError(body.error),
      });
    }
    try {
      const area = await dependencies.staffVenueSetupRepository.createArea({
        staff,
        area: body.data,
      });
      return reply.code(201).send(area);
    } catch (error) {
      return sendVenueSetupError(error, reply);
    }
  });

  app.put<{ Params: { areaId: string } }>(
    "/v1/staff/setup/areas/:areaId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = staffAreaSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_AREA",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffVenueSetupRepository.updateArea({
          staff,
          areaId: request.params.areaId,
          area: body.data,
        });
      } catch (error) {
        return sendVenueSetupError(error, reply);
      }
    },
  );

  app.post("/v1/staff/setup/tables", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffTableSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        code: "INVALID_TABLE",
        message: z.prettifyError(body.error),
      });
    }
    try {
      const table = await dependencies.staffVenueSetupRepository.createTable({
        staff,
        table: body.data,
      });
      return reply.code(201).send(table);
    } catch (error) {
      return sendVenueSetupError(error, reply);
    }
  });

  app.put<{ Params: { tableId: string } }>(
    "/v1/staff/setup/tables/:tableId",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = staffTableSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_TABLE",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffVenueSetupRepository.updateTable({
          staff,
          tableId: request.params.tableId,
          table: body.data,
        });
      } catch (error) {
        return sendVenueSetupError(error, reply);
      }
    },
  );

  app.post<{ Params: { tableId: string } }>(
    "/v1/staff/setup/tables/:tableId/rotate-qr",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.staffVenueSetupRepository.rotateTableQr({
          staff,
          tableId: request.params.tableId,
        });
      } catch (error) {
        return sendVenueSetupError(error, reply);
      }
    },
  );

  app.post("/v1/auth/password", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffPasswordChangeSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ code: "INVALID_PASSWORD_CHANGE" });
    if (!dependencies.staffAuthRepository.changePassword)
      return reply.code(501).send({ code: "PASSWORD_CHANGE_UNAVAILABLE" });
    try {
      await dependencies.staffAuthRepository.changePassword(
        staff,
        body.data.currentPassword,
        body.data.newPassword,
      );
      reply.clearCookie("flowgastronomie_staff_session", { path: "/" });
      return { changed: true, sessionsRevoked: true };
    } catch {
      return reply.code(401).send({ code: "INVALID_STAFF_CREDENTIALS" });
    }
  });
  app.post("/v1/auth/logout", async (request, reply) => {
    const authorization = request.headers.authorization;
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : undefined;
    const sessionToken =
      request.cookies.flowgastronomie_staff_session ??
      request.cookies.restaurantflow_staff_session ??
      bearerToken;

    if (sessionToken) {
      await dependencies.staffAuthRepository.logout(sessionToken);
    }
    reply.clearCookie("flowgastronomie_staff_session", { path: "/" });
    reply.clearCookie("restaurantflow_staff_session", { path: "/" });
    return reply.code(204).send();
  });

  app.get("/v1/staff/radar", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;

    try {
      assertStaffPermission(staff.role, "RADAR_VIEW");
      return {
        signals: await dependencies.staffRadarRepository.listOpen(staff),
        assignees:
          await dependencies.staffRadarRepository.listAvailableStaff(staff),
      };
    } catch (error) {
      if (error instanceof StaffPermissionDeniedError) {
        return reply
          .code(403)
          .send({ code: "FORBIDDEN", message: error.message });
      }
      throw error;
    }
  });

  app.patch<{ Params: { signalId: string } }>(
    "/v1/staff/radar/:signalId/claim",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        const claimed = await dependencies.staffRadarRepository.claim({
          staff,
          signalId: request.params.signalId,
        });
        if (!claimed) {
          return reply.code(404).send({
            code: "SIGNAL_NOT_FOUND",
            message: "The service task was not found",
          });
        }
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof ActiveShiftRequiredError)
          return sendWorkError(error, reply);
        if (error instanceof StaffPermissionDeniedError) {
          return reply
            .code(403)
            .send({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof RadarAssignmentConflictError) {
          return reply
            .code(409)
            .send({ code: "TASK_ALREADY_ASSIGNED", message: error.message });
        }
        throw error;
      }
    },
  );

  app.put<{ Params: { signalId: string } }>(
    "/v1/staff/radar/:signalId/assignment",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = signalAssignmentSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_SIGNAL_ASSIGNMENT",
          message: z.prettifyError(body.error),
        });
      }
      try {
        const assigned = await dependencies.staffRadarRepository.assign({
          staff,
          signalId: request.params.signalId,
          membershipId: body.data.membershipId,
        });
        if (!assigned) {
          return reply.code(404).send({
            code: "ASSIGNEE_NOT_FOUND",
            message: "The task or active worker was not found",
          });
        }
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError) {
          return reply
            .code(403)
            .send({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof RadarAssignmentConflictError) {
          return reply
            .code(409)
            .send({ code: "INVALID_TASK_ASSIGNEE", message: error.message });
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { signalId: string } }>(
    "/v1/staff/radar/:signalId/assignment",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        const released = await dependencies.staffRadarRepository.release({
          staff,
          signalId: request.params.signalId,
        });
        return released
          ? reply.code(204).send()
          : reply.code(404).send({
              code: "SIGNAL_NOT_FOUND",
              message: "The assigned task was not found",
            });
      } catch (error) {
        if (error instanceof RadarAssignmentConflictError) {
          return reply
            .code(409)
            .send({ code: "TASK_ASSIGNMENT_CONFLICT", message: error.message });
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { signalId: string } }>(
    "/v1/staff/radar/:signalId/acknowledge",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;

      try {
        assertStaffPermission(staff.role, "SIGNAL_ACKNOWLEDGE");
        const acknowledged =
          await dependencies.staffRadarRepository.acknowledge({
            staff,
            signalId: request.params.signalId,
          });

        if (!acknowledged) {
          return reply.code(404).send({
            code: "SIGNAL_NOT_FOUND",
            message: "The signal was not found or was already acknowledged",
          });
        }
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof ActiveShiftRequiredError) {
          return sendWorkError(error, reply);
        }
        if (error instanceof StaffPermissionDeniedError) {
          return reply.code(403).send({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  if (configuration.workforceClock && process.env.NODE_ENV === "production")
    throw new Error("Fixture clock cannot run in production");
  registerWorkforceRoutes(app, requireStaff, configuration.workforceClock);
  registerWorkforceAccountRoutes(
    app,
    requireStaff,
    configuration.workforceClock,
  );
  registerWorkforceOperationsRoutes(
    app,
    requireStaff,
    configuration.workforceClock,
  );
  registerHardwareRoutes(app, requireStaff, configuration.hardwareService);
  registerCounterSaleRoutes(
    app,
    requireStaff,
    dependencies.counterSaleRepository,
  );
  registerPilotOperationsRoutes(app, requireStaff);
  registerCreativeRoutes(app, requireStaff);
  registerPlatformAiUsageRoutes(app, requireStaff);
  registerSmartSetupRoutes(app, requireStaff);
  registerWebsiteImportRoutes(
    app,
    requireStaff,
    undefined,
    configuration.websiteAiProvider,
  );
  registerBusinessImportRoutes(app, requireStaff, configuration.businessImport);
  registerPosMenuChannelRoutes(app, requireStaff);
  registerSetupMediaRoutes(app, requireStaff);
  registerMenuImportRoutes(
    app,
    requireStaff,
    configuration.menuExtractionProvider,
  );

  app.get("/v1/staff/pos/menu", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const query = publicMenuQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        code: "INVALID_LOCALE",
        message: "Supported locales are en, de, it, and sq",
      });
    }
    try {
      return await dependencies.staffOrderRepository.posMenu(
        staff,
        query.data.locale,
      );
    } catch (error) {
      return sendStaffOrderError(error, reply);
    }
  });

  app.post("/v1/staff/orders", async (request, reply) => {
    const staff = await requireStaff(request, reply);
    if (!staff) return;
    const body = staffOrderSchema.safeParse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key =
      typeof rawKey === "string"
        ? staffOrderKeySchema.safeParse(rawKey)
        : { success: false as const };
    const takeawayWithTable =
      body.success && body.data.orderType === "TAKEAWAY" && body.data.tableId;
    const dineInWithoutTable =
      body.success && body.data.orderType === "DINE_IN" && !body.data.tableId;
    if (
      !body.success ||
      !key.success ||
      takeawayWithTable ||
      dineInWithoutTable
    ) {
      return reply.code(400).send({
        code: "INVALID_ORDER",
        message: body.success
          ? "Dine-in orders need a table and takeaway orders must not have one, plus a valid idempotency key"
          : z.prettifyError(body.error),
      });
    }
    try {
      const order = await dependencies.staffOrderRepository.createOrder({
        staff,
        orderType: body.data.orderType,
        ...(body.data.tableId ? { tableId: body.data.tableId } : {}),
        locale: body.data.locale,
        idempotencyKey: key.data,
        items: body.data.items,
      });
      return reply.code(201).send(order);
    } catch (error) {
      return sendStaffOrderError(error, reply);
    }
  });

  app.patch<{ Params: { orderId: string } }>(
    "/v1/staff/orders/:orderId/status",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = staffOrderStatusSchema.safeParse(request.body);

      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_ORDER_STATUS",
          message: z.prettifyError(body.error),
        });
      }

      try {
        return await dependencies.staffOperationsRepository.transitionOrder({
          staff,
          orderId: request.params.orderId,
          nextStatus: body.data.status,
          expectedVersion: body.data.expectedVersion,
        });
      } catch (error) {
        if (error instanceof CounterSaleError)
          return sendWorkError(error, reply);
        if (error instanceof ActiveShiftRequiredError) {
          return sendWorkError(error, reply);
        }
        if (error instanceof StaffPermissionDeniedError) {
          return reply
            .code(403)
            .send({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof StaffResourceNotFoundError) {
          return reply.code(404).send({
            code: "ORDER_NOT_FOUND",
            message: error.message,
          });
        }
        if (
          error instanceof InvalidOrderTransitionError ||
          error instanceof ConcurrentOrderUpdateError
        ) {
          return reply.code(409).send({
            code: "ORDER_CONFLICT",
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { orderId: string } }>(
    "/v1/staff/orders/:orderId/tablet-attribution",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        return await dependencies.staffOperationsRepository.attributeTabletOrder(
          { staff, orderId: request.params.orderId },
        );
      } catch (error) {
        if (error instanceof ActiveShiftRequiredError)
          return sendWorkError(error, reply);
        if (error instanceof StaffPermissionDeniedError) {
          return reply
            .code(403)
            .send({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof StaffResourceNotFoundError) {
          return reply
            .code(404)
            .send({ code: "ORDER_NOT_FOUND", message: error.message });
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { ticketId: string } }>(
    "/v1/staff/production-tickets/:ticketId/status",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = productionTicketStatusSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_PRODUCTION_TICKET_STATUS",
          message: z.prettifyError(body.error),
        });
      }
      try {
        return await dependencies.staffProductionRepository.transition({
          staff,
          ticketId: request.params.ticketId,
          ...body.data,
        });
      } catch (error) {
        return sendProductionError(error, reply);
      }
    },
  );

  app.get<{ Params: { station: "BAR" | "KITCHEN" | "DESSERT" } }>(
    "/v1/staff/online-production/:station",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      if (!["BAR", "KITCHEN", "DESSERT"].includes(request.params.station)) {
        return reply.code(400).send({ code: "INVALID_STATION" });
      }
      try {
        return await dependencies.onlineOrderRepository.listProductionForStaff({
          staff,
          station: request.params.station,
        });
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        return reply.code(404).send({ code: "ONLINE_PRODUCTION_NOT_FOUND" });
      }
    },
  );

  app.get<{ Params: { station: "BAR" | "KITCHEN" | "DESSERT" } }>(
    "/v1/staff/online-production/:station/events",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      try {
        const initial =
          await dependencies.onlineOrderRepository.listProductionForStaff({
            staff,
            station: request.params.station,
          });
        startSsePolling({
          request,
          reply,
          event: "tickets",
          initial,
          async poll() {
            const current = await refreshLiveStaff(request, staff);
            return current
              ? dependencies.onlineOrderRepository.listProductionForStaff({
                  staff: current,
                  station: request.params.station,
                })
              : undefined;
          },
        });
      } catch (error) {
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        return reply.code(404).send({ code: "ONLINE_PRODUCTION_NOT_FOUND" });
      }
    },
  );

  app.patch<{ Params: { ticketId: string } }>(
    "/v1/staff/online-production-tickets/:ticketId/status",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = z
        .object({
          status: z.enum(["PREPARING", "READY"]),
          expectedVersion: z.number().int().positive(),
        })
        .safeParse(request.body);
      if (!body.success)
        return reply
          .code(400)
          .send({ code: "INVALID_ONLINE_PRODUCTION_STATUS" });
      try {
        const result =
          await dependencies.onlineOrderRepository.transitionProductionForStaff(
            {
              staff,
              ticketId: request.params.ticketId,
              ...body.data,
            },
          );
        if (result.customerStatusChanged && result.order.contact.email) {
          await notify({
            kind: "ONLINE_ORDER_STATUS_CHANGED",
            recipient: result.order.contact.email,
            locale: result.order.locale,
            referenceCode: result.order.referenceCode,
            status: result.order.status,
            note: null,
          });
        }
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof ActiveShiftRequiredError)
          return sendWorkError(error, reply);
        if (error instanceof StaffPermissionDeniedError)
          return reply.code(403).send({ code: "FORBIDDEN" });
        return reply
          .code(409)
          .send({ code: "ONLINE_PRODUCTION_TRANSITION_INVALID" });
      }
    },
  );

  app.put<{ Params: { ticketId: string } }>(
    "/v1/staff/production-tickets/:ticketId/assignment",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;
      const body = signalAssignmentSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          code: "INVALID_PRODUCTION_ASSIGNMENT",
          message: z.prettifyError(body.error),
        });
      }
      try {
        await dependencies.staffProductionRepository.assign({
          staff,
          ticketId: request.params.ticketId,
          membershipId: body.data.membershipId,
        });
        return reply.code(204).send();
      } catch (error) {
        return sendProductionError(error, reply);
      }
    },
  );

  app.patch<{ Params: { sessionId: string } }>(
    "/v1/staff/table-sessions/:sessionId/close",
    async (request, reply) => {
      const staff = await requireStaff(request, reply);
      if (!staff) return;

      try {
        return await dependencies.staffOperationsRepository.closeTableSession({
          staff,
          sessionId: request.params.sessionId,
        });
      } catch (error) {
        if (error instanceof ActiveShiftRequiredError) {
          return sendWorkError(error, reply);
        }
        if (error instanceof StaffPermissionDeniedError) {
          return reply
            .code(403)
            .send({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof StaffResourceNotFoundError) {
          return reply.code(404).send({
            code: "SESSION_NOT_FOUND",
            message: error.message,
          });
        }
        if (error instanceof SessionHasOpenOrdersError) {
          return reply.code(409).send({
            code: "SESSION_HAS_OPEN_ORDERS",
            message: error.message,
          });
        }
        if (error instanceof SessionPaymentOutstandingError) {
          return reply.code(409).send({
            code: "SESSION_PAYMENT_OUTSTANDING",
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { qrToken: string } }>(
    "/v1/public/tables/:qrToken/menu",
    { config: { rateLimit: unauthenticatedRateLimits.publicRead } },
    async (request, reply) => {
      const query = publicMenuQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.code(400).send({
          code: "INVALID_LOCALE",
          message: "Supported locales are en, de, it, and sq",
        });
      }

      const menu = await dependencies.publicMenuRepository.findByQrToken(
        request.params.qrToken,
        query.data.locale,
      );

      if (!menu) {
        return reply.code(404).send({
          code: "TABLE_NOT_FOUND",
          message: "The QR code is invalid or has been revoked",
        });
      }

      return menu;
    },
  );

  app.post<{ Params: { qrToken: string } }>(
    "/v1/public/tables/:qrToken/sessions",
    { config: { rateLimit: unauthenticatedRateLimits.qrSessionWrite } },
    async (request, reply) => {
      try {
        return await dependencies.guestServiceRepository.openSession(
          request.params.qrToken,
        );
      } catch (error) {
        if (error instanceof PublicTableNotFoundError) {
          return reply.code(404).send({
            code: "TABLE_NOT_FOUND",
            message: error.message,
          });
        }

        throw error;
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/v1/public/sessions/:sessionId/orders",
    { config: { rateLimit: unauthenticatedRateLimits.guestOrderWrite } },
    async (request, reply) => {
      const credentials = guestCredentialsSchema.safeParse({
        guestToken: request.headers["x-guest-token"],
        idempotencyKey: request.headers["idempotency-key"],
      });
      const body = submitOrderSchema.safeParse(request.body);

      if (!credentials.success || !body.success) {
        return reply.code(400).send({
          code: "INVALID_ORDER",
          message:
            "A valid guest token, idempotency key, and order are required",
        });
      }

      try {
        const order = await dependencies.guestServiceRepository.submitOrder({
          sessionId: request.params.sessionId,
          guestToken: credentials.data.guestToken,
          idempotencyKey: credentials.data.idempotencyKey,
          locale: body.data.locale,
          items: body.data.items,
        });
        return reply.code(201).send(order);
      } catch (error) {
        if (error instanceof GuestSessionNotFoundError) {
          return reply.code(401).send({
            code: "INVALID_GUEST_SESSION",
            message: error.message,
          });
        }

        if (error instanceof ProductUnavailableError) {
          return reply.code(409).send({
            code: "PRODUCT_UNAVAILABLE",
            message: error.message,
          });
        }

        if (error instanceof GuestActionNotAllowedError) {
          return reply.code(409).send({
            code: "ACTION_NOT_ALLOWED",
            message: error.message,
          });
        }

        throw error;
      }
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/v1/public/sessions/:sessionId/requests",
    { config: { rateLimit: unauthenticatedRateLimits.guestServiceWrite } },
    async (request, reply) => {
      const credentials = guestCredentialsSchema.safeParse({
        guestToken: request.headers["x-guest-token"],
        idempotencyKey: request.headers["idempotency-key"],
      });
      const body = serviceRequestSchema.safeParse(request.body);

      if (!credentials.success || !body.success) {
        return reply.code(400).send({
          code: "INVALID_SERVICE_REQUEST",
          message:
            "A valid guest token, idempotency key, and request are required",
        });
      }

      try {
        const signal = await dependencies.guestServiceRepository.createRequest({
          sessionId: request.params.sessionId,
          guestToken: credentials.data.guestToken,
          idempotencyKey: credentials.data.idempotencyKey,
          type: body.data.type,
        });
        return reply.code(201).send(signal);
      } catch (error) {
        if (error instanceof GuestSessionNotFoundError) {
          return reply.code(401).send({
            code: "INVALID_GUEST_SESSION",
            message: error.message,
          });
        }

        if (error instanceof GuestActionNotAllowedError) {
          return reply.code(409).send({
            code: "ACTION_NOT_ALLOWED",
            message: error.message,
          });
        }

        throw error;
      }
    },
  );

  app.get(
    "/v1/demo/radar",
    { config: { rateLimit: unauthenticatedRateLimits.publicRead } },
    async () => ({
      signals: await dependencies.staffRadarRepository.listOpen(demoVenue),
    }),
  );

  app.patch<{ Params: { signalId: string } }>(
    "/v1/demo/radar/:signalId/acknowledge",
    { config: { rateLimit: unauthenticatedRateLimits.demoWrite } },
    async (request, reply) => {
      const acknowledged = (
        await dependencies.staffRadarRepository.listOpen(demoVenue)
      ).some((signal) => signal.id === request.params.signalId);

      if (!acknowledged) {
        return reply.code(404).send({
          code: "SIGNAL_NOT_FOUND",
          message: "The signal was not found or was already acknowledged",
        });
      }

      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { orderId: string } }>(
    "/v1/demo/orders/:orderId/status",
    { config: { rateLimit: unauthenticatedRateLimits.demoWrite } },
    async (request, reply) => {
      const parsed = transitionSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          code: "INVALID_REQUEST",
          message: z.prettifyError(parsed.error),
        });
      }

      const current = demoOrders.get(request.params.orderId);

      if (!current) {
        return reply.code(404).send({
          code: "ORDER_NOT_FOUND",
          message: "Order was not found",
        });
      }

      try {
        const status = transitionOrder(current, parsed.data.status);
        demoOrders.set(request.params.orderId, status);
        return { id: request.params.orderId, status };
      } catch (error) {
        if (error instanceof InvalidOrderTransitionError) {
          return reply.code(409).send({
            code: "INVALID_ORDER_TRANSITION",
            message: error.message,
          });
        }

        throw error;
      }
    },
  );

  return app;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GuestServiceRepository,
  BillingWorkspaceRepository,
  CustomerProfileRepository,
  OnlineOrderRepository,
  OperationalOrderRepository,
  ReservationRepository,
  StaffAuthRepository,
  StaffMenuRepository,
  StaffCostRepository,
  StaffOperationsRepository,
  StaffOrderRepository,
  StaffRadarRepository,
  StaffReportRepository,
  StaffTeamRepository,
  StaffVenueSetupRepository,
  StaffWorkRepository,
  TrialRegistrationRepository,
  VenueWebsiteRepository,
  VenueLaunchRepository,
  WebsiteAssetRepository,
  WebsiteDomainRepository,
  WorkspaceOverviewRepository,
} from "@flowgastronomie/database";
import {
  ActiveShiftRequiredError,
  TrialEmailAlreadyRegisteredError,
  OnlineOrderTrackingNotFoundError,
  VenueWebsitePublicationError,
  PlanChangeConflictError,
  ProductUnavailableError,
  StaffTableNotFoundError,
  SubscriptionAccessDeniedError,
  VenueLaunchBlockedError,
} from "@flowgastronomie/database";
import {
  InvalidIngredientQuantityError,
  CounterSaleError,
  StaffPermissionDeniedError,
  type OperationalOrder,
} from "@flowgastronomie/domain";

import { buildApp } from "./app.js";
import type { TransactionalNotification } from "./transactional-notifications.js";

const apps: ReturnType<typeof buildApp>[] = [];
const validGuestToken = "g".repeat(32);

const fakeGuestServiceRepository: GuestServiceRepository = {
  async openSession() {
    return {
      sessionId: "session-1",
      guestToken: validGuestToken,
      tableLabel: "07",
      serviceMode: "ORDER_AND_CONFIRM",
      capabilities: {
        canOrder: true,
        canRequestService: true,
        requiresConfirmation: true,
      },
    };
  },
  async submitOrder() {
    return {
      id: "order-2",
      status: "NEW",
      totalMinor: 2500,
      currency: "EUR",
      createdAt: new Date("2026-08-06T20:00:00Z"),
      items: [
        {
          productId: "product-1",
          productName: "Burrata",
          quantity: 2,
          unitPriceMinor: 1250,
          variantName: null,
          modifiers: [],
        },
      ],
    };
  },
  async createRequest(input) {
    return {
      id: "signal-4",
      type: input.type,
      createdAt: new Date("2026-08-06T20:00:00Z"),
    };
  },
};

const fakeStaffRadarRepository: StaffRadarRepository = {
  async listOpen() {
    return [
      {
        id: "signal-1",
        tableSessionId: "session-1",
        tableLabel: "Tavolina 07",
        area: "Terrace",
        type: "WAITER_CALL",
        createdAt: new Date("2026-08-06T19:00:00Z"),
        waitingSeconds: 420,
        assignment: null,
        balance: {
          dueMinor: 0,
          paidMinor: 0,
          outstandingMinor: 0,
          currency: "EUR",
        },
        order: null,
      },
      {
        id: "signal-2",
        tableSessionId: "session-2",
        tableLabel: "Tavolina 12",
        area: "Main",
        type: "BILL_REQUEST",
        createdAt: new Date("2026-08-06T19:03:00Z"),
        waitingSeconds: 240,
        assignment: null,
        balance: {
          dueMinor: 5000,
          paidMinor: 0,
          outstandingMinor: 5000,
          currency: "EUR",
        },
        order: null,
      },
      {
        id: "signal-3",
        tableSessionId: "session-3",
        tableLabel: "Tavolina 03",
        area: "Window",
        type: "NEW_ORDER",
        createdAt: new Date("2026-08-06T19:05:00Z"),
        waitingSeconds: 120,
        assignment: null,
        balance: {
          dueMinor: 5000,
          paidMinor: 0,
          outstandingMinor: 5000,
          currency: "EUR",
        },
        order: {
          id: "order-3",
          tableSessionId: "session-3",
          status: "NEW",
          version: 1,
          itemCount: 4,
          totalMinor: 5000,
          currency: "EUR",
          source: "GUEST_QR",
          serviceOwner: null,
          productionTickets: [
            {
              id: "ticket-1",
              station: "KITCHEN",
              status: "NEW",
              version: 1,
              itemCount: 4,
              itemNames: ["Burrata"],
              subtotalMinor: 5000,
              assignment: null,
            },
          ],
        },
      },
    ];
  },
  async acknowledge({ signalId }) {
    return signalId === "signal-1";
  },
  async listAvailableStaff() {
    return [
      {
        membershipId: "membership-1",
        displayName: "Demo Manager",
        role: "MANAGER",
      },
    ];
  },
  async claim({ signalId }) {
    return signalId === "signal-1";
  },
  async assign({ signalId }) {
    return signalId === "signal-1";
  },
  async release({ signalId }) {
    return signalId === "signal-1";
  },
};

const demoStaff = {
  sessionId: "staff-session-1",
  userId: "staff-1",
  membershipId: "membership-1",
  displayName: "Demo Manager",
  email: "manager@flowgastronomie.local",
  tenantId: "demo-tenant",
  tenantSlug: "flowgastronomie-demo",
  venueId: "demo-venue",
  venueName: "Restaurant Olive",
  venueSlug: "restaurant-olive",
  role: "MANAGER" as const,
};

const fakeStaffAuthRepository: StaffAuthRepository = {
  async login() {
    return {
      sessionToken: "valid-staff-session-token",
      expiresAt: new Date("2026-08-07T12:00:00Z"),
      staff: demoStaff,
    };
  },
  async authenticate(token) {
    return token === "valid-staff-session-token" ? demoStaff : null;
  },
  async logout() {},
};

const fakeReservationRepository: ReservationRepository = {
  async getAutoConfirm() {
    return { enabled: false };
  },
  async setAutoConfirm({ enabled }) {
    return { enabled };
  },
  async create() {
    return {
      reservation: { id: "reservation-1", status: "REQUESTED" },
      confirmation: null,
    };
  },
  async list() {
    return [];
  },
  async transition() {
    return {
      reservation: { id: "reservation-1", status: "CONFIRMED" },
      confirmation: null,
    };
  },
};

const fakeCustomerProfileRepository: CustomerProfileRepository = {
  async list() {
    return [
      {
        id: "customer-1",
        displayName: "Ada Lovelace",
        emailNormalized: "ada@example.com",
        phoneNormalized: "+4912345678",
        preferredLocale: "EN",
        internalNotes: null,
        _count: { reservations: 1, onlineOrders: 1 },
      },
    ];
  },
  async get({ customerProfileId }) {
    return {
      id: customerProfileId,
      displayName: "Ada Lovelace",
      reservations: [{ id: "reservation-1", status: "COMPLETED" }],
      onlineOrders: [{ referenceCode: "RF-123456", status: "ACCEPTED" }],
    };
  },
  async findDuplicateCandidates() {
    return [
      {
        id: "customer-2",
        displayName: "Ada Byron",
        matchingFields: ["email"],
      },
    ];
  },
  async update({ customerProfileId, displayName, preferredLocale }) {
    return { id: customerProfileId, displayName, preferredLocale };
  },
  async remove() {},
};

const fakeOnlineOrderTracking = {
  referenceCode: "RF-123456",
  fulfillmentType: "PICKUP" as const,
  status: "PENDING_CONFIRMATION" as const,
  locale: "sq" as const,
  totalMinor: 1_200,
  currency: "EUR",
  contact: { name: "Ada", phone: "+49123456", email: null },
  requestedFor: new Date("2026-08-09T18:00:00Z"),
  timingMode: "SCHEDULED" as const,
  deliveryAddress: null,
  cateringGuestCount: null,
  guestNotes: null,
  items: [],
  timeline: [],
  messages: [],
};

const fakeOnlineOrderRepository: OnlineOrderRepository = {
  async quote() {
    return {
      fingerprint: "a".repeat(64),
      totalMinor: 1250,
      deliveryFeeMinor: 0,
      currency: "EUR",
      items: [],
    };
  },
  async findPublicStatus() {
    throw new OnlineOrderTrackingNotFoundError();
  },
  async pickupAvailability() {
    return {
      generatedAt: new Date(),
      timezone: "Europe/Berlin",
      asapAvailable: false,
      earliest: null,
      slots: [],
      unavailableReason: "NO_OPENING",
    };
  },
  async recover() {
    throw new OnlineOrderTrackingNotFoundError();
  },
  async createDeliveryZone() {
    return { id: "zone-1" };
  },
  async updateDeliveryZone() {},
  async listDeliveryZones() {
    return [];
  },
  async getFulfillmentSettings() {
    return {
      pickupEnabled: true,
      deliveryEnabled: true,
      cateringEnabled: true,
    };
  },
  async updateFulfillmentSettings(input) {
    return {
      pickupEnabled: input.pickupEnabled,
      deliveryEnabled: input.deliveryEnabled,
      cateringEnabled: input.cateringEnabled,
    };
  },
  async listProductionForStaff() {
    return [];
  },
  async transitionProductionForStaff() {
    return {
      order: fakeOnlineOrderTracking,
      customerStatusChanged: false,
    };
  },
  async listForStaff() {
    return [fakeOnlineOrderTracking];
  },
  async transitionForStaff() {
    return fakeOnlineOrderTracking;
  },
  async addStaffMessage() {
    return fakeOnlineOrderTracking;
  },
  async submit() {
    return {
      referenceCode: fakeOnlineOrderTracking.referenceCode,
      trackingToken: "tracking-token",
      status: "PENDING_CONFIRMATION",
    };
  },
  async findTracking() {
    return fakeOnlineOrderTracking;
  },
  async addGuestMessage() {
    return fakeOnlineOrderTracking;
  },
};

const fakeOperationalOrder: OperationalOrder = {
  id: "order-3",
  reference: "order-3",
  source: "TABLE_GUEST_QR",
  fulfillment: "DINE_IN",
  status: "PENDING_CONFIRMATION",
  createdAt: new Date("2026-08-09T18:00:00Z"),
  updatedAt: new Date("2026-08-09T18:00:00Z"),
  requestedFor: null,
  totals: { totalMinor: 1_200, currency: "EUR" },
  customerLink: { kind: "TABLE_GUEST", id: "guest-1" },
  table: { sessionId: "session-1", label: "07" },
  payment: { status: "NOT_RECORDED" },
  items: [],
  production: [],
  statusHistory: [],
  statusHistoryCoverage: "CURRENT_STATE_ONLY",
  actors: { created: null, serviceOwner: null, decision: null },
};

const fakeOperationalOrderRepository: OperationalOrderRepository = {
  async listForStaff() {
    return [fakeOperationalOrder];
  },
};

const fakeTrialRegistrationRepository: TrialRegistrationRepository = {
  async register(input) {
    return {
      sessionToken: "new-owner-session-token",
      expiresAt: new Date("2026-08-08T12:00:00Z"),
      staff: {
        ...demoStaff,
        displayName: input.ownerDisplayName,
        email: input.email,
        role: "OWNER",
      },
      subscription: {
        plan: input.plan,
        status: "TRIALING",
        trialEndsAt: new Date("2026-08-21T12:00:00Z"),
      },
    };
  },
};

const fakeWorkspaceOverviewRepository: WorkspaceOverviewRepository = {
  async get() {
    return {
      organization: {
        id: "demo-tenant",
        name: "FlowGastronomie Demo",
        slug: "flowgastronomie-demo",
      },
      venue: {
        id: "demo-venue",
        name: "Restaurant Olive",
        slug: "restaurant-olive",
        timezone: "Europe/Berlin",
        currency: "EUR",
        defaultServiceMode: "ORDER_AND_CONFIRM",
      },
      subscription: {
        plan: "RESTAURANT_PRO",
        status: "TRIALING",
        trialEndsAt: new Date("2026-08-21T12:00:00Z"),
        enabledFeatures: 12,
        features: ["REPORTING", "RESERVATIONS"],
        staffSeatLimit: 30,
      },
      launch: {
        completed: 6,
        total: 6,
        steps: {
          account: true,
          venue: true,
          menu: true,
          area: true,
          tableQr: true,
          team: true,
        },
      },
      content: {
        categories: 3,
        products: 12,
        publishedProducts: 10,
        areas: 2,
        tables: 12,
        activeQrTables: 12,
        teamMembers: 4,
      },
      live: {
        openTableSessions: 4,
        actionableSignals: 2,
        activeOrders: 3,
        activeShifts: 4,
      },
    };
  },
};

const websiteTranslations = ["en", "de", "it", "sq"].map((locale) => ({
  locale: locale as "en" | "de" | "it" | "sq",
  heroTitle: `Olive ${locale}`,
  heroSubtitle: `Seasonal food ${locale}`,
  storyTitle: `Our story ${locale}`,
  storyBody: `Handmade in Berlin ${locale}`,
  seoTitle: `Restaurant Olive ${locale}`,
  seoDescription: `Italian restaurant in Berlin ${locale}`,
}));
const websiteHours = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
].map((day) => ({
  day: day as
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY"
    | "SUNDAY",
  closed: false,
  opensAt: "11:30",
  closesAt: "23:00",
}));
const websiteEditor = {
  id: "website-1",
  venueId: "demo-venue",
  venueName: "Restaurant Olive",
  publicSlug: "restaurant-olive-demo",
  status: "DRAFT" as const,
  primaryColor: "#17382f",
  accentColor: "#ed6b37",
  logoUrl: null,
  heroImageUrl: null,
  phone: "+49 30 123456",
  contactEmail: "hello@restaurantolive.example",
  address: "Berlin",
  instagramUrl: null,
  facebookUrl: null,
  openingHours: websiteHours,
  publishedAt: null,
  translations: websiteTranslations,
};
const fakeVenueWebsiteRepository: VenueWebsiteRepository = {
  async getEditor() {
    return websiteEditor;
  },
  async update(input) {
    return { ...websiteEditor, ...input.website };
  },
  async publish() {
    return { ...websiteEditor, status: "PUBLISHED", publishedAt: new Date() };
  },
  async unpublish() {
    return websiteEditor;
  },
  async findPublic(publicSlug, locale) {
    if (publicSlug !== "restaurant-olive-demo") return null;
    const content = websiteTranslations.find((item) => item.locale === locale)!;
    return {
      locale,
      publicSlug,
      venue: { name: "Restaurant Olive", currency: "EUR" },
      brand: {
        primaryColor: "#17382f",
        accentColor: "#ed6b37",
        logoUrl: null,
        heroImageUrl: null,
      },
      contact: {
        phone: "+49 30 123456",
        email: "hello@restaurantolive.example",
        address: "Berlin",
        instagramUrl: null,
        facebookUrl: null,
        openingHours: websiteHours,
      },
      content,
      legal: {
        legalName: "Restaurant Olive GmbH",
        addressLine1: "Kastanienallee 27",
        postalCode: "10435",
        city: "Berlin",
        countryCode: "DE",
        vatId: "DE123456789",
      },
      menu: [],
    };
  },
};

const domainEditor = {
  hostname: "www.restaurantolive.de",
  status: "PENDING" as const,
  verificationRecord: {
    type: "TXT" as const,
    name: "_flowgastronomie.www.restaurantolive.de",
    value: "flowgastronomie-verification=token-1",
  },
  routingRecord: {
    type: "CNAME" as const,
    name: "www.restaurantolive.de",
    value: "domains.flowgastronomie.site",
  },
  lastCheckedAt: null,
  verifiedAt: null,
  activatedAt: null,
  failureReason: null,
  fallbackUrl: "/restaurant-olive-demo",
};

const fakeWebsiteDomainRepository: WebsiteDomainRepository = {
  async get() {
    return domainEditor;
  },
  async configure(input) {
    return { ...domainEditor, hostname: input.hostname };
  },
  async verify() {
    return { ...domainEditor, status: "VERIFIED", verifiedAt: new Date() };
  },
  async activate() {
    return { ...domainEditor, status: "ACTIVE", activatedAt: new Date() };
  },
  async remove() {},
  async resolvePublic(hostname) {
    return hostname === "www.restaurantolive.de"
      ? { publicSlug: "restaurant-olive-demo", defaultLocale: "sq" }
      : null;
  },
};

const fakeWebsiteAssetRepository: WebsiteAssetRepository = {
  async upload(input) {
    return {
      id: "asset-1",
      kind: input.kind,
      url: "/v1/public/website-assets/asset-1",
    };
  },
  async findPublic(id) {
    return id === "asset-1"
      ? {
          mimeType: "image/png",
          bytes: Uint8Array.from([137, 80, 78, 71]),
          updatedAt: new Date("2026-08-07T20:00:00Z"),
        }
      : null;
  },
};

const billingWorkspace = {
  organization: { name: "FlowGastronomie Demo", slug: "flowgastronomie-demo" },
  profile: {
    legalName: "FlowGastronomie Demo GmbH",
    billingEmail: "billing@flowgastronomie.local",
    addressLine1: "Alexanderplatz 1",
    postalCode: "10178",
    city: "Berlin",
    countryCode: "DE",
    vatId: "DE123456789",
  },
  subscription: {
    plan: "RESTAURANT_PRO" as const,
    status: "ACTIVE" as const,
    trialEndsAt: null,
    currentPeriodStartedAt: new Date("2026-08-01T00:00:00Z"),
    currentPeriodEndsAt: new Date("2026-09-01T00:00:00Z"),
    features: [],
    usage: [{ usageKey: "STAFF_SEATS", quantity: 5, measuredAt: new Date() }],
  },
  plans: [
    {
      key: "RESTAURANT_PRO" as const,
      monthlyPriceMinor: 6900,
      currency: "EUR",
      features: [] as const,
      limits: { venues: 1, staffSeats: 30, publishedSites: 1 },
    },
  ],
  pendingChange: null,
  invoices: [
    {
      id: "invoice-1",
      number: "RF-2026-0001",
      status: "PAID" as const,
      amountMinor: 6900,
      currency: "EUR",
      periodStart: new Date("2026-07-01T00:00:00Z"),
      periodEnd: new Date("2026-08-01T00:00:00Z"),
      issuedAt: new Date("2026-07-01T00:00:00Z"),
      dueAt: new Date("2026-07-08T00:00:00Z"),
      paidAt: new Date("2026-07-01T00:00:00Z"),
      externalUrl: null,
    },
  ],
};

const fakeBillingWorkspaceRepository: BillingWorkspaceRepository = {
  async get() {
    return billingWorkspace;
  },
  async updateProfile() {
    return billingWorkspace;
  },
  async requestPlanChange(input) {
    return {
      ...billingWorkspace,
      pendingChange: {
        id: "change-1",
        currentPlan: "RESTAURANT_PRO",
        requestedPlan: input.requestedPlan,
        requestedAt: new Date(),
      },
    };
  },
  async cancelPlanChange() {
    return billingWorkspace;
  },
};

const launchWorkspace = {
  venue: { name: "Restaurant Olive", slug: "restaurant-olive" },
  actorRole: "OWNER" as const,
  checks: [
    { key: "SUBSCRIPTION_ACTIVE" as const, required: true, complete: true },
    { key: "ORGANIZATION_PROFILE" as const, required: true, complete: true },
    { key: "WEBSITE_PUBLISHED" as const, required: true, complete: true },
    { key: "MENU_PUBLISHED" as const, required: true, complete: true },
    { key: "TABLE_QR_READY" as const, required: true, complete: true },
    { key: "TEAM_READY" as const, required: true, complete: true },
    { key: "SERVICE_REHEARSAL" as const, required: true, complete: false },
  ],
  progress: { completed: 6, total: 7, percent: 86 },
  rehearsalConfirmedAt: null,
  launchedAt: null,
  canLaunch: false,
};

const fakeVenueLaunchRepository: VenueLaunchRepository = {
  async get() {
    return launchWorkspace;
  },
  async confirmRehearsal() {
    return {
      ...launchWorkspace,
      checks: launchWorkspace.checks.map((check) =>
        check.key === "SERVICE_REHEARSAL"
          ? { ...check, complete: true }
          : check,
      ),
      progress: { completed: 7, total: 7, percent: 100 },
      rehearsalConfirmedAt: new Date(),
      canLaunch: true,
    };
  },
  async launch() {
    return { ...launchWorkspace, launchedAt: new Date(), canLaunch: true };
  },
};

const fakeStaffTeamRepository: StaffTeamRepository = {
  async list() {
    return {
      members: [{ id: "membership-1", displayName: "Demo Manager" }],
      tables: [{ id: "table-1", label: "07", assignment: null }],
      pendingInvitations: [],
      recentShifts: [],
    };
  },
  async invite(input) {
    return {
      invitationToken: "secure-invitation-token",
      invitation: { id: "invitation-1", email: input.email, role: input.role },
    };
  },
  async acceptInvitation() {
    return {
      tenantSlug: "flowgastronomie-demo",
      venueSlug: "restaurant-olive",
      email: "waiter@flowgastronomie.local",
    };
  },
  async updateMember(input) {
    return { id: input.membershipId, active: input.active ?? true };
  },
  async assignTable(input) {
    return { id: "assignment-1", tableId: input.tableId };
  },
  async endAssignment() {},
};

const fakeStaffOperationsRepository: StaffOperationsRepository = {
  async transitionOrder(input) {
    return {
      id: input.orderId,
      status: input.nextStatus,
      version: input.expectedVersion + 1,
      updatedAt: new Date("2026-08-07T08:00:00Z"),
    };
  },
  async closeTableSession(input) {
    return {
      id: input.sessionId,
      status: "CLOSED",
      closedAt: new Date("2026-08-07T08:00:00Z"),
    };
  },
  async attributeTabletOrder(input) {
    return { id: input.orderId, source: "STAFF_TABLET" };
  },
};

const categoryTranslations = [
  { locale: "en" as const, name: "Mains" },
  { locale: "de" as const, name: "Hauptgerichte" },
  { locale: "it" as const, name: "Piatti principali" },
  { locale: "sq" as const, name: "Kryesore" },
];

const productTranslations = categoryTranslations.map((translation) => ({
  ...translation,
  name: `Rigatoni ${translation.locale}`,
  description: null,
}));

const configurationTranslations = categoryTranslations.map((translation) => ({
  ...translation,
  name: `Regular ${translation.locale}`,
}));

const productConfiguration = {
  productId: "product-1",
  basePriceMinor: 1290,
  variants: [
    {
      priceDeltaMinor: 0,
      sortOrder: 0,
      available: true,
      isDefault: true,
      translations: configurationTranslations,
    },
  ],
  modifierGroups: [
    {
      minSelect: 0,
      maxSelect: 1,
      sortOrder: 0,
      translations: categoryTranslations,
      options: [
        {
          priceDeltaMinor: 150,
          sortOrder: 0,
          available: true,
          translations: configurationTranslations,
        },
      ],
    },
  ],
};

const fakeStaffMenuRepository: StaffMenuRepository = {
  async list() {
    return {
      venue: { id: "demo-venue", name: "Restaurant Olive", currency: "EUR" },
      categories: [
        {
          id: "category-1",
          sortOrder: 0,
          published: true,
          translations: categoryTranslations,
          products: [],
        },
      ],
    };
  },
  async createCategory(input) {
    return { id: "category-2", products: [], ...input };
  },
  async updateCategory(input) {
    return { id: input.categoryId, products: [], ...input };
  },
  async createProduct(input) {
    return {
      id: "product-2",
      currency: "EUR",
      allergens: [],
      variantCount: 0,
      modifierGroupCount: 0,
      ...input,
    };
  },
  async updateProduct(input) {
    return {
      id: input.productId,
      currency: "EUR",
      allergens: [],
      variantCount: 0,
      modifierGroupCount: 0,
      ...input,
    };
  },
  async getConfiguration(input) {
    return { ...productConfiguration, productId: input.productId };
  },
  async replaceConfiguration(input) {
    return {
      productId: input.productId,
      basePriceMinor: 1290,
      variants: input.variants,
      modifierGroups: input.modifierGroups,
    };
  },
};

const fakeStaffCostRepository: StaffCostRepository = {
  async list() {
    return {
      venue: { id: "demo-venue", currency: "EUR" },
      ingredients: [
        {
          id: "ingredient-1",
          name: "Flour",
          baseUnit: "GRAM",
          allergens: ["GLUTEN"],
          active: true,
        },
      ],
      suppliers: [],
      prices: [],
    };
  },
  async createIngredient(input) {
    return { id: "ingredient-2", ...input };
  },
  async updateIngredient(input) {
    return { id: input.ingredientId, baseUnit: "GRAM" as const, ...input };
  },
  async createSupplier(input) {
    return { id: "supplier-1", ...input };
  },
  async updateSupplier(input) {
    return { id: input.supplierId, ...input };
  },
  async addPrice(input) {
    return {
      id: "price-1",
      currency: "EUR",
      createdAt: new Date("2026-08-10T10:00:00Z"),
      ...input,
    };
  },
  async getRecipe({ productId }) {
    return { productId, recipe: null, estimate: null };
  },
  async replaceRecipe({ productId, ...recipe }) {
    return { productId, recipe, estimate: null };
  },
};

const fakeVenueSetupRepository: StaffVenueSetupRepository = {
  async list() {
    return {
      venue: {
        id: "demo-venue",
        name: "Restaurant Olive",
        timezone: "Europe/Berlin",
        currency: "EUR",
        defaultServiceMode: "ORDER_AND_CONFIRM",
      },
      areas: [
        {
          id: "area-1",
          name: "Terrace",
          serviceModeOverride: null,
          tableCount: 1,
        },
      ],
      tables: [
        {
          id: "table-1",
          label: "07",
          areaId: "area-1",
          areaName: "Terrace",
          serviceModeOverride: null,
          effectiveServiceMode: "ORDER_AND_CONFIRM",
          qrConfigured: true,
          qrRevoked: false,
        },
      ],
    };
  },
  async updateVenue(input) {
    return {
      id: "demo-venue",
      name: "Restaurant Olive",
      timezone: "Europe/Berlin",
      currency: "EUR",
      defaultServiceMode: input.defaultServiceMode,
    };
  },
  async createArea(input) {
    return { id: "area-2", tableCount: 0, ...input.area };
  },
  async updateArea(input) {
    return { id: input.areaId, tableCount: 1, ...input.area };
  },
  async createTable(input) {
    return {
      qrToken: "new-secure-qr-token",
      table: {
        id: "table-2",
        ...input.table,
        areaName: "Terrace",
        effectiveServiceMode: "ORDER_AND_CONFIRM",
        qrConfigured: true,
        qrRevoked: false,
      },
    };
  },
  async updateTable(input) {
    return {
      id: input.tableId,
      ...input.table,
      areaName: "Terrace",
      effectiveServiceMode: "ORDER_AND_CONFIRM",
      qrConfigured: true,
      qrRevoked: false,
    };
  },
  async rotateTableQr(input) {
    return { tableId: input.tableId, qrToken: "rotated-secure-qr-token" };
  },
};

const fakeWorkRepository: StaffWorkRepository = {
  async currentShift() {
    return null;
  },
  async listPayments(input) {
    return {
      date: input.date ?? "2026-08-07",
      timezone: "Europe/Berlin",
      currency: "EUR",
      scope: "VENUE",
      payments: [
        {
          id: "payment-1",
          tableLabel: "07",
          area: "Terrace",
          amountMinor: 2500,
          currency: "EUR",
          method: "CARD_AT_TABLE",
          status: "RECORDED",
          recordedAt: "2026-08-07T12:00:00.000Z",
          recordedBy: {
            membershipId: "membership-1",
            displayName: "Demo Manager",
          },
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
          externalReference: null,
          canVoid: true,
        },
      ],
    };
  },
  async startShift() {
    return {
      id: "shift-1",
      status: "OPEN",
      startedAt: new Date("2026-08-07T08:00:00Z"),
      endedAt: null,
      recordedPaymentMinor: 0,
      actionCount: 1,
    };
  },
  async endShift() {
    return {
      id: "shift-1",
      status: "CLOSED",
      startedAt: new Date("2026-08-07T08:00:00Z"),
      endedAt: new Date("2026-08-07T16:00:00Z"),
      recordedPaymentMinor: 4200,
      actionCount: 12,
    };
  },
  async recordPayment(input) {
    return {
      id: "payment-1",
      amountMinor: input.amountMinor,
      currency: "EUR",
      method: input.method,
      status: "RECORDED",
      recordedAt: new Date("2026-08-07T12:00:00Z"),
    };
  },
  async voidPayment(input) {
    return {
      id: input.paymentId,
      status: "VOIDED",
      voidedAt: new Date("2026-08-07T12:05:00Z"),
    };
  },
};

const fakeReportRepository: StaffReportRepository = {
  async daily(input) {
    return {
      date: input.date ?? "2026-08-07",
      timezone: "Europe/Berlin",
      currency: "EUR",
      scope: "VENUE",
      range: {
        startsAt: "2026-08-06T22:00:00.000Z",
        endsAt: "2026-08-07T22:00:00.000Z",
      },
      orders: {
        submitted: 12,
        served: 10,
        cancelled: 1,
        orderValueMinor: 24800,
      },
      reconciliation: {
        ordersCreated: {
          count: 15,
          orderValueMinor: 34800,
          paidMinor: 22000,
          pendingMinor: 12800,
          unallocatedMinor: 0,
          overpaidMinor: 0,
          excludedCount: 1,
        },
        paymentsRecorded: {
          totalMinor: 22000,
          cashMinor: 9000,
          cardMinor: 13000,
          otherMinor: 0,
          todayOrdersMinor: 22000,
          otherPaymentsMinor: 0,
          earlierOrdersMinor: 0,
          tableSessionOnlyMinor: 0,
          excludedOrdersMinor: 0,
          unlinkedMinor: 0,
        },
      },
      channels: {
        table: { submitted: 12, orderValueMinor: 24800 },
        pickup: { submitted: 3, orderValueMinor: 6800 },
        delivery: { submitted: 1, orderValueMinor: 3200 },
        catering: { submitted: 0, orderValueMinor: 0 },
      },
      reservations: {
        requested: 1,
        confirmed: 2,
        seated: 0,
        completed: 4,
        cancelled: 1,
        noShows: 1,
        partySize: 18,
      },
      popularProducts: [
        {
          productId: "product-1",
          productName: "Burrata",
          quantity: 9,
          orderValueMinor: 10800,
        },
      ],
      costing: {
        complete: true,
        itemCount: 12,
        costedItemCount: 12,
        estimatedOrderValueMinor: 24800,
        estimatedDirectCostMinor: 6900,
        estimatedFoodCostBasisPoints: 2782,
        estimatedContributionMinor: 17900,
        missingRecipeProductIds: [],
        missingPriceIngredientIds: [],
      },
      payments: {
        recordedMinor: 22000,
        voidedMinor: 0,
        cashMinor: 9000,
        cardMinor: 13000,
        otherMinor: 0,
      },
      service: {
        requests: 8,
        acknowledged: 7,
        unresolved: 1,
        averageAcknowledgeSeconds: 42,
      },
      shifts: { count: 4, open: 3, workedMinutes: 960 },
      staff: [
        {
          membershipId: "membership-1",
          displayName: "Demo Manager",
          role: "MANAGER",
          shiftCount: 1,
          workedMinutes: 240,
          onShift: true,
          actionCount: 18,
          ticketsStarted: 0,
          ticketsReady: 0,
          partsServed: 4,
          requestsCompleted: 3,
          paymentsRecorded: 2,
          paymentTotalMinor: 7500,
          tablesClosed: 2,
        },
      ],
    };
  },
};

const staffOrderCalls: Array<
  Parameters<StaffOrderRepository["createOrder"]>[0]
> = [];

const fakeStaffOrderRepository: StaffOrderRepository = {
  async posMenu(staff, locale) {
    return {
      locale,
      venue: { id: staff.venueId, name: "Restaurant Olive", currency: "EUR" },
      tables: [{ id: "table-1", label: "07", area: "Terrace" }],
      categories: [
        {
          id: "category-1",
          name: "Pizza",
          products: [
            {
              id: "product-1",
              name: "Margherita",
              description: null,
              priceMinor: 900,
              currency: "EUR",
              available: true,
              station: "KITCHEN",
              allergens: ["GLUTEN", "MILK"],
              variants: [],
              modifierGroups: [],
            },
          ],
        },
      ],
    };
  },
  async createOrder(input) {
    staffOrderCalls.push(input);
    return {
      id: "pos-order-1",
      reference: "pos-order-1",
      status: "ACCEPTED",
      orderType: input.orderType,
      source: "STAFF_TABLET",
      totalMinor: 900,
      currency: "EUR",
      tableId: input.orderType === "DINE_IN" ? (input.tableId ?? null) : null,
      tableLabel: input.orderType === "DINE_IN" ? "07" : null,
      createdAt: new Date("2026-10-03T12:00:00Z"),
      items: [
        {
          productId: input.items[0]!.productId,
          productName: "Margherita",
          quantity: input.items[0]!.quantity,
          unitPriceMinor: 900,
          variantName: null,
          modifiers: [],
        },
      ],
    };
  },
};

afterEach(async () => {
  staffOrderCalls.length = 0;
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("FlowGastronomie API", () => {
  it("reports its health", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("publishes the server-owned subscription plan catalog", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/public/plans",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      plans: [
        { key: "WEBSITE", monthlyPriceMinor: 1900 },
        { key: "SMART_SERVICE", monthlyPriceMinor: 3900, featured: true },
        { key: "RESTAURANT_PRO", monthlyPriceMinor: 6900 },
      ],
    });
  });

  it("returns the protected unified operational order read model", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      operationalOrderRepository: fakeOperationalOrderRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/operational-orders",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: "order-3",
        source: "TABLE_GUEST_QR",
        fulfillment: "DINE_IN",
        status: "PENDING_CONFIRMATION",
      }),
    ]);
  });

  it("creates a complete trial workspace and an HTTP-only owner session", async () => {
    const register = vi.fn(fakeTrialRegistrationRepository.register);
    const app = buildApp({
      trialRegistrationRepository: { register },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/public/trials",
      payload: {
        organizationName: "Alba Hospitality",
        venueName: "Restaurant Alba",
        ownerDisplayName: "Ana Kola",
        email: "ana@example.com",
        password: "Secure123!",
        locale: "sq",
        timezone: "Europe/Tirane",
        currency: "ALL",
        plan: "RESTAURANT_PRO",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: "Europe/Tirane", currency: "ALL" }),
    );
    expect(response.headers["set-cookie"]).toContain(
      "flowgastronomie_staff_session=",
    );
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.json()).toMatchObject({
      staff: { displayName: "Ana Kola", role: "OWNER" },
      subscription: { plan: "RESTAURANT_PRO", status: "TRIALING" },
    });
    expect(response.json().sessionToken).toBeUndefined();
  });

  it("rejects an invalid public trial registration", async () => {
    const app = buildApp({
      trialRegistrationRepository: fakeTrialRegistrationRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/public/trials",
      payload: { email: "not-an-email", plan: "UNKNOWN" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_TRIAL_REGISTRATION");
  });

  it.each([
    { timezone: undefined, currency: "ALL" },
    { timezone: "Europe/Tirane", currency: undefined },
    { timezone: "Europe/Unknown", currency: "ALL" },
    { timezone: "Europe/Tirane", currency: "ZZZ" },
  ])("rejects trial region %j before calling provisioning", async (region) => {
    const register = vi.fn(fakeTrialRegistrationRepository.register);
    const app = buildApp({ trialRegistrationRepository: { register } });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/public/trials",
      payload: {
        organizationName: "Alba Hospitality",
        venueName: "Restaurant Alba",
        ownerDisplayName: "Ana Kola",
        email: "ana@example.com",
        password: "Secure123!",
        locale: "sq",
        plan: "WEBSITE",
        ...region,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_TRIAL_REGISTRATION");
    expect(register).not.toHaveBeenCalled();
  });

  it("directs an existing trial email back to sign in", async () => {
    const app = buildApp({
      trialRegistrationRepository: {
        async register() {
          throw new TrialEmailAlreadyRegisteredError();
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/public/trials",
      payload: {
        organizationName: "Alba Hospitality",
        venueName: "Restaurant Alba",
        ownerDisplayName: "Ana Kola",
        email: "existing@example.com",
        password: "Secure123!",
        locale: "sq",
        timezone: "Europe/Tirane",
        currency: "ALL",
        plan: "SMART_SERVICE",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("allows browser preflight for live staff mutations", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/staff/radar/signal-1/claim",
      headers: {
        origin: "http://localhost:3001",
        "access-control-request-method": "PATCH",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("returns ranked service signals", async () => {
    const app = buildApp({ staffRadarRepository: fakeStaffRadarRepository });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/demo/radar",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().signals).toHaveLength(3);
    expect(response.json().signals[0].tableLabel).toBe("Tavolina 07");
  });

  it("acknowledges a staff radar signal", async () => {
    const app = buildApp({ staffRadarRepository: fakeStaffRadarRepository });
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/demo/radar/signal-1/acknowledge",
    });

    expect(response.statusCode).toBe(204);
  });

  it("maps invalid order transitions to a conflict response", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/demo/orders/order-1/status",
      payload: { status: "READY" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("INVALID_ORDER_TRANSITION");
  });

  it("returns a localized public menu through an injected repository", async () => {
    const app = buildApp({
      publicMenuRepository: {
        async findByQrToken(qrToken, locale) {
          if (qrToken !== "valid-token") return null;

          return {
            locale,
            venue: {
              name: "Restaurant Olive",
              slug: "restaurant-olive",
              currency: "EUR",
            },
            table: {
              label: "07",
              area: "Terrace",
              serviceMode: "ORDER_AND_CONFIRM",
            },
            categories: [],
          };
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/public/tables/valid-token/menu?locale=de",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      locale: "de",
      venue: { name: "Restaurant Olive" },
      table: { serviceMode: "ORDER_AND_CONFIRM" },
    });
  });

  it("rejects unsupported public-menu locales", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/public/tables/valid-token/menu?locale=fr",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_LOCALE");
  });

  it("opens an anonymous guest session for a valid table", async () => {
    const app = buildApp({
      guestServiceRepository: fakeGuestServiceRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/public/tables/valid-token/sessions",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessionId: "session-1",
      tableLabel: "07",
      capabilities: { canOrder: true, requiresConfirmation: true },
    });
  });

  it("submits a guest order with credentials and an idempotency key", async () => {
    const app = buildApp({
      guestServiceRepository: fakeGuestServiceRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/public/sessions/session-1/orders",
      headers: {
        "x-guest-token": validGuestToken,
        "idempotency-key": "order-request-1",
      },
      payload: {
        locale: "sq",
        items: [{ productId: "product-1", quantity: 2 }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "order-2",
      status: "NEW",
      totalMinor: 2500,
    });
  });

  it("creates an idempotent table-service request", async () => {
    const app = buildApp({
      guestServiceRepository: fakeGuestServiceRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/public/sessions/session-1/requests",
      headers: {
        "x-guest-token": validGuestToken,
        "idempotency-key": "service-request-1",
      },
      payload: { type: "WAITER_CALL" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "signal-4",
      type: "WAITER_CALL",
    });
  });

  it("changes only the authenticated staff password and clears the session cookie", async () => {
    const changePassword = vi.fn(async () => {});
    const app = buildApp({
      staffAuthRepository: { ...fakeStaffAuthRepository, changePassword },
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/password",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        currentPassword: "OldSynthetic12!",
        newPassword: "NewSynthetic12!",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(changePassword).toHaveBeenCalledWith(
      demoStaff,
      "OldSynthetic12!",
      "NewSynthetic12!",
    );
    expect(response.json()).toEqual({ changed: true, sessionsRevoked: true });
    expect(response.headers["set-cookie"]).toContain(
      "flowgastronomie_staff_session=;",
    );
  });

  it("rejects unauthenticated password changes and supplied target identities", async () => {
    const changePassword = vi.fn(async () => {});
    const app = buildApp({
      staffAuthRepository: { ...fakeStaffAuthRepository, changePassword },
    });
    apps.push(app);
    const payload = {
      currentPassword: "OldSynthetic12!",
      newPassword: "NewSynthetic12!",
    };
    expect(
      (await app.inject({ method: "POST", url: "/v1/auth/password", payload }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/password",
          headers: { authorization: "Bearer valid-staff-session-token" },
          payload: { ...payload, userId: "another-tenant-user" },
        })
      ).statusCode,
    ).toBe(400);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("creates an HTTP-only staff session on login", async () => {
    const app = buildApp({ staffAuthRepository: fakeStaffAuthRepository });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: "flowgastronomie-demo",
        venueSlug: "restaurant-olive",
        email: "manager@flowgastronomie.local",
        password: "Demo1234!",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain(
      "flowgastronomie_staff_session=",
    );
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.json().staff.role).toBe("MANAGER");
    expect(response.json().sessionToken).toBeUndefined();
  });

  it("returns the authenticated tenant-scoped business overview", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      workspaceOverviewRepository: fakeWorkspaceOverviewRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspace/overview",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      organization: { slug: "flowgastronomie-demo" },
      venue: { slug: "restaurant-olive" },
      subscription: { plan: "RESTAURANT_PRO" },
      launch: { completed: 6, total: 6 },
      live: { actionableSignals: 2, activeOrders: 3 },
    });
  });

  it("accepts the legacy staff cookie during the platform-brand transition", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      workspaceOverviewRepository: fakeWorkspaceOverviewRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspace/overview",
      headers: {
        cookie: "restaurantflow_staff_session=valid-staff-session-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().organization.slug).toBe("flowgastronomie-demo");
  });

  it("protects the business overview from anonymous access", async () => {
    const app = buildApp({
      workspaceOverviewRepository: fakeWorkspaceOverviewRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspace/overview",
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns the protected restaurant website editor", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      venueWebsiteRepository: fakeVenueWebsiteRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspace/website",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      venueName: "Restaurant Olive",
      publicSlug: "restaurant-olive-demo",
      status: "DRAFT",
    });
    expect(response.json().translations).toEqual(
      expect.arrayContaining([expect.objectContaining({ locale: "en" })]),
    );
  });

  it("keeps partial imported hours editable without inventing absent days", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      venueWebsiteRepository: fakeVenueWebsiteRepository,
    });
    apps.push(app);
    const hours = [
      { day: "MONDAY", closed: false, opensAt: "12:00", closesAt: "22:00" },
    ];
    const response = await app.inject({
      method: "PUT",
      url: "/v1/workspace/website",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { ...websiteEditor, openingHours: hours },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().openingHours).toEqual(hours);
  });

  it("accepts only trusted internal paths for uploaded website images", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      venueWebsiteRepository: fakeVenueWebsiteRepository,
    });
    apps.push(app);

    const trusted = await app.inject({
      method: "PUT",
      url: "/v1/workspace/website",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        ...websiteEditor,
        logoUrl: "/v1/public/website-assets/asset-1",
      },
    });
    const untrusted = await app.inject({
      method: "PUT",
      url: "/v1/workspace/website",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { ...websiteEditor, logoUrl: "/uploads/untrusted.png" },
    });

    expect(trusted.statusCode).toBe(200);
    expect(trusted.json().logoUrl).toBe("/v1/public/website-assets/asset-1");
    expect(untrusted.statusCode).toBe(400);
  });

  it("publishes a localized public restaurant website", async () => {
    const app = buildApp({
      venueWebsiteRepository: fakeVenueWebsiteRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/public/websites/restaurant-olive-demo?locale=it",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      locale: "it",
      venue: { name: "Restaurant Olive" },
      content: { heroTitle: "Olive it" },
    });
  });

  it("returns publication issues without publishing incomplete content", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      venueWebsiteRepository: {
        ...fakeVenueWebsiteRepository,
        async publish() {
          throw new VenueWebsitePublicationError(["CONTACT_REQUIRED"]);
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspace/website/publish",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "WEBSITE_NOT_READY",
      issues: ["CONTACT_REQUIRED"],
    });
  });

  it("exposes the custom-domain lifecycle and public resolution", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      websiteDomainRepository: fakeWebsiteDomainRepository,
    });
    apps.push(app);

    const configured = await app.inject({
      method: "PUT",
      url: "/v1/workspace/website/domain",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { hostname: "www.restaurantolive.de" },
    });
    const verified = await app.inject({
      method: "POST",
      url: "/v1/workspace/website/domain/verify",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });
    const resolved = await app.inject({
      method: "GET",
      url: "/v1/public/domains/www.restaurantolive.de",
    });

    expect(configured.statusCode).toBe(200);
    expect(configured.json().domain.verificationRecord.type).toBe("TXT");
    expect(verified.json().domain.status).toBe("VERIFIED");
    expect(resolved.json()).toEqual({
      publicSlug: "restaurant-olive-demo",
      defaultLocale: "sq",
    });
  });

  it("uploads and serves a website image", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      websiteAssetRepository: fakeWebsiteAssetRepository,
    });
    apps.push(app);

    const uploaded = await app.inject({
      method: "PUT",
      url: "/v1/workspace/website/assets/LOGO",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "content-type": "image/png",
      },
      payload: Buffer.from([137, 80, 78, 71]),
    });
    const asset = await app.inject({
      method: "GET",
      url: "/v1/public/website-assets/asset-1",
    });

    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json()).toMatchObject({ kind: "LOGO" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toBe("image/png");
  });

  it("returns the protected owner billing workspace and requests a plan change", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      billingWorkspaceRepository: fakeBillingWorkspaceRepository,
    });
    apps.push(app);

    const workspace = await app.inject({
      method: "GET",
      url: "/v1/workspace/billing",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });
    const requested = await app.inject({
      method: "POST",
      url: "/v1/workspace/billing/plan-change",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { requestedPlan: "SMART_SERVICE" },
    });

    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({
      subscription: { plan: "RESTAURANT_PRO" },
      invoices: [{ number: "RF-2026-0001", status: "PAID" }],
    });
    expect(requested.json().pendingChange).toMatchObject({
      requestedPlan: "SMART_SERVICE",
    });
  });

  it("returns actionable plan-change conflicts", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      billingWorkspaceRepository: {
        ...fakeBillingWorkspaceRepository,
        async requestPlanChange() {
          throw new PlanChangeConflictError(["SAME_PLAN"]);
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspace/billing/plan-change",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { requestedPlan: "RESTAURANT_PRO" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "PLAN_CHANGE_CONFLICT",
      issues: ["SAME_PLAN"],
    });
  });

  it("serves onboarding progress and confirms the service rehearsal", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      venueLaunchRepository: fakeVenueLaunchRepository,
    });
    apps.push(app);

    const onboarding = await app.inject({
      method: "GET",
      url: "/v1/workspace/onboarding",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });
    const rehearsal = await app.inject({
      method: "POST",
      url: "/v1/workspace/launch/rehearsal",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(onboarding.statusCode).toBe(200);
    expect(onboarding.json().progress).toEqual({
      completed: 6,
      total: 7,
      percent: 86,
    });
    expect(rehearsal.json()).toMatchObject({
      canLaunch: true,
      progress: { percent: 100 },
    });
  });

  it("returns exact blockers when launch activation is rejected", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      venueLaunchRepository: {
        ...fakeVenueLaunchRepository,
        async launch() {
          throw new VenueLaunchBlockedError(["SERVICE_REHEARSAL"]);
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspace/launch/activate",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "VENUE_LAUNCH_BLOCKED",
      issues: ["SERVICE_REHEARSAL"],
    });
  });

  it("protects staff radar and accepts a valid bearer session", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffRadarRepository: fakeStaffRadarRepository,
    });
    apps.push(app);

    const unauthorized = await app.inject({
      method: "GET",
      url: "/v1/staff/radar",
    });
    const authorized = await app.inject({
      method: "GET",
      url: "/v1/staff/radar",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().signals).toHaveLength(3);
    expect(authorized.json().assignees).toHaveLength(1);
  });

  it("lets an active worker claim a live service task", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffRadarRepository: fakeStaffRadarRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/staff/radar/signal-1/claim",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(204);
  });

  it("lets management assign a live task to an active worker", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffRadarRepository: fakeStaffRadarRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/v1/staff/radar/signal-1/assignment",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { membershipId: "membership-1" },
    });

    expect(response.statusCode).toBe(204);
  });

  it("updates an order through the authenticated staff workflow", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOperationsRepository: fakeStaffOperationsRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/staff/orders/order-3/status",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { status: "ACCEPTED", expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "order-3",
      status: "ACCEPTED",
      version: 2,
    });
  });

  it("returns a correction-document conflict when cancelling a finalized counter sale", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOperationsRepository: {
        ...fakeStaffOperationsRepository,
        async transitionOrder() {
          throw new CounterSaleError(
            "FINALIZED_PAYMENT",
            "Issue a correction document",
          );
        },
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "PATCH",
      url: "/v1/staff/orders/paid-order/status",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { status: "CANCELLED", expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("FINALIZED_PAYMENT");
  });

  it("returns the authenticated venue menu", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffMenuRepository: fakeStaffMenuRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/menu",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      venue: { name: "Restaurant Olive" },
      categories: [{ id: "category-1" }],
    });
  });

  it("lets an authenticated manager manage the venue cost catalog", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffCostRepository: fakeStaffCostRepository,
    });
    apps.push(app);

    const catalog = await app.inject({
      method: "GET",
      url: "/v1/staff/costs",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toMatchObject({
      ingredients: [{ id: "ingredient-1", baseUnit: "GRAM" }],
    });

    const price = await app.inject({
      method: "POST",
      url: "/v1/staff/costs/prices",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        supplierId: "supplier-1",
        ingredientId: "ingredient-1",
        packQuantity: 1,
        unit: "KILOGRAM",
        priceMinor: 399,
        effectiveFrom: "2026-08-10",
      },
    });
    expect(price.statusCode).toBe(201);
    expect(price.json()).toMatchObject({
      supplierId: "supplier-1",
      ingredientId: "ingredient-1",
      currency: "EUR",
    });
  });

  it("rejects invalid supplier-price quantities at the API boundary", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffCostRepository: fakeStaffCostRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/costs/prices",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        supplierId: "supplier-1",
        ingredientId: "ingredient-1",
        packQuantity: 0,
        unit: "KILOGRAM",
        priceMinor: 399,
        effectiveFrom: "2026-08-10",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_SUPPLIER_PRICE" });
  });

  it("returns a safe validation error for an incompatible price unit", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffCostRepository: {
        ...fakeStaffCostRepository,
        async addPrice() {
          throw new InvalidIngredientQuantityError();
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/costs/prices",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        supplierId: "supplier-1",
        ingredientId: "ingredient-1",
        packQuantity: 1,
        unit: "KILOGRAM",
        priceMinor: 399,
        effectiveFrom: "2026-08-10",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_SUPPLIER_PRICE" });
  });

  it("requires an active shift before an online order decision", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      onlineOrderRepository: {
        ...fakeOnlineOrderRepository,
        async transitionForStaff() {
          throw new ActiveShiftRequiredError();
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/staff/online-orders/RF-123456/status",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { status: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "ACTIVE_SHIFT_REQUIRED" });
  });

  it("quotes without submitting and preserves uncertain failures for safe reconciliation", async () => {
    let submissions = 0;
    const app = buildApp({
      onlineOrderRepository: {
        ...fakeOnlineOrderRepository,
        async submit() {
          submissions++;
          throw new Error("uncertain database result");
        },
      },
    });
    apps.push(app);
    const payload = {
      locale: "en",
      idempotencyKey: "safe-request-123",
      fulfillmentType: "PICKUP",
      timingMode: "ASAP",
      contact: { name: "Test guest", phone: "+49 123456" },
      items: [{ productId: "p", quantity: 1 }],
    };
    const quote = await app.inject({
      method: "POST",
      url: "/v1/public/online-orders/synthetic/quote",
      payload,
    });
    expect(quote.statusCode).toBe(200);
    expect(quote.json().totalMinor).toBe(1250);
    expect(submissions).toBe(0);
    const result = await app.inject({
      method: "POST",
      url: "/v1/public/online-orders/synthetic",
      payload,
    });
    expect(result.statusCode).toBe(503);
    expect(result.json().code).toBe("ONLINE_ORDER_RESULT_UNKNOWN");
    expect(submissions).toBe(1);
  });

  it("authenticates a staff live stream before opening the connection", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/online-orders/events",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("notifies the guest in the stored locale after an order status commit", async () => {
    const sent: TransactionalNotification[] = [];
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      onlineOrderRepository: {
        ...fakeOnlineOrderRepository,
        async transitionForStaff(input) {
          return {
            ...fakeOnlineOrderTracking,
            status: input.status,
            locale: "de",
            contact: {
              ...fakeOnlineOrderTracking.contact,
              email: "guest@example.com",
            },
          };
        },
      },
      transactionalNotificationService: {
        async send(notification) {
          sent.push(notification);
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/staff/online-orders/RF-123456/status",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { status: "ACCEPTED", note: "Ready in 20 minutes" },
    });

    expect(response.statusCode).toBe(200);
    expect(sent).toEqual([
      {
        kind: "ONLINE_ORDER_STATUS_CHANGED",
        recipient: "guest@example.com",
        locale: "de",
        referenceCode: "RF-123456",
        status: "ACCEPTED",
        note: "Ready in 20 minutes",
      },
    ]);
  });

  it("keeps a committed online order when notification delivery fails", async () => {
    const app = buildApp({
      onlineOrderRepository: fakeOnlineOrderRepository,
      transactionalNotificationService: {
        async send() {
          throw new Error("provider unavailable");
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/public/online-orders/restaurant-olive-demo",
      payload: {
        locale: "it",
        idempotencyKey: "order-notification-1",
        fulfillmentType: "PICKUP",
        contact: {
          name: "Ada Lovelace",
          phone: "+4912345678",
          email: "ada@example.com",
        },
        requestedFor: "2027-08-09T18:00:00.000Z",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      referenceCode: "RF-123456",
      status: "PENDING_CONFIRMATION",
    });
  });

  it("notifies an auto-confirmed reservation only after it is created", async () => {
    const sent: TransactionalNotification[] = [];
    const app = buildApp({
      reservationRepository: {
        ...fakeReservationRepository,
        async create() {
          return {
            reservation: { id: "reservation-1", status: "CONFIRMED" },
            confirmation: {
              recipient: "ada@example.com",
              locale: "it",
              venueName: "Restaurant Olive",
              requestedFor: new Date("2027-08-09T18:00:00.000Z"),
              timezone: "Europe/Berlin",
              partySize: 4,
            },
          };
        },
      },
      transactionalNotificationService: {
        async send(notification) {
          sent.push(notification);
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/public/reservations/restaurant-olive-demo",
      payload: {
        idempotencyKey: "reservation-confirmed-1",
        guestName: "Ada Lovelace",
        phone: "+4912345678",
        email: "ada@example.com",
        locale: "it",
        requestedFor: "2027-08-09T18:00:00.000Z",
        partySize: 4,
        guestNotes: null,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(sent).toEqual([
      {
        kind: "RESERVATION_CONFIRMED",
        recipient: "ada@example.com",
        locale: "it",
        venueName: "Restaurant Olive",
        requestedFor: new Date("2027-08-09T18:00:00.000Z"),
        timezone: "Europe/Berlin",
        partySize: 4,
      },
    ]);
  });

  it("keeps a confirmed reservation when notification delivery fails", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      reservationRepository: {
        ...fakeReservationRepository,
        async transition() {
          return {
            reservation: { id: "reservation-1", status: "CONFIRMED" },
            confirmation: {
              recipient: "ada@example.com",
              locale: "sq",
              venueName: "Restaurant Olive",
              requestedFor: new Date("2027-08-09T18:00:00.000Z"),
              timezone: "Europe/Berlin",
              partySize: 2,
            },
          };
        },
      },
      transactionalNotificationService: {
        async send() {
          throw new Error("provider unavailable");
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/staff/reservations/reservation-1",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { status: "CONFIRMED", tableId: null },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "reservation-1",
      status: "CONFIRMED",
    });
  });

  it("provides a staff-scoped customer profile, export, correction, and deletion", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      customerProfileRepository: fakeCustomerProfileRepository,
    });
    apps.push(app);
    const headers = { authorization: "Bearer valid-staff-session-token" };

    const listed = await app.inject({
      method: "GET",
      url: "/v1/staff/customers",
      headers,
    });
    const exported = await app.inject({
      method: "GET",
      url: "/v1/staff/customers/export",
      headers,
    });
    const profile = await app.inject({
      method: "GET",
      url: "/v1/staff/customers/customer-1",
      headers,
    });
    const duplicates = await app.inject({
      method: "GET",
      url: "/v1/staff/customers/customer-1/duplicates",
      headers,
    });
    const corrected = await app.inject({
      method: "PUT",
      url: "/v1/staff/customers/customer-1",
      headers,
      payload: {
        displayName: "Ada Byron",
        email: "ada@example.com",
        phone: "+4912345678",
        preferredLocale: "de",
        internalNotes: "Quiet table",
      },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/staff/customers/customer-1",
      headers,
    });

    expect(listed.statusCode).toBe(200);
    expect(exported.json()).toEqual(listed.json());
    expect(profile.json()).toMatchObject({
      id: "customer-1",
      reservations: [{ id: "reservation-1" }],
      onlineOrders: [{ referenceCode: "RF-123456" }],
    });
    expect(duplicates.json()).toEqual([
      expect.objectContaining({
        id: "customer-2",
        matchingFields: ["email"],
      }),
    ]);
    expect(corrected.json()).toMatchObject({
      id: "customer-1",
      displayName: "Ada Byron",
      preferredLocale: "de",
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("rejects invalid customer correction payloads before calling the repository", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      customerProfileRepository: fakeCustomerProfileRepository,
    });
    apps.push(app);
    const response = await app.inject({
      method: "PUT",
      url: "/v1/staff/customers/customer-1",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        displayName: "Ada",
        email: null,
        phone: null,
        preferredLocale: "en",
        internalNotes: null,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_CUSTOMER_PROFILE" });
  });

  it("returns a consistent upgrade response when customer timeline is unavailable", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      customerProfileRepository: {
        ...fakeCustomerProfileRepository,
        async list() {
          throw new SubscriptionAccessDeniedError("CUSTOMER_TIMELINE");
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/customers",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "SUBSCRIPTION_UPGRADE_REQUIRED" });
  });

  it("requires an active shift before an online production transition", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      onlineOrderRepository: {
        ...fakeOnlineOrderRepository,
        async transitionProductionForStaff() {
          throw new ActiveShiftRequiredError();
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/staff/online-production-tickets/ticket-1/status",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { status: "PREPARING", expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "ACTIVE_SHIFT_REQUIRED" });
  });

  it("keeps online order tracking private to its opaque token", async () => {
    const tracking = {
      referenceCode: "RF-123456",
      fulfillmentType: "DELIVERY" as const,
      status: "PREPARING" as const,
      locale: "de" as const,
      totalMinor: 2490,
      currency: "EUR",
      contact: { name: "Ada", phone: "+49123456", email: null },
      requestedFor: new Date("2026-08-09T18:00:00Z"),
      timingMode: "SCHEDULED" as const,
      deliveryAddress: {
        line1: "Market 1",
        postalCode: "80331",
        city: "Munich",
      },
      cateringGuestCount: null,
      guestNotes: null,
      items: [],
      timeline: [],
      messages: [],
    };
    const app = buildApp({
      onlineOrderRepository: {
        ...fakeOnlineOrderRepository,
        async submit() {
          return {
            referenceCode: "RF-123456",
            trackingToken: "valid-tracking-token",
            status: "PENDING_CONFIRMATION" as const,
          };
        },
        async listForStaff() {
          return [tracking];
        },
        async listProductionForStaff() {
          return [];
        },
        async getFulfillmentSettings() {
          return {
            pickupEnabled: true,
            deliveryEnabled: true,
            cateringEnabled: true,
          };
        },
        async updateFulfillmentSettings(input) {
          return {
            pickupEnabled: input.pickupEnabled,
            deliveryEnabled: input.deliveryEnabled,
            cateringEnabled: input.cateringEnabled,
          };
        },
        async listDeliveryZones() {
          return [];
        },
        async createDeliveryZone() {
          return { id: "zone-1" };
        },
        async updateDeliveryZone() {},
        async transitionProductionForStaff() {
          return { order: tracking, customerStatusChanged: false };
        },
        async transitionForStaff() {
          return tracking;
        },
        async addStaffMessage() {
          return tracking;
        },
        async findTracking(token) {
          if (token !== "valid-tracking-token") {
            throw new OnlineOrderTrackingNotFoundError();
          }
          return tracking;
        },
        async addGuestMessage(input) {
          if (input.trackingToken !== "valid-tracking-token") {
            throw new OnlineOrderTrackingNotFoundError();
          }
          return {
            ...tracking,
            messages: [
              {
                author: "GUEST" as const,
                body: input.body,
                createdAt: new Date(),
              },
            ],
          };
        },
      },
    });
    apps.push(app);

    const found = await app.inject({
      method: "GET",
      url: "/v1/public/online-orders/track/valid-tracking-token",
    });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({
      referenceCode: "RF-123456",
      status: "PREPARING",
    });

    const missing = await app.inject({
      method: "GET",
      url: "/v1/public/online-orders/track/other-token",
    });
    expect(missing.statusCode).toBe(404);

    const message = await app.inject({
      method: "POST",
      url: "/v1/public/online-orders/track/valid-tracking-token/messages",
      payload: { body: "Can you confirm the delivery time?" },
    });
    expect(message.statusCode).toBe(200);
    expect(message.json().messages[0]).toMatchObject({ author: "GUEST" });
  });

  it("creates a fully translated menu product", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffMenuRepository: fakeStaffMenuRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/menu/products",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        categoryId: "category-1",
        priceMinor: 1890,
        sortOrder: 1,
        available: true,
        published: true,
        station: "KITCHEN",
        translations: productTranslations,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "product-2",
      priceMinor: 1890,
    });
    expect(response.json().translations).toEqual(
      expect.arrayContaining([expect.objectContaining({ locale: "sq" })]),
    );
  });

  it("reads and replaces a product's variants and modifier groups", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffMenuRepository: fakeStaffMenuRepository,
    });
    apps.push(app);

    const read = await app.inject({
      method: "GET",
      url: "/v1/staff/menu/products/product-1/configuration",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      productId: "product-1",
      variants: [{ isDefault: true }],
      modifierGroups: [{ options: [{ priceDeltaMinor: 150 }] }],
    });

    const replacement = await app.inject({
      method: "PUT",
      url: "/v1/staff/menu/products/product-1/configuration",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        variants: productConfiguration.variants,
        modifierGroups: productConfiguration.modifierGroups,
      },
    });

    expect(replacement.statusCode).toBe(200);
    expect(replacement.json()).toMatchObject({
      productId: "product-1",
      modifierGroups: [{ maxSelect: 1 }],
    });
  });

  it("rejects incomplete product configuration translations", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffMenuRepository: fakeStaffMenuRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/v1/staff/menu/products/product-1/configuration",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        variants: [
          {
            ...productConfiguration.variants[0],
            translations: configurationTranslations.slice(0, 3),
          },
        ],
        modifierGroups: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_PRODUCT_CONFIGURATION");
  });

  it("rejects menu content with missing platform translations", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffMenuRepository: fakeStaffMenuRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/menu/categories",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        published: true,
        sortOrder: 2,
        translations: categoryTranslations.slice(0, 3),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_MENU_CATEGORY");
  });

  it("returns venue areas and tables to authenticated management", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffVenueSetupRepository: fakeVenueSetupRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/setup",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      venue: { defaultServiceMode: "ORDER_AND_CONFIRM" },
      areas: [{ name: "Terrace" }],
      tables: [{ label: "07" }],
    });
  });

  it("creates a table and returns its raw QR token only in the write result", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffVenueSetupRepository: fakeVenueSetupRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/setup/tables",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        label: "08",
        areaId: "area-1",
        serviceModeOverride: null,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      qrToken: "new-secure-qr-token",
      table: { label: "08", qrConfigured: true },
    });
  });

  it("rejects an invalid service mode override", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffVenueSetupRepository: fakeVenueSetupRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/setup/areas",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { name: "Garden", serviceModeOverride: "INVALID" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_AREA");
  });

  it("starts an individual authenticated staff shift", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffWorkRepository: fakeWorkRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/shift/start",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: { note: "Lunch shift" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "shift-1", status: "OPEN" });
  });

  it("records a manual table payment against the staff work account", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffWorkRepository: fakeWorkRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/table-sessions/session-1/payments",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        amountMinor: 2500,
        method: "CARD_AT_TABLE",
        idempotencyKey: "payment-request-1",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "payment-1",
      amountMinor: 2500,
      method: "CARD_AT_TABLE",
      status: "RECORDED",
    });
  });

  it("returns the scoped manual payment history", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffWorkRepository: fakeWorkRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/payments?date=2026-08-07",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      date: "2026-08-07",
      scope: "VENUE",
      payments: [
        {
          id: "payment-1",
          tableLabel: "07",
          recordedBy: { displayName: "Demo Manager" },
          canVoid: true,
        },
      ],
    });
  });

  it("returns the authenticated venue daily operations report", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffReportRepository: fakeReportRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/reports/daily?date=2026-08-07",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      date: "2026-08-07",
      scope: "VENUE",
      orders: { submitted: 12, orderValueMinor: 24800 },
      staff: [{ displayName: "Demo Manager", actionCount: 18 }],
    });
  });

  it("rejects an invalid daily report date", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffReportRepository: fakeReportRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/reports/daily?date=07-08-2026",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_REPORT_DATE" });
  });

  it("returns the protected team workspace", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffTeamRepository: fakeStaffTeamRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/team",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      members: [{ id: "membership-1" }],
      tables: [{ label: "07" }],
    });
  });

  it("creates a staff invitation without exposing its hash", async () => {
    const sent: TransactionalNotification[] = [];
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffTeamRepository: fakeStaffTeamRepository,
      transactionalNotificationService: {
        async send(notification) {
          sent.push(notification);
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/team/invitations",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        email: "waiter@flowgastronomie.local",
        role: "WAITER",
        preferredLocale: "sq",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      invitationToken: "secure-invitation-token",
      invitation: { role: "WAITER" },
    });
    expect(response.json().tokenHash).toBeUndefined();
    expect(sent).toEqual([
      {
        kind: "STAFF_INVITATION",
        recipient: "waiter@flowgastronomie.local",
        locale: "sq",
        venueName: "Restaurant Olive",
        role: "WAITER",
        invitationToken: "secure-invitation-token",
      },
    ]);
  });

  it("accepts a public staff invitation into an individual profile", async () => {
    const app = buildApp({ staffTeamRepository: fakeStaffTeamRepository });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/invitations/secure-invitation-token/accept",
      payload: { displayName: "Elira Hoxha", password: "Demo1234!" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      venueSlug: "restaurant-olive",
      email: "waiter@flowgastronomie.local",
    });
  });

  it("lets service staff create a dine-in POS order for a table", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: fakeStaffOrderRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "idempotency-key": "pos-idempotency-1",
      },
      payload: {
        orderType: "DINE_IN",
        tableId: "table-1",
        locale: "sq",
        items: [{ productId: "product-1", quantity: 2 }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: "pos-order-1",
      status: "ACCEPTED",
      orderType: "DINE_IN",
      source: "STAFF_TABLET",
      tableId: "table-1",
      tableLabel: "07",
      totalMinor: 900,
    });
    expect(staffOrderCalls[0]).toMatchObject({
      staff: { membershipId: "membership-1" },
      idempotencyKey: "pos-idempotency-1",
      tableId: "table-1",
    });
  });

  it("lets service staff create a takeaway POS order without a table", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: fakeStaffOrderRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "idempotency-key": "pos-idempotency-2",
      },
      payload: {
        orderType: "TAKEAWAY",
        locale: "en",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      orderType: "TAKEAWAY",
      tableId: null,
      tableLabel: null,
    });
  });

  it("rejects POS orders without an idempotency key", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: fakeStaffOrderRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: { authorization: "Bearer valid-staff-session-token" },
      payload: {
        orderType: "TAKEAWAY",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_ORDER" });
  });

  it("rejects takeaway POS orders that carry a table", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: fakeStaffOrderRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "idempotency-key": "pos-idempotency-3",
      },
      payload: {
        orderType: "TAKEAWAY",
        tableId: "table-1",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects dine-in POS orders without a table", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: fakeStaffOrderRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "idempotency-key": "pos-idempotency-4",
      },
      payload: {
        orderType: "DINE_IN",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects POS creation for staff without the ORDER_CREATE permission", async () => {
    const app = buildApp({
      staffAuthRepository: {
        ...fakeStaffAuthRepository,
        async authenticate(token) {
          return token === "valid-staff-session-token"
            ? { ...demoStaff, role: "KITCHEN" as const }
            : null;
        },
      },
      staffOrderRepository: {
        ...fakeStaffOrderRepository,
        async createOrder() {
          throw new StaffPermissionDeniedError("KITCHEN", "ORDER_CREATE");
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "idempotency-key": "pos-idempotency-5",
      },
      payload: {
        orderType: "TAKEAWAY",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires an active shift before creating POS orders", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: {
        ...fakeStaffOrderRepository,
        async createOrder() {
          throw new ActiveShiftRequiredError();
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "idempotency-key": "pos-idempotency-6",
      },
      payload: {
        orderType: "TAKEAWAY",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "ACTIVE_SHIFT_REQUIRED" });
  });

  it("rejects POS orders for tables outside the venue", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: {
        ...fakeStaffOrderRepository,
        async createOrder() {
          throw new StaffTableNotFoundError();
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "idempotency-key": "pos-idempotency-7",
      },
      payload: {
        orderType: "DINE_IN",
        tableId: "other-venue-table",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "TABLE_NOT_FOUND" });
  });

  it("rejects POS orders with unavailable products", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: {
        ...fakeStaffOrderRepository,
        async createOrder() {
          throw new ProductUnavailableError();
        },
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      headers: {
        authorization: "Bearer valid-staff-session-token",
        "idempotency-key": "pos-idempotency-8",
      },
      payload: {
        orderType: "TAKEAWAY",
        items: [{ productId: "unpublished-product", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  });

  it("requires authentication to create POS orders", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: fakeStaffOrderRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/orders",
      payload: {
        orderType: "TAKEAWAY",
        items: [{ productId: "product-1", quantity: 1 }],
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("serves the POS menu with tables and orderable products", async () => {
    const app = buildApp({
      staffAuthRepository: fakeStaffAuthRepository,
      staffOrderRepository: fakeStaffOrderRepository,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/staff/pos/menu?locale=en",
      headers: { authorization: "Bearer valid-staff-session-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      venue: { name: "Restaurant Olive", currency: "EUR" },
      tables: [{ id: "table-1", label: "07" }],
      categories: [
        {
          id: "category-1",
          products: [{ id: "product-1", priceMinor: 900, available: true }],
        },
      ],
    });
  });
});

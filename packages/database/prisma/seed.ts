import { AllergenCode, Locale, StationType } from "@prisma/client";
import { entitlementsForPlan } from "@flowgastronomie/domain";

import { hashPassword, hashQrToken, prisma } from "../src/index.js";

const tenantId = "demo-tenant";
const venueId = "demo-venue";
const categoryId = "demo-category-mains";

const categoryNames = {
  EN: "Mains",
  DE: "Hauptgerichte",
  IT: "Piatti principali",
  SQ: "Kryesore",
} satisfies Record<Locale, string>;

const products = [
  {
    id: "demo-product-burrata",
    priceMinor: 1250,
    station: StationType.KITCHEN,
    translations: {
      EN: ["Seasonal burrata", "Heirloom tomatoes, basil, olive oil"],
      DE: ["Burrata der Saison", "Alte Tomatensorten, Basilikum, Olivenöl"],
      IT: ["Burrata di stagione", "Pomodori antichi, basilico, olio d'oliva"],
      SQ: ["Burrata e stinës", "Domate heirloom, borzilok, vaj ulliri"],
    },
  },
  {
    id: "demo-product-rigatoni",
    priceMinor: 1890,
    station: StationType.KITCHEN,
    translations: {
      EN: ["Rigatoni al ragù", "8-hour beef ragù, 24-month parmigiano"],
      DE: [
        "Rigatoni al ragù",
        "8 Stunden geschmortes Rinderragù, Parmigiano 24 Monate",
      ],
      IT: ["Rigatoni al ragù", "Ragù di manzo cotto 8 ore, parmigiano 24 mesi"],
      SQ: ["Rigatoni al ragù", "Ragù viçi 8-orësh, parmigiano 24 muaj"],
    },
  },
  {
    id: "demo-product-seabass",
    priceMinor: 2400,
    station: StationType.KITCHEN,
    translations: {
      EN: ["Grilled sea bass", "New potatoes, lemon, salsa verde"],
      DE: ["Gegrillter Wolfsbarsch", "Neue Kartoffeln, Zitrone, Salsa verde"],
      IT: ["Branzino alla griglia", "Patate novelle, limone, salsa verde"],
      SQ: ["Levrek në skarë", "Patate të reja, limon, salsa verde"],
    },
  },
] as const;

if (process.env.NODE_ENV === "production")
  throw new Error("Demo seed must never run in production");
const target = new URL(process.env.DATABASE_URL ?? "");
if (
  !["postgres:", "postgresql:"].includes(target.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
)
  throw new Error(
    "Synthetic seed requires local disposable PostgreSQL; remote data is never seeded",
  );
const prior = await prisma.tenant.findUnique({
  where: { id: tenantId },
  include: { users: true, venues: true },
});
if (
  prior &&
  (prior.kind !== "LEGACY_CI" ||
    prior.slug !== "flowgastronomie-demo" ||
    prior.name !== "FlowGastronomie Demo" ||
    prior.users.some(
      (user) => !user.email.endsWith("@flowgastronomie.local"),
    ) ||
    prior.venues.length !== 1 ||
    prior.venues[0]?.id !== venueId ||
    prior.venues[0]?.slug !== "restaurant-olive")
)
  throw new Error(
    "Synthetic seed refuses unidentified or customer-owned records",
  );
await prisma.$transaction([
  prisma.$executeRaw`SET LOCAL flowgastronomie.test_cleanup = 'on'`,
  prisma.printJob.deleteMany({ where: { tenantId } }),
  prisma.hardwareCommandRecord.deleteMany({ where: { tenantId } }),
  prisma.hardwareDevice.deleteMany({ where: { tenantId } }),
  prisma.receipt.deleteMany({ where: { tenantId } }),
  prisma.paymentRecord.deleteMany({ where: { tenantId } }),

  prisma.staffSession.deleteMany({ where: { tenantId } }),
  prisma.onlineOrder.deleteMany({ where: { tenantId } }),
  prisma.operationalOrderEvent.deleteMany({ where: { tenantId } }),
  prisma.deliveryZone.deleteMany({ where: { tenantId } }),
  prisma.cashSession.deleteMany({ where: { tenantId } }),
  prisma.auditEvent.deleteMany({ where: { tenantId } }),
  prisma.tableAssignment.deleteMany({ where: { tenantId } }),
  prisma.staffShift.deleteMany({ where: { tenantId } }),
  prisma.staffProfile.deleteMany({ where: { tenantId } }),
  prisma.serviceSignal.deleteMany({ where: { tenantId } }),
  prisma.orderItem.deleteMany({ where: { order: { tenantId } } }),
  prisma.order.deleteMany({ where: { tenantId } }),
  prisma.tableGuest.deleteMany({ where: { tenantId } }),
  prisma.tableSession.deleteMany({ where: { tenantId } }),
  prisma.product.updateMany({
    where: { tenantId },
    data: { taxCategoryId: null },
  }),
  prisma.tenant.deleteMany({ where: { id: tenantId } }),
]);

await prisma.tenant.create({
  data: {
    id: tenantId,
    name: "FlowGastronomie Demo",
    kind: "LEGACY_CI",
    slug: "flowgastronomie-demo",
  },
});

const trialStartedAt = new Date();
const trialEndsAt = new Date(
  trialStartedAt.getTime() + 14 * 24 * 60 * 60 * 1_000,
);
await prisma.subscription.create({
  data: {
    id: "demo-subscription",
    tenantId,
    plan: "RESTAURANT_PRO",
    status: "ACTIVE",
    trialStartedAt,
    trialEndsAt,
    currentPeriodStartedAt: new Date("2026-08-01T00:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-09-01T00:00:00.000Z"),
    entitlements: {
      create: entitlementsForPlan("RESTAURANT_PRO").map((entitlement) => ({
        tenantId,
        featureKey: entitlement.featureKey,
        enabled: entitlement.enabled,
        limitInt: entitlement.limit,
      })),
    },
    usageRecords: {
      create: [
        { tenantId, usageKey: "VENUES", quantity: 1 },
        { tenantId, usageKey: "PUBLISHED_SITES", quantity: 1 },
        { tenantId, usageKey: "STAFF_SEATS", quantity: 5 },
      ],
    },
  },
});

await prisma.organizationBillingProfile.create({
  data: {
    id: "demo-billing-profile",
    tenantId,
    legalName: "Restaurant Olive Berlin GmbH",
    billingEmail: "billing@restaurantolive.example",
    addressLine1: "Musterstraße 27",
    postalCode: "10435",
    city: "Berlin",
    countryCode: "DE",
    vatId: "DE123456789",
  },
});

await prisma.billingInvoice.createMany({
  data: [
    {
      id: "demo-invoice-2026-06",
      tenantId,
      subscriptionId: "demo-subscription",
      number: "RF-2026-0061",
      status: "PAID",
      amountMinor: 6900,
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      issuedAt: new Date("2026-06-01T00:00:00.000Z"),
      dueAt: new Date("2026-06-08T00:00:00.000Z"),
      paidAt: new Date("2026-06-01T09:15:00.000Z"),
    },
    {
      id: "demo-invoice-2026-07",
      tenantId,
      subscriptionId: "demo-subscription",
      number: "RF-2026-0074",
      status: "PAID",
      amountMinor: 6900,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      issuedAt: new Date("2026-07-01T00:00:00.000Z"),
      dueAt: new Date("2026-07-08T00:00:00.000Z"),
      paidAt: new Date("2026-07-01T08:42:00.000Z"),
    },
    {
      id: "demo-invoice-2026-08",
      tenantId,
      subscriptionId: "demo-subscription",
      number: "RF-2026-0088",
      status: "PAID",
      amountMinor: 6900,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      issuedAt: new Date("2026-08-01T00:00:00.000Z"),
      dueAt: new Date("2026-08-08T00:00:00.000Z"),
      paidAt: new Date("2026-08-01T10:03:00.000Z"),
    },
  ],
});

await prisma.venue.create({
  data: {
    id: venueId,
    tenantId,
    name: "Restaurant Olive",
    slug: "restaurant-olive",
    pickupLeadMinutes: 20, // Demo value only. Real venues must configure this.
    defaultLocale: Locale.SQ,
    defaultServiceMode: "ORDER_AND_CONFIRM",
  },
});

await prisma.deliveryZone.create({
  data: {
    id: "demo-delivery-zone-berlin",
    tenantId,
    venueId,
    name: "Berlin center",
    postalPrefixes: ["10"],
    feeMinor: 300,
    minimumOrderMinor: 1000,
  },
});

const websiteCopy = {
  EN: {
    heroTitle: "An Italian evening, made for Berlin.",
    heroSubtitle:
      "Seasonal ingredients, handmade pasta and warm hospitality in the heart of the city.",
    storyTitle: "A table inspired by Italy",
    storyBody:
      "Restaurant Olive brings regional Italian cooking into a relaxed neighborhood setting. Our kitchen follows the seasons, our pasta is made by hand, and every table is welcomed like a regular.",
    seoTitle: "Restaurant Olive — Italian restaurant in Berlin",
    seoDescription:
      "Discover handmade pasta, seasonal Italian dishes and warm hospitality at Restaurant Olive in Berlin.",
  },
  DE: {
    heroTitle: "Ein italienischer Abend mitten in Berlin.",
    heroSubtitle:
      "Saisonale Zutaten, handgemachte Pasta und herzliche Gastfreundschaft im Herzen der Stadt.",
    storyTitle: "Ein Tisch, inspiriert von Italien",
    storyBody:
      "Restaurant Olive bringt regionale italienische Küche in ein entspanntes Nachbarschaftslokal. Unsere Küche folgt den Jahreszeiten, die Pasta wird von Hand gemacht und jeder Tisch wird wie ein Stammgast begrüßt.",
    seoTitle: "Restaurant Olive — Italienisches Restaurant in Berlin",
    seoDescription:
      "Handgemachte Pasta, saisonale italienische Gerichte und herzliche Gastfreundschaft in der Restaurant Olive in Berlin.",
  },
  IT: {
    heroTitle: "Una serata italiana nel cuore di Berlino.",
    heroSubtitle:
      "Ingredienti di stagione, pasta fatta a mano e un’ospitalità autentica.",
    storyTitle: "Una tavola ispirata all’Italia",
    storyBody:
      "Restaurant Olive porta la cucina regionale italiana in un ambiente di quartiere rilassato. Seguiamo le stagioni, prepariamo la pasta a mano e accogliamo ogni tavolo come un cliente abituale.",
    seoTitle: "Restaurant Olive — Ristorante italiano a Berlino",
    seoDescription:
      "Scopri pasta fatta a mano, piatti italiani stagionali e autentica ospitalità da Restaurant Olive a Berlino.",
  },
  SQ: {
    heroTitle: "Një mbrëmje italiane, në zemër të Berlinit.",
    heroSubtitle:
      "Përbërës sezonalë, pasta të punuara me dorë dhe mikpritje e ngrohtë.",
    storyTitle: "Një tavolinë e frymëzuar nga Italia",
    storyBody:
      "Restaurant Olive sjell gatimin rajonal italian në një ambient të qetë lagjeje. Kuzhina jonë ndjek stinët, pastat bëhen me dorë dhe çdo tavolinë pritet si klient i rregullt.",
    seoTitle: "Restaurant Olive — Restorant italian në Berlin",
    seoDescription:
      "Zbulo pasta të punuara me dorë, pjata italiane sezonale dhe mikpritje të ngrohtë në Restaurant Olive në Berlin.",
  },
} satisfies Record<
  Locale,
  {
    heroTitle: string;
    heroSubtitle: string;
    storyTitle: string;
    storyBody: string;
    seoTitle: string;
    seoDescription: string;
  }
>;

const demoOpeningHours = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
].map((day) => ({
  day,
  closed: day === "MONDAY",
  opensAt: "17:00",
  closesAt: "23:30",
}));

await prisma.venueWebsite.create({
  data: {
    id: "demo-website",
    tenantId,
    venueId,
    publicSlug: "restaurant-olive-demo",
    status: "PUBLISHED",
    primaryColor: "#17382f",
    accentColor: "#ed6b37",
    phone: "+49 30 23125 727",
    contactEmail: "hello@restaurantolive.example",
    address: "Musterstraße 27, 10435 Berlin",
    instagramUrl: "https://instagram.com/restaurantolive",
    openingHours: demoOpeningHours,
    publishedAt: new Date(),
    translations: {
      create: Object.entries(websiteCopy).map(([locale, copy]) => ({
        tenantId,
        venueId,
        locale: locale as Locale,
        ...copy,
      })),
    },
  },
});

await prisma.websitePublicationRevision.create({
  data: {
    id: "demo-website-revision-1",
    tenantId,
    venueId,
    websiteId: "demo-website",
    revision: 1,
    publishedByUserId: "demo-owner",
    publishedByMembershipId: "demo-owner-membership",
    publishedAt: new Date("2026-08-07T18:00:00.000Z"),
    snapshot: {
      publicSlug: "restaurant-olive-demo",
      primaryColor: "#17382f",
      accentColor: "#ed6b37",
      logoUrl: null,
      heroImageUrl: null,
      phone: "+49 30 23125 727",
      contactEmail: "hello@restaurantolive.example",
      address: "Musterstraße 27, 10435 Berlin",
      instagramUrl: "https://instagram.com/restaurantolive",
      facebookUrl: null,
      openingHours: demoOpeningHours,
      translations: Object.entries(websiteCopy).map(([locale, copy]) => ({
        locale: locale.toLowerCase(),
        ...copy,
      })),
    },
  },
});

const passwordHash = await hashPassword("Demo1234!");
await prisma.user.create({
  data: {
    id: "demo-owner",
    tenantId,
    email: "owner@flowgastronomie.local",
    displayName: "Demo Owner",
    passwordHash,
  },
});

await prisma.membership.create({
  data: {
    id: "demo-owner-membership",
    tenantId,
    venueId,
    userId: "demo-owner",
    role: "OWNER",
  },
});

await prisma.staffProfile.create({
  data: {
    id: "demo-owner-profile",
    tenantId,
    venueId,
    userId: "demo-owner",
    membershipId: "demo-owner-membership",
    preferredLocale: Locale.SQ,
    employeeRef: "OWN-001",
  },
});

await prisma.user.create({
  data: {
    id: "demo-manager",
    tenantId,
    email: "manager@flowgastronomie.local",
    displayName: "Demo Manager",
    passwordHash,
  },
});

await prisma.membership.create({
  data: {
    id: "demo-manager-membership",
    tenantId,
    venueId,
    userId: "demo-manager",
    role: "MANAGER",
  },
});

await prisma.staffProfile.create({
  data: {
    id: "demo-manager-profile",
    tenantId,
    venueId,
    userId: "demo-manager",
    membershipId: "demo-manager-membership",
    preferredLocale: Locale.SQ,
    employeeRef: "MGR-001",
  },
});

await prisma.user.createMany({
  data: [
    {
      id: "demo-waiter",
      tenantId,
      email: "waiter@flowgastronomie.local",
      displayName: "Elira Hoxha",
      passwordHash,
    },
    {
      id: "demo-bar",
      tenantId,
      email: "bar@flowgastronomie.local",
      displayName: "Marco Bianchi",
      passwordHash,
    },
    {
      id: "demo-kitchen",
      tenantId,
      email: "kitchen@flowgastronomie.local",
      displayName: "Arben Kola",
      passwordHash,
    },
  ],
});

await prisma.membership.createMany({
  data: [
    {
      id: "demo-waiter-membership",
      tenantId,
      venueId,
      userId: "demo-waiter",
      role: "WAITER",
    },
    {
      id: "demo-bar-membership",
      tenantId,
      venueId,
      userId: "demo-bar",
      role: "BAR",
    },
    {
      id: "demo-kitchen-membership",
      tenantId,
      venueId,
      userId: "demo-kitchen",
      role: "KITCHEN",
    },
  ],
});

await prisma.staffProfile.createMany({
  data: [
    {
      id: "demo-waiter-profile",
      tenantId,
      venueId,
      userId: "demo-waiter",
      membershipId: "demo-waiter-membership",
      preferredLocale: Locale.SQ,
      employeeRef: "SRV-007",
    },
    {
      id: "demo-bar-profile",
      tenantId,
      venueId,
      userId: "demo-bar",
      membershipId: "demo-bar-membership",
      preferredLocale: Locale.IT,
      employeeRef: "BAR-002",
    },
    {
      id: "demo-kitchen-profile",
      tenantId,
      venueId,
      userId: "demo-kitchen",
      membershipId: "demo-kitchen-membership",
      preferredLocale: Locale.DE,
      employeeRef: "KIT-003",
    },
  ],
});

await prisma.venueLaunch.create({
  data: {
    id: "demo-venue-launch",
    tenantId,
    venueId,
    rehearsalConfirmedAt: new Date("2026-08-07T18:30:00.000Z"),
    rehearsalByUserId: "demo-manager",
  },
});

await prisma.retentionRun.create({
  data: {
    status: "COMPLETED",
    completedAt: new Date(),
    summary: {
      onlineOrdersRedacted: 0,
      reservationsRedacted: 0,
      customerProfilesDeleted: 0,
      messagesDeleted: 0,
      guestTokensRedacted: 0,
      staffSessionsDeleted: 0,
    },
  },
});

await prisma.area.create({
  data: {
    id: "demo-area-terrace",
    tenantId,
    venueId,
    name: "Terrace",
  },
});

await prisma.diningTable.create({
  data: {
    id: "demo-table-07",
    tenantId,
    venueId,
    areaId: "demo-area-terrace",
    label: "07",
    qrTokenHash: hashQrToken("demo-table-07"),
  },
});

await prisma.staffShift.create({
  data: {
    id: "demo-waiter-shift",
    tenantId,
    venueId,
    userId: "demo-waiter",
    membershipId: "demo-waiter-membership",
    activeShiftKey: "demo-venue:demo-waiter",
    openingNote: "Terrace service",
    assignments: {
      create: {
        id: "demo-table-assignment-07",
        tenantId,
        venueId,
        tableId: "demo-table-07",
        activeTableKey: "demo-table-07",
      },
    },
  },
});

await prisma.staffShift.createMany({
  data: [
    {
      id: "demo-bar-shift",
      tenantId,
      venueId,
      userId: "demo-bar",
      membershipId: "demo-bar-membership",
      activeShiftKey: "demo-venue:demo-bar",
      openingNote: "Bar production",
    },
    {
      id: "demo-kitchen-shift",
      tenantId,
      venueId,
      userId: "demo-kitchen",
      membershipId: "demo-kitchen-membership",
      activeShiftKey: "demo-venue:demo-kitchen",
      openingNote: "Kitchen production",
    },
  ],
});

await prisma.menuCategory.create({
  data: {
    id: categoryId,
    tenantId,
    venueId,
    sortOrder: 1,
    published: true,
  },
});

await prisma.menuCategoryTranslation.createMany({
  data: Object.entries(categoryNames).map(([locale, name]) => ({
    tenantId,
    venueId,
    categoryId,
    locale: locale as Locale,
    name,
  })),
});

for (const [sortOrder, product] of products.entries()) {
  await prisma.product.create({
    data: {
      id: product.id,
      tenantId,
      venueId,
      categoryId,
      priceMinor: product.priceMinor,
      station: product.station,
      sortOrder,
      available: true,
      published: true,
    },
  });

  await prisma.productTranslation.createMany({
    data: Object.entries(product.translations).map(
      ([locale, [name, description]]) => ({
        tenantId,
        venueId,
        productId: product.id,
        locale: locale as Locale,
        name,
        description,
      }),
    ),
  });
}

const showcaseCategories = [
  {
    id: "demo-category-starters",
    names: {
      EN: "Starters",
      DE: "Vorspeisen",
      IT: "Antipasti",
      SQ: "Parapjata",
    },
  },
  {
    id: "demo-category-pizza",
    names: {
      EN: "Stone-baked pizza",
      DE: "Steinofenpizza",
      IT: "Pizza al forno",
      SQ: "Pica në furrë guri",
    },
  },
  {
    id: "demo-category-desserts",
    names: { EN: "Desserts", DE: "Desserts", IT: "Dolci", SQ: "Ëmbëlsira" },
  },
  {
    id: "demo-category-bar",
    names: {
      EN: "Bar & cocktails",
      DE: "Bar & Cocktails",
      IT: "Bar e cocktail",
      SQ: "Bar dhe kokteje",
    },
  },
] as const;

for (const [index, category] of showcaseCategories.entries()) {
  await prisma.menuCategory.create({
    data: {
      id: category.id,
      tenantId,
      venueId,
      sortOrder: index + 1,
      published: true,
      translations: {
        create: Object.entries(category.names).map(([locale, name]) => ({
          tenantId,
          venueId,
          locale: locale as Locale,
          name,
        })),
      },
    },
  });
}

const showcaseProducts = [
  [
    "demo-product-carpaccio",
    "demo-category-starters",
    1490,
    StationType.KITCHEN,
    [
      "Beef carpaccio",
      "Rindercarpaccio",
      "Carpaccio di manzo",
      "Karpacio viçi",
    ],
    [
      "Truffle cream, capers, parmigiano",
      "Trüffelcreme, Kapern, Parmigiano",
      "Crema al tartufo, capperi, parmigiano",
      "Krem tartufi, kaperi, parmigiano",
    ],
  ],
  [
    "demo-product-arancini",
    "demo-category-starters",
    990,
    StationType.KITCHEN,
    [
      "Truffle arancini",
      "Trüffel-Arancini",
      "Arancini al tartufo",
      "Arancini me tartuf",
    ],
    [
      "Mozzarella heart, tomato fondue",
      "Mozzarellakern, Tomatenfondue",
      "Cuore di mozzarella, fonduta di pomodoro",
      "Zemër mozzarella, fondue domateje",
    ],
  ],
  [
    "demo-product-calamari",
    "demo-category-starters",
    1390,
    StationType.KITCHEN,
    [
      "Crispy calamari",
      "Knusprige Calamari",
      "Calamari croccanti",
      "Kallamarë krokantë",
    ],
    [
      "Lemon, parsley, roasted garlic aioli",
      "Zitrone, Petersilie, Knoblauch-Aioli",
      "Limone, prezzemolo, aioli all'aglio",
      "Limon, majdanoz, aioli me hudhër",
    ],
  ],
  [
    "demo-product-margherita",
    "demo-category-pizza",
    1290,
    StationType.KITCHEN,
    ["Margherita 2.0", "Margherita 2.0", "Margherita 2.0", "Margherita 2.0"],
    [
      "San Marzano, fior di latte, basil",
      "San Marzano, Fior di latte, Basilikum",
      "San Marzano, fior di latte, basilico",
      "San Marzano, fior di latte, borzilok",
    ],
  ],
  [
    "demo-product-diavola",
    "demo-category-pizza",
    1590,
    StationType.KITCHEN,
    ["Diavola", "Diavola", "Diavola", "Diavola"],
    [
      "Spicy salami, nduja, smoked provola",
      "Pikante Salami, Nduja, Provola",
      "Salame piccante, nduja, provola",
      "Sallam pikant, nduja, provola",
    ],
  ],
  [
    "demo-product-tartufo-pizza",
    "demo-category-pizza",
    1890,
    StationType.KITCHEN,
    ["Tartufo bianco", "Tartufo bianco", "Tartufo bianco", "Tartufo bianco"],
    [
      "Mushrooms, truffle, taleggio",
      "Pilze, Trüffel, Taleggio",
      "Funghi, tartufo, taleggio",
      "Kërpudha, tartuf, taleggio",
    ],
  ],
  [
    "demo-product-tiramisu",
    "demo-category-desserts",
    850,
    StationType.DESSERT,
    [
      "Tiramisù classico",
      "Klassisches Tiramisù",
      "Tiramisù classico",
      "Tiramisù klasik",
    ],
    [
      "Espresso, mascarpone, cocoa",
      "Espresso, Mascarpone, Kakao",
      "Espresso, mascarpone, cacao",
      "Espresso, mascarpone, kakao",
    ],
  ],
  [
    "demo-product-panna-cotta",
    "demo-category-desserts",
    790,
    StationType.DESSERT,
    [
      "Vanilla panna cotta",
      "Vanille-Panna-cotta",
      "Panna cotta alla vaniglia",
      "Panna cotta me vanilje",
    ],
    [
      "Forest berries, pistachio",
      "Waldbeeren, Pistazie",
      "Frutti di bosco, pistacchio",
      "Manaferra, fëstëk",
    ],
  ],
  [
    "demo-product-sgroppino",
    "demo-category-desserts",
    950,
    StationType.BAR,
    [
      "Lemon sgroppino",
      "Zitronen-Sgroppino",
      "Sgroppino al limone",
      "Sgroppino me limon",
    ],
    [
      "Lemon sorbet, prosecco, vodka",
      "Zitronensorbet, Prosecco, Wodka",
      "Sorbetto al limone, prosecco, vodka",
      "Sorbet limoni, prosecco, vodka",
    ],
  ],
  [
    "demo-product-negroni",
    "demo-category-bar",
    1250,
    StationType.BAR,
    [
      "Barrel-aged Negroni",
      "Fassgereifter Negroni",
      "Negroni affinato in botte",
      "Negroni i stazhonuar",
    ],
    [
      "Gin, bitter, vermouth rosso",
      "Gin, Bitter, roter Wermut",
      "Gin, bitter, vermouth rosso",
      "Xhin, bitter, vermut i kuq",
    ],
  ],
  [
    "demo-product-spritz",
    "demo-category-bar",
    1050,
    StationType.BAR,
    [
      "Mediterranean spritz",
      "Mediterraner Spritz",
      "Spritz mediterraneo",
      "Spritz mesdhetar",
    ],
    [
      "Bergamot, prosecco, soda",
      "Bergamotte, Prosecco, Soda",
      "Bergamotto, prosecco, soda",
      "Bergamot, prosecco, soda",
    ],
  ],
  [
    "demo-product-zero",
    "demo-category-bar",
    850,
    StationType.BAR,
    [
      "Zero-proof garden",
      "Alkoholfreier Garden",
      "Garden analcolico",
      "Garden pa alkool",
    ],
    [
      "Basil, cucumber, lime, tonic",
      "Basilikum, Gurke, Limette, Tonic",
      "Basilico, cetriolo, lime, tonica",
      "Borzilok, kastravec, limetë, tonik",
    ],
  ],
] as const;

for (const [sortOrder, product] of showcaseProducts.entries()) {
  const [id, productCategoryId, priceMinor, station, names, descriptions] =
    product;
  await prisma.product.create({
    data: {
      id,
      tenantId,
      venueId,
      categoryId: productCategoryId,
      priceMinor,
      station,
      sortOrder,
      available: true,
      published: true,
      translations: {
        create: (["EN", "DE", "IT", "SQ"] as const).map(
          (locale, localeIndex) => ({
            tenantId,
            venueId,
            locale,
            name: names[localeIndex]!,
            description: descriptions[localeIndex]!,
          }),
        ),
      },
    },
  });
}

await prisma.productAllergen.createMany({
  data: [
    ["demo-product-burrata", AllergenCode.MILK],
    ["demo-product-rigatoni", AllergenCode.GLUTEN],
    ["demo-product-rigatoni", AllergenCode.EGGS],
    ["demo-product-rigatoni", AllergenCode.MILK],
    ["demo-product-seabass", AllergenCode.FISH],
    ["demo-product-carpaccio", AllergenCode.MILK],
    ["demo-product-arancini", AllergenCode.GLUTEN],
    ["demo-product-arancini", AllergenCode.MILK],
    ["demo-product-calamari", AllergenCode.MOLLUSCS],
    ["demo-product-calamari", AllergenCode.EGGS],
    ["demo-product-margherita", AllergenCode.GLUTEN],
    ["demo-product-margherita", AllergenCode.MILK],
    ["demo-product-diavola", AllergenCode.GLUTEN],
    ["demo-product-diavola", AllergenCode.MILK],
    ["demo-product-tartufo-pizza", AllergenCode.GLUTEN],
    ["demo-product-tartufo-pizza", AllergenCode.MILK],
    ["demo-product-tiramisu", AllergenCode.GLUTEN],
    ["demo-product-tiramisu", AllergenCode.EGGS],
    ["demo-product-tiramisu", AllergenCode.MILK],
    ["demo-product-panna-cotta", AllergenCode.MILK],
    ["demo-product-panna-cotta", AllergenCode.NUTS],
    ["demo-product-negroni", AllergenCode.SULPHITES],
    ["demo-product-spritz", AllergenCode.SULPHITES],
  ].map(([productId, allergen]) => ({
    productId: productId as string,
    allergen: allergen as AllergenCode,
  })),
});

const localizedNames = (names: readonly [string, string, string, string]) =>
  (["EN", "DE", "IT", "SQ"] as const).map((locale, index) => ({
    locale,
    name: names[index]!,
  }));

await prisma.productVariant.create({
  data: {
    id: "variant-pizza-regular",
    tenantId,
    venueId,
    productId: "demo-product-margherita",
    isDefault: true,
    translations: {
      create: localizedNames([
        "Regular 30 cm",
        "Normal 30 cm",
        "Normale 30 cm",
        "Normale 30 cm",
      ]),
    },
  },
});
await prisma.productVariant.create({
  data: {
    id: "variant-pizza-large",
    tenantId,
    venueId,
    productId: "demo-product-margherita",
    priceDeltaMinor: 450,
    sortOrder: 1,
    translations: {
      create: localizedNames([
        "Large 40 cm",
        "Groß 40 cm",
        "Grande 40 cm",
        "E madhe 40 cm",
      ]),
    },
  },
});

await prisma.productModifierGroup.create({
  data: {
    id: "modifier-pizza-extras",
    tenantId,
    venueId,
    productId: "demo-product-margherita",
    maxSelect: 3,
    translations: {
      create: localizedNames([
        "Extra toppings",
        "Extra Beläge",
        "Ingredienti extra",
        "Shtesa ekstra",
      ]),
    },
    options: {
      create: [
        {
          id: "option-burrata",
          tenantId,
          venueId,
          priceDeltaMinor: 350,
          translations: {
            create: localizedNames([
              "Burrata",
              "Burrata",
              "Burrata",
              "Burrata",
            ]),
          },
        },
        {
          id: "option-prosciutto",
          tenantId,
          venueId,
          priceDeltaMinor: 300,
          sortOrder: 1,
          translations: {
            create: localizedNames([
              "Prosciutto",
              "Prosciutto",
              "Prosciutto",
              "Proshutë",
            ]),
          },
        },
        {
          id: "option-mushrooms",
          tenantId,
          venueId,
          priceDeltaMinor: 180,
          sortOrder: 2,
          translations: {
            create: localizedNames([
              "Mushrooms",
              "Pilze",
              "Funghi",
              "Kërpudha",
            ]),
          },
        },
      ],
    },
  },
});

await prisma.productModifierGroup.create({
  data: {
    id: "modifier-negroni-garnish",
    tenantId,
    venueId,
    productId: "demo-product-negroni",
    minSelect: 1,
    maxSelect: 1,
    translations: {
      create: localizedNames([
        "Choose garnish",
        "Garnitur wählen",
        "Scegli guarnizione",
        "Zgjidh garniturën",
      ]),
    },
    options: {
      create: [
        {
          id: "option-orange",
          tenantId,
          venueId,
          translations: {
            create: localizedNames([
              "Orange",
              "Orange",
              "Arancia",
              "Portokall",
            ]),
          },
        },
        {
          id: "option-rosemary",
          tenantId,
          venueId,
          sortOrder: 1,
          translations: {
            create: localizedNames([
              "Smoked rosemary",
              "Geräucherter Rosmarin",
              "Rosmarino affumicato",
              "Rozmarinë e tymosur",
            ]),
          },
        },
      ],
    },
  },
});

await prisma.tableSession.create({
  data: {
    id: "demo-live-session-07",
    tenantId,
    venueId,
    tableId: "demo-table-07",
    activeTableKey: "demo-table-07",
    guests: {
      create: {
        id: "demo-live-guest-07",
        tenantId,
        venueId,
        tokenHash: hashQrToken("demo-live-guest-07"),
      },
    },
  },
});

await prisma.order.create({
  data: {
    id: "demo-live-order-07",
    tenantId,
    venueId,
    tableSessionId: "demo-live-session-07",
    guestId: "demo-live-guest-07",
    idempotencyKey: "demo-live-order-07",
    totalMinor: 3340,
    statusEvents: {
      create: {
        tenantId,
        venueId,
        status: "NEW",
        kind: "INITIAL",
      },
    },
    items: {
      create: [
        {
          id: "demo-live-order-item-07",
          productId: "demo-product-margherita",
          productName: "Margherita 2.0",
          quantity: 1,
          unitPriceMinor: 2090,
          station: StationType.KITCHEN,
          variantId: "variant-pizza-large",
          variantName: "E madhe 40 cm + Burrata",
        },
        {
          id: "demo-live-order-item-bar-07",
          productId: "demo-product-negroni",
          productName: "Barrel-aged Negroni",
          quantity: 1,
          unitPriceMinor: 1250,
          station: StationType.BAR,
        },
      ],
    },
    productionTickets: {
      create: [
        {
          id: "demo-ticket-kitchen-07",
          tenantId,
          venueId,
          station: StationType.KITCHEN,
        },
        {
          id: "demo-ticket-bar-07",
          tenantId,
          venueId,
          station: StationType.BAR,
        },
      ],
    },
  },
});

await prisma.serviceSignal.createMany({
  data: [
    {
      id: "demo-signal-order-07",
      tenantId,
      venueId,
      tableId: "demo-table-07",
      tableSessionId: "demo-live-session-07",
      guestId: "demo-live-guest-07",
      orderId: "demo-live-order-07",
      type: "NEW_ORDER",
    },
    {
      id: "demo-signal-waiter-07",
      tenantId,
      venueId,
      tableId: "demo-table-07",
      tableSessionId: "demo-live-session-07",
      guestId: "demo-live-guest-07",
      idempotencyKey: "demo-waiter-call-07",
      type: "WAITER_CALL",
    },
    {
      id: "demo-signal-water-07",
      tenantId,
      venueId,
      tableId: "demo-table-07",
      tableSessionId: "demo-live-session-07",
      guestId: "demo-live-guest-07",
      idempotencyKey: "demo-water-call-07",
      type: "WATER_REQUEST",
      assignedMembershipId: "demo-waiter-membership",
      assignedUserId: "demo-waiter",
      assignedShiftId: "demo-waiter-shift",
      assignedByUserId: "demo-manager",
      claimedAt: new Date(),
    },
    {
      id: "demo-signal-bill-07",
      tenantId,
      venueId,
      tableId: "demo-table-07",
      tableSessionId: "demo-live-session-07",
      guestId: "demo-live-guest-07",
      idempotencyKey: "demo-bill-call-07",
      type: "BILL_REQUEST",
    },
  ],
});

// Explicit test/demo configuration, not a statement of statutory VAT rates.
for (const [code, rateBasisPoints, station] of [
  ["DEMO_TEST_10", 1000, "KITCHEN"],
  ["DEMO_TEST_20", 2000, "BAR"],
  ["DEMO_TEST_10_DESSERT", 1000, "DESSERT"],
] as const) {
  const tax = await prisma.taxCategory.create({
    data: { tenantId, venueId, code, rateBasisPoints },
  });
  await prisma.product.updateMany({
    where: { tenantId, venueId, station },
    data: { taxCategoryId: tax.id },
  });
}
console.log("Demo data created.");
console.log("Public QR token: demo-table-07");

await prisma.$disconnect();

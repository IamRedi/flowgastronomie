import { z } from "zod";

// Workflow blueprints are independent of commercial products/subscription tiers.
export const businessProfileIds = [
  "PIZZERIA",
  "RESTAURANT",
  "BAKERY",
  "DONER",
  "CAFE",
  "BAR",
  "IMBISS",
  "GENERIC",
  "FAST_FOOD",
  "ICE_CAFE",
] as const;
const category = z.strictObject({
  key: z.string().regex(/^[a-z][a-z-]*$/),
  translations: z.strictObject({
    en: z.string().trim().min(1).max(80),
    de: z.string().trim().min(1).max(80),
    it: z.string().trim().min(1).max(80),
    sq: z.string().trim().min(1).max(80),
  }),
});
export const businessProfileTemplateSchema = z.strictObject({
  id: z.enum(businessProfileIds),
  version: z.union([z.literal(2), z.literal(3)]),
  name: z.string().min(1).max(100),
  categories: z.array(category).max(12),
  stations: z
    .array(z.enum(["KITCHEN", "BAR", "DESSERT"]))
    .min(1)
    .max(3),
  variants: z.array(z.string().min(1).max(80)).max(8),
  modifiers: z.array(z.string().min(1).max(80)).max(12),
  suggestedServiceMode: z.enum([
    "MENU_ONLY",
    "CALL_AND_REQUEST",
    "ORDER_AND_CONFIRM",
  ]),
  suggestedModules: z
    .array(
      z.enum(["PUBLIC_WEBSITE", "QR_MENU", "ONLINE_ORDERING", "RESERVATIONS"]),
    )
    .max(4),
  website: z.strictObject({
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/),
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/),
  }),
  pos: z.strictObject({
    layout: z.enum(["GRID", "LIST"]),
    showPhotos: z.boolean(),
  }),
  inventoryCategories: z.array(z.string().max(80)).max(12),
  checklist: z.array(z.string().max(120)).max(12),
});
export type BusinessProfileTemplate = z.infer<
  typeof businessProfileTemplateSchema
>;
export type BusinessProfileId = BusinessProfileTemplate["id"];
// Stable keys do not change when a translation is edited. Shared categories use
// the same explicit translations across profiles, never a locale fallback.
const categoryTranslations = {
  burgers: { en: "Burgers", de: "Burger", it: "Hamburger", sq: "Burgerë" },
  gelato: { en: "Gelato", de: "Eis", it: "Gelato", sq: "Akullore" },
  waffles: { en: "Waffles", de: "Waffeln", it: "Waffle", sq: "Vafle" },
  pizza: { en: "Pizza", de: "Pizza", it: "Pizza", sq: "Pica" },
  pasta: { en: "Pasta", de: "Pasta", it: "Pasta", sq: "Makarona" },
  salads: { en: "Salads", de: "Salate", it: "Insalate", sq: "Sallata" },
  desserts: { en: "Desserts", de: "Desserts", it: "Dolci", sq: "Ëmbëlsira" },
  drinks: { en: "Drinks", de: "Getränke", it: "Bevande", sq: "Pije" },
  starters: {
    en: "Starters",
    de: "Vorspeisen",
    it: "Antipasti",
    sq: "Parapjata",
  },
  mains: {
    en: "Mains",
    de: "Hauptgerichte",
    it: "Piatti principali",
    sq: "Pjata kryesore",
  },
  bread: { en: "Bread", de: "Brot", it: "Pane", sq: "Bukë" },
  pastries: {
    en: "Pastries",
    de: "Gebäck",
    it: "Prodotti di pasticceria",
    sq: "Pasta të ëmbla",
  },
  cakes: { en: "Cakes", de: "Kuchen", it: "Torte", sq: "Torta" },
  sandwiches: {
    en: "Sandwiches",
    de: "Belegte Brote",
    it: "Panini",
    sq: "Sanduiçe",
  },
  "hot-drinks": {
    en: "Hot drinks",
    de: "Heiße Getränke",
    it: "Bevande calde",
    sq: "Pije të ngrohta",
  },
  "cold-drinks": {
    en: "Cold drinks",
    de: "Kalte Getränke",
    it: "Bevande fredde",
    sq: "Pije të ftohta",
  },
  doner: { en: "Doner kebab", de: "Döner", it: "Kebab", sq: "Doner" },
  durum: { en: "Kebab wraps", de: "Dürüm", it: "Piadine kebab", sq: "Durum" },
  box: {
    en: "Kebab boxes",
    de: "Dönerboxen",
    it: "Kebab in box",
    sq: "Doner në kuti",
  },
  teller: {
    en: "Kebab plates",
    de: "Dönerteller",
    it: "Piatti kebab",
    sq: "Doner në pjatë",
  },
  sides: { en: "Sides", de: "Beilagen", it: "Contorni", sq: "Shoqëruese" },
  coffee: { en: "Coffee", de: "Kaffee", it: "Caffè", sq: "Kafe" },
  tea: { en: "Tea", de: "Tee", it: "Tè", sq: "Çaj" },
  snacks: {
    en: "Snacks",
    de: "Snacks",
    it: "Spuntini",
    sq: "Ushqime të lehta",
  },
  cocktails: {
    en: "Cocktails",
    de: "Cocktails",
    it: "Cocktail",
    sq: "Kokteje",
  },
  beer: { en: "Beer", de: "Bier", it: "Birra", sq: "Birrë" },
  wine: { en: "Wine", de: "Wein", it: "Vino", sq: "Verë" },
  "soft-drinks": {
    en: "Soft drinks",
    de: "Erfrischungsgetränke",
    it: "Bibite analcoliche",
    sq: "Pije joalkoolike",
  },
} satisfies Record<string, z.infer<typeof category>["translations"]>;
const definitions: Record<
  BusinessProfileId,
  {
    name: string;
    categories: (keyof typeof categoryTranslations)[];
    variants?: string[];
    modifiers?: string[];
    stations?: BusinessProfileTemplate["stations"];
  }
> = {
  PIZZERIA: {
    name: "Pizzeria Aurora",
    categories: ["pizza", "pasta", "salads", "desserts", "drinks"],
    variants: ["Size / diameter"],
    modifiers: ["Extra cheese", "Toppings", "Sauce"],
    stations: ["KITCHEN", "BAR"],
  },
  RESTAURANT: {
    name: "Restaurant Olive",
    categories: ["starters", "mains", "salads", "desserts", "drinks"],
    stations: ["KITCHEN", "DESSERT", "BAR"],
  },
  BAKERY: {
    name: "Bäckerei Morgen",
    categories: [
      "bread",
      "pastries",
      "cakes",
      "sandwiches",
      "hot-drinks",
      "cold-drinks",
    ],
    stations: ["KITCHEN", "BAR"],
  },
  DONER: {
    name: "Grill Haus",
    stations: ["KITCHEN", "BAR"],
    categories: ["doner", "durum", "box", "teller", "sides", "drinks"],
    modifiers: ["Meat", "Sauce", "Vegetables", "Cheese", "Spicy"],
  },
  CAFE: {
    name: "Café Flora",
    categories: ["coffee", "tea", "pastries", "snacks", "cold-drinks"],
    stations: ["BAR", "KITCHEN"],
  },
  BAR: {
    name: "Bar Ember",
    categories: ["cocktails", "beer", "wine", "soft-drinks", "snacks"],
    stations: ["BAR", "KITCHEN"],
  },
  IMBISS: {
    name: "Imbiss Ecke",
    stations: ["KITCHEN", "BAR"],
    categories: ["mains", "sandwiches", "sides", "desserts", "drinks"],
    modifiers: ["Sauce", "Extras"],
  },
  FAST_FOOD: {
    name: "FastBite",
    categories: ["burgers", "sandwiches", "sides", "desserts", "drinks"],
    modifiers: ["Sauce", "Extras"],
    stations: ["KITCHEN", "BAR"],
  },
  ICE_CAFE: {
    name: "Eiscafé Luna",
    categories: ["gelato", "waffles", "desserts", "coffee", "cold-drinks"],
    variants: ["Scoops"],
    stations: ["DESSERT", "BAR"],
  },
  GENERIC: { name: "Generic Gastronomy", categories: [] },
};
const templates = businessProfileIds.map((id) => {
  const definition = definitions[id];
  return businessProfileTemplateSchema.parse({
    id,
    version: 3,
    name: definition.name,
    categories: definition.categories.map((key) => ({
      key,
      translations: categoryTranslations[key],
    })),
    stations: definition.stations ?? ["KITCHEN"],
    variants: definition.variants ?? [],
    modifiers: definition.modifiers ?? [],
    suggestedServiceMode: "MENU_ONLY",
    suggestedModules: ["PUBLIC_WEBSITE", "QR_MENU"],
    website: { primaryColor: "#17382f", accentColor: "#c39b62" },
    pos: { layout: "GRID", showPhotos: true },
    inventoryCategories: [],
    checklist: [
      "Review business identity",
      "Add your menu and prices",
      "Upload and approve media",
      "Configure staff and service",
      "Review before activation",
    ],
  });
});
export function businessProfileCatalog(): BusinessProfileTemplate[] {
  return structuredClone(templates);
}
export function businessProfileDefaults(
  id: BusinessProfileId,
  applyCategories = true,
): BusinessProfileTemplate {
  const result = businessProfileCatalog().find((profile) => profile.id === id);
  if (!result) throw new Error("Unknown business profile");
  if (!applyCategories) result.categories = [];
  return result;
}

export const tenantKinds = [
  "REAL",
  "DEMO",
  "LOCAL_PILOT",
  "LEGACY_CI",
] as const;
export type TenantKind = (typeof tenantKinds)[number];
export function businessIdentityLabel(kind: TenantKind) {
  return kind === "DEMO"
    ? "DEMO"
    : kind === "LOCAL_PILOT"
      ? "LOCAL PILOT"
      : kind === "LEGACY_CI"
        ? "DEMO SEED"
        : null;
}

/** Legacy labels remain readable; new clients always register from zero. */
export function assertBusinessProvisionKind(kind: TenantKind) {
  if (kind === "LOCAL_PILOT")
    throw new Error(
      "Precreated local pilots are retired; use public business registration",
    );
}

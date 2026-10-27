import { z } from "zod";
import {
  businessProfileDefaults,
  type BusinessProfileId,
} from "./business-profile";
import { premiumPhotoRecipes } from "./premium-photo-recipes";
import { premiumMenuData } from "./premium-menu-data";

const recipeSignature = (product: {
  name: { en: string };
  description: { en: string };
}) => `${product.name.en}\n${product.description.en}`;
const exactRecipePhotos = new Map(
  Object.values(premiumMenuData)
    .flat()
    .filter((p) => premiumPhotoRecipes.includes(p.key))
    .map((p) => [recipeSignature(p), p.key]),
);
export const premiumLayouts = ["EDITORIAL", "URBAN", "HERITAGE"] as const;
export type PremiumLayout = (typeof premiumLayouts)[number];
export const premiumStyleSelectionSchema = z.strictObject({
  styleId: z.string().regex(/^[a-z_]+-[123]$/),
  version: z.literal(1),
  confirmed: z.literal(true),
  includeSampleMenu: z.boolean(),
});
const packs = [
  {
    profileId: "RESTAURANT",
    version: 1,
    name: "Restaurant Olive",
    tagline: {
      en: "Gather around good food.",
      de: "Gemeinsam gut essen.",
      it: "Il piacere di stare a tavola.",
      sq: "Bashkë rreth tryezës.",
    },
    styles: [
      {
        id: "restaurant-1",
        name: "Rustic Mediterranean",
        layout: "EDITORIAL",
        primaryColor: "#713e2c",
        backgroundColor: "#f8f1e7",
        accentColor: "#c28a58",
      },
      {
        id: "restaurant-2",
        name: "Contemporary Dining",
        layout: "URBAN",
        primaryColor: "#253439",
        backgroundColor: "#f2eee5",
        accentColor: "#bda275",
      },
      {
        id: "restaurant-3",
        name: "Family Heritage",
        layout: "HERITAGE",
        primaryColor: "#405943",
        backgroundColor: "#f6f3e9",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "A Mediterranean-inspired sample table: colourful starters, comforting mains and something sweet to finish.",
      de: "Eine mediterran inspirierte Beispielkarte: bunte Vorspeisen, wohltuende Hauptgerichte und ein süßer Abschluss.",
      it: "Una tavola di esempio ispirata al Mediterraneo: antipasti colorati, piatti conviviali e un dolce finale.",
      sq: "Një tryezë shembull me frymë mesdhetare: parapjata plot ngjyra, pjata kryesore dhe diçka e ëmbël në fund.",
    },
  },
  {
    profileId: "PIZZERIA",
    version: 1,
    name: "Pizzeria Aurora",
    tagline: {
      en: "A little slice of togetherness.",
      de: "Ein Stück Gemeinsamkeit.",
      it: "Una fetta di convivialità.",
      sq: "Një copëz ngrohtësie.",
    },
    styles: [
      {
        id: "pizzeria-1",
        name: "Rustic Italian",
        layout: "EDITORIAL",
        primaryColor: "#873e29",
        backgroundColor: "#fcf2e2",
        accentColor: "#c28a58",
      },
      {
        id: "pizzeria-2",
        name: "Modern Urban",
        layout: "URBAN",
        primaryColor: "#292d30",
        backgroundColor: "#f2eee8",
        accentColor: "#bda275",
      },
      {
        id: "pizzeria-3",
        name: "Family Stone Oven",
        layout: "HERITAGE",
        primaryColor: "#635232",
        backgroundColor: "#fbf4e4",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "An Italian-inspired sample menu, from a simple Margherita to pasta and a shared dessert.",
      de: "Eine italienisch inspirierte Beispielkarte: von Margherita über Pasta bis zum Dessert zum Teilen.",
      it: "Un menu di esempio d’ispirazione italiana, dalla Margherita alla pasta e al dolce da condividere.",
      sq: "Një menu shembull me frymë italiane, nga Margarita te makaronat dhe ëmbëlsirat për t’u ndarë.",
    },
  },
  {
    profileId: "FAST_FOOD",
    version: 1,
    name: "FastBite",
    tagline: {
      en: "Big flavour. Your rhythm.",
      de: "Viel Geschmack. Dein Rhythmus.",
      it: "Grande gusto. Il tuo ritmo.",
      sq: "Shije e madhe. Ritmi yt.",
    },
    styles: [
      {
        id: "fast_food-1",
        name: "Bold Urban",
        layout: "EDITORIAL",
        primaryColor: "#a73525",
        backgroundColor: "#fff3e8",
        accentColor: "#c28a58",
      },
      {
        id: "fast_food-2",
        name: "Clean Express",
        layout: "URBAN",
        primaryColor: "#16324b",
        backgroundColor: "#f6f8fa",
        accentColor: "#bda275",
      },
      {
        id: "fast_food-3",
        name: "Comfort Diner",
        layout: "HERITAGE",
        primaryColor: "#714c20",
        backgroundColor: "#fff4da",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "Burgers, wraps and sides: a sample menu built around a quick, satisfying break.",
      de: "Burger, Wraps und Beilagen: eine Beispielkarte für die schnelle, genussvolle Pause.",
      it: "Hamburger, wrap e contorni: un menu di esempio per una pausa veloce e gustosa.",
      sq: "Burgerë, mbështjellëse dhe shoqëruese: një menu shembull për një pushim të shpejtë e të shijshëm.",
    },
  },
  {
    profileId: "IMBISS",
    version: 1,
    name: "Imbiss Ecke",
    tagline: {
      en: "Your corner. Your favourite bite.",
      de: "Deine Ecke. Dein Lieblingsbissen.",
      it: "Il tuo angolo. Il tuo gusto.",
      sq: "Këndi yt. Shija jote.",
    },
    styles: [
      {
        id: "imbiss-1",
        name: "German Classic",
        layout: "EDITORIAL",
        primaryColor: "#67501d",
        backgroundColor: "#faf1d5",
        accentColor: "#c28a58",
      },
      {
        id: "imbiss-2",
        name: "Berlin Street",
        layout: "URBAN",
        primaryColor: "#7e3b29",
        backgroundColor: "#f1eeea",
        accentColor: "#bda275",
      },
      {
        id: "imbiss-3",
        name: "Warm Lokal",
        layout: "HERITAGE",
        primaryColor: "#284b3b",
        backgroundColor: "#f4efdf",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "A neighbourhood snack-bar concept with currywurst, schnitzel and crisp sides.",
      de: "Ein Imbisskonzept für die Nachbarschaft mit Currywurst, Schnitzel und knusprigen Beilagen.",
      it: "Un’idea di chiosco di quartiere con currywurst, cotoletta e contorni croccanti.",
      sq: "Një koncept lokali lagjeje me salçiçe me kari, shnicel dhe shoqëruese krokante.",
    },
  },
  {
    profileId: "BAKERY",
    version: 1,
    name: "Bäckerei Morgen",
    tagline: {
      en: "Make room for a slow morning.",
      de: "Zeit für einen ruhigen Morgen.",
      it: "Spazio a un mattino lento.",
      sq: "Kohë për një mëngjes të qetë.",
    },
    styles: [
      {
        id: "bakery-1",
        name: "Artisan Craft",
        layout: "EDITORIAL",
        primaryColor: "#68432d",
        backgroundColor: "#faf1e1",
        accentColor: "#c28a58",
      },
      {
        id: "bakery-2",
        name: "Nordic Minimal",
        layout: "URBAN",
        primaryColor: "#38444d",
        backgroundColor: "#f4f5f2",
        accentColor: "#bda275",
      },
      {
        id: "bakery-3",
        name: "Family Bakery",
        layout: "HERITAGE",
        primaryColor: "#78501c",
        backgroundColor: "#fff6df",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "A sample morning collection of breads, buttery pastries, sandwiches and coffee.",
      de: "Eine beispielhafte Morgenauswahl aus Brot, Buttergebäck, belegten Broten und Kaffee.",
      it: "Una collezione mattutina di esempio con pane, sfoglie al burro, panini e caffè.",
      sq: "Një përzgjedhje mëngjesi me bukë, pasta me gjalpë, sanduiçe dhe kafe.",
    },
  },
  {
    profileId: "CAFE",
    version: 1,
    name: "Café Flora",
    tagline: {
      en: "A pause, beautifully made.",
      de: "Eine Pause zum Genießen.",
      it: "Una pausa da assaporare.",
      sq: "Një pushim për ta shijuar.",
    },
    styles: [
      {
        id: "cafe-1",
        name: "Botanical Calm",
        layout: "EDITORIAL",
        primaryColor: "#3b5947",
        backgroundColor: "#f3f2e5",
        accentColor: "#c28a58",
      },
      {
        id: "cafe-2",
        name: "Modern Brunch",
        layout: "URBAN",
        primaryColor: "#804c39",
        backgroundColor: "#fff4ea",
        accentColor: "#bda275",
      },
      {
        id: "cafe-3",
        name: "Parisian Cozy",
        layout: "HERITAGE",
        primaryColor: "#613e39",
        backgroundColor: "#faf0ec",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "Coffee and conversation, a little pastry and time to pause: the Flora sample concept.",
      de: "Kaffee und Gespräche, etwas Gebäck und Zeit zum Verweilen: das Flora-Beispielkonzept.",
      it: "Caffè e conversazioni, un piccolo dolce e tempo per fermarsi: il concept Flora di esempio.",
      sq: "Kafe e biseda, pak ëmbëlsira dhe kohë për pushim: koncepti shembull Flora.",
    },
  },
  {
    profileId: "ICE_CAFE",
    version: 1,
    name: "Eiscafé Luna",
    tagline: {
      en: "Small scoops. Lovely moments.",
      de: "Kleine Kugeln. Schöne Momente.",
      it: "Piccole palline. Grandi momenti.",
      sq: "Kupa të vogla. Çaste të bukura.",
    },
    styles: [
      {
        id: "ice_cafe-1",
        name: "Italian Gelateria",
        layout: "EDITORIAL",
        primaryColor: "#425e39",
        backgroundColor: "#f6f2dc",
        accentColor: "#c28a58",
      },
      {
        id: "ice_cafe-2",
        name: "Pastel Family",
        layout: "URBAN",
        primaryColor: "#365c52",
        backgroundColor: "#eef8f0",
        accentColor: "#bda275",
      },
      {
        id: "ice_cafe-3",
        name: "Dessert Atelier",
        layout: "HERITAGE",
        primaryColor: "#594038",
        backgroundColor: "#f9f0e4",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "A playful sample collection of gelato, warm waffles and sweet little moments.",
      de: "Eine verspielte Beispielauswahl aus Eis, warmen Waffeln und süßen kleinen Momenten.",
      it: "Una collezione giocosa di esempio con gelato, waffle caldi e piccoli momenti dolci.",
      sq: "Një përzgjedhje plot gëzim me akullore, vafle të ngrohta dhe çaste të ëmbla.",
    },
  },
  {
    profileId: "DONER",
    version: 1,
    name: "Grill Haus",
    tagline: {
      en: "Fire, flavour, a place to gather.",
      de: "Feuer, Geschmack, Gemeinsamkeit.",
      it: "Fuoco, gusto, convivialità.",
      sq: "Zjarr, shije, mikpritje.",
    },
    styles: [
      {
        id: "doner-1",
        name: "Classic Grill",
        layout: "EDITORIAL",
        primaryColor: "#703d2a",
        backgroundColor: "#fbefe2",
        accentColor: "#c28a58",
      },
      {
        id: "doner-2",
        name: "Urban Kebab",
        layout: "URBAN",
        primaryColor: "#394229",
        backgroundColor: "#f5f4e6",
        accentColor: "#bda275",
      },
      {
        id: "doner-3",
        name: "Warm Levant",
        layout: "HERITAGE",
        primaryColor: "#705021",
        backgroundColor: "#faf2df",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "A grill-inspired sample menu of döner, wraps, plates and sauces, ready for your own recipes.",
      de: "Eine vom Grill inspirierte Beispielkarte mit Döner, Dürüm, Tellern und Saucen für deine eigenen Rezepte.",
      it: "Un menu di esempio ispirato alla griglia con kebab, piadine, piatti e salse, pronto per le tue ricette.",
      sq: "Një menu shembull me doner, durum, pjata dhe salca, gati për recetat e tua.",
    },
  },
  {
    profileId: "BAR",
    version: 1,
    name: "Bar Ember",
    tagline: {
      en: "Let the evening unfold.",
      de: "Der Abend kann beginnen.",
      it: "Lascia spazio alla serata.",
      sq: "Le të nisë mbrëmja.",
    },
    styles: [
      {
        id: "bar-1",
        name: "Cocktail Noir",
        layout: "EDITORIAL",
        primaryColor: "#3c302b",
        backgroundColor: "#f1e8dc",
        accentColor: "#c28a58",
      },
      {
        id: "bar-2",
        name: "Modern Wine",
        layout: "URBAN",
        primaryColor: "#653745",
        backgroundColor: "#fbf1ed",
        accentColor: "#bda275",
      },
      {
        id: "bar-3",
        name: "Neighborhood Aperitivo",
        layout: "HERITAGE",
        primaryColor: "#4a5434",
        backgroundColor: "#f8f0e0",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "A sample evening menu: spritz, wine, alcohol-free drinks and small plates to share.",
      de: "Eine Beispielkarte für den Abend: Spritz, Wein, alkoholfreie Drinks und kleine Teller zum Teilen.",
      it: "Un menu serale di esempio: spritz, vino, analcolici e piccoli piatti da condividere.",
      sq: "Një menu shembull mbrëmjeje: spritz, verë, pije pa alkool dhe pjata të vogla për t’u ndarë.",
    },
  },
  {
    profileId: "GENERIC",
    version: 1,
    name: "Your business",
    tagline: {
      en: "A place of your own.",
      de: "Ein Ort ganz nach dir.",
      it: "Un posto tutto tuo.",
      sq: "Një vend krejt i yti.",
    },
    styles: [
      {
        id: "generic-1",
        name: "Soft Classic",
        layout: "EDITORIAL",
        primaryColor: "#4d554d",
        backgroundColor: "#f8f5ee",
        accentColor: "#c28a58",
      },
      {
        id: "generic-2",
        name: "Warm Modern",
        layout: "URBAN",
        primaryColor: "#685042",
        backgroundColor: "#fbf2e8",
        accentColor: "#bda275",
      },
      {
        id: "generic-3",
        name: "Contemporary Neutral",
        layout: "HERITAGE",
        primaryColor: "#37454e",
        backgroundColor: "#f2f4f4",
        accentColor: "#b2b783",
      },
    ],
    story: {
      en: "Your story starts here.",
      de: "Hier beginnt deine Geschichte.",
      it: "La tua storia inizia qui.",
      sq: "Historia jote nis këtu.",
    },
  },
] as const;
export const flagshipProfileIds = packs
  .filter((p) => p.profileId !== "GENERIC")
  .map((p) => p.profileId);
export function premiumShowcase(profileId: BusinessProfileId) {
  const pack = packs.find((p) => p.profileId === profileId);
  if (!pack) throw new Error("Unknown showcase");
  const profile = businessProfileDefaults(profileId);
  return structuredClone({
    ...pack,
    categories: profile.categories.map((category) => ({
      ...category,
      products: premiumMenuData[
        (profileId === "IMBISS" && category.key === "mains"
          ? "imbiss-mains"
          : category.key) as keyof typeof premiumMenuData
      ].map((product) => ({
        ...product,
        photoKey: exactRecipePhotos.get(recipeSignature(product)) ?? null,
        station: ([
          "coffee",
          "tea",
          "drinks",
          "hot-drinks",
          "cold-drinks",
          "cocktails",
          "beer",
          "wine",
          "soft-drinks",
        ].includes(category.key)
          ? "BAR"
          : ["desserts", "gelato", "waffles", "cakes"].includes(category.key) &&
              profile.stations.includes("DESSERT")
            ? "DESSERT"
            : "KITCHEN") as "BAR" | "DESSERT" | "KITCHEN",
        variants:
          profileId === "PIZZERIA" && category.key === "pizza"
            ? [
                {
                  name: { en: "28 cm", de: "28 cm", it: "28 cm", sq: "28 cm" },
                  priceDeltaMinor: 0,
                  isDefault: true,
                },
                {
                  name: { en: "32 cm", de: "32 cm", it: "32 cm", sq: "32 cm" },
                  priceDeltaMinor: 250,
                  isDefault: false,
                },
              ]
            : [],
        currency: "EUR" as const,
        sample: true as const,
      })),
    })),
  });
}
export const premiumStyleIdSchema = z
  .string()
  .refine(
    (value) =>
      packs.some((pack) => pack.styles.some((style) => style.id === value)),
    "Unknown premium style",
  );
export function premiumStyles() {
  return structuredClone(packs.flatMap((pack) => [...pack.styles]));
}
export function premiumCatalog() {
  return packs.map((pack) => premiumShowcase(pack.profileId));
}
export class PremiumSelectionError extends Error {}
export function resolvePremiumSelection(
  profileId: BusinessProfileId,
  value: unknown,
  currency: string,
) {
  const selection = premiumStyleSelectionSchema.parse(value);
  const pack = premiumShowcase(profileId);
  const style = pack.styles.find((s) => s.id === selection.styleId);
  if (!style)
    throw new PremiumSelectionError(
      "Style does not belong to this business profile",
    );
  if (selection.includeSampleMenu && currency !== "EUR")
    throw new PremiumSelectionError(
      "Sample prices are EUR. Start empty or import your own prices for other currencies.",
    );
  return { pack, style, selection };
}

import type { PlatformLocale } from "./locale";
import type { CanonicalMediaReference } from "./canonical-media";
import type { ServiceMode } from "./service-mode";

export type ProductStation = "BAR" | "KITCHEN" | "DESSERT";

export const ALLERGEN_CODES = [
  "GLUTEN",
  "CRUSTACEANS",
  "EGGS",
  "FISH",
  "PEANUTS",
  "SOY",
  "MILK",
  "NUTS",
  "CELERY",
  "MUSTARD",
  "SESAME",
  "SULPHITES",
  "LUPIN",
  "MOLLUSCS",
] as const;

export type AllergenCode = (typeof ALLERGEN_CODES)[number];

export type PublicMenuOption = {
  id: string;
  name: string;
  priceDeltaMinor: number;
  available: boolean;
};

export type PublicMenu = {
  locale: PlatformLocale;
  venue: {
    name: string;
    slug: string;
    currency: string;
  };
  table: {
    label: string;
    area: string | null;
    serviceMode: ServiceMode;
  };
  categories: Array<{
    id: string;
    name: string;
    products: Array<{
      id: string;
      name: string;
      description: string | null;
      priceMinor: number;
      media?: CanonicalMediaReference;
      currency: string;
      available: boolean;
      station: ProductStation;
      allergens: AllergenCode[];
      variants: Array<
        PublicMenuOption & {
          isDefault: boolean;
        }
      >;
      modifierGroups: Array<{
        id: string;
        name: string;
        minSelect: number;
        maxSelect: number;
        options: PublicMenuOption[];
      }>;
    }>;
  }>;
};

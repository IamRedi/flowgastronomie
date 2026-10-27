import type { Locale } from "./i18n";

/** PRESENTATION ONLY. Non-operational starter presets, never domain truth.
 * Keys identify local templates, not products, categories, campaigns or money.
 * No eligibility, calculations, activation, issuance or redemption belongs here.
 */
type LocalizedLabel = Readonly<Record<Locale, string>>;
const label = (
  en: string,
  de: string,
  it: string,
  sq: string,
): LocalizedLabel => ({ en, de, it, sq });
export type PromotionStarter = Readonly<{
  key: string;
  name: string;
  typeIndex: 0 | 1 | 3 | 4 | 5 | 6 | 7 | 8;
  plannedRule: LocalizedLabel;
  channels: readonly ("POS" | "ONLINE")[];
  needsSelection: boolean;
  status: "DRAFT";
  operational: false;
}>;
export type GiftCardStarter = Readonly<{
  key: string;
  name: LocalizedLabel;
  value: LocalizedLabel;
  status: "TEMPLATE";
  issued: false;
}>;
export type CreativeStarter = Readonly<{
  key: string;
  name: LocalizedLabel;
  ratio: string;
  source: { kind: "promotion" | "gift-card"; templateKey: string };
  treatment: "offer" | "gift" | "qr-placeholder" | "thermal";
  status: "TEMPLATE";
  operational: false;
}>;

export const marketingStarterCatalog: Readonly<{
  promotions: readonly PromotionStarter[];
  giftCards: readonly GiftCardStarter[];
  creative: readonly CreativeStarter[];
}> = {
  promotions: [
    {
      key: "pizza-tuesday",
      name: "Pizza Tuesday",
      typeIndex: 0,
      plannedRule: label(
        "10% · Pizza category · Tuesday",
        "10 % · Kategorie Pizza · Dienstag",
        "10% · Categoria pizza · Martedì",
        "10% · Kategoria Pizza · E martë",
      ),
      channels: ["POS", "ONLINE"],
      needsSelection: true,
      status: "DRAFT",
      operational: false,
    },
    {
      key: "happy-hour",
      name: "Happy Hour",
      typeIndex: 5,
      plannedRule: label(
        "10% · Selected drinks · 14:00–17:00",
        "10 % · Ausgewählte Getränke · 14:00–17:00",
        "10% · Bevande selezionate · 14:00–17:00",
        "10% · Pije të zgjedhura · 14:00–17:00",
      ),
      channels: ["POS"],
      needsSelection: true,
      status: "DRAFT",
      operational: false,
    },
    {
      key: "five-off-thirty",
      name: "€5 Off €30+",
      typeIndex: 1,
      plannedRule: label(
        "€5 reward · Subtotal ≥ €30",
        "5 € Rabatt · Zwischensumme ≥ 30 €",
        "Premio €5 · Subtotale ≥ €30",
        "Shpërblim €5 · Nëntotali ≥ €30",
      ),
      channels: ["POS", "ONLINE"],
      needsSelection: false,
      status: "DRAFT",
      operational: false,
    },
    {
      key: "two-pizzas-drink",
      name: "Buy 2 Pizzas, Get 1 Drink",
      typeIndex: 3,
      plannedRule: label(
        "Buy 2 eligible pizzas → 1 drink",
        "2 passende Pizzen kaufen → 1 Getränk",
        "Acquista 2 pizze idonee → 1 bevanda",
        "Bli 2 pica të përshtatshme → 1 pije",
      ),
      channels: ["POS", "ONLINE"],
      needsSelection: true,
      status: "DRAFT",
      operational: false,
    },
    {
      key: "dessert-forty",
      name: "Free Dessert over €40",
      typeIndex: 4,
      plannedRule: label(
        "Free dessert · Subtotal ≥ €40",
        "Gratisdessert · Zwischensumme ≥ 40 €",
        "Dessert gratuito · Subtotale ≥ €40",
        "Ëmbëlsirë falas · Nëntotali ≥ €40",
      ),
      channels: [],
      needsSelection: true,
      status: "DRAFT",
      operational: false,
    },
    {
      key: "receipt-comeback",
      name: "Receipt Come-Back Coupon",
      typeIndex: 7,
      plannedRule: label(
        "Reward template: 10% on the next order",
        "Belohnungsvorlage: 10 % bei der nächsten Bestellung",
        "Modello premio: 10% sul prossimo ordine",
        "Model shpërblimi: 10% në porosinë e ardhshme",
      ),
      channels: [],
      needsSelection: false,
      status: "DRAFT",
      operational: false,
    },
    {
      key: "milestone-pizza",
      name: "Milestone Pizza",
      typeIndex: 8,
      plannedRule: label(
        "Every 500th eligible pizza",
        "Jede 500. passende Pizza",
        "Ogni 500ª pizza idonea",
        "Çdo picë e 500-të e përshtatshme",
      ),
      channels: [],
      needsSelection: true,
      status: "DRAFT",
      operational: false,
    },
    {
      key: "qr-campaign",
      name: "QR Campaign",
      typeIndex: 6,
      plannedRule: label(
        "Reward template: 15%",
        "Belohnungsvorlage: 15 %",
        "Modello premio: 15%",
        "Model shpërblimi: 15%",
      ),
      channels: ["POS", "ONLINE"],
      needsSelection: false,
      status: "DRAFT",
      operational: false,
    },
  ],
  giftCards: [
    {
      key: "gift-25",
      name: label(
        "€25 Gift Card",
        "25 € Gutschein",
        "Buono regalo €25",
        "Gift Card €25",
      ),
      value: label("€25", "25 €", "€25", "€25"),
      status: "TEMPLATE",
      issued: false,
    },
    {
      key: "gift-50",
      name: label(
        "€50 Gift Card",
        "50 € Gutschein",
        "Buono regalo €50",
        "Gift Card €50",
      ),
      value: label("€50", "50 €", "€50", "€50"),
      status: "TEMPLATE",
      issued: false,
    },
    {
      key: "gift-100",
      name: label(
        "€100 Gift Card",
        "100 € Gutschein",
        "Buono regalo €100",
        "Gift Card €100",
      ),
      value: label("€100", "100 €", "€100", "€100"),
      status: "TEMPLATE",
      issued: false,
    },
    {
      key: "gift-custom",
      name: label(
        "Custom Value Gift Card",
        "Gutschein mit Wunschwert",
        "Buono regalo con valore personalizzato",
        "Gift Card me vlerë të personalizuar",
      ),
      value: label(
        "Custom value",
        "Wunschwert",
        "Valore personalizzato",
        "Vlerë e personalizuar",
      ),
      status: "TEMPLATE",
      issued: false,
    },
  ],
  creative: [
    {
      key: "promotion-post",
      name: label(
        "Promotion Post 4:5",
        "Aktionspost 4:5",
        "Post promozionale 4:5",
        "Postim promocioni 4:5",
      ),
      ratio: "4 / 5",
      source: { kind: "promotion", templateKey: "pizza-tuesday" },
      treatment: "offer",
      status: "TEMPLATE",
      operational: false,
    },
    {
      key: "promotion-story",
      name: label(
        "Promotion Story 9:16",
        "Aktionsstory 9:16",
        "Storia promozionale 9:16",
        "Story promocioni 9:16",
      ),
      ratio: "9 / 16",
      source: { kind: "promotion", templateKey: "happy-hour" },
      treatment: "offer",
      status: "TEMPLATE",
      operational: false,
    },
    {
      key: "gift-social",
      name: label(
        "Gift Card Social 4:5",
        "Gutscheinpost 4:5",
        "Buono regalo social 4:5",
        "Gift Card social 4:5",
      ),
      ratio: "4 / 5",
      source: { kind: "gift-card", templateKey: "gift-50" },
      treatment: "gift",
      status: "TEMPLATE",
      operational: false,
    },
    {
      key: "offer-flyer",
      name: label(
        "A6 Offer Flyer",
        "A6 Angebotsflyer",
        "Volantino offerta A6",
        "Fletushkë oferte A6",
      ),
      ratio: "105 / 148",
      source: { kind: "promotion", templateKey: "five-off-thirty" },
      treatment: "offer",
      status: "TEMPLATE",
      operational: false,
    },
    {
      key: "window-poster",
      name: label(
        "A4 Window Poster",
        "A4 Schaufensterplakat",
        "Poster vetrina A4",
        "Poster vitrine A4",
      ),
      ratio: "210 / 297",
      source: { kind: "promotion", templateKey: "two-pizzas-drink" },
      treatment: "offer",
      status: "TEMPLATE",
      operational: false,
    },
    {
      key: "qr-sticker",
      name: label("QR Sticker", "QR-Sticker", "Adesivo QR", "Ngjitëse QR"),
      ratio: "1 / 1",
      source: { kind: "promotion", templateKey: "qr-campaign" },
      treatment: "qr-placeholder",
      status: "TEMPLATE",
      operational: false,
    },
    {
      key: "thermal-comeback",
      name: label(
        "Thermal Come-Back Coupon",
        "Thermo-Rückkehrcoupon",
        "Coupon ritorno termico",
        "Kupon rikthimi termik",
      ),
      ratio: "4 / 7",
      source: { kind: "promotion", templateKey: "receipt-comeback" },
      treatment: "thermal",
      status: "TEMPLATE",
      operational: false,
    },
  ],
};

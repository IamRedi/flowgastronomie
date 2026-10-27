import { z } from "zod";
export const labTrafficConfigSchema = z.strictObject({
  version: z.literal(1),
  profile: z.enum(["DE", "AL"]),
  level: z.enum(["LOW", "NORMAL", "BUSY"]),
  seed: z.number().int().min(0).max(2147483647),
  maxOrders: z.number().int().min(4).max(300),
  browserOrders: z.number().int().min(2).max(10),
});
export type LabTrafficConfig = z.infer<typeof labTrafficConfigSchema>;
export type LabChannel = "COUNTER" | "STAFF_TABLE" | "QR" | "WEBSITE";
export type LabProvenance =
  "STAFF_POS" | "TABLE_QR" | "WEBSITE_API" | "WEBSITE_BROWSER";
export type LabCatalogItem = {
  key: string;
  productId: string;
  name: string;
  category: "MEAL" | "SIDE" | "DRINK" | "DESSERT";
  priceMinor: number;
  station: "KITCHEN" | "BAR";
  variantId?: string;
  variantDelta?: number;
  modifierId?: string;
  modifierDelta?: number;
};
export type LabIntent = {
  position: number;
  channel: LabChannel;
  provenance: LabProvenance;
  arrivalMinute: number;
  prepSeconds: number;
  method: "CASH" | "CARD_AT_COUNTER";
  cancel: boolean;
  items: Array<{
    productId: string;
    quantity: number;
    variantId?: string;
    modifierOptionIds?: string[];
    notes?: string;
    unitMinor: number;
    station: "KITCHEN" | "BAR";
    name: string;
  }>;
  totalMinor: number;
};
export function labRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function labChannelTargets(config: LabTrafficConfig) {
  const c = labTrafficConfigSchema.parse(config);
  const base = c.profile === "DE" ? [35, 15, 14, 16] : [15, 48, 25, 12];
  const factor = c.level === "LOW" ? 0.5 : c.level === "BUSY" ? 1.25 : 1;
  const target = Math.min(
    c.maxOrders,
    Math.round(base.reduce((a, b) => a + b, 0) * factor),
  );
  const scaled = base.map((n) =>
    Math.floor((n * target) / base.reduce((a, b) => a + b, 0)),
  );
  for (let i = scaled.reduce((a, b) => a + b, 0); i < target; i++)
    scaled[i % 4]!++;
  if (scaled[3]! < c.browserOrders)
    throw new Error("Traffic cap cannot support required browser journeys");
  return Object.fromEntries(
    (["COUNTER", "STAFF_TABLE", "QR", "WEBSITE"] as const).map((ch, i) => [
      ch,
      scaled[i]!,
    ]),
  ) as Record<LabChannel, number>;
}
export function generateLabIntents(
  config: LabTrafficConfig,
  catalog: LabCatalogItem[],
): LabIntent[] {
  const targets = labChannelTargets(config),
    random = labRandom(config.seed);
  const meals = catalog.filter((p) => p.category === "MEAL"),
    drinks = catalog.filter((p) => p.category === "DRINK"),
    extras = catalog.filter((p) => ["SIDE", "DESSERT"].includes(p.category));
  if (meals.length < 3 || drinks.length < 2 || extras.length < 2)
    throw new Error("Distinct configured menu categories are required");
  const pick = <T>(rows: T[]) => rows[Math.floor(random() * rows.length)]!;
  const channels = (
    Object.entries(targets) as Array<[LabChannel, number]>
  ).flatMap(([channel, count]) => Array.from({ length: count }, () => channel));
  // Shuffle channel mix, then place arrivals along lunch/dinner/quiet demand bands.
  for (let i = channels.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [channels[i], channels[j]] = [channels[j]!, channels[i]!];
  }
  let browser = 0;
  const result = channels.map((channel, position) => {
    const isBrowser = channel === "WEBSITE" && browser < config.browserOrders;
    const meal = isBrowser
        ? meals[browser % meals.length]!
        : position < 3
          ? meals[position]!
          : pick(meals),
      drink = pick(drinks);
    const chosen = [meal, drink, ...(random() < 0.4 ? [pick(extras)] : [])];
    const items = chosen.map((product, index) => {
      const variant =
        index === 0 &&
        product.variantId &&
        (random() < 0.5 || (isBrowser && browser === 0));
      const modifier =
        index === 0 &&
        product.modifierId &&
        (random() < 0.4 || (isBrowser && browser === 0));
      return {
        productId: product.productId,
        quantity: index === 0 && random() < 0.35 ? 2 : 1,
        ...(variant ? { variantId: product.variantId } : {}),
        ...(modifier ? { modifierOptionIds: [product.modifierId!] } : {}),
        ...(position % 11 === 0 && !isBrowser
          ? { notes: "TEST ONLY preparation note" }
          : {}),
        unitMinor:
          product.priceMinor +
          (variant ? (product.variantDelta ?? 0) : 0) +
          (modifier ? (product.modifierDelta ?? 0) : 0),
        station: product.station,
        name: product.name,
      };
    });
    const band = random();
    const arrivalMinute = Math.round(
      band < 0.35
        ? 60 + random() * 120
        : band < 0.8
          ? 420 + random() * 160
          : random() * 660,
    );
    const provenance: LabProvenance =
      channel === "WEBSITE"
        ? browser++ < config.browserOrders
          ? "WEBSITE_BROWSER"
          : "WEBSITE_API"
        : channel === "QR"
          ? "TABLE_QR"
          : "STAFF_POS";
    return {
      position,
      channel,
      provenance,
      arrivalMinute,
      prepSeconds: 120 + Math.round(random() * 600),
      method: (channel === "QR" || random() < 0.55
        ? "CASH"
        : "CARD_AT_COUNTER") as LabIntent["method"],
      cancel: false,
      items,
      totalMinor: items.reduce((n, i) => n + i.quantity * i.unitMinor, 0),
    };
  });
  const cancelled = result.find(
    (i) =>
      i.position >= 9 &&
      i.channel !== "QR" &&
      i.provenance !== "WEBSITE_BROWSER",
  );
  if (cancelled) cancelled.cancel = true;
  return result;
}
export function labDueInstant(dayStart: Date, intent: LabIntent) {
  return new Date(dayStart.getTime() + intent.arrivalMinute * 60000);
}
export function labResumeArrivals<T extends { dueAt: Date; status: string }>(
  rows: T[],
  now: Date,
) {
  // Missed arrivals are reviewable skips, never an automatic historical flood.
  return rows.map((row) => ({
    ...row,
    status: row.status === "PENDING" && row.dueAt < now ? "MISSED" : row.status,
  }));
}

import { createHash, randomUUID } from "node:crypto";
import { load } from "cheerio";
import { extractPdfMenu } from "./menu-pdf-layout.js";
import {
  businessFieldSchema,
  businessHoursSchema,
  importPriceMinor,
  SetupImportError,
  type BusinessField,
  type BusinessImage,
  type MenuImportProposal,
  type ImportSourceDescriptor,
} from "@flowgastronomie/domain";

export type DiscoverySource = ImportSourceDescriptor & {
  bytes: Buffer;
  sourceUrl: string | null;
  method: "HTML" | "JSON_LD" | "PDF_TEXT" | "RENDERED_HTML" | "DOCUMENT";
};
export type ExtractedBusiness = {
  fields: BusinessField[];
  images: BusinessImage[];
  menu: MenuImportProposal;
  links: string[];
  warnings: string[];
};
export function sourceDocument(
  bytes: Buffer,
  url: string | null,
  mimeType: string,
  method: DiscoverySource["method"],
  filename = "website",
): DiscoverySource {
  return {
    id: randomUUID(),
    bytes,
    sourceUrl: url,
    mimeType,
    method,
    filename,
    pageCount: 1,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
  };
}
const clean = (value: unknown, max = 2000) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
const objects = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (v): v is Record<string, unknown> =>
      !!v && typeof v === "object" && !Array.isArray(v),
  );
const strings = (value: unknown) =>
  (Array.isArray(value) ? value : [value]).filter(
    (v): v is string => typeof v === "string",
  );

export function extractBusinessHtml(
  source: DiscoverySource,
): ExtractedBusiness & { menuMethod: string } {
  const html = source.bytes.toString("utf8");
  if (html.length > 2_000_000) throw new SetupImportError("LIMIT");
  const $ = load(html);
  const result: ExtractedBusiness = {
    fields: [],
    images: [],
    menu: { schemaVersion: 1, categories: [], items: [] },
    links: [],
    warnings: [],
  };
  if (
    $("meta[name=robots],meta[name=googlebot]")
      .toArray()
      .some((e) =>
        /\b(noai|noindex|noarchive|none)\b/i.test($(e).attr("content") ?? ""),
      )
  )
    throw new SetupImportError("REVIEW_REQUIRED");
  const evidence = (quote: string, method: "HTML" | "JSON_LD" = "HTML") => ({
    sourceId: source.id,
    sourceUrl: source.sourceUrl,
    sourceHash: source.contentHash,
    excerpt: quote.slice(0, 1000),
    method:
      source.method === "RENDERED_HTML" ? ("RENDERED_HTML" as const) : method,
    status: "SOURCE_OBSERVED" as const,
    confidence: null,
  });
  const field = (
    name: BusinessField["field"],
    value: unknown,
    quote: string,
    method: "HTML" | "JSON_LD" = "HTML",
  ) => {
    const text = clean(value, 4000);
    if (
      !text ||
      result.fields.some((f) => f.field === name && f.value === text) ||
      result.fields.length >= 100
    )
      return;
    result.fields.push(
      businessFieldSchema.parse({
        id: randomUUID(),
        field: name,
        value: text,
        evidence: evidence(quote, method),
      }),
    );
  };
  const url = (value: string) => {
    try {
      const parsed = new URL(value, source.sourceUrl ?? undefined);
      return parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password
        ? parsed.href
        : null;
    } catch {
      return null;
    }
  };
  const image = (
    value: unknown,
    label: string,
    method: "HTML" | "JSON_LD" = "HTML",
  ) => {
    const raw = typeof value === "string" ? value : objects(value)[0]?.url;
    const candidate = typeof raw === "string" ? url(raw) : null;
    if (
      !candidate ||
      result.images.some((i) => i.url === candidate) ||
      result.images.length >= 50
    )
      return;
    result.images.push({
      id: randomUUID(),
      url: candidate,
      label: clean(label, 200),
      evidence: evidence(String(raw), method),
      assetId: null,
    });
  };
  const observed = <T>(value: T | null, quote: string) => ({
    value,
    confidence: null,
    evidence:
      value === null
        ? []
        : [
            {
              sourceId: source.id,
              page: 1,
              quote: quote.slice(0, 1000),
              box: null,
            },
          ],
  });
  const category = (name: string) => {
    const found = result.menu.categories.find((c) => c.name.value === name);
    if (found) return found.id;
    const id = randomUUID();
    if (result.menu.categories.length >= 50)
      return result.menu.categories[0]!.id;
    result.menu.categories.push({ id, name: observed(name || null, name) });
    return id;
  };
  const price = (value: unknown) => {
    try {
      return typeof value === "number" || typeof value === "string"
        ? importPriceMinor(String(value), "EUR")
        : null;
    } catch {
      return null;
    }
  };
  const addItem = (
    name: string,
    description: string,
    amount: unknown,
    currency: string,
    categoryName: string,
    quote: string,
    variants: { name: string; amount: unknown }[] = [],
  ) => {
    if (!name || result.menu.items.length >= 150) return;
    const minor = price(amount);
    const categoryId = category(categoryName);
    result.menu.items.push({
      id: randomUUID(),
      name: observed(name, quote),
      description: observed(description || null, description),
      categoryId: observed(categoryId, categoryName || quote),
      priceMinor: observed(minor, String(amount ?? "")),
      currency: observed(
        /^[A-Z]{3}$/.test(currency) ? currency : null,
        currency,
      ),
      variants: variants.map((v) => ({
        name: observed(v.name, v.name),
        priceDeltaMinor: observed(
          minor !== null && price(v.amount) !== null
            ? price(v.amount)! - minor
            : null,
          String(v.amount),
        ),
      })),
      modifierGroups: [],
      allergenCandidates: [],
    });
  };
  const visit = (node: unknown, categoryName = "", depth = 0) => {
    if (depth > 20) {
      result.warnings.push("Structured data exceeds the nesting limit.");
      return;
    }
    for (const object of objects(node)) {
      const types = strings(object["@type"]);
      const name = clean(object.name, 160);
      if (
        types.some((t) =>
          /^(Restaurant|FoodEstablishment|LocalBusiness|CafeOrCoffeeShop|Bakery|BarOrPub|IceCreamShop|FastFoodRestaurant)$/.test(
            t,
          ),
        )
      ) {
        const quote = JSON.stringify(object).slice(0, 1000);
        field("venueName", name, name, "JSON_LD");
        field(
          "description",
          object.description,
          clean(object.description),
          "JSON_LD",
        );
        const profile: Record<string, string> = {
          Restaurant: "RESTAURANT",
          CafeOrCoffeeShop: "CAFE",
          Bakery: "BAKERY",
          BarOrPub: "BAR",
          IceCreamShop: "ICE_CAFE",
          FastFoodRestaurant: "FAST_FOOD",
          FoodEstablishment: "GENERIC",
          LocalBusiness: "GENERIC",
        };
        const schemaType = types.find((type) => profile[type]);
        if (schemaType)
          field("businessType", profile[schemaType], schemaType, "JSON_LD");
        field("phone", object.telephone, clean(object.telephone), "JSON_LD");
        field("contactEmail", object.email, clean(object.email), "JSON_LD");
        const address =
          typeof object.address === "string"
            ? object.address
            : objects(object.address)
                .map((a) =>
                  [
                    a.streetAddress,
                    a.postalCode,
                    a.addressLocality,
                    a.addressCountry,
                  ]
                    .filter((v) => typeof v === "string")
                    .join(", "),
                )
                .join("; ");
        field("address", address, address, "JSON_LD");
        for (const social of strings(object.sameAs)) {
          if (/^https:\/\/(www\.)?instagram\.com\//i.test(social))
            field("instagramUrl", social, social, "JSON_LD");
          if (/^https:\/\/(www\.)?facebook\.com\//i.test(social))
            field("facebookUrl", social, social, "JSON_LD");
        }
        const hours = objects(object.openingHoursSpecification).flatMap((h) =>
          strings(h.dayOfWeek).map((day) => ({
            day: day.split("/").pop()!.toUpperCase(),
            closed: false,
            opensAt: h.opens,
            closesAt: h.closes,
          })),
        );
        if (hours.length) {
          const valid = businessHoursSchema.safeParse(hours);
          if (valid.success)
            field(
              "openingHours",
              JSON.stringify(valid.data),
              JSON.stringify(object.openingHoursSpecification),
              "JSON_LD",
            );
          else
            result.warnings.push(
              "Opening hours contain multiple shifts or ambiguous times; review them manually.",
            );
        }
        if (object.openingHours && !hours.length)
          result.warnings.push(
            `Opening hours need manual review: ${clean(JSON.stringify(object.openingHours), 200)}`,
          );
        image(object.logo, "Logo", "JSON_LD");
        image(object.image, name, "JSON_LD");
        for (const link of strings(object.hasMenu ?? object.menu)) {
          const resolved = url(link);
          if (resolved) result.links.push(resolved);
        }
        void quote;
      }
      const nextCategory = types.includes("MenuSection") ? name : categoryName;
      if (types.includes("MenuItem") || types.includes("Product")) {
        const offers = objects(object.offers);
        const amounts = offers.map((o) => price(o.price));
        const valid = amounts.filter((n): n is number => n !== null);
        const baseIndex = valid.length
          ? amounts.indexOf(Math.min(...valid))
          : 0;
        const offer = offers[baseIndex] ?? {};
        const namedVariants =
          offers.length > 1 &&
          /^[A-Z]{3}$/.test(clean(offer.priceCurrency)) &&
          offers.every(
            (o) =>
              clean(o.name) &&
              price(o.price) !== null &&
              clean(o.priceCurrency) === clean(offer.priceCurrency),
          );
        addItem(
          name,
          clean(object.description),
          offers.length > 1 && !namedVariants ? null : offer.price,
          clean(offer.priceCurrency),
          nextCategory || clean(object.category, 160),
          JSON.stringify(object).slice(0, 1000),
          namedVariants
            ? offers.map((o) => ({ name: clean(o.name, 160), amount: o.price }))
            : [],
        );
        if (offers.length > 1 && !namedVariants)
          result.warnings.push(
            `Conflicting offers for ${name}; price requires review.`,
          );
        image(object.image, name, "JSON_LD");
      }
      for (const [key, value] of Object.entries(object))
        if (
          value &&
          typeof value === "object" &&
          ![
            "offers",
            "address",
            "openingHoursSpecification",
            "image",
            "logo",
          ].includes(key)
        )
          visit(value, nextCategory, depth + 1);
    }
  };
  for (const tag of $("script[type='application/ld+json']")
    .toArray()
    .slice(0, 30)) {
    const raw = $(tag).text();
    if (raw.length > 300_000) {
      result.warnings.push("Large structured data was skipped.");
      continue;
    }
    try {
      visit(JSON.parse(raw));
    } catch {
      result.warnings.push("Malformed structured data was skipped.");
    }
  }
  // The menu pass chooses JSON-LD first, then HTML only if no structured items exist.
  const menuMethod = result.menu.items.length ? "JSON_LD" : "HTML";
  const title = clean($("title").first().text(), 120);
  field("seoTitle", title, title);
  if (!result.fields.some((f) => f.field === "venueName"))
    field(
      "venueName",
      $("meta[property='og:site_name']").attr("content") ??
        $("h1").first().text() ??
        title,
      title,
    );
  const description =
    $("meta[name=description]").attr("content") ??
    $("meta[property='og:description']").attr("content");
  field("seoDescription", clean(description, 280), clean(description));
  field("description", description, clean(description));
  const theme = $("meta[name='theme-color']").attr("content");
  if (theme && /^#[a-f0-9]{6}$/i.test(theme))
    field("primaryColor", theme, theme);
  image($("meta[property='og:image']").attr("content"), "Website image");
  for (const element of $("a[href]").toArray().slice(0, 500)) {
    const raw = $(element).attr("href") ?? "";
    if (raw.startsWith("tel:")) field("phone", raw.slice(4), raw);
    if (raw.startsWith("mailto:"))
      field("contactEmail", raw.slice(7).split("?")[0], raw);
    const resolved = url(raw);
    if (!resolved) continue;
    if (/^https:\/\/(www\.)?instagram\.com\//i.test(resolved))
      field("instagramUrl", resolved, raw);
    if (/^https:\/\/(www\.)?facebook\.com\//i.test(resolved))
      field("facebookUrl", resolved, raw);
    if (
      /menu|speisekarte|karte|meny|menù|contact|kontakt|about|über|ueber|orari|\.pdf(?:\?|$)/i.test(
        raw + " " + $(element).text(),
      )
    )
      result.links.push(resolved);
  }
  for (const img of $("img[src]").toArray().slice(0, 80))
    image($(img).attr("src"), $(img).attr("alt") ?? "Image candidate");
  $("script,style,noscript,template,iframe,nav,footer").remove();
  if (!result.menu.items.length) {
    for (const element of $(
      "[itemtype$='/MenuItem'],[itemtype$='/Product'],.menu-item,.dish,.menu-product,.food-item,tr",
    )
      .toArray()
      .slice(0, 200)) {
      const row = $(element);
      const quote = clean(row.text(), 1000);
      const name = clean(
        row
          .find("[itemprop=name],.name,.title,h3,h4,td:first-child")
          .first()
          .text(),
        160,
      );
      const raw = clean(
        row
          .find("[itemprop=price],.price,.amount,td:last-child")
          .first()
          .attr("content") ??
          row
            .find("[itemprop=price],.price,.amount,td:last-child")
            .first()
            .text(),
      );
      const matches = [...raw.matchAll(/\d+(?:[.,]\d{1,2})?/g)].map(
        (m) => m[0],
      );
      const currency =
        row.find("[itemprop=priceCurrency]").attr("content") ??
        (/€|\bEUR\b/.test(raw)
          ? "EUR"
          : /\bALL\b|\blek\b/i.test(raw)
            ? "ALL"
            : "");
      if (name)
        addItem(
          name,
          clean(
            row.find("[itemprop=description],.description,p").first().text(),
          ),
          matches.length === 1 ? matches[0] : null,
          currency,
          clean(row.closest("section").find("h2").first().text(), 160),
          quote,
        );
    }
  }
  return { ...result, menuMethod };
}

// Plain text shares the conservative parser; synthetic positions encode line order.
export function extractMenuText(
  source: DiscoverySource,
  pages: string[],
): MenuImportProposal {
  return extractPdfMenu(
    source,
    pages.map((text) =>
      text
        .split(/\r?\n/)
        .slice(0, 2000)
        .map((line, index) => ({
          text: line.trim(),
          x: 0,
          y: -index * 30,
          height: index === 0 ? 16 : 12,
        })),
    ),
  );
}

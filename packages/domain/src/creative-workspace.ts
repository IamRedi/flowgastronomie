import { z } from "zod";
import {
  createDesign,
  createTextLayer,
  creativeFormats,
  parseDesignDocument,
  CreativeError,
  type CreativeBinding,
  type CreativeLayer,
  type DesignDocument,
} from "./creative";

export const creativeBriefSchema = z.strictObject({
  material: z.enum(["STICKER", "MENU", "BROCHURE"]),
  locale: z.enum(["en", "de", "it", "sq"]),
  instruction: z.string().trim().max(2000),
  campaignText: z.string().trim().max(180),
  productIds: z.array(z.string().min(1).max(100)).max(40),
  assetIds: z.array(z.string().min(1).max(100)).max(6),
});
export type CreativeBrief = z.infer<typeof creativeBriefSchema>;
export function creativeMentionedProducts(
  instruction: string,
  products: { id: string; name: string }[],
) {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const request = ` ${normalize(instruction)} `;
  return products
    .filter(
      (p) =>
        normalize(p.name).length > 2 &&
        request.includes(` ${normalize(p.name)} `),
    )
    .map((p) => p.id);
}
export const creativeMaterialNames = {
  en: { STICKER: "Sticker", MENU: "Menu", BROCHURE: "Brochure" },
  de: { STICKER: "Sticker", MENU: "Speisekarte", BROCHURE: "Broschüre" },
  it: { STICKER: "Adesivo", MENU: "Menu", BROCHURE: "Brochure" },
  sq: { STICKER: "Sticker", MENU: "Menu", BROCHURE: "Broshurë" },
} as const;

// Only an explicitly requested percentage is authorized. It never changes menu prices
// or creates a promotion. Free-form campaign copy must be supplied verbatim by staff.
export function creativeRequestedCopy(
  instruction: string,
  locale: DesignDocument["locale"],
) {
  const match =
    instruction.match(
      /(?:^|[^\d.,-])(\d{1,2}|100)\s*%\s*(?:ulje|off|discount|rabatt|sconto)\b/i,
    ) ??
    instruction.match(/\b(?:ulje|discount|rabatt|sconto)\s*(\d{1,2}|100)\s*%/i);
  if (!match || Number(match[1]) < 1) return [];
  const percent = `${Number(match[1])}%`;
  return [
    percent,
    `${percent} ${{ en: "off", de: "Rabatt", it: "di sconto", sq: "ulje" }[locale]}`,
  ];
}

export function composeCreativeBrief(
  brief: CreativeBrief,
  bindings: CreativeBinding[],
  assets: { id: string; kind: string }[],
  theme?: DesignDocument["theme"],
): DesignDocument {
  const doc = createDesign(
    brief.material === "STICKER" ? "STICKER" : "A4",
    brief.locale,
  );
  if (theme) doc.theme = theme;
  const { width: w, height: h, safe } = creativeFormats[doc.format];
  const m = Math.max(safe + 3, w * 0.075);
  const content = w - 2 * m;
  const layers: CreativeLayer[] = [];
  const base = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => ({
    id,
    name: id,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    groupId: null,
    bindingId: null,
  });
  const text = (
    id: string,
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
    size: number,
    binding?: CreativeBinding,
    options: {
      align?: "left" | "center" | "right";
      fill?: string;
      font?: "Studio Sans" | "Studio Serif";
      weight?: "normal" | "bold";
      letterSpacing?: number;
    } = {},
  ) => {
    const layer = createTextLayer(id, value);
    if (!("text" in layer)) return;
    layers.push({
      ...layer,
      ...base(id, x, y, width, height),
      text: value,
      type:
        binding?.field === "price"
          ? "price"
          : binding?.sourceType === "PRODUCT"
            ? "product"
            : "text",
      bindingId: binding?.id ?? null,
      fontSize: size,
      fill: options.fill ?? doc.theme.primary,
      font:
        options.font ?? (id === "headline" ? "Studio Serif" : "Studio Sans"),
      weight: options.weight ?? "normal",
      letterSpacing: options.letterSpacing ?? 0,
      align: options.align ?? "left",
      overflow: "shrink",
    });
  };
  const shape = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    radius = 0,
  ) =>
    layers.push({
      ...base(id, x, y, width, height),
      type: "shape",
      fill,
      radius,
    });
  const venue = bindings.find((b) => b.sourceType === "VENUE");
  const names = bindings.filter(
    (b) => b.sourceType === "PRODUCT" && b.field === "name",
  );
  const qr = bindings.find((b) => b.field === "destination");
  const logo = assets.find((a) => a.kind === "LOGO");
  const productPhoto = assets.find((a) => a.kind === "PRODUCT");
  const photo = productPhoto ?? assets.find((a) => a.kind !== "LOGO");
  const image = (
    asset: { id: string },
    type: "image" | "logo",
    x: number,
    y: number,
    width: number,
    height: number,
    radius = 0,
  ) =>
    layers.push({
      ...base(
        type === "logo" ? "logo" : `image_${asset.id}`,
        x,
        y,
        width,
        height,
      ),
      type,
      assetId: asset.id,
      fit: type === "logo" ? "contain" : "cover",
      focalX: 0.5,
      focalY: 0.5,
      radius,
    });
  const requestedCopyCandidate =
    brief.campaignText ||
    creativeRequestedCopy(brief.instruction, brief.locale).at(-1) ||
    "";
  const requestedCopy =
    names[0] &&
    requestedCopyCandidate.normalize("NFKC").trim().toLowerCase() ===
      names[0].value.normalize("NFKC").trim().toLowerCase()
      ? ""
      : requestedCopyCandidate;
  const neutralCopy = {
    en: "Discover our menu",
    de: "Unsere Speisekarte entdecken",
    it: "Scopri il nostro menu",
    sq: "Zbuloni menunë tonë",
  }[brief.locale];
  const headline = requestedCopy || neutralCopy;

  if (brief.material === "STICKER") {
    if (venue)
      text("venue", venue.value, m, m, content, 22, 12, venue, {
        align: "center",
        weight: "bold",
        letterSpacing: 0.7,
      });
    text("headline", headline, m, m + 29, content, 49, 29, undefined, {
      align: "center",
      font: "Studio Serif",
      weight: "bold",
    });
    if (qr)
      layers.push({
        ...base("qr", (w - 80) / 2, h - m - 80, 80, 80),
        type: "qr",
        bindingId: qr.id,
        fill: "#000000",
        background: "#ffffff",
      });
    else if (logo) image(logo, "logo", (w - 74) / 2, h - m - 74, 74, 74);
    else if (names[0])
      text(
        "product",
        names[0].value,
        m,
        h - m - 50,
        content,
        45,
        16,
        names[0],
        { align: "center", weight: "bold" },
      );
  } else if (brief.material === "BROCHURE" && names.length === 1 && photo) {
    // Curated single-product hero: visual by default, while all commercial facts
    // remain canonical bindings. AI may refine this scene later through patches.
    doc.pages[0]!.background = "#f8f3e9";
    shape("top_rule", m, m, 62, 5, doc.theme.accent, 3);
    if (logo) image(logo, "logo", w - m - 78, m - 6, 78, 78);
    if (venue)
      text(
        "venue",
        venue.value,
        m,
        m + 18,
        content - (logo ? 98 : 0),
        34,
        18,
        venue,
        {
          weight: "bold",
          letterSpacing: 0.6,
        },
      );

    const heroY = m + 92;
    const heroH = Math.min(495, h * 0.43);
    image(photo, "image", m, heroY, content, heroH, 28);

    const cardY = heroY + heroH - 42;
    const cardX = m + 34;
    const cardW = content - 68;
    const cardH = 250;
    shape("feature_card", cardX, cardY, cardW, cardH, "#fffdf8", 30);
    shape("feature_accent", cardX, cardY, 10, cardH, doc.theme.accent, 5);

    if (requestedCopy)
      text(
        "headline",
        requestedCopy,
        cardX + 34,
        cardY + 28,
        cardW - 68,
        48,
        20,
        undefined,
        {
          fill: doc.theme.accent,
          weight: "bold",
          letterSpacing: 0.5,
        },
      );

    const name = names[0]!;
    const price = bindings.find(
      (b) => b.sourceId === name.sourceId && b.field === "price",
    );
    const titleY = cardY + (requestedCopy ? 82 : 46);
    text(
      "product_0",
      name.value,
      cardX + 34,
      titleY,
      cardW - 220,
      92,
      44,
      name,
      { font: "Studio Serif", weight: "bold" },
    );
    if (price)
      text(
        "price_0",
        price.value,
        cardX + cardW - 176,
        titleY + 6,
        142,
        70,
        38,
        price,
        {
          align: "right",
          fill: doc.theme.accent,
          weight: "bold",
        },
      );

    text(
      "cta",
      qr?.id === "directions_qr"
        ? {
            en: "Visit us",
            de: "Besuchen Sie uns",
            it: "Vieni a trovarci",
            sq: "Na vizitoni",
          }[brief.locale]
        : neutralCopy,
      cardX + 34,
      cardY + cardH - 58,
      cardW - 68,
      30,
      14,
      undefined,
      { weight: "bold", letterSpacing: 0.4 },
    );

    const footerY = h - m - 108;
    const contact =
      bindings.find((b) => b.field === "address") ??
      bindings.find((b) => b.field === "phone");
    if (contact)
      text(
        "contact",
        contact.value,
        m,
        footerY,
        content - (qr ? 126 : 0),
        42,
        13,
        contact,
        { weight: "bold" },
      );
    const phone = bindings.find((b) => b.field === "phone");
    if (phone && phone !== contact)
      text(
        "phone",
        phone.value,
        m,
        footerY + 38,
        content - (qr ? 126 : 0),
        28,
        12,
        phone,
      );
    if (qr) {
      shape("qr_card", w - m - 104, footerY - 14, 104, 104, "#ffffff", 18);
      layers.push({
        ...base("qr", w - m - 92, footerY - 2, 80, 80),
        type: "qr",
        bindingId: qr.id,
        fill: "#000000",
        background: "#ffffff",
      });
      text(
        "directions_label",
        qr.id === "directions_qr"
          ? {
              en: "Directions",
              de: "Anfahrt",
              it: "Indicazioni",
              sq: "Adresa",
            }[brief.locale]
          : { en: "Open", de: "Öffnen", it: "Apri", sq: "Hap" }[brief.locale],
        w - m - 104,
        footerY + 82,
        104,
        18,
        9,
        undefined,
        { align: "center", weight: "bold" },
      );
    }
  } else {
    if (logo) image(logo, "logo", w - m - 74, m, 74, 74);
    if (venue)
      text(
        "venue",
        venue.value,
        m,
        m,
        content - (logo ? 90 : 0),
        35,
        20,
        venue,
        { weight: "bold" },
      );
    text(
      "headline",
      brief.material === "MENU" && !brief.campaignText
        ? creativeMaterialNames[brief.locale].MENU
        : headline,
      m,
      m + 58,
      content,
      86,
      51,
      undefined,
      { font: "Studio Serif", weight: "bold" },
    );
    layers.push({
      ...base("accent", m, m + 155, content, 2),
      type: "divider",
      fill: doc.theme.accent,
    });
    let top = m + 181;
    if (brief.material === "BROCHURE" && photo) {
      image(photo, "image", m, top, content, 310, 22);
      top += 338;
    }
    const capacity = brief.material === "MENU" ? 40 : photo ? 12 : 24;
    if (names.length > capacity)
      throw new CreativeError(
        "INVALID_DESIGN",
        `Select at most ${capacity} products for this layout.`,
      );
    const columns = names.length > 8 ? 2 : 1;
    const rows = Math.ceil(names.length / columns);
    const gap = 32;
    const colW = (content - (columns - 1) * gap) / columns;
    const rowH = Math.min(55, (h - m - 95 - top) / Math.max(rows, 1));
    names.forEach((name, index) => {
      const x = m + Math.floor(index / Math.max(rows, 1)) * (colW + gap);
      const y = top + (index % Math.max(rows, 1)) * rowH;
      const featured = brief.material === "BROCHURE" && names.length <= 2;
      const priceWidth = featured ? 140 : 70;
      text(
        `product_${index}`,
        name.value,
        x,
        y,
        colW - priceWidth - 6,
        rowH - 5,
        featured ? 28 : 16,
        name,
        { weight: featured ? "bold" : "normal" },
      );
      const price = bindings.find(
        (b) => b.sourceId === name.sourceId && b.field === "price",
      );
      if (price)
        text(
          `price_${index}`,
          price.value,
          x + colW - priceWidth,
          y,
          priceWidth,
          rowH - 5,
          featured ? 30 : 15,
          price,
          {
            align: "right",
            fill: featured ? doc.theme.accent : doc.theme.primary,
          },
        );
    });
    const contact =
      bindings.find((b) => b.field === "address") ??
      bindings.find((b) => b.field === "phone");
    if (contact)
      text(
        "contact",
        contact.value,
        m,
        h - m - 58,
        content - (qr ? 110 : 0),
        50,
        13,
        contact,
      );
    const phone = bindings.find((b) => b.field === "phone");
    if (phone && phone !== contact)
      text(
        "phone",
        phone.value,
        m,
        h - m - 25,
        content - (qr ? 110 : 0),
        24,
        12,
        phone,
      );
    if (qr)
      layers.push({
        ...base("qr", w - m - 80, h - m - 80, 80, 80),
        type: "qr",
        bindingId: qr.id,
        fill: "#000000",
        background: "#ffffff",
      });
    if (qr?.id === "directions_qr")
      text(
        "directions_label",
        { en: "Directions", de: "Anfahrt", it: "Indicazioni", sq: "Adresa" }[
          brief.locale
        ],
        w - m - 80,
        h - m - 100,
        80,
        18,
        10,
        undefined,
        { align: "center", weight: "bold" },
      );
  }
  if (doc.pages[0]!.background === "#faf7f0")
    doc.pages[0]!.background = "#fffdf7";
  doc.pages[0]!.layers = layers;
  doc.bindings = bindings.filter((b) =>
    layers.some((l) => l.bindingId === b.id),
  );
  return parseDesignDocument(doc);
}

export function creativeArchiveState(
  status: string,
  version: number,
  exportedVersion?: number,
) {
  if (status === "ARCHIVED") return "ARCHIVED" as const;
  if (exportedVersion === undefined) return "DRAFT" as const;
  return exportedVersion === version
    ? ("CURRENT" as const)
    : ("CHANGED" as const);
}

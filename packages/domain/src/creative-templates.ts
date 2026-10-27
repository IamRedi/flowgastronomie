import {
  createDesign,
  createTextLayer,
  creativeFormats,
  parseDesignDocument,
  type CreativeBinding,
  type CreativeLayer,
  type DesignDocument,
} from "./creative";
export const creativeTemplates = [
  "Product spotlight",
  "Promotion poster",
  "Menu price card",
  "Food offer",
  "Event announcement",
  "QR table card",
  "QR sticker",
  "Come-back coupon",
  "Printed menu",
  "Gift-card visual",
] as const;
export type CreativeTemplate = (typeof creativeTemplates)[number];
const copy = {
  en: [
    "Fresh from our kitchen",
    "Discover our menu",
    "A little something to look forward to",
  ],
  de: [
    "Frisch aus unserer Küche",
    "Unsere Speisekarte entdecken",
    "Ein guter Grund zum Wiederkommen",
  ],
  it: [
    "Fresco dalla nostra cucina",
    "Scopri il nostro menu",
    "Un buon motivo per tornare",
  ],
  sq: [
    "Freskët nga kuzhina jonë",
    "Zbuloni menunë tonë",
    "Një arsye e mirë për t’u kthyer",
  ],
};
export function instantiateCreativeTemplate(
  template: CreativeTemplate,
  format: DesignDocument["format"],
  locale: DesignDocument["locale"],
  bindings: CreativeBinding[],
  theme?: DesignDocument["theme"],
): DesignDocument {
  const doc = createDesign(format, locale);
  if (theme) doc.theme = theme;
  const spec = creativeFormats[format],
    margin = Math.max(spec.safe, spec.width * 0.08),
    contentWidth = spec.width - 2 * margin;
  const layers: CreativeLayer[] = [];
  const text = (
    id: string,
    content: string,
    y: number,
    size: number,
    binding?: CreativeBinding,
    width = contentWidth,
  ) => {
    const layer = createTextLayer(id, content);
    if (!("text" in layer)) return;
    layers.push({
      ...layer,
      name: binding
        ? `${binding.sourceType.toLowerCase()} ${binding.field}`
        : "Campaign copy",
      type:
        binding?.field === "price"
          ? "price"
          : binding?.sourceType === "PRODUCT" ||
              binding?.sourceType === "VARIANT"
            ? "product"
            : "text",
      bindingId: binding?.id ?? null,
      x: margin,
      y,
      width,
      height: size * 2.4,
      fontSize: size,
      fill: doc.theme.primary,
      font: doc.theme.font,
    });
  };
  const venue = bindings.find((b) => b.sourceType === "VENUE");
  if (venue) text("venue", venue.value, margin, spec.width * 0.035, venue);
  let y = margin + spec.width * 0.11;
  if (template === "Printed menu") {
    const names = bindings.filter(
      (b) =>
        b.field === "name" && ["PRODUCT", "VARIANT"].includes(b.sourceType),
    );
    const size = Math.max(
      12,
      Math.min(25, (spec.height - y - margin) / Math.max(1, names.length) / 2),
    );
    names.forEach((name, index) => {
      text(`item_${index}`, name.value, y, size, name, contentWidth * 0.72);
      const price = bindings.find(
        (b) => b.sourceId === name.sourceId && b.field === "price",
      );
      if (price) {
        text(
          `price_${index}`,
          price.value,
          y,
          size,
          price,
          contentWidth * 0.25,
        );
        layers[layers.length - 1]!.x =
          spec.width - margin - contentWidth * 0.25;
      }
      y += size * 2.6;
    });
  } else {
    const name = bindings.find(
      (b) =>
        b.field === "name" && ["PRODUCT", "VARIANT"].includes(b.sourceType),
    );
    text(
      "headline",
      name?.value ??
        (template === "Gift-card visual"
          ? "Gift card · Design draft"
          : template === "Promotion poster"
            ? "Promotion · Design draft"
            : copy[locale][0]!),
      y,
      Math.min(76, spec.width * 0.075),
      name,
    );
    const price = bindings.find((b) => b.field === "price");
    if (price)
      text(
        "price",
        price.value,
        y + spec.height * 0.18,
        spec.width * 0.065,
        price,
      );
    text(
      "cta",
      template === "Come-back coupon" ? copy[locale][2]! : copy[locale][1]!,
      spec.height - margin - spec.width * 0.1,
      spec.width * 0.032,
    );
  }
  const qr = bindings.find((b) => b.field === "destination");
  if (qr) {
    const size = Math.max(76, Math.min(200, spec.width * 0.32));
    layers.push({
      id: "qr",
      name: "Scan to explore",
      type: "qr",
      x: margin,
      y: spec.height * 0.52,
      width: size,
      height: size,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      bindingId: qr.id,
      groupId: null,
      fill: "#000000",
      background: "#ffffff",
    });
  }
  doc.bindings = bindings;
  doc.pages[0]!.layers = layers;
  return parseDesignDocument(doc);
}

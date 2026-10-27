import { z } from "zod";

// Canonical design units are CSS pixels at 96 dpi, including print presets.
const print = (width: number, height: number) => ({
  width: (width * 96) / 25.4,
  height: (height * 96) / 25.4,
  widthMm: width,
  heightMm: height,
  safe: (5 * 96) / 25.4,
});
export const creativeFormats = {
  SOCIAL: { width: 1080, height: 1350, widthMm: 0, heightMm: 0, safe: 48 },
  STORY: { width: 1080, height: 1920, widthMm: 0, heightMm: 0, safe: 96 },
  SQUARE: { width: 1080, height: 1080, widthMm: 0, heightMm: 0, safe: 48 },
  A4: print(210, 297),
  A5: print(148, 210),
  A6: print(105, 148),
  WINDOW: print(297, 420),
  STICKER: print(60, 60),
  TABLE_CARD: print(105, 148),
  TABLE_TENT: print(105, 210),
  PROMOTION_CARD: print(148, 105),
  COUPON: print(148, 74),
} as const;
export const creativeFormatIds = Object.keys(creativeFormats) as [
  keyof typeof creativeFormats,
  ...(keyof typeof creativeFormats)[],
];
export const creativeFonts = ["Studio Sans", "Studio Serif"] as const;
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text = z.string().max(2000);
export const creativeBindingSchema = z.strictObject({
  id,
  sourceType: z.enum([
    "VENUE",
    "BRAND",
    "PRODUCT",
    "CATEGORY",
    "VARIANT",
    "QR",
    "TABLE_QR",
    "HOURS",
  ]),
  sourceId: id,
  field: z.enum([
    "name",
    "description",
    "price",
    "address",
    "phone",
    "website",
    "logo",
    "image",
    "primaryColor",
    "accentColor",
    "hours",
    "destination",
  ]),
  version: z.string().max(200),
  value: z.string().max(4000),
});
const base = {
  id,
  name: z.string().min(1).max(120),
  x: z.number().finite().min(-5000).max(10000),
  y: z.number().finite().min(-5000).max(10000),
  width: z.number().finite().min(1).max(10000),
  height: z.number().finite().min(1).max(10000),
  rotation: z.number().finite().min(-360).max(360),
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  locked: z.boolean(),
  bindingId: id.nullable(),
  groupId: id.nullable(),
};
const typeStyle = {
  font: z.enum(creativeFonts),
  fontSize: z.number().min(6).max(400),
  weight: z.enum(["normal", "bold"]),
  italic: z.boolean(),
  lineHeight: z.number().min(1).max(3),
  letterSpacing: z.number().min(-2).max(30),
  align: z.enum(["left", "center", "right"]),
  fill: color,
  overflow: z.enum(["clip", "shrink"]),
};
const imageStyle = {
  assetId: id,
  fit: z.enum(["cover", "contain"]),
  focalX: z.number().min(0).max(1),
  focalY: z.number().min(0).max(1),
  radius: z.number().min(0).max(1000),
};
export const creativeLayerSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("text"), text, ...typeStyle }),
  z.strictObject({ ...base, type: z.literal("product"), text, ...typeStyle }),
  z.strictObject({ ...base, type: z.literal("price"), text, ...typeStyle }),
  z.strictObject({ ...base, type: z.literal("promotion"), text, ...typeStyle }),
  z.strictObject({ ...base, type: z.literal("image"), ...imageStyle }),
  z.strictObject({ ...base, type: z.literal("logo"), ...imageStyle }),
  z.strictObject({
    ...base,
    type: z.literal("shape"),
    fill: color,
    radius: z.number().min(0).max(1000),
  }),
  z.strictObject({ ...base, type: z.literal("divider"), fill: color }),
  z.strictObject({
    ...base,
    type: z.literal("qr"),
    bindingId: id,
    fill: z.literal("#000000"),
    background: z.literal("#ffffff"),
  }),
  z.strictObject({ ...base, type: z.literal("group") }),
]);
export const designDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    format: z.enum(creativeFormatIds),
    locale: z.enum(["en", "de", "it", "sq"]),
    theme: z.strictObject({
      primary: color,
      accent: color,
      font: z.enum(creativeFonts),
    }),
    pages: z
      .array(
        z.strictObject({
          id,
          background: color,
          layers: z.array(creativeLayerSchema).max(150),
        }),
      )
      .length(1),
    bindings: z.array(creativeBindingSchema).max(150),
  })
  .superRefine((doc, ctx) => {
    const characterCount = doc.pages[0]!.layers.reduce(
      (sum, layer) => sum + ("text" in layer ? layer.text.length : 0),
      0,
    );
    if (characterCount > 12000)
      ctx.addIssue({
        code: "custom",
        message: "A design may contain at most 12,000 text characters.",
      });
    const ids = new Set<string>();
    const bindings = new Map(doc.bindings.map((b) => [b.id, b]));
    if (bindings.size !== doc.bindings.length)
      ctx.addIssue({ code: "custom", message: "Duplicate binding" });
    for (const layer of doc.pages.flatMap((p) => p.layers)) {
      if (ids.has(layer.id))
        ctx.addIssue({ code: "custom", message: "Duplicate layer" });
      ids.add(layer.id);
      const binding = layer.bindingId
        ? bindings.get(layer.bindingId)
        : undefined;
      if (layer.bindingId && !binding)
        ctx.addIssue({ code: "custom", message: "Missing binding" });
      if ((layer.type === "price" || layer.type === "product") && !binding)
        ctx.addIssue({
          code: "custom",
          message: "Commercial layers require a source",
        });
      if (layer.type === "price" && binding?.field !== "price")
        ctx.addIssue({
          code: "custom",
          message: "Price requires a price source",
        });
      if (
        layer.type === "qr" &&
        (binding?.field !== "destination" ||
          !["QR", "TABLE_QR"].includes(binding.sourceType))
      )
        ctx.addIssue({
          code: "custom",
          message: "QR requires an approved destination",
        });
      if (
        layer.type === "qr" &&
        (layer.width !== layer.height ||
          layer.width < 76 ||
          layer.opacity !== 1 ||
          layer.rotation !== 0)
      )
        ctx.addIssue({
          code: "custom",
          message: "QR must be square, opaque, unrotated and at least 20 mm",
        });
      if (
        layer.groupId &&
        !doc.pages[0]?.layers.some(
          (g) => g.type === "group" && g.id === layer.groupId && !g.groupId,
        )
      )
        ctx.addIssue({ code: "custom", message: "Invalid group" });
    }
  });
export type DesignDocument = z.infer<typeof designDocumentSchema>;
export type CreativeLayer = z.infer<typeof creativeLayerSchema>;
export type CreativeBinding = z.infer<typeof creativeBindingSchema>;
export type CreativeScope = {
  tenantId: string;
  venueId: string;
  userId: string;
  role: import("./staff-permissions").StaffRole;
};
export class CreativeError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "INVALID_DESIGN"
      | "UNRESOLVED_SOURCE"
      | "STALE_SOURCE"
      | "UNAPPROVED_ASSET"
      | "UNAVAILABLE"
      | "RATE_LIMIT",
    message: string = code,
  ) {
    super(message);
  }
}
export function parseDesignDocument(value: unknown): DesignDocument {
  const parsed = designDocumentSchema.safeParse(value);
  if (!parsed.success)
    throw new CreativeError(
      "INVALID_DESIGN",
      parsed.error.issues
        .map((i) => i.message)
        .join("; ")
        .slice(0, 400),
    );
  return parsed.data;
}
export function createDesign(
  format: DesignDocument["format"],
  locale: DesignDocument["locale"],
): DesignDocument {
  return {
    schemaVersion: 1,
    format,
    locale,
    theme: { primary: "#17382f", accent: "#b78b52", font: "Studio Sans" },
    pages: [{ id: "page_1", background: "#faf7f0", layers: [] }],
    bindings: [],
  };
}
export function createTextLayer(
  id: string,
  content = "Your headline",
): Extract<CreativeLayer, { type: "text" }> {
  return {
    id,
    type: "text",
    name: "Headline",
    text: content,
    x: 60,
    y: 80,
    width: 500,
    height: 120,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    bindingId: null,
    groupId: null,
    font: "Studio Sans",
    fontSize: 48,
    weight: "normal",
    italic: false,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
    fill: "#17382f",
    overflow: "shrink",
  };
}
export function adaptDesign(
  document: DesignDocument,
  format: DesignDocument["format"],
): DesignDocument {
  const from = creativeFormats[document.format],
    to = creativeFormats[format];
  const scale = Math.min(to.width / from.width, to.height / from.height);
  return parseDesignDocument({
    ...document,
    format,
    pages: document.pages.map((p) => ({
      ...p,
      layers: p.layers.map((l) => ({
        ...l,
        x: l.x * scale,
        y: l.y * scale,
        width:
          l.type === "qr" ? Math.max(76, l.width * scale) : l.width * scale,
        height:
          l.type === "qr" ? Math.max(76, l.height * scale) : l.height * scale,
        ...("fontSize" in l
          ? { fontSize: Math.max(6, l.fontSize * scale) }
          : {}),
      })),
    })),
  });
}
export function sourceChanges(
  document: DesignDocument,
  resolved: CreativeBinding[],
) {
  return document.bindings.flatMap((previous) => {
    const current = resolved.find((b) => b.id === previous.id);
    if (!current) throw new CreativeError("UNRESOLVED_SOURCE");
    return current.version !== previous.version ||
      current.value !== previous.value
      ? [{ previous, current }]
      : [];
  });
}
export function applyResolvedBindings(
  document: DesignDocument,
  bindings: CreativeBinding[],
): DesignDocument {
  return parseDesignDocument({
    ...document,
    bindings,
    pages: document.pages.map((p) => ({
      ...p,
      layers: p.layers.map((l) => {
        const binding = bindings.find((b) => b.id === l.bindingId);
        return binding && "text" in l ? { ...l, text: binding.value } : l;
      }),
    })),
  });
}

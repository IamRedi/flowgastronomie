import { z } from "zod";
import { SetupImportError } from "./smart-setup";
import { PLATFORM_LOCALES } from "./locale";
import { assertProductMenuConfiguration } from "./menu-configuration";
import { ALLERGEN_CODES } from "./public-menu";

export const importStatuses = [
  "DETECTED",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "IMPORTED",
] as const;
export const importLimits = {
  files: 4,
  pages: 20,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 24 * 1024 * 1024,
  items: 150,
  sessionsPerDay: 20,
  extractionAttempts: 3,
} as const;
const id = z.string().min(1).max(100);
const name = z.string().trim().max(160);
const money = z.number().int().min(0).max(100_000_000);
export const importEvidenceSchema = z.strictObject({
  sourceId: id,
  page: z.number().int().min(1).max(importLimits.pages),
  quote: z.string().max(1000).nullable(),
  box: z
    .strictObject({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .nullable(),
});
const observed = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value: value.nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    evidence: z.array(importEvidenceSchema).max(8),
  });
export const importAllergenCodes = ALLERGEN_CODES;
const variant = z.strictObject({
  name: observed(name),
  priceDeltaMinor: observed(
    z.number().int().min(-100_000_000).max(100_000_000),
  ),
});
const modifier = z.strictObject({
  name: observed(name),
  minSelect: observed(z.number().int().min(0).max(20)),
  maxSelect: observed(z.number().int().min(0).max(20)),
  options: z
    .array(
      z.strictObject({
        name: observed(name),
        priceDeltaMinor: observed(money),
      }),
    )
    .max(20),
});
export const menuImportProposalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  categories: z.array(z.strictObject({ id, name: observed(name) })).max(50),
  items: z
    .array(
      z.strictObject({
        id,
        categoryId: observed(id),
        name: observed(name),
        description: observed(z.string().max(2000)),
        priceMinor: observed(money),
        currency: observed(z.string().regex(/^[A-Z]{3}$/)),
        variants: z.array(variant).max(20),
        modifierGroups: z.array(modifier).max(15),
        allergenCandidates: z
          .array(observed(z.enum(importAllergenCodes)))
          .max(14),
      }),
    )
    .max(importLimits.items),
});
export type MenuImportProposal = z.infer<typeof menuImportProposalSchema>;
export type ImportEvidence = z.infer<typeof importEvidenceSchema>;
export type ImportSourceDescriptor = {
  id: string;
  pageCount: number;
  contentHash: string;
  mimeType: string;
  filename: string;
};

// Provider provenance must resolve only to the uploaded documents in this session.
export function validateMenuImportProposal(
  value: unknown,
  sources: ImportSourceDescriptor[],
): MenuImportProposal {
  const proposal = menuImportProposalSchema.parse(value);
  const ids = proposal.items.map((p) => p.id),
    categories = proposal.categories.map((c) => c.id);
  if (
    new Set(ids).size !== ids.length ||
    new Set(categories).size !== categories.length
  )
    throw new SetupImportError(
      "INVALID_INPUT",
      "Duplicate proposal identifiers.",
    );
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const object = node as Record<string, unknown>;
    if ("confidence" in object && "evidence" in object) {
      const evidence = object.evidence as ImportEvidence[];
      if (object.value !== null && evidence.length === 0)
        throw new SetupImportError(
          "INVALID_INPUT",
          "Detected values require source evidence.",
        );
      for (const point of evidence) {
        const source = sources.find((s) => s.id === point.sourceId);
        if (
          !source ||
          point.page > source.pageCount ||
          (point.box &&
            (point.box.x + point.box.width > 1.000001 ||
              point.box.y + point.box.height > 1.000001))
        )
          throw new SetupImportError(
            "INVALID_INPUT",
            "Extraction references an unavailable source or page.",
          );
      }
    }
    Object.values(object).forEach(walk);
  };
  walk(proposal);
  for (const item of proposal.items) {
    if (
      item.categoryId.value !== null &&
      !categories.includes(item.categoryId.value)
    )
      throw new SetupImportError("INVALID_INPUT", "Unknown proposed category.");
    for (const field of [
      item.priceMinor,
      ...item.variants.map((v) => v.priceDeltaMinor),
      ...item.modifierGroups.flatMap((g) =>
        g.options.map((o) => o.priceDeltaMinor),
      ),
    ])
      if (
        field.value !== null &&
        !field.evidence.some((e) => e.quote && /\d/.test(e.quote))
      )
        throw new SetupImportError(
          "INVALID_INPUT",
          "Extracted prices require an observed numeric source quote; missing prices must stay empty.",
        );
    const quotedAmounts = (evidence: ImportEvidence[]) =>
      evidence
        .flatMap((e) => (e.quote ?? "").match(/\d+(?:[.,]\d{1,2})?/g) ?? [])
        .map((s) => Math.round(Number(s.replace(",", ".")) * 100));
    for (const field of [
      item.priceMinor,
      ...item.modifierGroups.flatMap((g) =>
        g.options.map((o) => o.priceDeltaMinor),
      ),
    ])
      if (
        field.value !== null &&
        !quotedAmounts(field.evidence).includes(field.value)
      )
        throw new SetupImportError(
          "INVALID_INPUT",
          "Price does not match its quoted source amount. Leave ambiguous prices empty for review.",
        );
    for (const variant of item.variants) {
      const field = variant.priceDeltaMinor;
      if (
        field.value !== null &&
        (item.priceMinor.value === null ||
          !quotedAmounts(field.evidence).includes(
            item.priceMinor.value + field.value,
          ))
      )
        throw new SetupImportError(
          "INVALID_INPUT",
          "Variant adjustments require an observed base and size price.",
        );
    }
  }
  return proposal;
}
export const reviewedMenuItemSchema = z.strictObject({
  categoryName: name,
  categoryId: id.nullable(),
  name,
  description: z.string().max(2000),
  priceMinor: money.nullable(),
  currency: z.string().max(3),
  station: z.enum(["KITCHEN", "BAR", "DESSERT"]),
  variants: z
    .array(
      z.strictObject({
        name,
        priceDeltaMinor: z
          .number()
          .int()
          .min(-100_000_000)
          .max(100_000_000)
          .nullable(),
        isDefault: z.boolean(),
      }),
    )
    .max(20),
  modifierGroups: z
    .array(
      z.strictObject({
        name,
        minSelect: z.number().int().min(0).max(20),
        maxSelect: z.number().int().min(0).max(20),
        options: z
          .array(z.strictObject({ name, priceDeltaMinor: money.nullable() }))
          .max(20),
      }),
    )
    .max(15),
  approvedAllergens: z.array(z.enum(importAllergenCodes)).max(14),
  duplicateAcknowledged: z.boolean(),
});
export type ReviewedMenuItem = z.infer<typeof reviewedMenuItemSchema>;
export function reviewFromProposal(
  item: MenuImportProposal["items"][number],
  proposal: MenuImportProposal,
): ReviewedMenuItem {
  return {
    categoryId: null,
    categoryName:
      proposal.categories.find((c) => c.id === item.categoryId.value)?.name
        .value ?? "",
    name: item.name.value ?? "",
    description: item.description.value ?? "",
    priceMinor: item.priceMinor.value,
    currency: item.currency.value ?? "",
    station: "KITCHEN",
    variants: item.variants.map((v, i) => ({
      name: v.name.value ?? "",
      priceDeltaMinor: v.priceDeltaMinor.value,
      isDefault: i === 0,
    })),
    modifierGroups: item.modifierGroups.map((g) => ({
      name: g.name.value ?? "",
      minSelect: g.minSelect.value ?? 0,
      maxSelect: g.maxSelect.value ?? 1,
      options: g.options.map((o) => ({
        name: o.name.value ?? "",
        priceDeltaMinor: o.priceDeltaMinor.value,
      })),
    })),
    approvedAllergens: [],
    duplicateAcknowledged: false,
  };
}
export const importReviewSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  item: reviewedMenuItemSchema,
  action: z.enum(["SAVE", "APPROVE", "REJECT"]),
  confirm: z.boolean(),
});
export type ImportReviewInput = z.infer<typeof importReviewSchema>;
export const importCommitSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  confirm: z.literal(true),
});
export function normalizeImportName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ");
}
export function menuDuplicateCandidates(
  item: ReviewedMenuItem,
  products: { id: string; names: string[]; priceMinor: number }[],
) {
  const target = normalizeImportName(item.name);
  if (!target) return [];
  const tokens = new Set(target.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return products
    .filter((p) =>
      p.names.some((n) => {
        const normalized = normalizeImportName(n);
        if (normalized === target) return true;
        const other = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        const shared = other.filter((t) => tokens.has(t)).length;
        return (
          shared > 0 && shared / Math.max(tokens.size, other.length) >= 0.66
        );
      }),
    )
    .map((p) => ({
      id: p.id,
      name: p.names[0] ?? "",
      priceMinor: p.priceMinor,
    }));
}
export const importNameTranslations = (value: string) =>
  PLATFORM_LOCALES.map((locale) => ({ locale, name: value }));
export function validateReviewedMenuItem(
  value: ReviewedMenuItem,
  currency: string,
  duplicates: unknown[],
) {
  const item = reviewedMenuItemSchema.parse(value);
  if (
    !item.name ||
    !item.categoryName ||
    item.priceMinor === null ||
    item.currency !== currency
  )
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "Review the product name, category, price and venue currency.",
    );
  if (duplicates.length && !item.duplicateAcknowledged)
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "A similar product already exists. Explicitly choose a separate new product or reject this row.",
    );
  if (new Set(item.approvedAllergens).size !== item.approvedAllergens.length)
    throw new SetupImportError("INVALID_INPUT");
  if (
    item.variants.some((v) => !v.name || v.priceDeltaMinor === null) ||
    item.modifierGroups.some(
      (g) =>
        !g.name || g.options.some((o) => !o.name || o.priceDeltaMinor === null),
    )
  )
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "Review all variant and extra names and prices.",
    );
  const configuration = {
    basePriceMinor: item.priceMinor,
    variants: item.variants.map((v, i) => ({
      priceDeltaMinor: v.priceDeltaMinor!,
      sortOrder: i,
      available: true,
      isDefault: v.isDefault,
      translations: importNameTranslations(v.name),
    })),
    modifierGroups: item.modifierGroups.map((g, i) => ({
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sortOrder: i,
      translations: importNameTranslations(g.name),
      options: g.options.map((o, j) => ({
        priceDeltaMinor: o.priceDeltaMinor!,
        sortOrder: j,
        available: true,
        translations: importNameTranslations(o.name),
      })),
    })),
  };
  try {
    assertProductMenuConfiguration(configuration);
  } catch {
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "Review variant defaults, prices and extra selection limits.",
    );
  }
  return { item, configuration };
}
export function importSessionStatus(states: readonly string[]) {
  if (
    states.length &&
    states.every((s) => s === "IMPORTED" || s === "REJECTED") &&
    states.includes("IMPORTED")
  )
    return "IMPORTED";
  if (states.length && states.every((s) => s === "REJECTED")) return "REJECTED";
  if (
    states.length &&
    states.every((s) => s === "APPROVED" || s === "REJECTED")
  )
    return "APPROVED";
  return "NEEDS_REVIEW";
}
export function importPriceText(minor: number | null, currency: string) {
  if (minor === null) return "";
  const digits = currencyDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}
// The canonical menu/editor stores hundredths for every venue currency.
// Intl display defaults (e.g. ALL = zero fraction digits) are not storage units.
function currencyDigits(_currency: string) {
  return 2;
}
export function importPriceMinor(
  text: string,
  currency: string,
): number | null {
  if (!text.trim()) return null;
  const normalized = text.trim().replace(",", ".");
  const digits = currencyDigits(currency);
  if (
    !new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(1, digits)}})?$`).test(normalized)
  )
    throw new SetupImportError("INVALID_INPUT", "Enter one unambiguous price.");
  const minor = Number(normalized) * 10 ** digits;
  if (Math.abs(minor - Math.round(minor)) > 0.00001 || minor > 100_000_000)
    throw new SetupImportError("INVALID_INPUT", "Invalid price precision.");
  return Math.round(minor);
}

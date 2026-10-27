import { z } from "zod";
import {
  reviewedMenuItemSchema,
  validateReviewedMenuItem,
} from "./menu-import";
import { SetupImportError } from "./smart-setup";
import { premiumStyleIdSchema } from "./premium-showcase";
import { WEEKDAYS } from "./venue-website";
import { businessProfileIds } from "./business-profile";

export const businessImportFieldNames = [
  "venueName",
  "description",
  "businessType",
  "address",
  "phone",
  "contactEmail",
  "openingHours",
  "instagramUrl",
  "facebookUrl",
  "seoTitle",
  "seoDescription",
  "primaryColor",
] as const;
const identifier = z.string().min(1).max(100);
export const businessEvidenceSchema = z
  .strictObject({
    sourceId: identifier,
    sourceUrl: z.string().max(2048).nullable(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    excerpt: z.string().max(1000),
    method: z.enum(["JSON_LD", "HTML", "PDF_TEXT", "RENDERED_HTML", "AI"]),
    status: z.enum(["SOURCE_OBSERVED", "UNVERIFIED"]),
    confidence: z.number().min(0).max(1).nullable(),
  })
  .refine(
    (evidence) => evidence.method !== "AI" || evidence.status === "UNVERIFIED",
    "AI evidence must stay unverified.",
  );
export const businessFieldSchema = z.strictObject({
  id: identifier,
  field: z.enum(businessImportFieldNames),
  value: z.string().max(4000),
  evidence: businessEvidenceSchema,
});
export const businessImageSchema = z.strictObject({
  id: identifier,
  url: z.url().max(2048),
  label: z.string().max(200),
  evidence: businessEvidenceSchema,
  assetId: identifier.nullable(),
});
export const fieldDecisionSchema = z.strictObject({
  field: z.enum(businessImportFieldNames),
  proposalId: identifier.nullable(),
  value: z.string().max(4000),
  decision: z.enum(["PENDING", "APPROVE", "REJECT"]),
});
export const businessItemDecisionSchema = z.strictObject({
  id: identifier,
  item: reviewedMenuItemSchema,
  action: z.enum(["PENDING", "ADD", "UPDATE", "SKIP"]),
  targetProductId: identifier.nullable(),
  approvePrice: z.boolean(),
  approveConfiguration: z.boolean(),
});
export const businessMediaDecisionSchema = z.strictObject({
  candidateId: identifier,
  assetId: identifier,
  targetItemId: identifier.nullable(),
  role: z.enum(["PRIMARY", "GALLERY", "LOGO", "HERO"]),
  rightsConfirmed: z.literal(true),
});
export const businessReviewSchema = z.strictObject({
  canonicalRevision: z.string().regex(/^[a-f0-9]{64}$/),
  expectedVersion: z.number().int().nonnegative(),
  fields: z.array(fieldDecisionSchema).max(businessImportFieldNames.length),
  items: z.array(businessItemDecisionSchema).max(150),
  media: z.array(businessMediaDecisionSchema).max(50),
  premiumStyleId: premiumStyleIdSchema.nullable(),
  confirm: z.boolean(),
});
export type BusinessReview = z.infer<typeof businessReviewSchema>;
export const businessImportStateSchema = z.strictObject({
  schemaVersion: z.literal(2),
  url: z.url().max(2048).nullable(),
  authorized: z.literal(true),
  phase: z.enum([
    "SOURCES",
    "ANALYZING",
    "REVIEW",
    "COMMITTED",
    "REVERTED",
    "CANCELLED",
  ]),
  fields: z.array(businessFieldSchema).max(100),
  images: z.array(businessImageSchema).max(50),
  warnings: z.array(z.string().max(300)).max(50),
  review: businessReviewSchema.nullable(),
  requestKey: z.string().uuid().nullable(),
  attempts: z.number().int().min(0).max(3),
});
export type BusinessImportState = z.infer<typeof businessImportStateSchema>;
export function isUnfinishedBusinessImport(
  phase: BusinessImportState["phase"],
) {
  return ["SOURCES", "ANALYZING", "REVIEW"].includes(phase);
}
export function assertBusinessImportDiscard(
  state: BusinessImportState,
  imported: boolean,
) {
  if (
    imported ||
    (!isUnfinishedBusinessImport(state.phase) && state.phase !== "CANCELLED")
  )
    throw new SetupImportError(
      "CONFLICT",
      "Only an unfinished import can be cancelled.",
    );
}
export type BusinessField = z.infer<typeof businessFieldSchema>;
export type BusinessImage = z.infer<typeof businessImageSchema>;
export const businessImportCreateSchema = z.strictObject({
  requestKey: z.string().uuid(),
  locale: z.enum(["sq", "de", "en", "it"]),
  url: z.url().max(2048).nullable(),
  authorized: z.literal(true),
});
export const businessHoursSchema = z
  .array(
    z.strictObject({
      day: z.enum(WEEKDAYS),
      closed: z.boolean(),
      opensAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      closesAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    }),
  )
  .max(7)
  .refine((rows) => new Set(rows.map((r) => r.day)).size === rows.length);

export function validateBusinessField(
  field: (typeof businessImportFieldNames)[number],
  value: string,
) {
  if (field === "businessType") return z.enum(businessProfileIds).parse(value);
  if (field === "openingHours")
    return businessHoursSchema.parse(JSON.parse(value));
  if (field === "contactEmail" && value) z.email().max(254).parse(value);
  if (["instagramUrl", "facebookUrl"].includes(field) && value) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new SetupImportError("INVALID_INPUT");
  }
  if (field === "primaryColor")
    z.string()
      .regex(/^#[a-f0-9]{6}$/i)
      .parse(value);
  if (field === "venueName") z.string().trim().min(1).max(160).parse(value);
  if (field === "phone") z.string().max(60).parse(value);
  if (field === "address") z.string().max(300).parse(value);
  if (["seoTitle", "businessType"].includes(field))
    z.string().max(120).parse(value);
  if (field === "seoDescription") z.string().max(280).parse(value);
  return value;
}

export function validateBusinessReview(
  input: BusinessReview,
  state: BusinessImportState,
  currency: string,
  itemIds: string[],
) {
  if (
    new Set(input.fields.map((f) => f.field)).size !== input.fields.length ||
    new Set(input.items.map((i) => i.id)).size !== input.items.length ||
    input.items.length !== itemIds.length ||
    input.items.some((i) => !itemIds.includes(i.id))
  )
    throw new SetupImportError("INVALID_INPUT");
  for (const field of input.fields) {
    if (
      field.proposalId &&
      !state.fields.some(
        (p) => p.id === field.proposalId && p.field === field.field,
      )
    )
      throw new SetupImportError("NOT_FOUND");
    if (field.decision === "APPROVE")
      validateBusinessField(field.field, field.value);
  }
  for (const media of input.media) {
    if (
      !state.images.some(
        (i) => i.id === media.candidateId && i.assetId === media.assetId,
      )
    )
      throw new SetupImportError("NOT_FOUND");
    if (
      media.targetItemId &&
      !input.items.some(
        (i) =>
          i.id === media.targetItemId && ["ADD", "UPDATE"].includes(i.action),
      )
    )
      throw new SetupImportError("REVIEW_REQUIRED");
    if (
      media.targetItemId
        ? !["PRIMARY", "GALLERY"].includes(media.role)
        : !["LOGO", "HERO", "GALLERY"].includes(media.role)
    )
      throw new SetupImportError("INVALID_INPUT");
  }
  const mediaSlots = input.media
    .filter((row) => row.role !== "GALLERY")
    .map((row) => `${row.targetItemId ?? "venue"}:${row.role}`);
  if (
    new Set(input.media.map((row) => row.candidateId)).size !==
      input.media.length ||
    new Set(mediaSlots).size !== mediaSlots.length
  )
    throw new SetupImportError(
      "REVIEW_REQUIRED",
      "Choose one photograph per primary, logo or hero position.",
    );
  if (
    new Set(
      input.items
        .filter((i) => i.action === "UPDATE")
        .map((i) => i.targetProductId),
    ).size !== input.items.filter((i) => i.action === "UPDATE").length
  )
    throw new SetupImportError("CONFLICT");
  if (!input.confirm) return;
  if (
    input.fields.some((f) => f.decision === "PENDING") ||
    state.fields.some((f) => !input.fields.some((r) => r.field === f.field)) ||
    input.items.some((i) => i.action === "PENDING")
  )
    throw new SetupImportError("REVIEW_REQUIRED");
  for (const row of input.items.filter((i) => i.action !== "SKIP")) {
    assertBusinessReviewItem(row, currency);
  }
}
function assertBusinessReviewItem(
  row: BusinessReview["items"][number],
  currency: string,
) {
  if (
    row.action === "PENDING" ||
    !row.approvePrice ||
    !row.approveConfiguration ||
    (row.action === "UPDATE" && !row.targetProductId) ||
    (row.action === "ADD" && row.targetProductId)
  )
    throw new SetupImportError("REVIEW_REQUIRED");
  validateReviewedMenuItem(row.item, currency, []);
}
export function businessReviewReadiness(
  input: BusinessReview,
  state: BusinessImportState,
  currency: string,
  itemIds: string[],
) {
  const pendingFields = input.fields
    .filter((f) => f.decision === "PENDING")
    .map((f) => f.field);
  const incompleteItems = input.items
    .filter((row) => {
      if (row.action === "SKIP") return false;
      try {
        assertBusinessReviewItem(row, currency);
        return false;
      } catch {
        return true;
      }
    })
    .map((row) => row.id);
  let ready = true;
  try {
    validateBusinessReview(
      { ...input, confirm: true },
      state,
      currency,
      itemIds,
    );
  } catch {
    ready = false;
  }
  return {
    ready,
    pendingFields,
    incompleteItems,
    selectedProducts: input.items.filter(
      (i) => i.action === "ADD" || i.action === "UPDATE",
    ).length,
    skippedProducts: input.items.filter((i) => i.action === "SKIP").length,
  };
}

export function assertBusinessImportVersion(actual: number, expected: number) {
  if (actual !== expected)
    throw new SetupImportError(
      "CONFLICT",
      "The import changed. Reload the saved review.",
    );
}

export function assertBusinessImportRevert(input: {
  currentHash: string;
  importedHash: string;
  published: boolean;
  usedByOrders: boolean;
}) {
  if (
    input.currentHash !== input.importedHash ||
    input.published ||
    input.usedByOrders
  )
    throw new SetupImportError(
      "CONFLICT",
      "The imported data changed or was used. Restore only an unchanged private draft.",
    );
}

import sharp from "sharp";
import {
  composeCreativeBrief,
  creativeMaterialNames,
  creativeMentionedProducts,
  createDesign,
  CreativeError,
  type CreativeBrief,
  type CreativeBinding,
  type CreativeScope,
} from "@flowgastronomie/domain";
import {
  prisma,
  creativeRepository,
  creativeScope,
  creativeJson,
  creativeSourceCatalog,
  resolveCreativeBinding,
} from "@flowgastronomie/database";
import { creativeStorage } from "./creative-storage.js";
import {
  importCanonicalCreativeAsset,
  isCanonicalReviewAsset,
} from "./creative-canonical-media.js";

export async function importCreativeBrandAsset(
  staff: CreativeScope,
  id: string,
) {
  const asset = await prisma.websiteAsset.findFirst({
    where: { ...creativeScope(staff), id },
  });
  if (!asset) throw new CreativeError("NOT_FOUND");
  const prior = await prisma.creativeAsset.findFirst({
    where: {
      ...creativeScope(staff),
      source: "VENUE_LIBRARY",
      AND: [
        { provenance: { path: ["sourceId"], equals: asset.id } },
        {
          provenance: {
            path: ["sourceVersion"],
            equals: asset.updatedAt.toISOString(),
          },
        },
      ],
    },
  });
  if (prior) return prior;
  const result = await sharp(Buffer.from(asset.bytes), {
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  const key = await creativeStorage.put(result.data);
  return prisma.creativeAsset.create({
    data: {
      ...creativeScope(staff),
      name: asset.kind === "LOGO" ? "Venue logo" : "Venue image",
      source: "VENUE_LIBRARY",
      mimeType: "image/png",
      width: result.info.width,
      height: result.info.height,
      contentHash: key,
      storageKey: key,
      provenance: creativeJson({
        sourceId: asset.id,
        sourceVersion: asset.updatedAt.toISOString(),
        catalog: {
          kind: asset.kind === "LOGO" ? "LOGO" : "VENUE",
          productId: null,
        },
      }),
      approvedForPublicUse: true,
      approvedBy: staff.userId,
      createdBy: staff.userId,
    },
  });
}
export function creativeAssetCatalog(provenance: unknown) {
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance)
  )
    return { kind: "ARTWORK", productId: null };
  const catalog = (provenance as Record<string, unknown>).catalog;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog))
    return { kind: "ARTWORK", productId: null };
  const value = catalog as Record<string, unknown>;
  return {
    kind: typeof value.kind === "string" ? value.kind : "ARTWORK",
    productId: typeof value.productId === "string" ? value.productId : null,
  };
}
export async function composeCreativeProject(
  staff: CreativeScope,
  brief: CreativeBrief,
) {
  const catalog = await creativeSourceCatalog(staff, brief.locale);
  for (const row of catalog.media.venue)
    await importCanonicalCreativeAsset(staff, row.media.id, {
      kind: row.role === "LOGO" ? "LOGO" : "VENUE",
      productId: null,
    });
  for (const row of catalog.media.products)
    await importCanonicalCreativeAsset(staff, row.media.id, {
      kind: "PRODUCT",
      productId: row.productId,
    });
  if (!catalog.media.venue.length)
    for (const asset of catalog.websiteAssets)
      await importCreativeBrandAsset(staff, asset.id);
  const mentioned = creativeMentionedProducts(
    brief.instruction,
    catalog.products,
  );
  const selectedIds = brief.productIds.length
    ? brief.productIds
    : mentioned.length
      ? mentioned
      : brief.material === "MENU"
        ? catalog.products.map((p) => p.id)
        : [];
  if (selectedIds.length > 40)
    throw new CreativeError(
      "INVALID_DESIGN",
      "Choose up to 40 products for one menu page.",
    );
  if (selectedIds.some((id) => !catalog.products.some((p) => p.id === id)))
    throw new CreativeError("UNRESOLVED_SOURCE");
  const inputs: Omit<CreativeBinding, "version" | "value">[] = [
    {
      id: "venue",
      sourceId: staff.venueId,
      sourceType: "VENUE",
      field: "name",
    },
  ];
  for (const id of [...new Set(selectedIds)])
    for (const field of ["name", "price"] as const)
      inputs.push({
        id: `product_${id}_${field}`,
        sourceType: "PRODUCT",
        sourceId: id,
        field,
      });
  if (catalog.brand) {
    if (catalog.brand.status !== "PUBLISHED" && catalog.brand.address)
      inputs.push({
        id: "directions_qr",
        sourceType: "QR",
        sourceId: catalog.brand.id,
        field: "destination",
      });
    if (catalog.brand.status === "PUBLISHED")
      inputs.push({
        id: "website_qr",
        sourceType: "QR",
        sourceId: catalog.brand.id,
        field: "destination",
      });
    for (const field of ["address", "phone"] as const)
      if (catalog.brand[field])
        inputs.push({
          id: field,
          sourceType: "BRAND",
          sourceId: catalog.brand.id,
          field,
        });
  }
  const bindings = await Promise.all(
    inputs.map((input) =>
      resolveCreativeBinding(
        staff,
        { ...input, value: "", version: "" },
        brief.locale,
      ),
    ),
  );
  const available = await creativeRepository.assets(staff);
  if (
    brief.assetIds.some(
      (id) =>
        !available.some(
          (a) =>
            a.id === id &&
            (a.approvedForPublicUse || isCanonicalReviewAsset(a)),
        ),
    )
  )
    throw new CreativeError("UNAPPROVED_ASSET");
  const assets = available
    .filter((a) => a.approvedForPublicUse || isCanonicalReviewAsset(a))
    .map((a) => ({ id: a.id, ...creativeAssetCatalog(a.provenance) }));
  const chosen = brief.assetIds.length
    ? assets.filter((a) => brief.assetIds.includes(a.id) || a.kind === "LOGO")
    : assets.filter(
        (a) =>
          a.kind === "LOGO" ||
          a.kind === "VENUE" ||
          (a.productId && selectedIds.includes(a.productId)),
      );
  const theme = createDesign("A4", brief.locale).theme;
  if (catalog.brand) {
    theme.primary = catalog.brand.primaryColor;
    theme.accent = catalog.brand.accentColor;
  }
  const document = composeCreativeBrief(brief, bindings, chosen, theme);
  const project = await creativeRepository.create(
    staff,
    `${creativeMaterialNames[brief.locale][brief.material]} · ${catalog.venue.name}`,
    document,
  );
  return creativeRepository.save(
    staff,
    project.id,
    project.version,
    project.title,
    document,
    "Initial composition",
  );
}

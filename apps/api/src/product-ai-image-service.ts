import { createHash } from "node:crypto";
import {
  assertStaffPermission,
  createDesign,
  CreativeError,
  websiteDocumentSchema,
  imageProviders,
  type ImageProviderId,
} from "@flowgastronomie/domain";
import {
  prisma,
  creativeScope,
  creativeJson,
  canonicalMediaReference,
  type StaffIdentity,
  tenantImageUsage,
} from "@flowgastronomie/database";
import { generateCreativeAsset } from "./creative-image-service.js";
import { imageProviderConfigured } from "./creative-image-provider.js";
import {
  promoteCreativeMedia,
  importCanonicalCreativeAsset,
} from "./creative-canonical-media.js";

async function productContext(
  staff: StaffIdentity,
  productId: string,
  target = "products",
) {
  assertStaffPermission(staff.role, "CREATIVE_AI_USE");
  const scope = creativeScope(staff);
  let product;
  if (target === "website-sections") {
    const website = await prisma.venueWebsite.findFirst({ where: scope });
    const document = websiteDocumentSchema.safeParse(website?.document);
    const section = document.success
      ? document.data.sections.find((s) => s.id === productId)
      : undefined;
    if (!section) throw new CreativeError("NOT_FOUND");
    product = {
      translations: section.content.map((c) => ({
        locale: c.locale,
        name: c.title || section.type,
      })),
    };
  } else
    product = await prisma.product.findFirst({
      where: { ...scope, id: productId },
      include: { translations: true },
    });
  if (!product) throw new CreativeError("NOT_FOUND");
  const projectId = `product-photo-${createHash("sha256")
    .update(
      `${target === "products" ? "" : `${target}:`}${staff.tenantId}:${staff.venueId}:${productId}`,
    )
    .digest("hex")}`;
  return { scope, product, projectId };
}

export async function productImageHistory(
  staff: StaffIdentity,
  productId: string,
  target = "products",
) {
  const { scope, projectId } = await productContext(staff, productId, target);
  const jobs = await prisma.creativeJob.findMany({
    where: { ...scope, projectId, category: "IMAGE" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true,
      state: true,
      requestKey: true,
      resultId: true,
      createdAt: true,
      provider: true,
      model: true,
    },
  });
  const usage = await tenantImageUsage(staff.tenantId);
  const providers = usage.providers.map((p) => ({
    id: p.provider,
    model:
      p.provider === "meta"
        ? "muse-image-1.0"
        : p.provider === "ideogram"
          ? "ideogram-4-5"
          : (process.env.CREATIVE_IMAGE_MODEL ?? "gpt-image-2.5-flare"),
    enabled:
      p.enabled &&
      p.used < p.limit &&
      !usage.emergencyDisabled &&
      imageProviderConfigured(p.provider),
    used: p.used,
    limit: p.limit,
  }));
  const hasCurrentPhoto =
    target === "products" &&
    !!(await prisma.productMedia.findFirst({
      where: { ...scope, productId, role: "PRIMARY" },
      select: { id: true },
    }));
  return {
    enabled: providers.some((p) => p.enabled),
    providers,
    hasCurrentPhoto,
    jobs,
  };
}

export async function generateProductImage(
  staff: StaffIdentity,
  productId: string,
  input: {
    prompt: string;
    requestKey: string;
    locale: "sq" | "de" | "en" | "it";
    provider?: ImageProviderId | undefined;
    sourceAssetId?: string | null | undefined;
    editCurrent?: boolean | undefined;
  },
  target = "products",
) {
  const { scope, product, projectId } = await productContext(
    staff,
    productId,
    target,
  );
  const provider = input.provider ?? "openai";
  if (!imageProviders.includes(provider) || !imageProviderConfigured(provider))
    throw new CreativeError(
      "UNAVAILABLE",
      "This image provider is not configured.",
    );
  if (input.editCurrent && input.sourceAssetId)
    throw new CreativeError("INVALID_DESIGN", "Choose one source photo.");
  let sourceAssetId = input.sourceAssetId ?? null;
  if (input.editCurrent) {
    if (target !== "products")
      throw new CreativeError(
        "INVALID_DESIGN",
        "This image has no product photo source.",
      );
    const current = await prisma.productMedia.findFirst({
      where: { ...scope, productId, role: "PRIMARY" },
      select: { mediaAssetId: true },
    });
    if (!current)
      throw new CreativeError(
        "NOT_FOUND",
        "The current product photo was not found.",
      );
    sourceAssetId = (
      await importCanonicalCreativeAsset(staff, current.mediaAssetId, {
        kind: "PRODUCT",
        productId,
      })
    ).id;
  }
  const name =
    product.translations.find((t) => t.locale.toLowerCase() === input.locale)
      ?.name ??
    product.translations[0]?.name ??
    "Product";
  const document = createDesign("SQUARE", input.locale);
  // A photo can be prepared for an unpublished product. It is not a public
  // design binding; the already-authorized product association stays on the asset.
  // Stable, scoped Creative project gives refresh/retry the same durable job
  // identity. Product images share the existing provider, quotas and asset store.
  await prisma.creativeProject.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      ...scope,
      title:
        `${target === "products" ? "Product photo" : "Website illustration"}: ${name}`.slice(
          0,
          120,
        ),
      format: document.format,
      locale: input.locale,
      document: creativeJson(document),
      createdBy: staff.userId,
      updatedBy: staff.userId,
    },
  });
  return generateCreativeAsset(staff, projectId, {
    prompt: input.prompt,
    requestKey: input.requestKey,
    sourceLayerId: null,
    sourceAssetId,
    provider,
    ...(target === "products" ? { productId } : {}),
  });
}

export async function approveProductImage(
  staff: StaffIdentity,
  productId: string,
  assetId: string,
  target = "products",
) {
  const { scope, projectId } = await productContext(staff, productId, target);
  const job = await prisma.creativeJob.findFirst({
    where: {
      ...scope,
      projectId,
      category: "IMAGE",
      state: "SUCCEEDED",
      resultId: assetId,
    },
  });
  if (!job) throw new CreativeError("NOT_FOUND");
  const result = await promoteCreativeMedia(
    staff,
    assetId,
    target === "products" ? { productId } : { website: true },
    true,
  );
  const media = await prisma.mediaAsset.findFirstOrThrow({
    where: { ...scope, id: result.mediaAssetId },
  });
  return canonicalMediaReference(media);
}

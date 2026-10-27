import { createHash } from "node:crypto";
import {
  assertStaffPermission,
  CreativeError,
  type CreativeBinding,
  type CreativeScope,
  type DesignDocument,
} from "@flowgastronomie/domain";
import type { Locale } from "@prisma/client";
import { prisma } from "./client.js";
import { creativeScope } from "./creative-repository.js";
import { canonicalMediaRepository } from "./canonical-media-repository.js";
export function creativeSourceVersion(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function publicOrigin() {
  const value = process.env.CREATIVE_PUBLIC_ORIGIN ?? process.env.WEB_ORIGIN;
  if (!value)
    throw new CreativeError(
      "UNRESOLVED_SOURCE",
      "Configure the public venue origin before adding QR codes.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new CreativeError("UNRESOLVED_SOURCE");
  return url.origin;
}
export async function creativeSourceCatalog(
  staff: CreativeScope,
  locale: DesignDocument["locale"],
) {
  assertStaffPermission(staff.role, "CREATIVE_VIEW");
  const scope = creativeScope(staff);
  const [venue, website, categories, products, tables, websiteAssets] =
    await Promise.all([
      prisma.venue.findFirst({
        where: { id: scope.venueId, tenantId: scope.tenantId },
        select: { id: true, name: true, defaultLocale: true, currency: true },
      }),
      prisma.venueWebsite.findFirst({
        where: scope,
        select: {
          id: true,
          primaryColor: true,
          accentColor: true,
          logoUrl: true,
          address: true,
          phone: true,
          openingHours: true,
          publicSlug: true,
          status: true,
          updatedAt: true,
        },
      }),
      prisma.menuCategory.findMany({
        where: { ...scope, published: true },
        include: { translations: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.product.findMany({
        where: { ...scope, published: true, category: { published: true } },
        include: {
          translations: true,
          variants: {
            where: { available: true },
            include: { translations: true },
          },
        },
        orderBy: { sortOrder: "asc" },
        take: 200,
      }),
      prisma.diningTable.findMany({
        where: { ...scope, qrRevokedAt: null },
        select: { id: true, label: true },
      }),
      prisma.websiteAsset.findMany({
        where: scope,
        select: { id: true, kind: true, mimeType: true },
      }),
    ]);
  if (!venue) throw new CreativeError("NOT_FOUND");
  const media = await canonicalMediaRepository.resolve(scope);
  const translated = <T extends { locale: Locale; name: string }>(
    values: T[],
  ) =>
    values.find((v) => v.locale === locale.toUpperCase()) ??
    values.find((v) => v.locale === venue.defaultLocale);
  return {
    venue,
    brand: website,
    categories: categories.map((c) => ({
      id: c.id,
      name: translated(c.translations)?.name ?? "",
    })),
    products: products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: translated(p.translations)?.name ?? "",
      description: translated(p.translations)?.description ?? "",
      price: new Intl.NumberFormat(locale, {
        style: "currency",
        currency: p.currency,
      }).format(p.priceMinor / 100),
      variants: p.variants.map((v) => ({
        id: v.id,
        name: translated(v.translations)?.name ?? "",
      })),
    })),
    tables,
    websiteAssets,
    media,
  };
}
export async function resolveCreativeBinding(
  staff: CreativeScope,
  binding: CreativeBinding,
  locale: DesignDocument["locale"],
): Promise<CreativeBinding> {
  assertStaffPermission(staff.role, "CREATIVE_VIEW");
  const scope = creativeScope(staff);
  let value: string | undefined;
  let marker: unknown;
  const venue = await prisma.venue.findFirst({
    where: { id: scope.venueId, tenantId: scope.tenantId },
    select: { defaultLocale: true, name: true },
  });
  if (!venue) throw new CreativeError("UNRESOLVED_SOURCE");
  const translated = <T extends { locale: Locale; name: string }>(
    values: T[],
  ) =>
    values.find((v) => v.locale === locale.toUpperCase()) ??
    values.find((v) => v.locale === venue.defaultLocale);
  if (binding.sourceType === "PRODUCT" || binding.sourceType === "VARIANT") {
    const product = await prisma.product.findFirst({
      where: {
        ...scope,
        published: true,
        category: { published: true },
        ...(binding.sourceType === "PRODUCT"
          ? { id: binding.sourceId }
          : {
              variants: {
                some: { id: binding.sourceId, ...scope, available: true },
              },
            }),
      },
      include: {
        translations: true,
        variants: {
          where: { id: binding.sourceId, ...scope, available: true },
          include: { translations: true },
        },
      },
    });
    if (product) {
      const variant =
        binding.sourceType === "VARIANT" ? product.variants[0] : undefined;
      if (binding.field === "price")
        value = new Intl.NumberFormat(locale, {
          style: "currency",
          currency: product.currency,
        }).format((product.priceMinor + (variant?.priceDeltaMinor ?? 0)) / 100);
      if (binding.field === "name")
        value = variant
          ? `${translated(product.translations)?.name ?? ""} · ${translated(variant.translations)?.name ?? ""}`
          : translated(product.translations)?.name;
      if (binding.field === "description" && !variant)
        value = translated(product.translations)?.description ?? undefined;
    }
  } else if (binding.sourceType === "CATEGORY" && binding.field === "name") {
    const category = await prisma.menuCategory.findFirst({
      where: { ...scope, id: binding.sourceId, published: true },
      include: { translations: true },
    });
    if (category) value = translated(category.translations)?.name;
  } else if (
    binding.sourceType === "VENUE" &&
    binding.sourceId === staff.venueId &&
    binding.field === "name"
  )
    value = venue.name;
  else if (["BRAND", "HOURS", "QR"].includes(binding.sourceType)) {
    const website = await prisma.venueWebsite.findFirst({
      where: { ...scope, id: binding.sourceId },
    });
    if (website) {
      if (binding.sourceType === "BRAND") {
        if (binding.field === "primaryColor") value = website.primaryColor;
        if (binding.field === "accentColor") value = website.accentColor;
        if (binding.field === "address") value = website.address ?? undefined;
        if (binding.field === "phone") value = website.phone ?? undefined;
        if (binding.field === "website" && website.status === "PUBLISHED")
          value = `${publicOrigin()}/${locale}/venue/${website.publicSlug}`;
      }
      if (binding.sourceType === "HOURS" && binding.field === "hours")
        value = Array.isArray(website.openingHours)
          ? website.openingHours
              .flatMap((entry) => {
                if (!entry || typeof entry !== "object" || Array.isArray(entry))
                  return [];
                const days = [
                  "MONDAY",
                  "TUESDAY",
                  "WEDNESDAY",
                  "THURSDAY",
                  "FRIDAY",
                  "SATURDAY",
                  "SUNDAY",
                ];
                const index = days.indexOf(String(entry.day));
                if (index < 0) return [];
                if (
                  !entry.closed &&
                  (typeof entry.opensAt !== "string" ||
                    typeof entry.closesAt !== "string" ||
                    !/^\d{2}:\d{2}$/.test(entry.opensAt) ||
                    !/^\d{2}:\d{2}$/.test(entry.closesAt))
                )
                  return [];
                const day = new Intl.DateTimeFormat(locale, {
                  weekday: "short",
                  timeZone: "UTC",
                }).format(new Date(Date.UTC(2026, 0, 5 + index)));
                const closed = {
                  en: "Closed",
                  de: "Geschlossen",
                  it: "Chiuso",
                  sq: "Mbyllur",
                }[locale];
                return [
                  `${day}: ${entry.closed ? closed : `${entry.opensAt}–${entry.closesAt}`}`,
                ];
              })
              .join("\n")
          : undefined;
      if (
        binding.sourceType === "QR" &&
        binding.field === "destination" &&
        website.status === "PUBLISHED"
      ) {
        // Only the fixed venue/order routes can be selected; no arbitrary URLs.
        const ordering = binding.value.includes(`/${locale}/order/`);
        value = `${publicOrigin()}/${locale}/${ordering ? "order" : "venue"}/${website.publicSlug}`;
      }
      if (
        binding.sourceType === "QR" &&
        binding.id === "directions_qr" &&
        binding.field === "destination" &&
        website.address
      ) {
        value = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(website.address)}`;
      }
    }
  } else if (
    binding.sourceType === "TABLE_QR" &&
    binding.field === "destination"
  ) {
    const table = await prisma.diningTable.findFirst({
      where: { ...scope, id: binding.sourceId, qrRevokedAt: null },
    });
    let token = "";
    try {
      token = new URL(binding.value).pathname.split("/").at(-1) ?? "";
    } catch {
      /* unresolved */
    }
    if (
      table &&
      /^[a-zA-Z0-9_-]{24,100}$/.test(token) &&
      creativeSourceVersionToken(token) === table.qrTokenHash
    ) {
      value = `${publicOrigin()}/${locale}/menu/${token}`;
      marker = table.qrTokenHash;
    }
  }
  if (value === undefined || value === "")
    throw new CreativeError(
      "UNRESOLVED_SOURCE",
      "A selected source is unavailable, unpublished or revoked.",
    );
  return {
    ...binding,
    value,
    version: creativeSourceVersion([
      binding.sourceType,
      binding.sourceId,
      binding.field,
      locale,
      value,
      marker ?? null,
    ]),
  };
}
function creativeSourceVersionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function resolveCreativeDocument(
  staff: CreativeScope,
  document: DesignDocument,
) {
  return Promise.all(
    document.bindings.map((binding) =>
      resolveCreativeBinding(staff, binding, document.locale),
    ),
  );
}
export async function resolveCreativeSave(
  staff: CreativeScope,
  document: DesignDocument,
) {
  const resolved = await Promise.all(
    document.bindings.map(async (binding) => {
      try {
        return await resolveCreativeBinding(staff, binding, document.locale);
      } catch (error) {
        if (
          error instanceof CreativeError &&
          error.code === "UNRESOLVED_SOURCE"
        )
          return null;
        throw error;
      }
    }),
  );
  return resolved.filter((b): b is CreativeBinding => b !== null);
}

export const WEBSITE_DOMAIN_STATUSES = [
  "PENDING",
  "VERIFIED",
  "ACTIVE",
  "FAILED",
] as const;

export type WebsiteDomainStatus = (typeof WEBSITE_DOMAIN_STATUSES)[number];

export const WEBSITE_ASSET_KINDS = ["LOGO", "HERO"] as const;
export type WebsiteAssetKind = (typeof WEBSITE_ASSET_KINDS)[number];

export const WEBSITE_ASSET_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type WebsiteAssetMimeType = (typeof WEBSITE_ASSET_MIME_TYPES)[number];

export const WEBSITE_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOM_DOMAIN_TARGET = "domains.flowgastronomie.site";

export function normalizeWebsiteDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function isValidWebsiteDomain(value: string): boolean {
  const domain = normalizeWebsiteDomain(value);
  if (
    domain.length < 4 ||
    domain.length > 253 ||
    domain.includes("://") ||
    domain.includes("/") ||
    domain.includes(":") ||
    domain.startsWith("*.") ||
    domain === "localhost" ||
    domain.endsWith(".localhost") ||
    domain === "restaurantflow.site" ||
    domain.endsWith(".restaurantflow.site") ||
    domain === "flowgastronomie.site" ||
    domain.endsWith(".flowgastronomie.site") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(domain)
  ) {
    return false;
  }

  const labels = domain.split(".");
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) &&
    /^[a-z]{2,63}$/.test(labels.at(-1) ?? "")
  );
}

export function websiteDomainVerificationRecord(domain: string, token: string) {
  return {
    type: "TXT" as const,
    name: `_flowgastronomie.${normalizeWebsiteDomain(domain)}`,
    value: `flowgastronomie-verification=${token}`,
  };
}

export function canActivateWebsiteDomain(status: WebsiteDomainStatus): boolean {
  return status === "VERIFIED" || status === "ACTIVE";
}

export function isSupportedWebsiteAsset(
  mimeType: string,
  byteLength: number,
): mimeType is WebsiteAssetMimeType {
  return (
    WEBSITE_ASSET_MIME_TYPES.includes(mimeType as WebsiteAssetMimeType) &&
    byteLength > 0 &&
    byteLength <= WEBSITE_ASSET_MAX_BYTES
  );
}

export function websiteAssetInputKey(
  field: "logoUrl" | "heroImageUrl",
  value: string | null,
) {
  return `${field}:${value ?? "empty"}`;
}

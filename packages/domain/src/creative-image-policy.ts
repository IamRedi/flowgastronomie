import type { DesignDocument } from "./creative";

export type CreativeImageOutputPolicy = {
  width: 1024 | 1536;
  height: 1024;
  quality: "medium" | "high";
  purpose: "PRINT_HERO" | "SQUARE_ARTWORK";
};

// Product policy, chosen from the saved document, never from client controls.
export function creativeImageOutputPolicy(
  document: Pick<DesignDocument, "format">,
): CreativeImageOutputPolicy {
  return document.format === "A4"
    ? { width: 1536, height: 1024, quality: "high", purpose: "PRINT_HERO" }
    : {
        width: 1024,
        height: 1024,
        quality: "medium",
        purpose: "SQUARE_ARTWORK",
      };
}

export function canReviewGeneratedCreativeAsset(kind: string, source: string) {
  return (kind === "LOCAL_PILOT" || kind === "DEMO") && source === "GENERATED";
}

export function creativeReviewDisclosure(
  demo: boolean,
  generated: boolean,
  sample: boolean,
) {
  return `INTERNAL REVIEW${demo ? " · DEMO image" : ""}${generated ? " · AI-generated image · not actual venue food" : ""}${sample ? " · SAMPLE PRICE" : ""}`;
}

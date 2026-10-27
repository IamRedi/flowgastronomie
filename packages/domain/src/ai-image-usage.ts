import { CreativeError } from "./creative";

export const imageProviders = ["meta", "openai", "ideogram"] as const;
export type ImageProviderId = (typeof imageProviders)[number];

export const defaultMonthlyImageLimits: Record<ImageProviderId, number> = {
  meta: 100,
  openai: 30,
  ideogram: 30,
};

export function imageMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export function nextImageMonthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}

export function assertImageAllowance(input: {
  provider: ImageProviderId;
  attempts: number;
  limit: number;
  enabled: boolean;
  emergencyDisabled: boolean;
}) {
  if (input.emergencyDisabled)
    throw new CreativeError(
      "UNAVAILABLE",
      "AI images are temporarily disabled.",
    );
  if (!input.enabled)
    throw new CreativeError("UNAVAILABLE", "This image provider is disabled.");
  if (!Number.isSafeInteger(input.limit) || input.limit < 0)
    throw new CreativeError("INVALID_DESIGN", "Invalid image limit.");
  if (input.attempts >= input.limit)
    throw new CreativeError(
      "RATE_LIMIT",
      `Monthly ${input.provider} image limit reached (${input.limit}). Contact the platform administrator.`,
    );
}

// USD estimates are deliberately separate from SaaS credits and invoices.
// Rates are a replaceable catalog; a missing OpenAI token split stays unknown.
export const imagePriceCatalog = {
  metaPerImageUsd: 0.01,
  ideogram45MediumPerImageUsd: 0.06,
  openaiFlareTextInputPerMillionUsd: 5,
  openaiFlareImageInputPerMillionUsd: 8,
  openaiFlareImageOutputPerMillionUsd: 30,
} as const;

export function estimateImageCostUsd(
  provider: ImageProviderId,
  model: string,
  usage: {
    images: number;
    inputTokens?: number;
    outputTokens?: number;
    providerUsage?: unknown;
  },
): number | null {
  if (provider === "meta")
    return usage.images * imagePriceCatalog.metaPerImageUsd;
  if (provider === "ideogram")
    return usage.images * imagePriceCatalog.ideogram45MediumPerImageUsd;
  if (model !== "gpt-image-2.5-flare") return null;
  const details = (
    usage.providerUsage as
      | {
          input_tokens_details?: {
            text_tokens?: number;
            image_tokens?: number;
          };
        }
      | undefined
  )?.input_tokens_details;
  if (
    !details ||
    typeof details.text_tokens !== "number" ||
    typeof details.image_tokens !== "number" ||
    typeof usage.outputTokens !== "number"
  )
    return null;
  return (
    (details.text_tokens * imagePriceCatalog.openaiFlareTextInputPerMillionUsd +
      details.image_tokens *
        imagePriceCatalog.openaiFlareImageInputPerMillionUsd +
      usage.outputTokens *
        imagePriceCatalog.openaiFlareImageOutputPerMillionUsd) /
    1_000_000
  );
}

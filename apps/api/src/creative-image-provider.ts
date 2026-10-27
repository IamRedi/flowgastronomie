import {
  CreativeError,
  type CreativeImageOutputPolicy,
} from "@flowgastronomie/domain";
import type { CreativeProviderUsage } from "./creative-providers.js";
export type CreativeImageRequest = {
  prompt: string;
  requestKey: string;
  output: CreativeImageOutputPolicy;
};
export type CreativeGeneratedAsset = {
  bytes: Buffer;
  mimeType: "image/png";
  usage: CreativeProviderUsage;
  requestId?: string | undefined;
};
export interface CreativeImageProvider {
  readonly provider: string;
  readonly model: string;
  generateAsset(request: CreativeImageRequest): Promise<CreativeGeneratedAsset>;
  editAsset(
    request: CreativeImageRequest & { source: Buffer },
  ): Promise<CreativeGeneratedAsset>;
}
export class OpenAICreativeImageProvider implements CreativeImageProvider {
  readonly provider = "openai";
  constructor(
    readonly model = process.env.CREATIVE_IMAGE_MODEL ?? "gpt-image-2.5-flare",
    private key = process.env.CREATIVE_OPENAI_API_KEY ?? "",
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    request: CreativeImageRequest,
    source?: Buffer,
  ): Promise<CreativeGeneratedAsset> {
    if (!this.key)
      throw new CreativeError(
        "UNAVAILABLE",
        "Image generation is not configured. Upload an image instead.",
      );
    const prompt = `Create only an illustrative promotional image asset. No text, numbers, prices, claims, logos, QR codes, borders or complete poster layout. Do not represent this as a real photograph of the venue's actual food. User art direction: ${request.prompt}`;
    let body: string | FormData;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      "Idempotency-Key": request.requestKey,
    };
    if (source) {
      const form = new FormData();
      form.set("model", this.model);
      form.set("prompt", prompt);
      form.set(
        "image",
        new Blob([new Uint8Array(source)], { type: "image/png" }),
        "source.png",
      );
      form.set("size", `${request.output.width}x${request.output.height}`);
      form.set("quality", request.output.quality);
      form.set("output_format", "png");
      form.set("n", "1");
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        model: this.model,
        prompt,
        n: 1,
        size: `${request.output.width}x${request.output.height}`,
        quality: request.output.quality,
        output_format: "png",
      });
    }
    try {
      const response = await this.fetcher(
        `https://api.openai.com/v1/images/${source ? "edits" : "generations"}`,
        // Exactly one attempt. An ambiguous timeout must never trigger a retry.
        { method: "POST", headers, body, signal: AbortSignal.timeout(300_000) },
      );
      if (!response.ok)
        throw new CreativeError(
          "UNAVAILABLE",
          `Image provider returned HTTP ${response.status}. No automatic retry was made.`,
        );
      const raw = await response.text();
      if (raw.length > 24_000_000) throw new Error("Oversize image");
      const result = JSON.parse(raw) as {
        data?: { b64_json?: string }[];
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          total_tokens?: number;
          input_tokens_details?: {
            text_tokens?: number;
            image_tokens?: number;
          };
        };
      };
      const encoded = result.data?.[0]?.b64_json;
      if (!encoded || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded))
        throw new Error("No image");
      return {
        bytes: Buffer.from(encoded, "base64"),
        mimeType: "image/png",
        requestId: response.headers.get("x-request-id") ?? undefined,
        usage: {
          inputTokens: Math.max(0, result.usage?.input_tokens ?? 0),
          outputTokens: Math.max(0, result.usage?.output_tokens ?? 0),
          images: 1,
          ...(result.usage ? { providerUsage: result.usage } : {}),
        },
      };
    } catch (error) {
      if (error instanceof CreativeError) throw error;
      throw new CreativeError(
        "UNAVAILABLE",
        "Image generation did not complete. Your design is unchanged. Retry explicitly if you want another attempt.",
      );
    }
  }
  generateAsset(request: CreativeImageRequest) {
    return this.request(request);
  }
  editAsset(request: CreativeImageRequest & { source: Buffer }) {
    return this.request(request, request.source);
  }
}

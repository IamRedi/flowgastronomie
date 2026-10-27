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
  mimeType: "image/png" | "image/jpeg" | "image/webp";
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
export function imageProviderConfigured(
  provider: "meta" | "openai" | "ideogram",
) {
  return !!(provider === "meta"
    ? process.env.CREATIVE_FAL_API_KEY
    : provider === "ideogram"
      ? process.env.CREATIVE_IDEOGRAM_API_KEY
      : process.env.CREATIVE_OPENAI_API_KEY);
}
export function selectCreativeImageProvider(
  provider: "meta" | "openai" | "ideogram",
): CreativeImageProvider {
  if (provider === "meta") return new FalMuseCreativeImageProvider();
  if (provider === "ideogram") return new IdeogramCreativeImageProvider();
  return new OpenAICreativeImageProvider();
}
const promotionalPrompt = (prompt: string, editing: boolean) =>
  `${editing ? "Edit the supplied image while preserving the original product identity and untouched details." : "Create an illustrative promotional image; do not imply it is a photograph of actual venue food."} Do not add text, numbers, prices, claims, logos, QR codes, borders or a complete poster layout. Art direction: ${prompt}`;
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
    const prompt = promotionalPrompt(request.prompt, !!source);
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

// fal.ai hosts Meta Muse Image without requiring direct Meta billing. Keep the
// existing "meta" provider identity so tenant quotas and admin controls are shared.
function simplifiedAspectRatio(width: number, height: number) {
  let a = width;
  let b = height;
  while (b) [a, b] = [b, a % b];
  return `${width / a}:${height / a}`;
}

export class FalMuseCreativeImageProvider implements CreativeImageProvider {
  readonly provider = "meta";
  readonly model = "muse-image-1.0-via-fal";
  constructor(
    private key = process.env.CREATIVE_FAL_API_KEY ?? "",
    private fetcher: typeof fetch = fetch,
  ) {}

  private async request(
    request: CreativeImageRequest,
    source?: Buffer,
  ): Promise<CreativeGeneratedAsset> {
    if (!this.key)
      throw new CreativeError(
        "UNAVAILABLE",
        "Meta via fal.ai is not configured. Upload an image instead.",
      );
    const endpoint = source ? "edit" : "text-to-image";
    const url = `https://fal.run/meta/muse-image/${endpoint}`;
    const input = {
      prompt: promotionalPrompt(request.prompt, !!source),
      aspect_ratio: simplifiedAspectRatio(
        request.output.width,
        request.output.height,
      ),
      num_images: 1,
      output_format: "png",
      // Returned data URI is private to this request, avoiding outbound
      // downloads from model-provided hosts and remote persistence.
      sync_mode: true,
      ...(source
        ? { image_urls: [`data:image/png;base64,${source.toString("base64")}`] }
        : {}),
    };
    try {
      // One paid submission only. Do not retry an ambiguous timeout.
      const response = await this.fetcher(url, {
        method: "POST",
        headers: {
          Authorization: `Key ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok)
        throw new CreativeError(
          "UNAVAILABLE",
          `fal.ai returned HTTP ${response.status}. No automatic retry was made.`,
        );
      const raw = await response.text();
      if (raw.length > 24_000_000) throw new Error("Oversize image response");
      const result = JSON.parse(raw) as {
        images?: { url?: string }[];
        request_id?: string;
      };
      const match =
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+\/=]+)$/.exec(
          result.images?.[0]?.url ?? "",
        );
      if (!match) throw new Error("No supported private image response");
      const bytes = Buffer.from(match[2]!, "base64");
      if (!bytes.length || bytes.length > 16 * 1024 * 1024)
        throw new Error("Oversize or empty image");
      return {
        bytes,
        mimeType: `image/${match[1]}` as CreativeGeneratedAsset["mimeType"],
        requestId:
          response.headers.get("x-fal-request-id") ??
          result.request_id ??
          undefined,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          images: 1,
          providerUsage: {
            billingProvider: "fal.ai",
            endpoint: `meta/muse-image/${endpoint}`,
            syncMode: true,
          },
        },
      };
    } catch (error) {
      if (error instanceof CreativeError) throw error;
      throw new CreativeError(
        "UNAVAILABLE",
        "fal.ai Meta result is uncertain. No automatic retry was made.",
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

export class MetaCreativeImageProvider implements CreativeImageProvider {
  readonly provider = "meta";
  readonly model = "muse-image-1.0";
  constructor(
    private key = process.env.CREATIVE_META_API_KEY ?? "",
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    request: CreativeImageRequest,
    source?: Buffer,
  ): Promise<CreativeGeneratedAsset> {
    if (!this.key)
      throw new CreativeError(
        "UNAVAILABLE",
        "Meta image generation is not configured.",
      );
    const prompt = promotionalPrompt(request.prompt, !!source);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
    };
    let body: string | FormData;
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
      form.set("output_format", "png");
      form.set("n", "1");
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        model: this.model,
        prompt,
        size: `${request.output.width}x${request.output.height}`,
        output_format: "png",
        n: 1,
      });
    }
    try {
      const response = await this.fetcher(
        `https://api.meta.ai/v1/images/${source ? "edits" : "generations"}`,
        {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(300_000),
        },
      );
      if (!response.ok)
        throw new CreativeError(
          "UNAVAILABLE",
          `Meta returned HTTP ${response.status}. No automatic retry was made.`,
        );
      const raw = await response.text();
      if (raw.length > 24_000_000) throw new Error("Oversize image");
      const result = JSON.parse(raw) as {
        data?: { b64_json?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const encoded = result.data?.[0]?.b64_json;
      if (!encoded || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded))
        throw new Error("No image");
      return {
        bytes: Buffer.from(encoded, "base64"),
        mimeType: "image/png",
        requestId: response.headers.get("x-request-id") ?? undefined,
        usage: {
          inputTokens: result.usage?.input_tokens ?? 0,
          outputTokens: result.usage?.output_tokens ?? 0,
          images: 1,
          providerUsage: result.usage ?? {},
        },
      };
    } catch (error) {
      if (error instanceof CreativeError) throw error;
      throw new CreativeError(
        "UNAVAILABLE",
        "Meta image result is uncertain. No automatic retry was made.",
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

export class IdeogramCreativeImageProvider implements CreativeImageProvider {
  readonly provider = "ideogram";
  readonly model = "ideogram-4-5";
  constructor(
    private key = process.env.CREATIVE_IDEOGRAM_API_KEY ?? "",
    private fetcher: typeof fetch = fetch,
  ) {}
  private async request(
    request: CreativeImageRequest,
    source?: Buffer,
  ): Promise<CreativeGeneratedAsset> {
    if (!this.key)
      throw new CreativeError(
        "UNAVAILABLE",
        "Ideogram image generation is not configured.",
      );
    const prompt = promotionalPrompt(request.prompt, !!source);
    const headers: Record<string, string> = { "Api-Key": this.key };
    let body: string | FormData;
    if (source) {
      const form = new FormData();
      form.set("prompt", prompt);
      form.set("quality", "medium");
      form.set("num_images", "1");
      form.set(
        "image",
        new Blob([new Uint8Array(source)], { type: "image/png" }),
        "source.png",
      );
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      // Auto is documented; the Creative output policy is applied locally.
      body = JSON.stringify({
        prompt,
        quality: "medium",
        num_images: 1,
        size: "auto",
      });
    }
    try {
      const response = await this.fetcher(
        `https://api.ideogram.ai/v2/image/${source ? "precise-edit" : "generate"}/ideogram-4-5`,
        {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(300_000),
        },
      );
      if (!response.ok)
        throw new CreativeError(
          "UNAVAILABLE",
          `Ideogram returned HTTP ${response.status}. No automatic retry was made.`,
        );
      const raw = await response.text();
      if (raw.length > 100_000) throw new Error("Oversize response");
      const result = JSON.parse(raw) as {
        generation_id?: string;
        data?: { url?: string; is_image_safe?: boolean }[];
      };
      const item = result.data?.[0];
      if (!item?.url || item.is_image_safe === false)
        throw new Error("No usable image");
      const url = new URL(item.url);
      if (
        url.protocol !== "https:" ||
        !(
          /(^|\.)ideogram\.ai$/.test(url.hostname) ||
          /(^|\.)googleapis\.com$/.test(url.hostname) ||
          /(^|\.)googleusercontent\.com$/.test(url.hostname)
        )
      )
        throw new Error("Unsupported image host");
      const imageResponse = await this.fetcher(url, {
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      if (
        !imageResponse.ok ||
        !/^image\/(png|jpeg|webp)/.test(
          imageResponse.headers.get("content-type") ?? "",
        )
      )
        throw new Error("Image unavailable");
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 16 * 1024 * 1024)
        throw new Error("Oversize image");
      const mimeType = imageResponse.headers
        .get("content-type")!
        .split(";")[0] as CreativeGeneratedAsset["mimeType"];
      return {
        bytes,
        mimeType,
        requestId: result.generation_id,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          images: 1,
          providerUsage: {
            quality: "medium",
            operation: source ? "precise-edit" : "generate",
          },
        },
      };
    } catch (error) {
      if (error instanceof CreativeError) throw error;
      throw new CreativeError(
        "UNAVAILABLE",
        "Ideogram image result is uncertain. No automatic retry was made.",
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

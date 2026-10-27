import { it, expect, vi } from "vitest";
import sharp from "sharp";
import { OpenAICreativeImageProvider } from "./creative-image-provider.js";
import { creativeImageOutputPolicy } from "@flowgastronomie/domain";
const output = creativeImageOutputPolicy({ format: "A4" });
it("requests exactly one image and returns bytes, never remote URLs", async () => {
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "#17382f" },
  })
    .png()
    .toBuffer();
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: bytes.toString("base64") }],
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
            input_tokens_details: { text_tokens: 10, image_tokens: 0 },
          },
        }),
        { headers: { "x-request-id": "provider-request" } },
      ),
  );
  const provider = new OpenAICreativeImageProvider(
    "gpt-image-2.5-flare",
    "test-key",
    fetcher,
  );
  const result = await provider.generateAsset({
    prompt: "Basil illustration",
    requestKey: "job1",
    output,
  });
  expect(result.bytes.equals(bytes)).toBe(true);
  expect(result.usage.images).toBe(1);
  expect(result.requestId).toBe("provider-request");
  expect(result.usage.providerUsage).toMatchObject({ total_tokens: 30 });
  const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(call[1].body as string)).toMatchObject({
    n: 1,
    size: "1536x1024",
    quality: "high",
  });
  expect(call[1].headers).toMatchObject({ "Idempotency-Key": "job1" });
  await provider.editAsset({
    prompt: "Warmer palette",
    requestKey: "job2",
    source: bytes,
    output,
  });
  const edit = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect(edit[0]).toContain("/edits");
  expect(edit[1].body).toBeInstanceOf(FormData);
  expect((edit[1].body as FormData).get("size")).toBe("1536x1024");
  expect((edit[1].body as FormData).get("quality")).toBe("high");
});
it("sanitizes failed provider output, URL responses and missing configuration", async () => {
  const provider = new OpenAICreativeImageProvider(
    "test-model",
    "test-key",
    async () =>
      new Response(
        JSON.stringify({ data: [{ url: "http://private/secret" }] }),
      ),
  );
  await expect(
    provider.generateAsset({ prompt: "asset", requestKey: "job", output }),
  ).rejects.toThrow("Your design is unchanged");
  await expect(
    new OpenAICreativeImageProvider("test-model", "").generateAsset({
      prompt: "asset",
      requestKey: "job",
      output,
    }),
  ).rejects.toThrow("Upload an image instead");
});
it.each([429, 500])(
  "never retries provider HTTP %s failures",
  async (status) => {
    const fetcher = vi.fn(
      async () => new Response("private provider error", { status }),
    );
    const provider = new OpenAICreativeImageProvider(
      "gpt-image-2.5-flare",
      "test-key",
      fetcher,
    );
    await expect(
      provider.generateAsset({
        prompt: "Margherita",
        requestKey: "single-attempt",
        output,
      }),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it("keeps social requests square and never retries network timeouts", async () => {
  const fetcher = vi.fn(async () => {
    throw new Error("timeout");
  });
  const provider = new OpenAICreativeImageProvider(
    "gpt-image-2.5-flare",
    "test-key",
    fetcher,
  );
  await expect(
    provider.generateAsset({
      prompt: "Margherita",
      requestKey: "single-attempt",
      output: creativeImageOutputPolicy({ format: "SOCIAL" }),
    }),
  ).rejects.toThrow("Your design is unchanged");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(call[1].body as string)).toMatchObject({
    size: "1024x1024",
    quality: "medium",
    n: 1,
  });
});

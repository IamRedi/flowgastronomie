import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { creativeImageOutputPolicy } from "@flowgastronomie/domain";
import {
  MetaCreativeImageProvider,
  FalMuseCreativeImageProvider,
  IdeogramCreativeImageProvider,
  selectCreativeImageProvider,
  imageProviderConfigured,
} from "./creative-image-provider.js";

const output = creativeImageOutputPolicy({ format: "SQUARE" });
const request = {
  prompt: "A product on a pale background",
  requestKey: "job-1",
  output,
};

it("calls Meta Standard image generation and edit once with documented fields", async () => {
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: bytes.toString("base64") }],
          usage: { input_tokens: 12, output_tokens: 20 },
        }),
      ),
  );
  const provider = new MetaCreativeImageProvider("fixture-key", fetcher);
  expect((await provider.generateAsset(request)).bytes.equals(bytes)).toBe(
    true,
  );
  await provider.editAsset({ ...request, source: bytes });
  const generation = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const edit = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect(generation[0]).toBe("https://api.meta.ai/v1/images/generations");
  expect(JSON.parse(generation[1].body as string)).toMatchObject({
    model: "muse-image-1.0",
    n: 1,
    output_format: "png",
  });
  expect(edit[0]).toBe("https://api.meta.ai/v1/images/edits");
  expect((edit[1].body as FormData).get("image")).toBeInstanceOf(Blob);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(provider.model).not.toContain("contributor");
});

it("downloads one Ideogram 4.5 result and rejects unsafe result hosts", async () => {
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const fetcher = vi.fn(async (url: string | URL) =>
    String(url).includes("api.ideogram.ai")
      ? new Response(
          JSON.stringify({
            generation_id: "gen-1",
            data: [
              { url: "https://ideogram.ai/result.png", is_image_safe: true },
            ],
          }),
        )
      : new Response(new Uint8Array(bytes), {
          headers: { "Content-Type": "image/png" },
        }),
  );
  const provider = new IdeogramCreativeImageProvider(
    "fixture-key",
    fetcher as typeof fetch,
  );
  const result = await provider.editAsset({ ...request, source: bytes });
  expect(result.bytes.equals(bytes)).toBe(true);
  expect(result.requestId).toBe("gen-1");
  const first = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(first[0]).toBe(
    "https://api.ideogram.ai/v2/image/precise-edit/ideogram-4-5",
  );
  expect((first[1].body as FormData).get("quality")).toBe("medium");
  expect(fetcher).toHaveBeenCalledTimes(2);

  const bad = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ data: [{ url: "http://127.0.0.1/private" }] }),
      ),
  );
  await expect(
    new IdeogramCreativeImageProvider("fixture-key", bad).generateAsset(
      request,
    ),
  ).rejects.toThrow("uncertain");
  expect(bad).toHaveBeenCalledTimes(1);
});

it("routes the existing Meta quota to fal.ai only when its key is configured", () => {
  vi.stubEnv("CREATIVE_FAL_API_KEY", "");
  vi.stubEnv("CREATIVE_META_API_KEY", "previous-direct-key");
  expect(imageProviderConfigured("meta")).toBe(false);
  vi.stubEnv("CREATIVE_FAL_API_KEY", "fixture-fal-key");
  expect(imageProviderConfigured("meta")).toBe(true);
  expect(selectCreativeImageProvider("meta").provider).toBe("meta");
  expect(selectCreativeImageProvider("meta").model).toBe(
    "muse-image-1.0-via-fal",
  );
  vi.unstubAllEnvs();
});

it("uses one fal.ai Muse generation/edit call and never fetches untrusted URLs", async () => {
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const imageUri = `data:image/png;base64,${bytes.toString("base64")}`;
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ images: [{ url: imageUri }] }), {
        headers: { "x-fal-request-id": "fal-job-1" },
      }),
  );
  const provider = new FalMuseCreativeImageProvider("fixture-fal-key", fetcher);
  const generated = await provider.generateAsset(request);
  expect(generated.bytes.equals(bytes)).toBe(true);
  expect(generated.requestId).toBe("fal-job-1");
  expect(generated.usage.providerUsage).toMatchObject({
    billingProvider: "fal.ai",
    endpoint: "meta/muse-image/text-to-image",
  });
  await provider.editAsset({ ...request, source: bytes });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const generateCall = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  const editCall = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect(generateCall[0]).toBe("https://fal.run/meta/muse-image/text-to-image");
  expect(editCall[0]).toBe("https://fal.run/meta/muse-image/edit");
  expect(generateCall[1].headers).toMatchObject({
    Authorization: "Key fixture-fal-key",
  });
  expect(JSON.parse(generateCall[1].body as string)).toMatchObject({
    num_images: 1,
    output_format: "png",
    sync_mode: true,
    aspect_ratio: "1:1",
  });
  expect(JSON.parse(editCall[1].body as string).image_urls).toEqual([imageUri]);
});

it("never repeats a failed fal.ai call and rejects remotely hosted image responses", async () => {
  const bad = vi.fn(
    async () => new Response("billing restriction", { status: 402 }),
  );
  await expect(
    new FalMuseCreativeImageProvider("fixture-key", bad).generateAsset(request),
  ).rejects.toThrow("HTTP 402");
  expect(bad).toHaveBeenCalledTimes(1);
  const remote = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          images: [{ url: "https://example.org/untrusted-image.png" }],
        }),
      ),
  );
  await expect(
    new FalMuseCreativeImageProvider("fixture-key", remote).generateAsset(
      request,
    ),
  ).rejects.toThrow("uncertain");
  expect(remote).toHaveBeenCalledTimes(1);
});

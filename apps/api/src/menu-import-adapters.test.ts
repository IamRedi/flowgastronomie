import { describe, it, expect, vi } from "vitest";
import {
  inspectMenuSource,
  renderMenuPdfPage,
} from "./menu-import-document-adapter.js";
import sharp from "sharp";
import { OpenAIMenuExtractionProvider } from "./menu-extraction-provider.js";
import {
  controlledMenuPng,
  controlledMenuPdf,
} from "../../../tests/setup/fixtures.js";
describe("Menu import adapters", () => {
  it("decodes controlled image/PDF, retains immutable bytes and rejects spoofed/truncated files", async () => {
    const png = await controlledMenuPng();
    const photo = await inspectMenuSource(png, "../menu.png", "image/png");
    expect(photo).toMatchObject({
      width: 900,
      height: 1100,
      pageCount: 1,
      filename: ".._menu.png",
    });
    expect(photo.bytes.equals(png)).toBe(true);
    const pdf = await controlledMenuPdf();
    const preview = await renderMenuPdfPage(pdf, 1);
    expect((await sharp(preview).metadata()).width).toBeGreaterThan(500);
    await expect(renderMenuPdfPage(pdf, 2)).rejects.toThrow();
    expect(
      await inspectMenuSource(pdf, "menu.pdf", "application/pdf"),
    ).toMatchObject({ pageCount: 1, mimeType: "application/pdf" });
    await expect(
      inspectMenuSource(png, "spoof.pdf", "application/pdf"),
    ).rejects.toThrow();
    await expect(
      inspectMenuSource(png.subarray(0, 64), "broken.png", "image/png"),
    ).rejects.toThrow();
    await expect(
      inspectMenuSource(
        Buffer.from("%PDF-broken"),
        "broken.pdf",
        "application/pdf",
      ),
    ).rejects.toThrow();
  });
  it("calls the provider once, with strict schema, private input and no business-writing tools", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"schemaVersion":1}' }],
            },
          ],
          usage: { input_tokens: 10 },
        }),
        { headers: { "x-request-id": "request-1" } },
      ),
    );
    const provider = new OpenAIMenuExtractionProvider(
      "configured-model",
      "test-key",
      fetcher,
    );
    const result = await provider.extract({
      locale: "sq",
      requestKey: "one",
      sources: [
        {
          id: "s",
          contentHash: "hash",
          pageCount: 1,
          mimeType: "application/pdf",
          filename: "menu.pdf",
          bytes: Buffer.from("fixture"),
        },
      ],
    });
    expect(result.requestId).toBe("request-1");
    const request = JSON.parse(fetcher.mock.calls[0]![1].body);
    expect(request.store).toBe(false);
    expect(request.tools).toBeUndefined();
    expect(request.text.format.strict).toBe(true);
    expect(request.input[0].content.at(-1).type).toBe("input_file");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never automatically retries or exposes provider errors", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("SECRET"));
    await expect(
      new OpenAIMenuExtractionProvider("model", "key", fetcher).extract({
        locale: "en",
        sources: [],
        requestKey: "retry",
      }),
    ).rejects.toThrow("No automatic retry");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

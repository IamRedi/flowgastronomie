import { it, expect, vi } from "vitest";
import { createDesign } from "@flowgastronomie/domain";
import {
  OpenAICreativePlanner,
  type CreativePlannerContext,
} from "./creative-providers.js";
const document = createDesign("A4", "en");
const context: CreativePlannerContext = {
  locale: "en",
  format: "A4",
  theme: document.theme,
  bindings: [],
  assets: [],
  allowedCopy: ["Fresh from our kitchen"],
  selectedLayerIds: [],
};
it("uses strict structured output, minimal context and extracts non-sensitive usage", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ summary: "Minimal", patches: [] }),
                },
              ],
            },
          ],
          usage: { input_tokens: 123, output_tokens: 45 },
        }),
        { status: 200 },
      ),
  );
  const provider = new OpenAICreativePlanner("gpt-6-luna", "test-key", fetcher);
  const result = await provider.createPatch(
    {
      ...context,
      assets: [
        {
          id: "photo",
          name: "Margherita",
          source: "UPLOADED",
          productId: "pizza",
          preview: "data:image/jpeg;base64,dGVzdA==",
        },
      ],
    },
    document,
    "Make this minimal",
  );
  expect(result.usage).toEqual({
    inputTokens: 123,
    outputTokens: 45,
    images: 0,
  });
  const options = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const body = JSON.parse(options[1].body as string);
  expect(body.store).toBe(false);
  expect(body.text.format.strict).toBe(true);
  expect(body.model).toBe("gpt-6-luna");
  expect(JSON.stringify(body.input)).not.toContain("tenantId");
  expect(JSON.stringify(body.text.format.schema)).not.toContain('"oneOf"');
  expect(JSON.stringify(body.text.format.schema)).toContain('"anyOf"');
  expect(body.input[0].content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "input_image",
        image_url: "data:image/jpeg;base64,dGVzdA==",
        detail: "low",
      }),
    ]),
  );
  expect(body.input[0].content[0].text).not.toContain("base64");
});
it("sanitizes provider errors and rejects incomplete/invalid structured output", async () => {
  for (const response of [
    new Response("secret-provider-message", { status: 500 }),
    new Response(JSON.stringify({ status: "incomplete" })),
    new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "<html>" }],
          },
        ],
      }),
    ),
  ]) {
    const provider = new OpenAICreativePlanner(
      "gpt-6-luna",
      "test-key",
      async () => response,
    );
    await expect(
      provider.createPatch(context, document, "Minimal"),
    ).rejects.toThrow("Your design is unchanged");
  }
});
it("leaves manual editing available when AI is not configured", async () => {
  const provider = new OpenAICreativePlanner("gpt-6-luna", "");
  await expect(provider.createPlan(context, "Poster")).rejects.toThrow(
    "continue editing manually",
  );
});

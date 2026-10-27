import { expect, it } from "vitest";
import { OpenAIWebsiteCopyProvider } from "./website-ai-provider.js";
it("uses bounded structured proposals, disables tools/storage, and rejects monetary fields", async () => {
  let request: Record<string, unknown> = {};
  const provider = new OpenAIWebsiteCopyProvider(
    "test-model",
    "test-key",
    async (_url, init) => {
      request = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    title: "A quiet pause",
                    description: "Coffee and conversation",
                  }),
                },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      );
    },
  );
  expect(
    await provider.propose({
      locale: "en",
      title: "Coffee",
      description: "Conversation",
      instruction: "Make the title warmer",
    }),
  ).toMatchObject({
    title: "A quiet pause",
    inputTokens: 10,
    outputTokens: 20,
  });
  expect(request.store).toBe(false);
  expect(request.max_output_tokens).toBe(1200);
  expect(request).not.toHaveProperty("tools");
  const invalid = new OpenAIWebsiteCopyProvider(
    "test-model",
    "test-key",
    async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: '{"title":"X","description":"Y","priceMinor":1}',
                },
              ],
            },
          ],
        }),
      ),
  );
  await expect(
    invalid.propose({
      locale: "en",
      title: "X",
      description: "Y",
      instruction: "Set price",
    }),
  ).rejects.toThrow();
  await expect(
    new OpenAIWebsiteCopyProvider("test-model", "").propose({
      locale: "en",
      title: "X",
      description: "Y",
      instruction: "Edit",
    }),
  ).rejects.toThrow();
});

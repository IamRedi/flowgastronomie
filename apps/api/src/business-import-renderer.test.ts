import { describe, expect, it } from "vitest";
import { configuredBusinessRenderer } from "./business-import-renderer.js";
import { ImportNetwork } from "./business-import-network.js";
import {
  controlledWebsiteTransport,
  fixtureOrigin,
  javascriptHtml,
} from "../../../tests/import-v2/fixtures.js";
it("requires an explicitly configured immutable renderer image", () => {
  expect(configuredBusinessRenderer({})).toBeUndefined();
  expect(() =>
    configuredBusinessRenderer({ BUSINESS_IMPORT_RENDERER_IMAGE: "latest" }),
  ).toThrow();
});
describe.skipIf(!process.env.BUSINESS_IMPORT_RENDERER_IMAGE)(
  "Real network-isolated Chromium acceptance",
  () => {
    it("renders a JavaScript menu while the broker denies metadata access", async () => {
      const renderer = configuredBusinessRenderer()!;
      const calls: string[] = [];
      const network = new ImportNetwork(
        `${fixtureOrigin}/js`,
        new AbortController().signal,
        {
          dns: async () => ["93.184.216.34"],
          transport: async (url, ...rest) => {
            calls.push(url.href);
            return controlledWebsiteTransport()(url, ...rest);
          },
        },
      );
      await network.authorize();
      const rendered = await renderer(
        `${fixtureOrigin}/js`,
        Buffer.from(javascriptHtml),
        network,
        network.signal,
      );
      expect(rendered.toString()).toContain("Rendered soup");
      expect(calls).toContain(`${fixtureOrigin}/menu.js`);
      expect(calls.every((url) => url.startsWith(fixtureOrigin))).toBe(true);
    }, 30_000);
  },
);

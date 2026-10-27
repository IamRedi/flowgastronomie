import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { flagshipProfileIds } from "@flowgastronomie/domain";
it("has matching immutable server/static stock assets with verified source/license records", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../assets/showcases/sources.json", import.meta.url),
      "utf8",
    ),
  ) as {
    profileId: string;
    file: string;
    sha256: string;
    bytes: number;
    source: string;
    licenseUrl: string;
    author: string;
  }[];
  expect(new Set(manifest.map((s) => s.profileId))).toEqual(
    new Set(flagshipProfileIds),
  );
  for (const source of manifest) {
    const [server, web] = await Promise.all([
      readFile(new URL(`../assets/showcases/${source.file}`, import.meta.url)),
      readFile(
        new URL(
          `../../../apps/web/public/showcases/${source.file}`,
          import.meta.url,
        ),
      ),
    ]);
    expect(createHash("sha256").update(server).digest("hex")).toBe(
      source.sha256,
    );
    expect(server.equals(web)).toBe(true);
    expect(server.length).toBe(source.bytes);
    expect(server.length).toBeLessThan(700000);
    expect(source.source).toMatch(/^https:\/\/unsplash.com\/photos\//);
    expect(source.licenseUrl).toBe("https://unsplash.com/license");
    expect(source.author.length).toBeGreaterThan(0);
  }
});

it("keeps product illustrations exact, optimized, and identical in preview and canonical provisioning", async () => {
  const { premiumCatalog } = await import("@flowgastronomie/domain");
  const rows = JSON.parse(
    await readFile(
      new URL("../assets/showcases/products/sources.json", import.meta.url),
      "utf8",
    ),
  ) as {
    recipeKey: string;
    file: string;
    sha256: string;
    source: string;
    author: string;
    licenseUrl: string;
    width: number;
    height: number;
  }[];
  const selected = new Set(
    premiumCatalog().flatMap((pack) =>
      pack.categories.flatMap((c) =>
        c.products.flatMap((p) => (p.photoKey ? [p.photoKey] : [])),
      ),
    ),
  );
  expect(new Set(rows.map((r) => r.recipeKey))).toEqual(selected);
  for (const row of rows) {
    const server = await readFile(
      new URL(`../assets/showcases/products/${row.file}`, import.meta.url),
    );
    const web = await readFile(
      new URL(
        `../../../apps/web/public/showcases/products/${row.file}`,
        import.meta.url,
      ),
    );
    expect(web.equals(server)).toBe(true);
    expect(createHash("sha256").update(server).digest("hex")).toBe(row.sha256);
    expect(server.length).toBeLessThan(120000);
    expect(row.width).toBe(640);
    expect(row.height).toBe(480);
    expect(row.author).toBeTruthy();
    expect(row.source).toMatch(/^https:\/\/unsplash.com\/photos\//);
    expect(row.licenseUrl).toBe("https://unsplash.com/license");
  }
});

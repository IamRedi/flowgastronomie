import { expect, it } from "vitest";
import {
  extractWebsiteCopy,
  isPublicIpv4,
  proposeWebsiteCopy,
  publicWebsiteUrl,
  robotsAllows,
} from "./website-import-adapter.js";
it.each([
  "127.0.0.1",
  "10.0.0.1",
  "169.254.169.254",
  "172.16.1.2",
  "192.168.0.1",
  "100.64.0.1",
  "0.0.0.0",
  "198.18.0.1",
  "203.0.113.1",
  "::1",
  "::ffff:127.0.0.1",
  "224.0.0.1",
])("rejects non-public address %s", (ip) =>
  expect(isPublicIpv4(ip)).toBe(false),
);
it.each([
  "http://example.com",
  "https://user:pass@example.com",
  "https://example.com:444",
  "https://localhost",
  "file:///etc/passwd",
])("rejects unsafe URL %s", (url) =>
  expect(() => publicWebsiteUrl(url)).toThrow(),
);
it("pins public DNS, extracts bounded text only, and never writes business facts", async () => {
  const calls: string[] = [];
  const result = await proposeWebsiteCopy(
    { url: "https://example.com/menu", authorized: true },
    {
      dns: async () => ["93.184.216.34"],
      transport: async (url, ip) => {
        calls.push(`${ip}:${url.pathname}`);
        return url.pathname === "/robots.txt"
          ? { status: 404, type: "text/plain", body: "" }
          : {
              status: 200,
              type: "text/html",
              body: '<title>Owner &amp; venue</title><meta name="description" content="A place to eat"><script>alert(1)</script>',
            };
      },
    },
  );
  expect(result).toMatchObject({
    title: "Owner & venue",
    description: "A place to eat",
    confidence: "UNVERIFIED",
  });
  expect(calls).toEqual(["93.184.216.34:/robots.txt", "93.184.216.34:/menu"]);
});
it("requires consent and checks rebinding, every redirect, robots, response bounds and media types", async () => {
  await expect(
    proposeWebsiteCopy({ url: "https://example.com", authorized: false }),
  ).rejects.toThrow();
  for (const location of [
    "https://127.0.0.1/private",
    "http://example.com/private",
    "https://other.example/private",
  ]) {
    await expect(
      proposeWebsiteCopy(
        { url: "https://example.com", authorized: true },
        {
          dns: async () => ["93.184.216.34"],
          transport: async (url) =>
            url.pathname === "/robots.txt"
              ? { status: 404, type: "text/plain", body: "" }
              : { status: 302, location, type: "text/html", body: "" },
        },
      ),
    ).rejects.toThrow();
  }
  let count = 0;
  await expect(
    proposeWebsiteCopy(
      { url: "https://example.com", authorized: true },
      {
        dns: async () => [++count === 1 ? "93.184.216.34" : "127.0.0.1"],
        transport: async () => ({ status: 404, type: "text/plain", body: "" }),
      },
    ),
  ).rejects.toThrow();
  expect(
    robotsAllows("User-agent: *\nDisallow: /private", "/private/menu"),
  ).toBe(false);
  expect(
    robotsAllows("User-agent: *\nDisallow: /\nAllow: /menu", "/menu"),
  ).toBe(true);
  for (const response of [
    { status: 200, type: "image/png", body: "x" },
    { status: 200, type: "text/html", body: "x".repeat(1000001) },
    { status: 401, type: "text/html", body: "" },
  ])
    await expect(
      proposeWebsiteCopy(
        { url: "https://example.com", authorized: true },
        {
          dns: async () => ["93.184.216.34"],
          transport: async (url) =>
            url.pathname === "/robots.txt"
              ? { status: 404, type: "text/plain", body: "" }
              : response,
        },
      ),
    ).rejects.toThrow();
  expect(() =>
    extractWebsiteCopy('<meta name="robots" content="noindex">'),
  ).toThrow();
});

it("honors shared user-agent groups and conservatively rejects wildcard restrictions", () => {
  expect(
    robotsAllows(
      "User-agent: *\nUser-agent: AnotherBot\nDisallow: /private",
      "/private",
    ),
  ).toBe(false);
  expect(
    robotsAllows(
      "User-agent: *\nDisallow: /*private\nAllow: /public",
      "/public/private",
    ),
  ).toBe(false);
});

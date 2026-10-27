import { describe, expect, it } from "vitest";
import {
  ImportNetwork,
  businessImportLimits,
  importUrl,
  publicImportAddress,
  type ImportTransport,
} from "./business-import-network.js";
import { robotsAllows } from "./website-import-adapter.js";

const response = (body = "hello", status = 200, extra = {}) => ({
  bytes: Buffer.from(body),
  type: "text/html",
  status,
  ...extra,
});
describe("Smart import public network boundary", () => {
  it("reserves aggregate bandwidth before concurrent renderer resources begin", async () => {
    let release: (() => void) | undefined;
    const net = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      {
        limits: { ...businessImportLimits({}), bytes: 10, pageBytes: 10 },
        dns: async () => ["8.8.8.8"],
        transport: async (url) => {
          if (url.pathname === "/robots.txt") return response("", 404);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return response("1234567890");
        },
      },
    );
    await net.authorize();
    const first = net.get("https://example.com/menu");
    await expect(net.get("https://example.com/contact")).rejects.toThrow();
    release!();
    await expect(first).resolves.toHaveProperty("status", 200);
    expect(net.bytes).toBe(10);
  });
  it("honors crawler-specific robots groups and encoded forbidden paths", () => {
    expect(
      robotsAllows(
        "User-agent: *\nAllow: /private/public\nUser-agent: FlowGastronomieImport\nDisallow: /private",
        "/private/public",
      ),
    ).toBe(false);
    expect(
      robotsAllows("User-agent: *\nDisallow: /private", "/%70rivate/menu"),
    ).toBe(false);
    expect(
      robotsAllows("User-agent: *\nDisallow: /private", "/%2570rivate/menu"),
    ).toBe(false);
  });
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.0.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.1.1.1",
    "255.255.255.255",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "2002:7f00:1::",
    "64:ff9b::7f00:1",
  ])("blocks special-use address %s", (value) =>
    expect(publicImportAddress(value)).toBe(false),
  );
  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("accepts global address %s", (value) =>
    expect(publicImportAddress(value)).toBe(true),
  );
  it.each([
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com:8443",
    "https://localhost",
    "https://127.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://[::1]",
    "file:///etc/passwd",
    "https://service.internal",
    "https://example.com.",
  ])("rejects unsafe URL %s", (url) => expect(() => importUrl(url)).toThrow());
  it("pins freshly validated IPv4/IPv6 and rejects mixed public/private DNS", async () => {
    const addresses: string[] = [];
    const transport: ImportTransport = async (url, pinned) => {
      addresses.push(pinned);
      return response(
        url.pathname === "/robots.txt" ? "User-agent: *\nAllow: /" : "menu",
      );
    };
    const net = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      { dns: async () => ["2606:4700:4700::1111"], transport },
    );
    await net.authorize();
    await net.get("https://example.com/menu");
    expect(addresses).toEqual(["2606:4700:4700::1111", "2606:4700:4700::1111"]);
    const mixed = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      { dns: async () => ["8.8.8.8", "10.0.0.1"], transport },
    );
    await expect(mixed.authorize()).rejects.toThrow();
    expect(addresses).toHaveLength(2);
  });
  it("rejects rebinding between robots and page resolution before transport", async () => {
    let lookups = 0,
      calls = 0;
    const net = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      {
        dns: async () => [++lookups === 1 ? "8.8.8.8" : "169.254.169.254"],
        transport: async () => {
          calls++;
          return response("");
        },
      },
    );
    await net.authorize();
    await expect(net.get("https://example.com/menu")).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it.each([
    "https://127.0.0.1/menu",
    "https://other.com/menu",
    "http://example.com/menu",
  ])("revalidates redirect %s", async (location) => {
    let calls = 0;
    const net = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      {
        dns: async () => ["8.8.8.8"],
        transport: async (url) => {
          calls++;
          return url.pathname === "/robots.txt"
            ? response("")
            : response("", 302, { location });
        },
      },
    );
    await net.authorize();
    await expect(net.get("https://example.com/menu")).rejects.toThrow();
    expect(calls).toBe(2);
  });
  it("checks robots on every redirect and denies reuse headers", async () => {
    const net = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      {
        dns: async () => ["8.8.8.8"],
        transport: async (url) =>
          url.pathname === "/robots.txt"
            ? response("User-agent: *\nDisallow: /private")
            : response("", 302, { location: "/private" }),
      },
    );
    await net.authorize();
    await expect(net.get("https://example.com/menu")).rejects.toThrow();
    expect(net.requests).toBe(2);
    const denied = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      {
        dns: async () => ["8.8.8.8"],
        transport: async () => response("", 200, { robots: "noai" }),
      },
    );
    await expect(denied.authorize()).rejects.toThrow();
  });
  it("enforces byte, request and timeout/cancellation budgets", async () => {
    const dependencies = {
      dns: async () => ["8.8.8.8"],
      limits: { ...businessImportLimits({}), requests: 1 },
      transport: async () => response(""),
    };
    const net = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      dependencies,
    );
    await net.authorize();
    await expect(net.get("https://example.com/menu")).rejects.toThrow();
    const large = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      {
        ...dependencies,
        limits: { ...dependencies.limits, pageBytes: 3 },
        transport: async () => response("large"),
      },
    );
    await expect(large.authorize()).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new ImportNetwork(
        "https://example.com",
        controller.signal,
        dependencies,
      ).authorize(),
    ).rejects.toThrow();
    const timeout = new ImportNetwork(
      "https://example.com",
      new AbortController().signal,
      {
        ...dependencies,
        limits: { ...dependencies.limits, requestMs: 15 },
        transport: () => new Promise(() => {}),
      },
    );
    await expect(timeout.authorize()).rejects.toThrow();
  });
});

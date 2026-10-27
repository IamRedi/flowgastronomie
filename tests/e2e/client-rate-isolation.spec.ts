import { expect, test } from "./browser-test";

test("synthetic clients retain the real authentication limit independently", async ({
  playwright,
}) => {
  const first = await playwright.request.newContext({
    baseURL: "http://localhost:4100",
    extraHTTPHeaders: { "x-forwarded-for": "127.255.255.1" },
  });
  const second = await playwright.request.newContext({
    baseURL: "http://localhost:4100",
    extraHTTPHeaders: { "x-forwarded-for": "127.255.255.2" },
  });
  try {
    for (let request = 0; request < 30; request++)
      expect((await first.get("/v1/auth/choices")).status()).toBe(401);
    const limited = await first.get("/v1/auth/choices");
    expect(limited.status()).toBe(429);
    expect((await limited.json()).code).toBe("RATE_LIMIT_EXCEEDED");
    expect((await second.get("/v1/auth/choices")).status()).toBe(401);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

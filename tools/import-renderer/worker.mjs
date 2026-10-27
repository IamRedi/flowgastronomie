import { chromium } from "playwright-core";
import { createInterface } from "node:readline";
const input = createInterface({ input: process.stdin });
const pending = new Map();
let started = false,
  sequence = 0;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
input.on("line", async (line) => {
  try {
    if (line.length > 3_000_000) throw new Error("limit");
    const message = JSON.parse(line);
    if (started) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
      return;
    }
    started = true;
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      args: [
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-background-networking",
      ],
    });
    try {
      const context = await browser.newContext({
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      await context.routeWebSocket("**/*", (socket) => socket.close());
      const page = await context.newPage();
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (request.url() === message.url && request.isNavigationRequest()) {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: Buffer.from(message.html, "base64"),
          });
          return;
        }
        if (
          request.method() !== "GET" ||
          !["script", "stylesheet", "xhr", "fetch"].includes(
            request.resourceType(),
          ) ||
          ++sequence > 24
        ) {
          await route.abort();
          return;
        }
        const id = sequence;
        const response = await new Promise((resolve) => {
          pending.set(id, resolve);
          send({
            type: "resource",
            id,
            method: request.method(),
            url: request.url(),
          });
        });
        if (response.denied) await route.abort();
        else
          await route.fulfill({
            status: 200,
            contentType: response.type,
            body: Buffer.from(response.bytes, "base64"),
          });
      });
      await page.goto(message.url, {
        waitUntil: "networkidle",
        timeout: 12_000,
      });
      const html = await page.content();
      if (Buffer.byteLength(html) > 2_000_000) throw new Error("limit");
      send({ type: "complete", html });
    } finally {
      await browser.close();
      process.exit(0);
    }
  } catch {
    send({ type: "error" });
    process.exit(1);
  }
});
setTimeout(() => process.exit(1), 18_000).unref();

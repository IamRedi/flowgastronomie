import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { prisma } from "@flowgastronomie/database";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { type LabIntent } from "@flowgastronomie/domain";
import { API } from "./client.js";
import { labActionContext } from "./action-context.js";
import { hash, assertLabScope } from "./guard.js";
import { verifyArchive, type ArchiveEntry } from "./pdf-archive.js";
import type { VenueContext } from "./operations.js";
const web = "http://127.0.0.1:3400";
let browser: Browser | undefined;
let browserLaunch: Promise<Browser> | undefined;
async function customerBrowser() {
  browserLaunch ??= chromium.launch({ headless: true });
  browser = await browserLaunch;
  return browser;
}
export async function closeCustomerBrowser() {
  await browser?.close();
  browser = undefined;
  browserLaunch = undefined;
}
export async function browserCustomer(
  context: VenueContext,
  intent: LabIntent,
  eventId: string,
  negative = false,
  evidenceFolder = "artifacts/operations-lab/normal-day",
) {
  const scope = context.state.actors.owner!.staff!,
    profile = scope.email.includes(".de@") ? "DE" : "AL";
  await assertLabScope(scope.tenantId, scope.venueId);
  browser = await customerBrowser();
  const guestContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await guestContext.newPage();
  const folder = evidenceFolder;
  await mkdir(folder, { recursive: true });
  const vault = ".operations-lab/browser-" + eventId + ".json";
  let submission:
    { referenceCode: string; trackingToken: string | null } | undefined;
  let nativeKey: string | undefined;
  const selected = intent.items[0]!;
  let changed: Record<string, unknown> | undefined;
  let stage = "published-website";
  let submitOperation = "not-started";
  let submitStatus: number | undefined;
  let rendererCrashed = false;
  page.on("crash", () => {
    rendererCrashed = true;
  });
  try {
    const prior = await prisma.$queryRaw<
      Array<{ browser_key: string | null }>
    >`SELECT browser_key FROM operations_lab.action WHERE event_id=${eventId} AND tenant_id=${scope.tenantId} AND venue_id=${scope.venueId}`;
    if (prior[0]?.browser_key && !negative) {
      nativeKey = prior[0].browser_key;
      const actual = await prisma.onlineOrder.findFirst({
        where: {
          tenantId: scope.tenantId,
          venueId: scope.venueId,
          idempotencyKey: nativeKey,
        },
        include: { items: true },
      });
      if (actual) {
        if (
          actual.totalMinor !== intent.totalMinor ||
          actual.items.length !== intent.items.length ||
          intent.items.some(
            (i) =>
              !actual.items.some(
                (a) =>
                  a.productId === i.productId &&
                  a.quantity === i.quantity &&
                  a.unitPriceMinor === i.unitMinor,
              ),
          )
        )
          throw new Error("LAB_BROWSER_RECOVERY_BASKET_CONFLICT");
        let token: string | undefined;
        try {
          token = (
            JSON.parse(await readFile(vault, "utf8")) as {
              trackingToken: string;
            }
          ).trackingToken;
        } catch {}
        if (!token) {
          try {
            const d = JSON.parse(
              await readFile(".operations-lab/browser-debug.json", "utf8"),
            ) as { url: string };
            const candidate = /\/order\/track\/([a-zA-Z0-9_-]+)/.exec(
              d.url,
            )?.[1];
            if (candidate && hash(candidate) === actual.trackingTokenHash)
              token = candidate;
          } catch {}
        }
        if (!token)
          throw new Error("LAB_BROWSER_RECOVERY_TRACKING_REQUIRES_REVIEW");
        submission = {
          referenceCode: actual.referenceCode,
          trackingToken: token,
        };
        await page.goto(
          web + "/en/order/track/" + token + "?venue=" + context.publicSlug,
          { waitUntil: "domcontentloaded" },
        );
      } else throw new Error("LAB_BROWSER_DISPATCH_UNCERTAIN");
    }
    if (!submission) {
      // SSR products can be visible before hydration, initial catalog refresh and
      // session-basket restoration finish. Observe those real boundaries before
      // the first add; never compensate by adding/submitting a second time.
      stage = "basket-initialization";
      const [initialResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === "GET" &&
            response.url() ===
              API +
                "/v1/public/websites/" +
                encodeURIComponent(context.publicSlug) +
                "?locale=en",
          { timeout: 60000 },
        ),
        page.goto(web + "/en/venue/" + context.publicSlug, {
          waitUntil: "domcontentloaded",
          timeout: 120000,
        }),
      ]);
      if (!initialResponse.ok() || (await initialResponse.finished()))
        throw new Error("LAB_BROWSER_INITIAL_CATALOG_FAILED");
      await page.waitForFunction(
        (slug) => sessionStorage.getItem(`online-basket:v1:${slug}`) !== null,
        context.publicSlug,
        { timeout: 60000 },
      );
      // The published website now has the same native basket inline; no legacy
      // order-page link is rendered. Keep the full browser/customer journey.
      await page
        .locator(".public-products article")
        .first()
        .waitFor({ state: "visible", timeout: 60000 });
      const basket = page.locator(".public-basket-drawer");
      for (const item of intent.items) {
        stage = "basket-selection";
        if (await basket.isVisible())
          await basket
            .getByRole("button", { name: "Close", exact: true })
            .click();
        const product = page
          .locator(".public-products article")
          .filter({
            has: page.getByRole("heading", { name: item.name, exact: true }),
          })
          .first();
        await product.locator(".public-add").click();
        const catalog = context.state.catalog!.find(
          (p) => p.productId === item.productId,
        )!;
        if (catalog.variantId) {
          const options = page.getByRole("region", {
            name: "Product options",
            exact: true,
          });
          await options.waitFor({ state: "visible" });
          if (item.variantId)
            await options
              .getByRole("radio", { name: /TEST ONLY Large/ })
              .check();
          if (item.modifierOptionIds?.length)
            await options
              .getByRole("checkbox", { name: /TEST ONLY Extra cheese/ })
              .check();
          await options
            .getByRole("button", { name: "Add to basket", exact: true })
            .click();
        }
        // Open through the real basket control if the current layout closed it;
        // do not add twice or bypass the ensuing basket/financial assertions.
        if (!(await basket.isVisible()))
          await page.locator(".public-basket-icon").click();
        await basket.waitFor({ state: "visible" });
        for (let i = 1; i < item.quantity; i++)
          await basket
            .getByRole("button", { name: "+ " + item.name, exact: true })
            .click();
      }
      stage = "basket-review";
      for (const item of intent.items)
        await expect(basket).toContainText(item.name);
      const currency = profile === "DE" ? "EUR" : "ALL";
      const formatted = new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).format(intent.totalMinor / 100);
      stage = "basket-total";
      await expect(
        basket.locator(".public-basket-body > div > strong"),
      ).toHaveText(`Total: ${formatted}`);
      await basket
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await basket
        .getByLabel("Name", { exact: true })
        .fill("TEST ONLY Browser customer " + intent.position);
      await basket.getByLabel("Phone", { exact: true }).fill("0000000000");
      await basket
        .getByLabel("Email (optional)", { exact: true })
        .fill("browser" + intent.position + "@operations-lab.invalid");
      await page.getByTestId("pickup-selection").waitFor({ state: "visible" });
      stage = "pickup-choice";
      await page
        .getByRole("button", { name: "As soon as possible", exact: true })
        .click();
      const menuSnapshot = await context.clients.waiter!.request<{
        categories: Array<{
          products: Array<{
            id: string;
            variants: Array<{ id: string; priceDeltaMinor: number }>;
          }>;
        }>;
      }>("GET", "/v1/staff/pos/menu?locale=en");
      const defaults = new Map(
        menuSnapshot.categories
          .flatMap((c) => c.products)
          .map((p) => [
            p.id,
            p.variants.find((v) => v.priceDeltaMinor === 0)?.id,
          ]),
      );
      await page.route(
        API + "/v1/public/online-orders/" + context.publicSlug,
        async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          const body = route.request().postDataJSON() as {
            idempotencyKey: string;
            items: Array<{
              productId: string;
              quantity: number;
              variantId?: string;
              modifierOptionIds?: string[];
            }>;
          };
          const normalize = (items: typeof body.items) =>
            items
              .map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
                variantId:
                  i.variantId === defaults.get(i.productId)
                    ? null
                    : (i.variantId ?? null),
                modifiers: [...(i.modifierOptionIds ?? [])].sort(),
              }))
              .sort((a, b) => a.productId.localeCompare(b.productId));
          if (
            JSON.stringify(normalize(body.items)) !==
            JSON.stringify(normalize(intent.items))
          )
            throw new Error("LAB_BROWSER_NATIVE_BASKET_CONFLICT");
          nativeKey = body.idempotencyKey;
          await assertLabScope(scope.tenantId, scope.venueId);
          await prisma.$executeRaw`UPDATE operations_lab.action SET browser_key=${nativeKey} WHERE event_id=${eventId} AND tenant_id=${scope.tenantId} AND venue_id=${scope.venueId}`;
          // Durable provenance before dispatch. The browser's native body is untouched.
          await route.continue();
        },
      );
      stage = "server-quote";
      await basket
        .getByRole("button", { name: "Review order", exact: true })
        .click();
      await basket
        .locator(".public-checkout-review")
        .waitFor({ state: "visible" });
      if (
        !(
          await basket.locator(".public-checkout-review > p strong").innerText()
        ).includes(formatted)
      )
        throw new Error("LAB_BROWSER_SERVER_QUOTE_TOTAL_MISMATCH");
      if (negative) {
        // Invalidate only after a valid quote, then prove final dispatch rejects
        // stale availability and creates no order. Never rewrite the native body.
        const menu = await context.clients.owner!.request<{
          categories: Array<{ products: Array<Record<string, unknown>> }>;
        }>("GET", "/v1/staff/menu");
        const p = menu.categories
          .flatMap((c) => c.products)
          .find((p) => p.id === selected.productId)!;
        changed = Object.fromEntries(
          [
            "categoryId",
            "priceMinor",
            "sortOrder",
            "published",
            "station",
            "translations",
          ].map((k) => [k, p[k]]),
        );
        await context.clients.owner!.request(
          "PUT",
          "/v1/staff/menu/products/" + selected.productId,
          { ...changed, available: false },
        );
      }
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url() === API + "/v1/public/online-orders/" + context.publicSlug &&
          r.request().method() === "POST",
        { timeout: 60000 },
      );
      stage = "submit";
      submitOperation = "confirm-click";
      await basket
        .getByRole("button", { name: "Confirm order", exact: true })
        .click();
      submitOperation = "response-wait";
      const response = await responsePromise;
      submitStatus = response.status();
      if (negative) {
        if (response.status() !== 400)
          throw new Error("LAB_BROWSER_NEGATIVE_WAS_NOT_REJECTED");
        submitOperation = "negative-response-code";
        if ((await response.json()).code !== "ONLINE_ORDER_PRODUCT_INVALID")
          throw new Error("LAB_BROWSER_NEGATIVE_VALIDATION_CODE_MISMATCH");
        // Exercise the legitimate concurrent catalog warning as well as the
        // backend validation error. Neither the native body nor API is mocked.
        submitOperation = "negative-catalog-refresh";
        const refreshed = page.waitForResponse(
          (r) =>
            r.request().method() === "GET" &&
            r.url() ===
              API + "/v1/public/websites/" + context.publicSlug + "?locale=en",
        );
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await (await refreshed).finished();
        submitOperation = "negative-validation-alert";
        await basket
          .getByRole("alert")
          .filter({
            hasText: "The price or options changed. Review the order again.",
          })
          .waitFor({ state: "visible" });
        await page.screenshot({
          path: folder + "/" + profile + "-browser-negative.png",
          fullPage: true,
        });
        if (changed)
          await context.clients.owner!.request(
            "PUT",
            "/v1/staff/menu/products/" + selected.productId,
            { ...changed, available: true },
          );
        submitOperation = "negative-no-order-check";
        const count = await prisma.onlineOrder.count({
          where: {
            tenantId: scope.tenantId,
            venueId: scope.venueId,
            idempotencyKey: nativeKey!,
          },
        });
        if (count !== 0) throw new Error("LAB_BROWSER_NEGATIVE_CREATED_ORDER");
        return { negative: true, status: 400, referenceCode: "" };
      }
      if (response.status() !== 201)
        throw new Error("LAB_BROWSER_SUBMIT_REJECTED");
      try {
        submitOperation = "response-body";
        submission = await response.json();
      } catch {
        submitOperation = "tracking-credential-recovery";
        await page.waitForURL("**/en/order/track/**", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        const token = /\/order\/track\/([a-zA-Z0-9_-]+)/.exec(page.url())?.[1];
        const actual = await prisma.onlineOrder.findFirstOrThrow({
          where: {
            tenantId: scope.tenantId,
            venueId: scope.venueId,
            idempotencyKey: nativeKey!,
          },
          select: { referenceCode: true, trackingTokenHash: true },
        });
        if (!token || hash(token) !== actual.trackingTokenHash)
          throw new Error("LAB_BROWSER_TRACKING_CREDENTIAL_MISSING");
        submission = {
          referenceCode: actual.referenceCode,
          trackingToken: token,
        };
      }
    }
    stage = "tracking";
    if (!submission?.trackingToken)
      throw new Error("LAB_BROWSER_CONFIRMATION_MISSING");
    await writeFile(vault, JSON.stringify(submission), { mode: 0o600 });
    await page.waitForURL("**/en/order/track/**", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page
      .locator(".customer-tracking")
      .getByText(submission.referenceCode, { exact: true })
      .waitFor({ state: "visible", timeout: 30000 });
    await page.screenshot({
      path:
        folder +
        "/" +
        profile +
        "-browser-" +
        intent.position +
        "-tracking.png",
      fullPage: true,
    });
    const staffContext = await browser.newContext(),
      staffPage = await staffContext.newPage();
    stage = "staff-order-view";
    try {
      const a = context.state.actors.manager!;
      await staffPage.goto(web + "/en/staff/login", {
        waitUntil: "domcontentloaded",
      });
      await staffPage
        .getByRole("button", { name: "Sign in", exact: true })
        .waitFor({ state: "visible" });
      await staffPage.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>(
            '.staff-login-form button[type="submit"]',
          )?.disabled,
      );
      await staffPage.locator('input[name="email"]').fill(a.email);
      await staffPage.locator('input[name="password"]').fill(a.password);
      await staffPage
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await staffPage
        .evaluate(() => {
          const input = document.querySelector<HTMLInputElement>(
            'input[name="password"]',
          );
          if (input) input.value = "";
        })
        .catch(() => {});
      await staffPage.waitForURL("**/app/en/overview", {
        waitUntil: "domcontentloaded",
      });
      await staffPage.goto(web + "/en/staff/orders", {
        waitUntil: "domcontentloaded",
      });
      await staffPage
        .getByRole("button", { name: "Today", exact: true })
        .click();
      const card = staffPage
        .locator("main article")
        .filter({ hasText: submission.referenceCode });
      await card.waitFor({ state: "visible", timeout: 30000 });
      await card
        .getByRole("button", { name: "Open order", exact: true })
        .click();
      await staffPage
        .getByRole("dialog")
        .getByText(selected.name, { exact: false })
        .first()
        .waitFor({ state: "visible" });
      await staffPage.screenshot({
        path:
          folder + "/" + profile + "-browser-" + intent.position + "-staff.png",
        fullPage: true,
      });
    } finally {
      await staffContext.close();
    }
    return {
      referenceCode: submission.referenceCode,
      provenance: "WEBSITE_BROWSER" as const,
      nativeKeyHash: hash(nativeKey!),
    };
  } catch (error) {
    let safeError = (error as Error).message;
    let safeUrl = page.url();
    for (const actor of Object.values(context.state.actors)) {
      for (const value of [
        actor.password,
        encodeURIComponent(actor.password),
        new URLSearchParams({ p: actor.password }).toString().slice(2),
      ])
        safeError = safeError.replaceAll(value, "[REDACTED LAB SECRET]");
    }
    if (safeUrl.includes("password=")) {
      const url = new URL(safeUrl);
      url.searchParams.delete("password");
      safeUrl = url.toString();
    }
    const failureKind = /has been closed|target.*closed/i.test(safeError)
      ? "browser-target-closed"
      : /crash/i.test(safeError)
        ? "browser-crashed"
        : /toContainText/.test(safeError)
          ? "expected-basket-text-missing"
          : /strict mode violation/i.test(safeError)
            ? "ambiguous-locator"
            : /timeout/i.test(safeError)
              ? "timeout"
              : "other-action-or-assertion";
    const basketMatches =
      stage === "basket-review" && !page.isClosed()
        ? await page
            .locator(".public-basket-drawer")
            .textContent({ timeout: 1000 })
            .then(
              (text) =>
                intent.items.filter((item) => text?.includes(item.name)).length,
            )
            .catch(() => null)
        : null;
    const failureSummary = {
      status: "lab_browser_failed",
      profile,
      stage,
      code: /^LAB_[A-Z0-9_]+$/.test(safeError)
        ? safeError
        : "BROWSER_ASSERTION_OR_ACTION_FAILED",
      submitOperation,
      submitStatus,
      nativeKeyCaptured: Boolean(nativeKey),
      errorClass:
        (error as Error).name === "TimeoutError" ? "TimeoutError" : "Error",
      sourceLine: /browser-customer\.ts:(\d+)/.exec(
        (error as Error).stack ?? "",
      )?.[1],
      failureKind,
      rendererCrashed,
      pageClosed: page.isClosed(),
      browserConnected: browser?.isConnected() ?? false,
      expectedItemCount: intent.items.length,
      basketExpectedMatches: basketMatches,
    };
    console.error(JSON.stringify(failureSummary));
    await writeFile(
      ".operations-lab/browser-debug.json",
      JSON.stringify(
        { stage, eventId, error: safeError, url: safeUrl },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    let screenshotCaptured = false;
    await page
      .screenshot({
        path: folder + "/" + profile + "-browser-failed.png",
        fullPage: true,
        timeout: 5000,
      })
      .then(() => {
        screenshotCaptured = true;
      })
      .catch(() => {});
    await writeFile(
      "artifacts/operations-lab/browser-failure-summary.json",
      JSON.stringify({ ...failureSummary, screenshotCaptured }, null, 2),
      { mode: 0o600 },
    );
    // No raw tracking URLs, cookies, passwords or contact data in errors/logs.
    throw new Error("LAB_BROWSER_CHECKOUT_NEEDS_REVIEW:" + stage);
  } finally {
    if (changed)
      await context.clients.owner!.request(
        "PUT",
        "/v1/staff/menu/products/" + selected.productId,
        { ...changed, available: true },
      );
    await guestContext.close();
  }
}
export async function verifyBrowserCompletion(
  context: VenueContext,
  intent: LabIntent,
  eventId: string,
  orderId: string,
  evidenceFolder = "artifacts/operations-lab/normal-day",
) {
  const scope = context.state.actors.owner!.staff!;
  await assertLabScope(scope.tenantId, scope.venueId);
  const stored = JSON.parse(
    await readFile(".operations-lab/browser-" + eventId + ".json", "utf8"),
  ) as { trackingToken: string; referenceCode: string };
  browser = await customerBrowser();
  const session = await browser.newContext(),
    page = await session.newPage();
  try {
    await page.goto(
      web +
        "/en/order/track/" +
        stored.trackingToken +
        "?venue=" +
        context.publicSlug,
      { waitUntil: "domcontentloaded" },
    );
    await page
      .locator(".tracking-status[data-state='COMPLETED']")
      .waitFor({ state: "visible", timeout: 30000 });
    const receipt = await prisma.receipt.findFirstOrThrow({
      where: {
        tenantId: scope.tenantId,
        venueId: scope.venueId,
        onlineOrderId: orderId,
      },
    });
    const archive = await prisma.$queryRaw<
      ArchiveEntry[]
    >`SELECT * FROM operations_lab.archive WHERE receipt_id=${receipt.id} AND tenant_id=${scope.tenantId} AND venue_id=${scope.venueId}`;
    if (!archive[0]) throw new Error("MISSING_BROWSER_PDF");
    await verifyArchive(archive[0]);
    await page.screenshot({
      path:
        evidenceFolder +
        "/" +
        (scope.email.includes(".de@") ? "DE" : "AL") +
        "-browser-" +
        intent.position +
        "-completed.png",
      fullPage: true,
    });
    return {
      id: orderId,
      receiptId: receipt.id,
      referenceCode: stored.referenceCode,
      trackingStatus: "COMPLETED",
      pdfHash: archive[0].content_hash,
    };
  } catch {
    throw new Error("LAB_BROWSER_COMPLETION_NEEDS_REVIEW");
  } finally {
    await session.close();
  }
}

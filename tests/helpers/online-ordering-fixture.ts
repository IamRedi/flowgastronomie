import type { Page } from "@playwright/test";

export const orderingToken = "opaque-browser-order-tracking-token-123456";
export const timingFixture = {
  generatedAt: "2030-10-07T15:00:00.000Z",
  timezone: "Europe/Berlin",
  earliest: "2030-10-07T15:20:00.000Z",
  unavailableReason: null,
  slots: [
    { at: "2030-10-07T15:30:00.000Z", day: "2030-10-07", label: "17:30" },
    { at: "2030-10-07T15:45:00.000Z", day: "2030-10-07", label: "17:45" },
    { at: "2030-10-08T15:30:00.000Z", day: "2030-10-08", label: "17:30" },
  ],
};
export function trackingFixture(status = "PENDING_CONFIRMATION") {
  return {
    venue: {
      name: "Restaurant Olive",
      publicSlug: "restaurant-olive-demo",
      timezone: "Europe/Berlin",
    },
    referenceCode: "RF-ABC123",
    status,
    fulfillmentType: "PICKUP",
    totalMinor: 1250,
    currency: "EUR",
    contact: { name: "Browser Guest" },
    requestedFor: timingFixture.earliest,
    items: [
      {
        productName: "Margherita",
        quantity: 1,
        unitPriceMinor: 1250,
        variantName: "40 cm",
        modifiers: [{ optionName: "Basil" }],
      },
    ],
    timeline: [
      {
        status: "PENDING_CONFIRMATION",
        note: null,
        createdAt: timingFixture.generatedAt,
      },
    ],
    messages: [
      {
        author: "STAFF",
        body: "Please use the side entrance.",
        createdAt: timingFixture.generatedAt,
      },
    ],
  };
}
declare global {
  interface Window {
    __orderingStreams: EventTarget[];
    __orderingEventUrls: string[];
  }
}
export async function mockOrdering(page: Page, fallback = false) {
  const state = {
    status: "PENDING_CONFIRMATION",
    submissions: [] as Record<string, unknown>[],
  };
  await page.addInitScript(
    ({ fallback }) => {
      window.__orderingStreams = [];
      window.__orderingEventUrls = [];
      class Stream extends EventTarget {
        onopen: ((event: Event) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        constructor(url: string) {
          super();
          window.__orderingStreams.push(this);
          window.__orderingEventUrls.push(url);
          setTimeout(() => {
            if (fallback) this.onerror?.(new Event("error"));
            else this.onopen?.(new Event("open"));
          }, 10);
        }
        close() {}
      }
      window.EventSource = Stream as unknown as typeof EventSource;
    },
    { fallback },
  );
  await page.route("**/v1/public/online-orders/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/pickup-times"))
      return route.fulfill({ json: timingFixture });
    if (path.endsWith("/status")) {
      const body = request.postDataJSON();
      if (body.referenceCode !== "RF-ABC123")
        return route.fulfill({
          status: 404,
          json: { code: "ORDER_STATUS_UNAVAILABLE" },
        });
      const order = trackingFixture(state.status);
      return route.fulfill({
        json: {
          status: order.status,
          requestedFor: order.requestedFor,
          venue: { name: order.venue.name, timezone: order.venue.timezone },
        },
      });
    }
    if (path.endsWith("/recover")) {
      const body = request.postDataJSON();
      return body.referenceCode === "RF-ABC123" &&
        body.phone === "+49 30 123456"
        ? route.fulfill({ json: { referenceCode: "RF-ABC123" } })
        : route.fulfill({
            status: 404,
            json: { code: "ORDER_RECOVERY_FAILED" },
          });
    }
    if (
      path === "/v1/public/online-orders/restaurant-olive-demo" &&
      request.method() === "POST"
    ) {
      state.submissions.push(request.postDataJSON());
      return route.fulfill({
        status: 201,
        json: {
          referenceCode: "RF-ABC123",
          trackingToken: orderingToken,
          status: "PENDING_CONFIRMATION",
        },
      });
    }
    if (path.includes("/track/"))
      return route.fulfill({ json: trackingFixture(state.status) });
    return route.continue();
  });
  return state;
}

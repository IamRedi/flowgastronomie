import { describe, it, expect } from "vitest";
import {
  workforceNotificationCategories,
  workforceNotificationCopy,
  workforceNotificationPath,
  workforcePrivatePushCopy,
  workforceNoticeImportant,
  workforceDeliveryRetry,
  workforceNotificationPreferenceSchema,
  workforcePushSubscriptionSchema,
  assertWorkforceNoticeAcknowledgment,
} from "./workforce-notifications";
describe("WF3 notification invariants", () => {
  it.each(["sq", "de", "en", "it"] as const)(
    "all event categories have versioned localized %s messages and private push copy",
    (lang) => {
      for (const category of workforceNotificationCategories) {
        const c = workforceNotificationCopy(category, lang);
        expect(c.title.length).toBeGreaterThan(6);
        expect(c.body).not.toContain("undefined");
        expect(c.action.length).toBeGreaterThan(3);
      }
      const push = workforcePrivatePushCopy(lang);
      expect(push.body).not.toMatch(
        /SICK|diagnos|medical|contract|email|450|480|tenantId/i,
      );
      expect(push.title).toBe("FlowGastronomie");
    },
  );
  it("deep links are authenticated internal routes and encode hostile source IDs", () => {
    expect(
      workforceNotificationPath("en", {
        tab: "requests",
        requestId: "../x?evil=1",
      }),
    ).toBe(
      "/en/staff/schedule?workforceTab=requests&workforceRequest=..%2Fx%3Fevil%3D1",
    );
  });
  it("important publication changes require acknowledgment confirmation", () => {
    expect(workforceNoticeImportant("SHIFT_CHANGED")).toBe(true);
    expect(workforceNoticeImportant("SHIFT_CANCELLED")).toBe(true);
    expect(() => assertWorkforceNoticeAcknowledgment(true, false)).toThrow(
      "Review",
    );
    expect(() => assertWorkforceNoticeAcknowledgment(true, true)).not.toThrow();
  });
  it("retries use bounded backoff, exhaust attempts and stop after the deduplication window", () => {
    const now = new Date("2030-01-01T00:00Z");
    expect(
      workforceDeliveryRetry(1, now, now).nextAttemptAt.getTime() -
        now.getTime(),
    ).toBe(30000);
    expect(
      workforceDeliveryRetry(2, now, now).nextAttemptAt.getTime() -
        now.getTime(),
    ).toBe(120000);
    expect(workforceDeliveryRetry(5, now, now).state).toBe("FAILED");
    expect(
      workforceDeliveryRetry(2, new Date(now.getTime() + 24 * 3600000), now)
        .state,
    ).toBe("UNCERTAIN");
  });
  it("opt-in is explicit and duplicate/unknown category preferences are rejected", () => {
    const b = {
      expectedVersion: 0,
      locale: "de",
      emailEnabled: true,
      pushEnabled: false,
      reminderMinutes: 60,
      categories: ["SHIFT_CHANGED"],
      consentConfirmed: true,
    };
    expect(workforceNotificationPreferenceSchema.safeParse(b).success).toBe(
      true,
    );
    expect(
      workforceNotificationPreferenceSchema.safeParse({
        ...b,
        consentConfirmed: false,
      }).success,
    ).toBe(false);
    expect(
      workforceNotificationPreferenceSchema.safeParse({
        ...b,
        categories: ["SHIFT_CHANGED", "SHIFT_CHANGED"],
      }).success,
    ).toBe(false);
  });
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/synthetic",
    keys: { auth: "a".repeat(22), p256dh: "b".repeat(87) },
  };
  it("accepts only known HTTPS push services with browser keys and consent", () => {
    expect(
      workforcePushSubscriptionSchema.safeParse({
        consentConfirmed: true,
        subscription,
      }).success,
    ).toBe(true);
  });
  it.each([
    "http://127.0.0.1/push",
    "https://localhost/push",
    "https://example.invalid/push",
    "https://fcm.googleapis.com.evil.invalid/push",
    "https://user:pass@fcm.googleapis.com/push",
    "https://fcm.googleapis.com:8443/push",
    "https://fcm.googleapis.com/push#secret",
  ])("rejects push SSRF endpoint %s", (endpoint) => {
    expect(
      workforcePushSubscriptionSchema.safeParse({
        consentConfirmed: true,
        subscription: { ...subscription, endpoint },
      }).success,
    ).toBe(false);
  });
});

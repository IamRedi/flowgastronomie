import { describe, expect, it, vi } from "vitest";

import {
  createBrevoTransactionalNotificationService,
  createTransactionalNotificationServiceFromEnvironment,
  TransactionalEmailConfigurationError,
  TransactionalEmailDeliveryError,
} from "./brevo-transactional-notifications.js";
import type { TransactionalNotification } from "./transactional-notifications.js";

const configuration = {
  apiKey: "brevo-secret",
  senderAddress: "service@updates.flowgastronomie.example",
  senderName: "FlowGastronomie",
  webOrigin: "https://app.flowgastronomie.example",
};

function requestBody(call: unknown[]) {
  const options = call[1] as RequestInit;
  return JSON.parse(String(options.body)) as {
    sender: { email: string; name: string };
    to: { email: string }[];
    subject: string;
    htmlContent: string;
    textContent: string;
    headers: { "Idempotency-Key": string };
    tags: string[];
  };
}

describe("Brevo transactional notification adapter", () => {
  it("builds a localized invitation without exposing credentials in content", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response('{"messageId":"message-1"}', { status: 201 }),
      ),
    );
    const service = createBrevoTransactionalNotificationService(configuration, {
      fetchImpl,
    });
    const notification: TransactionalNotification = {
      kind: "STAFF_INVITATION",
      recipient: "manager@example.com",
      locale: "de",
      venueName: "Bistro <Mitte>",
      role: "MANAGER",
      invitationToken: "invite/secret",
    };

    await service.send(notification);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected Brevo request");
    const [url, options] = call;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(options?.headers).toMatchObject({ "api-key": "brevo-secret" });
    const body = requestBody(call);
    expect(body.sender).toEqual({
      email: configuration.senderAddress,
      name: "FlowGastronomie",
    });
    expect(body.to).toEqual([{ email: "manager@example.com" }]);
    expect(body.subject).toContain("Einladung");
    expect(body.htmlContent).toContain("Bistro &lt;Mitte&gt;");
    expect(body.htmlContent).not.toContain("Bistro <Mitte>");
    expect(body.textContent).toContain(
      "https://app.flowgastronomie.example/de/staff/invite/invite%2Fsecret",
    );
    expect(body.headers["Idempotency-Key"]).toMatch(
      /^flowgastronomie-staff_invitation-[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(body)).not.toContain("brevo-secret");
  });

  it("uses the same idempotency key for retries of the same event", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("{}", { status: 201 }));
    const delays: number[] = [];
    const service = createBrevoTransactionalNotificationService(configuration, {
      fetchImpl,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    const notification: TransactionalNotification = {
      kind: "ONLINE_ORDER_RECEIVED",
      recipient: "guest@example.com",
      locale: "sq",
      referenceCode: "FG-1042",
      trackingToken: "track-secret",
    };

    await service.send(notification);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([250]);
    const first = requestBody(fetchImpl.mock.calls[0] ?? []);
    const second = requestBody(fetchImpl.mock.calls[1] ?? []);
    expect(first.headers["Idempotency-Key"]).toBe(
      second.headers["Idempotency-Key"],
    );
    expect(first.subject).toBe("Kërkesa e porosisë FG-1042 u mor");
    expect(first.textContent).toContain(
      "https://app.flowgastronomie.example/sq/order/track/track-secret",
    );
  });

  it("accepts Brevo's duplicate response as an already delivered event", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response('{"code":"duplicate_parameter"}', { status: 400 }),
      ),
    );
    const service = createBrevoTransactionalNotificationService(configuration, {
      fetchImpl,
    });

    await expect(
      service.send({
        kind: "ONLINE_ORDER_RECEIVED",
        recipient: "guest@example.com",
        locale: "en",
        referenceCode: "FG-1042",
        trackingToken: "track-secret",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not retry permanent errors or expose the provider body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        new Response(
          '{"code":"invalid_parameter","message":"recipient guest@example.com rejected"}',
          { status: 400 },
        ),
      ),
    );
    const service = createBrevoTransactionalNotificationService(configuration, {
      fetchImpl,
    });

    const delivery = service.send({
      kind: "ONLINE_ORDER_STATUS_CHANGED",
      recipient: "guest@example.com",
      locale: "en",
      referenceCode: "FG-1042",
      status: "READY",
      note: null,
    });

    await expect(delivery).rejects.toMatchObject({
      provider: "brevo",
      status: 400,
      providerCode: "invalid_parameter",
    });
    await expect(delivery).rejects.not.toThrow(/guest@example\.com/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("renders every notification shape in every platform locale", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(new Response("{}", { status: 201 })),
    );
    const service = createBrevoTransactionalNotificationService(configuration, {
      fetchImpl,
    });
    const locales = ["en", "de", "it", "sq"] as const;
    const statuses = [
      "PENDING_CONFIRMATION",
      "ACCEPTED",
      "PREPARING",
      "READY",
      "OUT_FOR_DELIVERY",
      "COMPLETED",
      "REJECTED",
      "CANCELLED",
    ] as const;

    for (const locale of locales) {
      await service.send({
        kind: "STAFF_INVITATION",
        recipient: "staff@example.com",
        locale,
        venueName: "Venue",
        role: "OWNER",
        invitationToken: "invite-token",
      });
      await service.send({
        kind: "ONLINE_ORDER_RECEIVED",
        recipient: "guest@example.com",
        locale,
        referenceCode: "FG-1",
        trackingToken: "tracking-token",
      });
      await service.send({
        kind: "RESERVATION_CONFIRMED",
        recipient: "guest@example.com",
        locale,
        venueName: "Venue",
        requestedFor: new Date("2027-08-09T18:00:00.000Z"),
        timezone: "Europe/Berlin",
        partySize: 2,
      });
      for (const status of statuses) {
        await service.send({
          kind: "ONLINE_ORDER_STATUS_CHANGED",
          recipient: "guest@example.com",
          locale,
          referenceCode: "FG-1",
          status,
          note: "<strong>safe</strong>",
        });
      }
    }

    expect(fetchImpl).toHaveBeenCalledTimes(44);
    for (const call of fetchImpl.mock.calls) {
      const body = requestBody(call);
      expect(body.subject.length).toBeGreaterThan(5);
      expect(body.htmlContent).toContain("FlowGastronomie");
      expect(body.htmlContent).not.toContain("<strong>safe</strong>");
      expect(body.textContent).toContain("FlowGastronomie");
    }
  });
});

describe("transactional notification environment", () => {
  it("keeps delivery disabled when explicitly selected", async () => {
    const service = createTransactionalNotificationServiceFromEnvironment({
      NODE_ENV: "production",
      TRANSACTIONAL_EMAIL_PROVIDER: "disabled",
    });

    await expect(
      service.send({
        kind: "ONLINE_ORDER_RECEIVED",
        recipient: "guest@example.com",
        locale: "en",
        referenceCode: "FG-1",
        trackingToken: "tracking-token",
      }),
    ).resolves.toBeUndefined();
  });

  it("fails fast when production has no explicit provider decision", () => {
    expect(() =>
      createTransactionalNotificationServiceFromEnvironment({
        NODE_ENV: "production",
      }),
    ).toThrowError(TransactionalEmailConfigurationError);
  });

  it("validates Brevo configuration before the server starts", () => {
    expect(() =>
      createTransactionalNotificationServiceFromEnvironment({
        NODE_ENV: "production",
        TRANSACTIONAL_EMAIL_PROVIDER: "brevo",
        BREVO_API_KEY: "secret",
        TRANSACTIONAL_EMAIL_FROM_ADDRESS: "not-an-email",
        WEB_ORIGIN: "https://app.flowgastronomie.example/path",
      }),
    ).toThrowError(/TRANSACTIONAL_EMAIL_FROM_ADDRESS/);
  });

  it("returns a sanitized delivery error after network retries", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("secret"));
    const service = createBrevoTransactionalNotificationService(configuration, {
      fetchImpl,
      sleep: async () => undefined,
    });

    const delivery = service.send({
      kind: "ONLINE_ORDER_RECEIVED",
      recipient: "guest@example.com",
      locale: "en",
      referenceCode: "FG-1",
      trackingToken: "tracking-token",
    });

    await expect(delivery).rejects.toBeInstanceOf(
      TransactionalEmailDeliveryError,
    );
    await expect(delivery).rejects.not.toThrow(/secret/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it.each(["sq", "de", "en", "it"] as const)(
    "reuses the adapter for localized workforce %s messages with stable delivery identity and private content",
    async (locale) => {
      const fetchImpl = vi.fn<typeof fetch>(
        async () => new Response('{"messageId":"synthetic"}', { status: 201 }),
      );
      const service = createBrevoTransactionalNotificationService(
        configuration,
        { fetchImpl },
      );
      const notice: TransactionalNotification = {
        kind: "WORKFORCE_UPDATE",
        notificationId: "synthetic-notice-1",
        recipient: "worker@workforce.invalid",
        locale,
        category: "MONTHLY_STATEMENT",
        link: { tab: "month", month: "2030-08" },
      };
      await service.send(notice);
      await service.send(notice);
      const first = requestBody(fetchImpl.mock.calls[0]!),
        second = requestBody(fetchImpl.mock.calls[1]!);
      expect(first.headers["Idempotency-Key"]).toBe(
        second.headers["Idempotency-Key"],
      );
      expect(first.textContent).toContain(
        "/" +
          locale +
          "/staff/schedule?workforceTab=month&workforceMonth=2030-08",
      );
      expect(first.htmlContent).not.toContain("brevo-secret");
      expect(first.htmlContent).not.toMatch(
        /CONFIDENTIAL|diagnos|450|480|privateKey|p256dh/,
      );
      expect(first.to[0]?.email).toBe("worker@workforce.invalid");
    },
  );
});

import { expect, it, vi } from "vitest";
import { staffAuthRepository } from "@flowgastronomie/database";
import { buildApp } from "./app.js";

it("keeps recovery responses generic, rate-limits and never returns recovery credentials", async () => {
  const send = vi.fn(async () => {});
  const app = buildApp(
    {
      staffAuthRepository: {
        ...staffAuthRepository,
        requestPasswordReset: async (email) =>
          email.startsWith("known")
            ? [{ recipient: email, token: "private-proof" }]
            : [],
      },
      transactionalNotificationService: { send },
    },
    { logger: false },
  );
  try {
    const known = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: { email: "known@example.test", locale: "sq" },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: { email: "missing@example.test", locale: "sq" },
    });
    expect(known.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
    expect(known.headers["cache-control"]).toBe("no-store");
    expect(known.body).not.toContain("private-proof");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "STAFF_PASSWORD_RESET",
        resetToken: "private-proof",
        locale: "sq",
      }),
    );
    for (let i = 0; i < 3; i++)
      await app.inject({
        method: "POST",
        url: "/v1/auth/password-reset/request",
        payload: { email: "missing@example.test", locale: "sq" },
      });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/password-reset/request",
          payload: { email: "missing@example.test", locale: "sq" },
        })
      ).statusCode,
    ).toBe(429);
  } finally {
    await app.close();
  }
});

it("rejects caller scope, malformed and consumed proofs and clears login cookies on success", async () => {
  const resetPassword = vi.fn(
    async (input: { token: string; newPassword: string }) =>
      input.token === "a".repeat(43),
  );
  const app = buildApp(
    { staffAuthRepository: { ...staffAuthRepository, resetPassword } },
    { logger: false },
  );
  const post = (payload: unknown) =>
    app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/complete",
      payload: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    });
  try {
    expect(
      (
        await post({
          token: "a".repeat(43),
          newPassword: "a-long-test-password",
          tenantId: "foreign",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await post({ token: "short", newPassword: "a-long-test-password" }))
        .statusCode,
    ).toBe(400);
    expect(resetPassword).not.toHaveBeenCalled();
    expect(
      (
        await post({
          token: "b".repeat(43),
          newPassword: "a-long-test-password",
        })
      ).json(),
    ).toEqual({ code: "INVALID_RESET" });
    const r = await post({
      token: "a".repeat(43),
      newPassword: "a-long-test-password",
    });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers["set-cookie"])).toContain(
      "flowgastronomie_staff_session=;",
    );
    expect(r.body).not.toContain("sessionToken");
  } finally {
    await app.close();
  }
});

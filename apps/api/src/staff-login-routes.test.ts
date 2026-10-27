import { expect, it, vi } from "vitest";
import {
  staffAuthRepository,
  InvalidStaffCredentialsError,
  type VerifiedStaffChoice,
  type StaffIdentity,
} from "@flowgastronomie/database";
import { buildApp } from "./app.js";
const choice = (id: string): VerifiedStaffChoice => ({
  membershipId: id,
  userId: `user-${id}`,
  passwordHash: "private-proof-never-public",
  tenantName: `Business ${id}`,
  venueName: `Venue ${id}`,
  role: "OWNER",
});
function appFor(choices: VerifiedStaffChoice[]) {
  return buildApp(
    {
      staffAuthRepository: {
        ...staffAuthRepository,
        async credentials(input) {
          if (input.password !== "valid-password")
            throw new InvalidStaffCredentialsError();
          return choices;
        },
        async select(c) {
          return {
            sessionToken: "opaque-staff-token",
            expiresAt: new Date(Date.now() + 3600000),
            staff: {
              membershipId: c.membershipId,
              role: c.role,
            } as StaffIdentity,
          };
        },
        async logout() {},
      },
    },
    { logger: false },
  );
}
it("email sign-in issues only an HttpOnly staff cookie for one verified membership", async () => {
  const app = appFor([choice("one")]);
  try {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@example.test", password: "valid-password" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().staff.membershipId).toBe("one");
    expect(JSON.stringify(r.json())).not.toContain("sessionToken");
    expect(String(r.headers["set-cookie"])).toContain("HttpOnly");
  } finally {
    await app.close();
  }
});
it("reveals choices only after authentication and binds selection to the short-lived one-use proof", async () => {
  const app = appFor([choice("one"), choice("two")]);
  try {
    const bad = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@example.test", password: "wrong-password" },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.body).not.toContain("Venue");
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@example.test", password: "valid-password" },
    });
    expect(r.json().choices).toHaveLength(2);
    expect(r.body).not.toContain("passwordHash");
    expect(r.body).not.toContain("private-proof");
    const cookie = r.cookies.find(
      (c) => c.name === "flowgastronomie_login_choice",
    )!;
    const cookies = { [cookie.name]: cookie.value };
    expect(
      (
        await app.inject({ method: "GET", url: "/v1/auth/choices", cookies })
      ).json().choices,
    ).toHaveLength(2);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/select",
          cookies,
          payload: { membershipId: "foreign" },
        })
      ).statusCode,
    ).toBe(401);
    const selected = await app.inject({
      method: "POST",
      url: "/v1/auth/select",
      cookies,
      payload: { membershipId: "two" },
    });
    expect(selected.json().staff.membershipId).toBe("two");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/select",
          cookies,
          payload: { membershipId: "one" },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
it("expires choice proof without persisting a password or issuing an unselected session", async () => {
  const app = appFor([choice("one"), choice("two")]);
  try {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@example.test", password: "valid-password" },
    });
    const cookie = r.cookies.find(
      (c) => c.name === "flowgastronomie_login_choice",
    )!;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/choices",
          cookies: { [cookie.name]: cookie.value },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    vi.restoreAllMocks();
    await app.close();
  }
});

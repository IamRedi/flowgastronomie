import { randomUUID, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
export async function workforceFixture(
  app: FastifyInstance,
  country: "DE" | "AL" = "DE",
  clientAddress = "127.0.0.1",
  options: { name?: string } = {},
) {
  const id = randomUUID(),
    password = randomBytes(24).toString("base64url"),
    email = id + "@workforce.invalid";
  const signup = await app.inject({
    remoteAddress: clientAddress,
    method: "POST",
    url: "/v1/public/trials",
    payload: {
      requestKey: id,
      organizationName: options.name ?? "WF1 synthetic " + id,
      venueName:
        options.name ??
        (country === "DE" ? "Synthetic Pizza Lab" : "Synthetic Restaurant Lab"),
      ownerDisplayName: "Synthetic Owner",
      email,
      password,
      locale: "en",
      countryCode: country,
      timezone: country === "DE" ? "Europe/Berlin" : "Europe/Tirane",
      currency: country === "DE" ? "EUR" : "ALL",
      plan: "RESTAURANT_PRO",
      profileId: country === "DE" ? "PIZZERIA" : "RESTAURANT",
      applyCategories: false,
    },
  });
  if (signup.statusCode !== 201)
    throw new Error("Fixture registration failed: " + signup.body);
  const owner = signup.json().staff,
    cookie = signup.cookies.map((c) => c.name + "=" + c.value).join("; ");
  async function addEmployee(
    name: string,
    role: "MANAGER" | "WAITER" | "KITCHEN" | "BAR" = "WAITER",
  ) {
    const staffEmail = randomUUID() + "@workforce.invalid",
      staffPassword = randomBytes(24).toString("base64url");
    const invite = await app.inject({
      remoteAddress: clientAddress,
      method: "POST",
      url: "/v1/staff/team/invitations",
      headers: { cookie },
      payload: { email: staffEmail, role, preferredLocale: "en" },
    });
    if (invite.statusCode !== 201)
      throw new Error("Fixture invitation failed: " + invite.body);
    const accepted = await app.inject({
      remoteAddress: clientAddress,
      method: "POST",
      url: "/v1/auth/invitations/" + invite.json().invitationToken + "/accept",
      payload: { displayName: name, password: staffPassword },
    });
    if (accepted.statusCode !== 200)
      throw new Error("Fixture acceptance failed: " + accepted.body);
    const login = await app.inject({
      remoteAddress: clientAddress,
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        tenantSlug: owner.tenantSlug,
        venueSlug: owner.venueSlug,
        email: staffEmail,
        password: staffPassword,
      },
    });
    if (login.statusCode !== 200) throw new Error("Fixture login failed");
    return {
      ...login.json().staff,
      cookie: login.cookies.map((c) => c.name + "=" + c.value).join("; "),
      password: staffPassword,
    };
  }
  return {
    owner: { ...owner, cookie, password },
    addEmployee,
    email,
    password,
  };
}

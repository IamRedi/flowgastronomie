import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  InvalidStaffCredentialsError,
  type StaffAuthRepository,
  type StaffLoginResult,
  type VerifiedStaffChoice,
} from "@flowgastronomie/database";
import { unauthenticatedRateLimits } from "./guest-rate-limit.js";
const credentials = z
  .object({
    email: z.email().max(254),
    password: z.string().min(8).max(128),
    tenantSlug: z.string().trim().min(1).max(100).optional(),
    venueSlug: z.string().trim().min(1).max(100).optional(),
  })
  .refine((x) => !!x.tenantSlug === !!x.venueSlug);
const cookie = "flowgastronomie_login_choice";
export function registerStaffLoginRoutes(
  app: FastifyInstance,
  repository: StaffAuthRepository,
) {
  // Short-lived credential proof only. Never a staff session; restart requires signing in again.
  const challenges = new Map<
    string,
    { expires: number; choices: VerifiedStaffChoice[] }
  >();
  const config = {
    config: { rateLimit: unauthenticatedRateLimits.staffLogin },
  };
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/v1/auth",
  };
  const publicChoices = (choices: VerifiedStaffChoice[]) => ({
    choices: choices.map((c) => ({
      id: c.membershipId,
      organization: c.tenantName,
      venue: c.venueName,
      role: c.role,
    })),
  });
  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "POST" && request.url === "/v1/auth/logout") {
      const token = request.cookies[cookie];
      if (token) challenges.delete(token);
      reply.clearCookie(cookie, { path: options.path });
    }
  });
  const complete = async (
    result: StaffLoginResult,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const old = request.cookies.flowgastronomie_staff_session;
    if (old) await repository.logout(old);
    reply.header("Cache-Control", "no-store");
    if (request.cookies[cookie])
      reply.clearCookie(cookie, { path: options.path });
    reply.setCookie("flowgastronomie_staff_session", result.sessionToken, {
      ...options,
      path: "/",
      expires: result.expiresAt,
    });
    return { staff: result.staff, expiresAt: result.expiresAt };
  };
  const denied = (reply: FastifyReply) =>
    reply.code(401).send({
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect, or sign-in has expired.",
    });
  const proof = (request: FastifyRequest) => {
    const token = request.cookies[cookie];
    const value = token ? challenges.get(token) : undefined;
    return value && value.expires > Date.now() ? value : undefined;
  };
  app.post("/v1/auth/login", config, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = credentials.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ code: "INVALID_LOGIN_REQUEST" });
    const old = request.cookies[cookie];
    if (old) {
      challenges.delete(old);
      reply.clearCookie(cookie, { path: options.path });
    }
    try {
      const input = body.data;
      if (input.tenantSlug && input.venueSlug)
        return await complete(
          await repository.login({
            ...input,
            tenantSlug: input.tenantSlug,
            venueSlug: input.venueSlug,
          }),
          request,
          reply,
        );
      if (!repository.credentials || !repository.select) return denied(reply);
      const choices = await repository.credentials(input);
      if (choices.length === 1)
        return await complete(
          await repository.select(choices[0]!),
          request,
          reply,
        );
      for (const [key, value] of challenges)
        if (value.expires <= Date.now()) challenges.delete(key);
      if (challenges.size >= 1024)
        return reply.code(503).send({ code: "LOGIN_BUSY" });
      const token = randomBytes(32).toString("base64url");
      const expires = Date.now() + 5 * 60_000;
      challenges.set(token, { expires, choices });
      reply.setCookie(cookie, token, {
        ...options,
        expires: new Date(expires),
      });
      return publicChoices(choices);
    } catch (error) {
      if (error instanceof InvalidStaffCredentialsError) return denied(reply);
      throw error;
    }
  });
  app.get("/v1/auth/choices", config, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const value = proof(request);
    return value ? publicChoices(value.choices) : denied(reply);
  });
  app.post("/v1/auth/select", config, async (request, reply) => {
    const input = z
      .object({ membershipId: z.string().min(1).max(100) })
      .safeParse(request.body);
    const value = proof(request);
    const choice = input.success
      ? value?.choices.find((c) => c.membershipId === input.data.membershipId)
      : undefined;
    if (!choice || !repository.select) return denied(reply);
    challenges.delete(request.cookies[cookie]!);
    try {
      const result = await repository.select(choice);
      return await complete(result, request, reply);
    } catch (error) {
      if (error instanceof InvalidStaffCredentialsError) return denied(reply);
      throw error;
    }
  });
  app.addHook("onClose", async () => challenges.clear());
}

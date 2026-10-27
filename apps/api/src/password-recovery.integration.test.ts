import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  prisma,
  staffAuthRepository,
  type VerifiedStaffChoice,
} from "@flowgastronomie/database";
import { provisionBusinessInTransaction } from "../../../packages/database/src/business-provisioner.js";
import { hashOpaqueToken } from "../../../packages/database/src/public-menu-repository.js";

describe.skipIf(process.env.SMART_SETUP_DB_GATE !== "true")(
  "isolated password recovery",
  () => {
    afterAll(async () => {
      await prisma.$disconnect();
    });
    async function account(email = `${randomUUID()}@recovery.invalid`) {
      return prisma.$transaction(
        (tx) =>
          provisionBusinessInTransaction(
            tx,
            {
              requestKey: randomUUID(),
              organizationName: "TEST ONLY recovery",
              venueName: "TEST ONLY recovery",
              ownerDisplayName: "Synthetic owner",
              email,
              password: "original-synthetic-password",
              locale: "en",
              timezone: "Europe/Berlin",
              currency: "EUR",
              plan: "RESTAURANT_PRO",
              profileId: "CAFE",
              applyCategories: false,
            },
            "DEMO",
          ),
        { timeout: 15000 },
      );
    }
    it("scopes tokens to one identity, serializes reuse, revokes sessions and rejects stale login choices", async () => {
      const a = await account(),
        b = await account(a.owner.email);
      const choices = await staffAuthRepository.credentials!({
        email: a.owner.email,
        password: "original-synthetic-password",
      });
      expect(choices).toHaveLength(2);
      const choice = choices.find((c) => c.userId === a.owner.id)!;
      const sessionA = await staffAuthRepository.select!(choice);
      const sessionB = await staffAuthRepository.select!(
        choices.find((c) => c.userId === b.owner.id)!,
      );
      const links = await staffAuthRepository.requestPasswordReset!(
        a.owner.email,
      );
      expect(links).toHaveLength(2);
      expect(
        await staffAuthRepository.requestPasswordReset!(a.owner.email),
      ).toEqual([]);
      const row = await prisma.staffPasswordReset.findFirstOrThrow({
        where: { userId: a.owner.id, tenantId: a.tenant.id },
      });
      const link = links.find(
        (l) => hashOpaqueToken(l.token) === row.tokenHash,
      )!;
      expect(row.tokenHash).not.toBe(link.token);
      const results = await Promise.all(
        [1, 2].map(() =>
          staffAuthRepository.resetPassword!({
            token: link.token,
            newPassword: "new-synthetic-password",
          }),
        ),
      );
      expect(results.sort()).toEqual([false, true]);
      expect(
        await staffAuthRepository.authenticate(sessionA.sessionToken),
      ).toBeNull();
      expect(
        await staffAuthRepository.authenticate(sessionB.sessionToken),
      ).not.toBeNull();
      await expect(staffAuthRepository.select!(choice)).rejects.toThrow();
      const old = await staffAuthRepository.credentials!({
        email: a.owner.email,
        password: "original-synthetic-password",
      });
      expect(old.map((c) => c.userId)).toEqual([b.owner.id]);
      expect(
        (
          await staffAuthRepository.credentials!({
            email: a.owner.email,
            password: "new-synthetic-password",
          })
        ).map((c) => c.userId),
      ).toEqual([a.owner.id]);
    });
    it("rejects expiry, disabled users and tokens issued before a password change", async () => {
      for (const scenario of ["expired", "inactive", "changed"] as const) {
        const a = await account();
        const [link] = await staffAuthRepository.requestPasswordReset!(
          a.owner.email,
        );
        if (scenario === "expired")
          await prisma.staffPasswordReset.updateMany({
            where: { tenantId: a.tenant.id },
            data: { expiresAt: new Date(0) },
          });
        else
          await prisma.user.update({
            where: { id: a.owner.id },
            data:
              scenario === "inactive"
                ? { active: false }
                : { passwordHash: "a-new-independent-hash" },
          });
        expect(
          await staffAuthRepository.resetPassword!({
            token: link!.token,
            newPassword: "new-synthetic-password",
          }),
        ).toBe(false);
      }
      expect(
        await staffAuthRepository.requestPasswordReset!(
          "missing@recovery.invalid",
        ),
      ).toEqual([]);
    });
  },
);

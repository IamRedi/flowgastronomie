import { randomBytes } from "node:crypto";

import {
  staffPasswordChangeSchema,
  staffPasswordResetSchema,
  STAFF_PASSWORD_RESET_LIFETIME_MS,
  STAFF_PASSWORD_RESET_COOLDOWN_MS,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { hashPassword, verifyPassword } from "./password.js";
import { hashOpaqueToken } from "./public-menu-repository.js";

export type VerifiedStaffChoice = {
  membershipId: string;
  userId: string;
  passwordHash: string;
  tenantName: string;
  venueName: string;
  role: StaffRole;
};
const sessionLifetimeMilliseconds = 12 * 60 * 60 * 1_000;

export class InvalidStaffCredentialsError extends Error {
  constructor() {
    super("The organization, venue, email, or password is incorrect");
    this.name = "InvalidStaffCredentialsError";
  }
}

export type StaffIdentity = {
  sessionId: string;
  userId: string;
  membershipId: string;
  displayName: string;
  email: string;
  tenantId: string;
  tenantSlug: string;
  tenantKind?: "REAL" | "DEMO" | "LOCAL_PILOT" | "LEGACY_CI";
  venueId: string;
  venueName: string;
  venueLogoUrl?: string | null;
  venueCity?: string | null;
  venueSlug: string;
  role: StaffRole;
};

export type StaffLoginResult = {
  sessionToken: string;
  expiresAt: Date;
  staff: StaffIdentity;
};

export type StaffAuthRepository = {
  requestPasswordReset?(
    email: string,
  ): Promise<{ recipient: string; token: string }[]>;
  resetPassword?(input: {
    token: string;
    newPassword: string;
  }): Promise<boolean>;
  credentials?(input: {
    email: string;
    password: string;
  }): Promise<VerifiedStaffChoice[]>;
  select?(choice: VerifiedStaffChoice): Promise<StaffLoginResult>;
  login(input: {
    tenantSlug: string;
    venueSlug: string;
    email: string;
    password: string;
  }): Promise<StaffLoginResult>;
  authenticate(sessionToken: string): Promise<StaffIdentity | null>;
  logout(sessionToken: string): Promise<void>;
  changePassword?(
    staff: StaffIdentity,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
};

function mapIdentity(session: {
  id: string;
  user: { id: string; displayName: string; email: string };
  tenant: { id: string; slug: string; kind?: StaffIdentity["tenantKind"] };
  venue: {
    id: string;
    name: string;
    slug: string;
    city?: string | null;
    media?: Array<{ mediaAssetId: string }>;
  };
  membership: { id: string; role: StaffRole };
}): StaffIdentity {
  return {
    sessionId: session.id,
    userId: session.user.id,
    membershipId: session.membership.id,
    displayName: session.user.displayName,
    email: session.user.email,
    tenantId: session.tenant.id,
    tenantSlug: session.tenant.slug,
    tenantKind: session.tenant.kind ?? "REAL",
    venueId: session.venue.id,
    venueName: session.venue.name,
    venueCity: session.venue.city ?? null,
    venueLogoUrl: session.venue.media?.[0]
      ? `/v1/media/${session.venue.media[0].mediaAssetId}`
      : null,
    venueSlug: session.venue.slug,
    role: session.membership.role,
  };
}

async function establishVerifiedSession(
  choice: Pick<VerifiedStaffChoice, "membershipId" | "userId" | "passwordHash">,
): Promise<StaffLoginResult> {
  return prisma.$transaction(async (tx) => {
    // Password changes take this same user-row lock before revoking sessions.
    // A stale proof can never create a fresh session after that revocation commits.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${choice.userId} FOR UPDATE`;
    const m = await tx.membership.findFirst({
      where: {
        id: choice.membershipId,
        userId: choice.userId,
        active: true,
        tenant: { retiredAt: null },
        user: { active: true, passwordHash: choice.passwordHash },
      },
      select: { id: true, tenantId: true, venueId: true, userId: true },
    });
    if (!m) throw new InvalidStaffCredentialsError();
    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionLifetimeMilliseconds);
    const session = await tx.staffSession.create({
      data: {
        tenantId: m.tenantId,
        venueId: m.venueId,
        userId: m.userId,
        membershipId: m.id,
        tokenHash: hashOpaqueToken(sessionToken),
        expiresAt,
      },
      include: {
        tenant: true,
        venue: {
          include: {
            media: { where: { role: "LOGO" }, select: { mediaAssetId: true } },
          },
        },
        user: true,
        membership: true,
      },
    });
    return { sessionToken, expiresAt, staff: mapIdentity(session) };
  });
}

export const staffAuthRepository: StaffAuthRepository = {
  async requestPasswordReset(email) {
    const users = await prisma.user.findMany({
      where: {
        email: email.trim().toLowerCase(),
        active: true,
        tenant: { retiredAt: null },
        memberships: { some: { active: true } },
      },
      take: 21,
      select: { id: true, tenantId: true, email: true },
    });
    if (users.length > 20) return [];
    const issued: { recipient: string; token: string }[] = [];
    for (const user of users) {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} AND "tenantId"=${user.tenantId} FOR UPDATE`;
        const current = await tx.user.findFirst({
          where: {
            id: user.id,
            tenantId: user.tenantId,
            active: true,
            tenant: { retiredAt: null },
          },
        });
        if (!current) return null;
        const now = new Date();
        // Bound email abuse across client addresses without exposing account existence.
        const recent = await tx.staffPasswordReset.findFirst({
          where: {
            tenantId: user.tenantId,
            userId: user.id,
            createdAt: {
              gt: new Date(now.getTime() - STAFF_PASSWORD_RESET_COOLDOWN_MS),
            },
          },
        });
        if (recent) return null;
        await tx.staffPasswordReset.updateMany({
          where: { tenantId: user.tenantId, userId: user.id, consumedAt: null },
          data: { consumedAt: now },
        });
        const token = randomBytes(32).toString("base64url");
        await tx.staffPasswordReset.create({
          data: {
            tenantId: user.tenantId,
            userId: user.id,
            tokenHash: hashOpaqueToken(token),
            passwordHashAtIssue: current.passwordHash,
            expiresAt: new Date(
              now.getTime() + STAFF_PASSWORD_RESET_LIFETIME_MS,
            ),
          },
        });
        return { recipient: user.email, token };
      });
      if (result) issued.push(result);
    }
    return issued;
  },
  async resetPassword(input) {
    staffPasswordResetSchema.parse(input);
    const tokenHash = hashOpaqueToken(input.token);
    const proof = await prisma.staffPasswordReset.findUnique({
      where: { tokenHash },
    });
    if (!proof || proof.consumedAt || proof.expiresAt <= new Date())
      return false;
    const passwordHash = await hashPassword(input.newPassword);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${proof.userId} AND "tenantId"=${proof.tenantId} FOR UPDATE`;
      const now = new Date();
      const user = await tx.user.findFirst({
        where: {
          id: proof.userId,
          tenantId: proof.tenantId,
          active: true,
          passwordHash: proof.passwordHashAtIssue,
          tenant: { retiredAt: null },
          memberships: { some: { active: true } },
        },
      });
      if (!user) return false;
      const consumed = await tx.staffPasswordReset.updateMany({
        where: {
          id: proof.id,
          tenantId: proof.tenantId,
          userId: proof.userId,
          tokenHash,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return false;
      await tx.user.update({
        where: { tenantId_id: { tenantId: user.tenantId, id: user.id } },
        data: { passwordHash },
      });
      await tx.staffSession.updateMany({
        where: { tenantId: user.tenantId, userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.staffPasswordReset.updateMany({
        where: { tenantId: user.tenantId, userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      return true;
    });
  },
  async credentials(input) {
    const users = await prisma.user.findMany({
      where: {
        email: input.email.trim().toLowerCase(),
        active: true,
        tenant: { retiredAt: null },
      },
      take: 21,
      include: {
        memberships: {
          where: { active: true, tenant: { retiredAt: null } },
          include: { tenant: true, venue: true },
        },
      },
    });
    if (!users.length || users.length > 20) {
      await hashPassword(input.password);
      throw new InvalidStaffCredentialsError();
    }
    const choices: VerifiedStaffChoice[] = [];
    // Verify every distinct tenant identity. Same email is never proof of a shared account.
    for (const user of users)
      if (await verifyPassword(input.password, user.passwordHash))
        for (const m of user.memberships)
          if (m.tenantId === user.tenantId)
            choices.push({
              membershipId: m.id,
              userId: user.id,
              passwordHash: user.passwordHash,
              tenantName: m.tenant.name,
              venueName: m.venue.name,
              role: m.role,
            });
    if (!choices.length || choices.length > 100)
      throw new InvalidStaffCredentialsError();
    return choices;
  },
  async select(choice) {
    return establishVerifiedSession(choice);
  },
  async changePassword(staff, currentPassword, newPassword) {
    staffPasswordChangeSchema.parse({ currentPassword, newPassword });
    const user = await prisma.user.findFirst({
      where: { id: staff.userId, tenantId: staff.tenantId, active: true },
    });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash)))
      throw new InvalidStaffCredentialsError();
    const passwordHash = await hashPassword(newPassword);
    await prisma.$transaction(async (tx) => {
      const n = await tx.user.updateMany({
        where: {
          id: user.id,
          tenantId: staff.tenantId,
          passwordHash: user.passwordHash,
        },
        data: { passwordHash },
      });
      if (n.count !== 1) throw new InvalidStaffCredentialsError();
      await tx.staffSession.updateMany({
        where: { tenantId: staff.tenantId, userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: user.id,
          actorMembershipId: staff.membershipId,
          action: "STAFF_PASSWORD_CHANGED",
          entityType: "User",
          entityId: user.id,
          metadata: { sessionsRevoked: true },
        },
      });
    });
  },
  async login(input) {
    const membership = await prisma.membership.findFirst({
      where: {
        tenant: { slug: input.tenantSlug, retiredAt: null },
        venue: { slug: input.venueSlug },
        user: { email: input.email.trim().toLowerCase(), active: true },
        active: true,
      },
      include: { tenant: true, venue: true, user: true },
    });

    if (!membership) {
      await hashPassword(input.password);
      throw new InvalidStaffCredentialsError();
    }

    const passwordMatches = await verifyPassword(
      input.password,
      membership.user.passwordHash,
    );
    if (!passwordMatches) throw new InvalidStaffCredentialsError();

    return establishVerifiedSession({
      membershipId: membership.id,
      userId: membership.userId,
      passwordHash: membership.user.passwordHash,
    });
  },

  async authenticate(sessionToken) {
    const session = await prisma.staffSession.findFirst({
      where: {
        tokenHash: hashOpaqueToken(sessionToken),
        revokedAt: null,
        tenant: { retiredAt: null },
        expiresAt: { gt: new Date() },
        user: { active: true },
        membership: { active: true },
      },
      include: {
        tenant: true,
        venue: {
          include: {
            media: { where: { role: "LOGO" }, select: { mediaAssetId: true } },
          },
        },
        user: true,
        membership: true,
      },
    });

    return session ? mapIdentity(session) : null;
  },

  async logout(sessionToken) {
    await prisma.staffSession.updateMany({
      where: {
        tokenHash: hashOpaqueToken(sessionToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  },
};

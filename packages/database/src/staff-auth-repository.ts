import { randomBytes } from "node:crypto";

import {
  staffPasswordChangeSchema,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { hashPassword, verifyPassword } from "./password.js";
import { hashOpaqueToken } from "./public-menu-repository.js";

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

export const staffAuthRepository: StaffAuthRepository = {
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

    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionLifetimeMilliseconds);
    const session = await prisma.staffSession.create({
      data: {
        tenantId: membership.tenantId,
        venueId: membership.venueId,
        userId: membership.userId,
        membershipId: membership.id,
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

    return {
      sessionToken,
      expiresAt,
      staff: mapIdentity(session),
    };
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

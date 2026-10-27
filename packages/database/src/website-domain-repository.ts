import { Prisma } from "@prisma/client";
import {
  CUSTOM_DOMAIN_TARGET,
  assertStaffPermission,
  canActivateWebsiteDomain,
  isValidWebsiteDomain,
  normalizeWebsiteDomain,
  websiteDomainVerificationRecord,
  type PlatformLocale,
  type WebsiteDomainStatus,
} from "@flowgastronomie/domain";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

import { prisma } from "./client.js";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { subscriptionRepository } from "./subscription-repository.js";

export class WebsiteDomainNotFoundError extends Error {
  constructor() {
    super("The custom domain was not found");
    this.name = "WebsiteDomainNotFoundError";
  }
}

export class WebsiteDomainConflictError extends Error {
  constructor() {
    super("This custom domain is already connected to another website");
    this.name = "WebsiteDomainConflictError";
  }
}

export class WebsiteDomainInvalidError extends Error {
  constructor() {
    super("Enter a valid public domain without protocol, path, or port");
    this.name = "WebsiteDomainInvalidError";
  }
}

export class WebsiteDomainNotVerifiedError extends Error {
  constructor() {
    super("The custom domain must be verified before activation");
    this.name = "WebsiteDomainNotVerifiedError";
  }
}

export type WebsiteDomainEditor = {
  hostname: string;
  status: WebsiteDomainStatus;
  verificationRecord: { type: "TXT"; name: string; value: string };
  routingRecord: { type: "CNAME"; name: string; value: string };
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  activatedAt: Date | null;
  failureReason: string | null;
  fallbackUrl: string;
};

export type WebsiteDomainRepository = {
  get(staff: StaffIdentity): Promise<WebsiteDomainEditor | null>;
  configure(input: {
    staff: StaffIdentity;
    hostname: string;
  }): Promise<WebsiteDomainEditor>;
  verify(staff: StaffIdentity): Promise<WebsiteDomainEditor>;
  activate(staff: StaffIdentity): Promise<WebsiteDomainEditor>;
  remove(staff: StaffIdentity): Promise<void>;
  resolvePublic(hostname: string): Promise<{
    publicSlug: string;
    defaultLocale: PlatformLocale;
  } | null>;
};

type TxtResolver = (hostname: string) => Promise<string[][]>;

const platformLocale = { EN: "en", DE: "de", IT: "it", SQ: "sq" } as const;

function mapDomain(domain: {
  hostname: string;
  status: WebsiteDomainStatus;
  verificationToken: string;
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  activatedAt: Date | null;
  failureReason: string | null;
  website: { publicSlug: string };
}): WebsiteDomainEditor {
  return {
    hostname: domain.hostname,
    status: domain.status,
    verificationRecord: websiteDomainVerificationRecord(
      domain.hostname,
      domain.verificationToken,
    ),
    routingRecord: {
      type: "CNAME",
      name: domain.hostname,
      value: CUSTOM_DOMAIN_TARGET,
    },
    lastCheckedAt: domain.lastCheckedAt,
    verifiedAt: domain.verifiedAt,
    activatedAt: domain.activatedAt,
    failureReason: domain.failureReason,
    fallbackUrl: `/${domain.website.publicSlug}`,
  };
}

const includeWebsite = { website: { select: { publicSlug: true } } };

function translateConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new WebsiteDomainConflictError();
  }
  throw error;
}

export function createWebsiteDomainRepository(
  txtResolver: TxtResolver = resolveTxt,
): WebsiteDomainRepository {
  async function scoped(staff: StaffIdentity) {
    const domain = await prisma.websiteDomain.findFirst({
      where: { tenantId: staff.tenantId, venueId: staff.venueId },
      include: includeWebsite,
    });
    if (!domain) throw new WebsiteDomainNotFoundError();
    return domain;
  }

  async function authorize(staff: StaffIdentity) {
    assertStaffPermission(staff.role, "WEBSITE_DOMAIN_MANAGE");
    await subscriptionRepository.assertFeature(staff.tenantId, "CUSTOM_DOMAIN");
  }

  return {
    async get(staff) {
      await authorize(staff);
      const domain = await prisma.websiteDomain.findFirst({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        include: includeWebsite,
      });
      return domain ? mapDomain(domain) : null;
    },

    async configure({ staff, hostname: value }) {
      await authorize(staff);
      const hostname = normalizeWebsiteDomain(value);
      if (!isValidWebsiteDomain(hostname))
        throw new WebsiteDomainInvalidError();
      const website = await prisma.venueWebsite.findFirst({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
      });
      if (!website) throw new WebsiteDomainNotFoundError();
      const verificationToken = randomBytes(24).toString("base64url");
      try {
        const domain = await prisma.$transaction(async (transaction) => {
          const saved = await transaction.websiteDomain.upsert({
            where: { venueId: staff.venueId },
            create: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              websiteId: website.id,
              hostname,
              verificationToken,
            },
            update: {
              hostname,
              verificationToken,
              status: "PENDING",
              lastCheckedAt: null,
              verifiedAt: null,
              activatedAt: null,
              failureReason: null,
            },
            include: includeWebsite,
          });
          await transaction.auditEvent.create({
            data: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              actorUserId: staff.userId,
              actorMembershipId: staff.membershipId,
              action: "WEBSITE_DOMAIN_CONFIGURED",
              entityType: "WebsiteDomain",
              entityId: saved.id,
              metadata: { hostname },
            },
          });
          return saved;
        });
        return mapDomain(domain);
      } catch (error) {
        return translateConflict(error);
      }
    },

    async verify(staff) {
      await authorize(staff);
      const current = await scoped(staff);
      const expected = websiteDomainVerificationRecord(
        current.hostname,
        current.verificationToken,
      );
      let verified = false;
      try {
        const records = await txtResolver(expected.name);
        verified = records.some((record) => record.join("") === expected.value);
      } catch {
        verified = false;
      }
      const now = new Date();
      const saved = await prisma.websiteDomain.update({
        where: { id: current.id },
        data: verified
          ? {
              status: "VERIFIED",
              lastCheckedAt: now,
              verifiedAt: now,
              failureReason: null,
            }
          : {
              status: "FAILED",
              lastCheckedAt: now,
              verifiedAt: null,
              activatedAt: null,
              failureReason: "TXT_RECORD_NOT_FOUND",
            },
        include: includeWebsite,
      });
      return mapDomain(saved);
    },

    async activate(staff) {
      await authorize(staff);
      const current = await scoped(staff);
      if (!canActivateWebsiteDomain(current.status)) {
        throw new WebsiteDomainNotVerifiedError();
      }
      const saved = await prisma.websiteDomain.update({
        where: { id: current.id },
        data: { status: "ACTIVE", activatedAt: new Date() },
        include: includeWebsite,
      });
      return mapDomain(saved);
    },

    async remove(staff) {
      await authorize(staff);
      const current = await scoped(staff);
      await prisma.websiteDomain.delete({ where: { id: current.id } });
    },

    async resolvePublic(value) {
      const hostname = normalizeWebsiteDomain(value);
      if (!isValidWebsiteDomain(hostname)) return null;
      const domain = await prisma.websiteDomain.findUnique({
        where: { hostname },
        include: {
          website: true,
          venue: { select: { defaultLocale: true } },
          tenant: {
            include: { subscription: { include: { entitlements: true } } },
          },
        },
      });
      if (
        !domain ||
        domain.status !== "ACTIVE" ||
        domain.website.status !== "PUBLISHED"
      )
        return null;
      const subscription = domain.tenant.subscription;
      const enabled = subscription?.entitlements.some(
        (item) => item.featureKey === "CUSTOM_DOMAIN" && item.enabled,
      );
      const active =
        subscription?.status === "ACTIVE" ||
        (subscription?.status === "TRIALING" &&
          subscription.trialEndsAt !== null &&
          subscription.trialEndsAt > new Date());
      return enabled && active
        ? {
            publicSlug: domain.website.publicSlug,
            defaultLocale: platformLocale[domain.venue.defaultLocale],
          }
        : null;
    },
  };
}

export const websiteDomainRepository = createWebsiteDomainRepository();

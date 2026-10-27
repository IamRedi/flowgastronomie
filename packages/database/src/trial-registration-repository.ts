import { createHash, randomUUID } from "node:crypto";
import {
  type BusinessProvisionInput,
  type PlatformLocale,
  type SubscriptionPlan,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import { provisionBusinessInTransaction } from "./business-provisioner.js";
import {
  staffAuthRepository,
  type StaffLoginResult,
} from "./staff-auth-repository.js";

export class TrialEmailAlreadyRegisteredError extends Error {
  constructor() {
    super("An account already exists for this email address");
    this.name = "TrialEmailAlreadyRegisteredError";
  }
}
export type TrialRegistrationInput = {
  organizationName: string;
  venueName: string;
  ownerDisplayName: string;
  email: string;
  password: string;
  locale: PlatformLocale;
  countryCode?: BusinessProvisionInput["countryCode"];
  timezone: BusinessProvisionInput["timezone"];
  currency: BusinessProvisionInput["currency"];
  plan: SubscriptionPlan;
  requestKey?: string | undefined;
  profileId?: BusinessProvisionInput["profileId"] | undefined;
  applyCategories?: boolean | undefined;
  premiumTemplate?: BusinessProvisionInput["premiumTemplate"] | undefined;
};
export type TrialRegistrationResult = StaffLoginResult & {
  subscription: {
    plan: SubscriptionPlan;
    status: "TRIALING";
    trialEndsAt: Date;
  };
};
export type TrialRegistrationRepository = {
  register(input: TrialRegistrationInput): Promise<TrialRegistrationResult>;
};

export const trialRegistrationRepository: TrialRegistrationRepository = {
  async register(input) {
    const email = input.email.trim().toLowerCase();
    const requestKey = input.requestKey ?? randomUUID();
    const requestKeyHash = createHash("sha256")
      .update(requestKey)
      .digest("hex");
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`signup:${email}`}, 0))`;
        const prior = await tx.businessProvision.findUnique({
          where: { requestKeyHash },
        });
        if (
          !prior &&
          (await tx.user.findFirst({ where: { email }, select: { id: true } }))
        )
          throw new TrialEmailAlreadyRegisteredError();
        const business = await provisionBusinessInTransaction(tx, {
          ...input,
          email,
          requestKey,
          profileId: input.profileId ?? "GENERIC",
          applyCategories: input.applyCategories ?? false,
        });
        const subscription = await tx.subscription.findUniqueOrThrow({
          where: { tenantId: business.tenant.id },
        });
        if (business.created)
          await tx.auditEvent.create({
            data: {
              tenantId: business.tenant.id,
              venueId: business.venue.id,
              actorUserId: business.owner.id,
              actorMembershipId: business.membership.id,
              action: "TRIAL_STARTED",
              entityType: "Subscription",
              entityId: subscription.id,
              metadata: {
                plan: subscription.plan,
                trialEndsAt: subscription.trialEndsAt!.toISOString(),
              },
            },
          });
        return { business, subscription };
      },
      { timeout: 15_000 },
    );
    const login = await staffAuthRepository.login({
      tenantSlug: result.business.tenant.slug,
      venueSlug: result.business.venue.slug,
      email,
      password: input.password,
    });
    return {
      ...login,
      subscription: {
        plan: result.subscription.plan,
        status: "TRIALING",
        trialEndsAt: result.subscription.trialEndsAt!,
      },
    };
  },
};

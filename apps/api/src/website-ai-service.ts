import { createHash } from "node:crypto";
import {
  SetupImportError,
  assertWebsiteDraftVersion,
  websiteAiCopySchema,
  websiteAiRequestSchema,
} from "@flowgastronomie/domain";
import {
  prisma,
  venueWebsiteRepository,
  websiteImportProposals,
  type StaffIdentity,
} from "@flowgastronomie/database";
import {
  OpenAIWebsiteCopyProvider,
  type WebsiteAiProvider,
} from "./website-ai-provider.js";
export function websiteAiEnabled() {
  return (
    process.env.WEBSITE_COPY_AI_ENABLED === "true" &&
    Boolean(process.env.CREATIVE_OPENAI_API_KEY)
  );
}
export async function proposeWebsiteAi(
  staff: StaffIdentity,
  value: unknown,
  provider: WebsiteAiProvider = new OpenAIWebsiteCopyProvider(),
) {
  const input = websiteAiRequestSchema.parse(value);
  await websiteImportProposals.authorize(staff);
  const website = await venueWebsiteRepository.getEditor(staff);
  assertWebsiteDraftVersion(
    input.expectedUpdatedAt,
    website.updatedAt ? new Date(website.updatedAt) : null,
  );
  const translation = website.translations.find(
    (t) => t.locale === input.locale,
  ) ?? { heroTitle: "", heroSubtitle: "" };
  const scope = { tenantId: staff.tenantId, venueId: staff.venueId };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const prior = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`website-ai:${staff.tenantId}:${staff.venueId}`},0))`;
    const previous = await tx.auditEvent.findFirst({
      where: {
        ...scope,
        action: "WEBSITE_AI_REQUESTED",
        entityId: input.requestKey,
      },
    });
    if (previous) {
      if (
        (previous.metadata as { fingerprint: string }).fingerprint !==
        fingerprint
      )
        throw new SetupImportError("CONFLICT");
      return true;
    }
    if (
      (await tx.auditEvent.count({
        where: {
          ...scope,
          action: "WEBSITE_AI_REQUESTED",
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
      })) >= 10
    )
      throw new SetupImportError(
        "LIMIT",
        "The daily AI proposal limit has been reached. Continue editing manually.",
      );
    await tx.auditEvent.create({
      data: {
        ...scope,
        actorUserId: staff.userId,
        actorMembershipId: staff.membershipId,
        action: "WEBSITE_AI_REQUESTED",
        entityType: "VenueWebsite",
        entityId: input.requestKey,
        metadata: {
          fingerprint,
          provider: provider.provider,
          model: provider.model,
        },
      },
    });
    return false;
  });
  if (prior) {
    const completed = await prisma.auditEvent.findFirst({
      where: {
        ...scope,
        action: "WEBSITE_AI_PROPOSED",
        metadata: { path: ["requestKey"], equals: input.requestKey },
      },
    });
    if (!completed)
      throw new SetupImportError(
        "CONFLICT",
        "This request is pending or failed. It will not be charged again automatically.",
      );
    return {
      id: completed.id,
      ...websiteAiCopySchema.parse({
        title: (completed.metadata as { title: string }).title,
        description: (completed.metadata as { description: string })
          .description,
      }),
    };
  }
  const result = await provider.propose({
    locale: input.locale,
    title: translation.heroTitle,
    description: translation.heroSubtitle,
    instruction: input.instruction,
  });
  const proposal = websiteAiCopySchema.parse({
    title: result.title,
    description: result.description,
  });
  const event = await prisma.auditEvent.create({
    data: {
      ...scope,
      actorUserId: staff.userId,
      actorMembershipId: staff.membershipId,
      action: "WEBSITE_AI_PROPOSED",
      entityType: "VenueWebsite",
      entityId: staff.venueId,
      metadata: {
        ...proposal,
        requestKey: input.requestKey,
        provider: provider.provider,
        model: provider.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        before: {
          title: translation.heroTitle,
          description: translation.heroSubtitle,
        },
        expectedUpdatedAt: input.expectedUpdatedAt,
      },
    },
  });
  return { id: event.id, ...proposal };
}

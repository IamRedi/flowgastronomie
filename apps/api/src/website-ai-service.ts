import { generateProductImage } from "./product-ai-image-service.js";
import { createHash } from "node:crypto";
import {
  SetupImportError,
  assertWebsiteDraftVersion,
  websiteAiCopySchema,
  websiteAiSectionCopySchema,
  websitePlanSchema,
  premiumStyles,
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
  await websiteImportProposals.authorize(staff, false);
  const website = await venueWebsiteRepository.getEditor(staff);
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
    assertWebsiteDraftVersion(
      input.expectedUpdatedAt,
      website.updatedAt ? new Date(website.updatedAt) : null,
    );
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
      designOnly:
        (completed.metadata as Record<string, unknown>).designOnly === true,
      imageAssetId:
        ((completed.metadata as Record<string, unknown>).imageAssetId as
          string | null) ?? null,
      provider: String(
        (completed.metadata as Record<string, unknown>).provider,
      ),
      model: String((completed.metadata as Record<string, unknown>).model),
      ...((completed.metadata as Record<string, unknown>).plan
        ? {
            plan: websitePlanSchema.parse(
              (completed.metadata as Record<string, unknown>).plan,
            ),
          }
        : {}),
      ...(input.operation === "SECTION"
        ? websiteAiSectionCopySchema
        : websiteAiCopySchema
      ).parse({
        title: (completed.metadata as { title: string }).title,
        description: (completed.metadata as { description: string })
          .description,
      }),
    };
  }
  const selected = input.sectionId
    ? website.document?.sections.find(
        (section) => section.id === input.sectionId,
      )
    : undefined;
  if (input.operation === "SECTION" && !selected)
    throw new SetupImportError("NOT_FOUND");
  const selectedCopy = selected?.content.find(
    (copy) =>
      copy.locale ===
      (input.action === "TRANSLATE"
        ? (input.sourceLocale ?? input.locale)
        : input.locale),
  );
  const [venue, categories, media] = await Promise.all([
    prisma.venue.findFirstOrThrow({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      select: { name: true, tenant: { select: { businessProfileId: true } } },
    }),
    prisma.menuCategory.findMany({
      where: scope,
      take: 30,
      select: {
        translations: { select: { name: true, locale: true } },
        products: {
          where: { archivedAt: null },
          take: 30,
          select: { translations: { select: { name: true, locale: true } } },
        },
      },
    }),
    prisma.mediaAsset.count({
      where: { ...scope, approvedForPublicUse: true },
    }),
  ]);
  const result = await provider.propose({
    locale: input.locale,
    title: selectedCopy?.title ?? translation.heroTitle,
    description: selectedCopy?.body ?? translation.heroSubtitle,
    operation: input.operation,
    action: input.action,
    sourceLocale: input.sourceLocale,
    facts: {
      venue,
      currentContent: website.translations,
      description: input.description ?? "",
      businessType: input.businessType ?? "",
      categories,
      approvedMediaCount: media,
      allowedStyles: premiumStyles().map(({ id, name, layout }) => ({
        id,
        name,
        layout,
      })),
    },
    instruction: input.instruction,
  });
  const proposal = (
    input.operation === "SECTION"
      ? websiteAiSectionCopySchema
      : websiteAiCopySchema
  ).parse({
    title: result.title,
    description: result.description,
  });
  const plan = result.plan ? websitePlanSchema.parse(result.plan) : undefined;
  let imageAssetId: string | null = null;
  if (plan && input.includeImage && !input.designOnly) {
    const hero = website.document?.sections.find((s) => s.type === "HERO");
    const existingHero = await prisma.venueMedia.count({
      where: { ...scope, role: "HERO", asset: { approvedForPublicUse: true } },
    });
    if (hero && !hero.media.length && !existingHero) {
      try {
        const image = await generateProductImage(
          staff,
          hero.id,
          {
            locale: input.locale,
            requestKey: input.requestKey,
            prompt: `Editorial food illustration for ${venue.name}. Business description: ${(input.description ?? "").slice(0, 600)}. Visual direction: ${input.instruction.slice(0, 400)}. No text, prices, logos, people, or claimed real venue interior. Use an illustrative composition, not documentary photography.`,
          },
          "website-sections",
        );
        imageAssetId = image.id;
      } catch {
        // Text proposal survives image quota/provider failures. No retry or publication.
      }
    }
  }
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
        ...(plan ? { plan } : {}),
        imageAssetId,
        operation: input.operation ?? "COPY",
        designOnly: input.designOnly ?? false,
        sectionId: input.sectionId ?? null,
        locale: input.locale,
        requestKey: input.requestKey,
        provider: provider.provider,
        model: provider.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        before: {
          title: selectedCopy?.title ?? translation.heroTitle,
          description: selectedCopy?.body ?? translation.heroSubtitle,
        },
        expectedUpdatedAt: input.expectedUpdatedAt,
      },
    },
  });
  return {
    id: event.id,
    designOnly: input.designOnly ?? false,
    imageAssetId,
    ...proposal,
    provider: provider.provider,
    model: provider.model,
    ...(plan ? { plan } : {}),
  };
}

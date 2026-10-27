import { Locale, Prisma } from "@prisma/client";
import {
  assertStaffPermission,
  websiteDocumentSchema,
  type WebsiteDocument,
  assertWebsiteDraftVersion,
  premiumStyleIdSchema,
  SetupImportError,
  createWorkspaceSlug,
  PLATFORM_LOCALES,
  websitePublicationIssues,
  type OpeningHoursEntry,
  type PlatformLocale,
  type WebsitePublicationIssue,
  type WebsiteStatus,
  type WebsiteTranslation,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { canonicalMediaRepository } from "./canonical-media-repository.js";
import type { CanonicalMediaReference } from "@flowgastronomie/domain";
import type { StaffIdentity } from "./staff-auth-repository.js";
import { subscriptionRepository } from "./subscription-repository.js";

const databaseLocale: Record<PlatformLocale, Locale> = {
  en: "EN",
  de: "DE",
  it: "IT",
  sq: "SQ",
};

const platformLocale: Record<Locale, PlatformLocale> = {
  EN: "en",
  DE: "de",
  IT: "it",
  SQ: "sq",
};

export class VenueWebsiteNotFoundError extends Error {
  constructor() {
    super("The venue website was not found");
    this.name = "VenueWebsiteNotFoundError";
  }
}

export class VenueWebsiteConflictError extends Error {
  constructor() {
    super("This public website address is already in use");
    this.name = "VenueWebsiteConflictError";
  }
}

export class VenueWebsitePublicationError extends Error {
  constructor(public readonly issues: WebsitePublicationIssue[]) {
    super("The website is not ready to publish");
    this.name = "VenueWebsitePublicationError";
  }
}

export type VenueWebsiteInput = {
  designVersion?: 1 | 2 | undefined;
  document?: WebsiteDocument | null | undefined;
  expectedUpdatedAt?: string | undefined;
  sourceProposalId?: string | undefined;
  publicSlug: string;
  premiumStyleId?: string | null | undefined;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  openingHours: OpeningHoursEntry[];
  translations: WebsiteTranslation[];
};

export type VenueWebsiteEditor = VenueWebsiteInput & {
  businessProfileId?: string | null;
  updatedAt?: string | undefined;
  id: string | null;
  venueId: string;
  venueName: string;
  status: WebsiteStatus;
  publishedAt: Date | null;
};

export type PublicVenueWebsite = {
  designVersion?: 1 | 2;
  document?: WebsiteDocument | null;
  sectionMedia?: CanonicalMediaReference[];
  locale: PlatformLocale;
  publicSlug: string;
  venue: { name: string; currency: string };
  brand: {
    premiumStyleId?: string | null | undefined;
    primaryColor: string;
    accentColor: string;
    logoUrl: string | null;
    heroImageUrl: string | null;
  };
  contact: {
    phone: string | null;
    email: string | null;
    address: string | null;
    instagramUrl: string | null;
    facebookUrl: string | null;
    openingHours: OpeningHoursEntry[];
  };
  content: Omit<WebsiteTranslation, "locale">;
  legal: {
    legalName: string;
    addressLine1: string;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId: string | null;
  } | null;
  menu: Array<{
    id: string;
    name: string;
    products: Array<{
      media?: CanonicalMediaReference;
      id: string;
      name: string;
      description: string | null;
      priceMinor: number;
      currency: string;
      available: boolean;
      variants: Array<{
        id: string;
        name: string;
        priceDeltaMinor: number;
        available: boolean;
        isDefault: boolean;
      }>;
      modifierGroups: Array<{
        id: string;
        name: string;
        minSelect: number;
        maxSelect: number;
        options: Array<{
          id: string;
          name: string;
          priceDeltaMinor: number;
          available: boolean;
        }>;
      }>;
    }>;
  }>;
};

export type VenueWebsiteRepository = {
  getEditor(staff: StaffIdentity): Promise<VenueWebsiteEditor>;
  update(input: {
    staff: StaffIdentity;
    website: VenueWebsiteInput;
    draftOnly?: boolean;
  }): Promise<VenueWebsiteEditor>;
  publish(
    staff: StaffIdentity,
    expectedUpdatedAt?: string,
  ): Promise<VenueWebsiteEditor>;
  unpublish(staff: StaffIdentity): Promise<VenueWebsiteEditor>;
  findPublic(
    publicSlug: string,
    locale: PlatformLocale,
  ): Promise<PublicVenueWebsite | null>;
};

const defaultOpeningHours: OpeningHoursEntry[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
].map((day) => ({
  day: day as OpeningHoursEntry["day"],
  closed: false,
  opensAt: "11:30",
  closesAt: "23:00",
}));

function asOpeningHours(value: Prisma.JsonValue): OpeningHoursEntry[] {
  if (!Array.isArray(value)) return defaultOpeningHours;
  return value as unknown as OpeningHoursEntry[];
}

function blankTranslations(): WebsiteTranslation[] {
  return PLATFORM_LOCALES.map((locale) => ({
    locale,
    heroTitle: "",
    heroSubtitle: "",
    storyTitle: "",
    storyBody: "",
    seoTitle: "",
    seoDescription: "",
  }));
}

function mapEditor(website: {
  document?: Prisma.JsonValue;
  updatedAt?: Date;
  id: string;
  venueId: string;
  publicSlug: string;
  status: WebsiteStatus;
  premiumStyleId?: string | null | undefined;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  openingHours: Prisma.JsonValue;
  publishedAt: Date | null;
  designVersion?: number;
  venue: { name: string; tenant?: { businessProfileId: string | null } };
  translations: Array<{
    locale: Locale;
    heroTitle: string;
    heroSubtitle: string;
    storyTitle: string;
    storyBody: string;
    seoTitle: string;
    seoDescription: string;
  }>;
}): VenueWebsiteEditor {
  return {
    designVersion: website.designVersion === 2 ? 2 : 1,
    businessProfileId: website.venue.tenant?.businessProfileId ?? null,
    document: website.document
      ? websiteDocumentSchema.parse(website.document)
      : null,
    updatedAt: website.updatedAt?.toISOString(),
    id: website.id,
    venueId: website.venueId,
    venueName: website.venue.name,
    publicSlug: website.publicSlug,
    status: website.status,
    premiumStyleId: website.premiumStyleId ?? null,
    primaryColor: website.primaryColor,
    accentColor: website.accentColor,
    logoUrl: website.logoUrl,
    heroImageUrl: website.heroImageUrl,
    phone: website.phone,
    contactEmail: website.contactEmail,
    address: website.address,
    instagramUrl: website.instagramUrl,
    facebookUrl: website.facebookUrl,
    openingHours: asOpeningHours(website.openingHours),
    publishedAt: website.publishedAt,
    translations: PLATFORM_LOCALES.map((locale) => {
      const translation = website.translations.find(
        (t) => platformLocale[t.locale] === locale,
      );
      return translation
        ? { ...translation, locale }
        : { ...blankTranslations().find((t) => t.locale === locale)! };
    }),
  };
}

async function venueFor(staff: StaffIdentity) {
  const venue = await prisma.venue.findFirst({
    where: { id: staff.venueId, tenantId: staff.tenantId },
    include: { tenant: { select: { slug: true, businessProfileId: true } } },
  });
  if (!venue) throw new VenueWebsiteNotFoundError();
  return venue;
}

const editorInclude = {
  venue: {
    select: { name: true, tenant: { select: { businessProfileId: true } } },
  },
  translations: { orderBy: { locale: "asc" as const } },
};

async function scopedWebsite(staff: StaffIdentity) {
  const website = await prisma.venueWebsite.findFirst({
    where: { tenantId: staff.tenantId, venueId: staff.venueId },
    include: editorInclude,
  });
  if (!website) throw new VenueWebsiteNotFoundError();
  return website;
}

function publicationInput(editor: VenueWebsiteEditor) {
  return {
    document: editor.document ?? null,
    publicSlug: editor.publicSlug,
    premiumStyleId: editor.premiumStyleId ?? null,
    primaryColor: editor.primaryColor,
    accentColor: editor.accentColor,
    phone: editor.phone,
    contactEmail: editor.contactEmail,
    address: editor.address,
    translations: editor.translations,
  };
}

function publicationSnapshot(editor: VenueWebsiteEditor): VenueWebsiteInput {
  return {
    designVersion: editor.designVersion ?? 1,
    document: editor.document ?? null,
    publicSlug: editor.publicSlug,
    premiumStyleId: editor.premiumStyleId ?? null,
    primaryColor: editor.primaryColor,
    accentColor: editor.accentColor,
    logoUrl: editor.logoUrl,
    heroImageUrl: editor.document?.sections.find((s) => s.type === "HERO")
      ?.media[0]?.assetId
      ? `/v1/media/${editor.document.sections.find((s) => s.type === "HERO")!.media[0]!.assetId}`
      : editor.heroImageUrl,
    phone: editor.phone,
    contactEmail: editor.contactEmail,
    address: editor.address,
    instagramUrl: editor.instagramUrl,
    facebookUrl: editor.facebookUrl,
    openingHours: editor.openingHours,
    translations: editor.translations,
  };
}

function translateConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new VenueWebsiteConflictError();
  }
  throw error;
}

export const venueWebsiteRepository: VenueWebsiteRepository = {
  async getEditor(staff) {
    assertStaffPermission(staff.role, "WEBSITE_VIEW");
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "PUBLIC_WEBSITE",
    );
    const [venue, website] = await Promise.all([
      venueFor(staff),
      prisma.venueWebsite.findFirst({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        include: editorInclude,
      }),
    ]);
    if (website) return mapEditor(website);
    return {
      id: null,
      venueId: venue.id,
      venueName: venue.name,
      businessProfileId: venue.tenant.businessProfileId,
      designVersion: 1,
      publicSlug: createWorkspaceSlug(`${venue.tenant.slug}-${venue.slug}`),
      status: "DRAFT",
      primaryColor: "#17382f",
      accentColor: "#ed6b37",
      logoUrl: null,
      heroImageUrl: null,
      phone: null,
      contactEmail: null,
      address: null,
      instagramUrl: null,
      facebookUrl: null,
      openingHours: [],
      publishedAt: null,
      translations: blankTranslations(),
    };
  },

  async update({ staff, website: input, draftOnly }) {
    if (input.document) websiteDocumentSchema.parse(input.document);
    if (input.premiumStyleId != null)
      premiumStyleIdSchema.parse(input.premiumStyleId);
    assertStaffPermission(staff.role, "WEBSITE_MANAGE");
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "PUBLIC_WEBSITE",
    );
    const venue = await venueFor(staff);
    try {
      const result = await prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`website:${staff.tenantId}:${staff.venueId}`}, 0))`;
        const existing = await transaction.venueWebsite.findFirst({
          where: { tenantId: staff.tenantId, venueId: staff.venueId },
          include: editorInclude,
        });
        assertWebsiteDraftVersion(
          input.expectedUpdatedAt,
          existing?.updatedAt ?? null,
        );
        if (input.sourceProposalId) {
          if (!existing || !input.expectedUpdatedAt)
            throw new SetupImportError("REVIEW_REQUIRED");
          const proposal = await transaction.auditEvent.findFirst({
            where: {
              id: input.sourceProposalId,
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              action: {
                in: ["WEBSITE_IMPORT_PROPOSED", "WEBSITE_AI_PROPOSED"],
              },
              entityId: staff.venueId,
            },
          });
          if (!proposal) throw new SetupImportError("NOT_FOUND");
          const proposedVersion = (
            proposal.metadata as { expectedUpdatedAt?: string }
          ).expectedUpdatedAt;
          if (proposedVersion && proposedVersion !== input.expectedUpdatedAt)
            throw new SetupImportError("CONFLICT");
        }
        // Draft-only changes never rewrite a publication revision.
        void draftOnly;
        for (const section of input.document?.sections ?? []) {
          const generation = section.generation;
          if (!generation) continue;
          const proof = await transaction.auditEvent.findFirst({
            where: {
              id: generation.proposalId,
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              action: "WEBSITE_AI_PROPOSED",
            },
          });
          const metadata = proof?.metadata as
            { provider?: string; model?: string } | undefined;
          if (
            !metadata ||
            metadata.provider !== generation.provider ||
            metadata.model !== generation.model
          )
            throw new SetupImportError(
              "REVIEW_REQUIRED",
              "Generation provenance does not belong to this website.",
            );
        }
        const mediaIds = [
          ...new Set([
            ...(input.document?.sections.flatMap((section) =>
              section.media.map((media) => media.assetId),
            ) ?? []),
            ...(input.document
              ? [input.logoUrl, input.heroImageUrl].flatMap((url) =>
                  url?.startsWith("/v1/media/") ? [url.slice(10)] : [],
                )
              : []),
          ]),
        ];
        if (
          mediaIds.length &&
          (await transaction.mediaAsset.count({
            where: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              id: { in: mediaIds },
              approvedForPublicUse: true,
            },
          })) !== mediaIds.length
        )
          throw new SetupImportError(
            "REVIEW_REQUIRED",
            "Choose approved media from this business.",
          );
        const saved = await transaction.venueWebsite.upsert({
          where: { venueId: staff.venueId },
          create: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            ...(input.designVersion !== undefined
              ? { designVersion: input.designVersion }
              : {}),
            publicSlug: input.publicSlug,
            ...(input.document !== undefined
              ? {
                  document:
                    input.document === null
                      ? Prisma.DbNull
                      : (input.document as unknown as Prisma.InputJsonValue),
                }
              : {}),
            ...(input.premiumStyleId !== undefined
              ? { premiumStyleId: input.premiumStyleId }
              : {}),
            primaryColor: input.primaryColor,
            accentColor: input.accentColor,
            logoUrl: input.logoUrl,
            heroImageUrl: input.heroImageUrl,
            phone: input.phone,
            contactEmail: input.contactEmail,
            address: input.address,
            instagramUrl: input.instagramUrl,
            facebookUrl: input.facebookUrl,
            openingHours: input.openingHours,
          },
          update: {
            ...(input.designVersion !== undefined
              ? { designVersion: input.designVersion }
              : {}),
            publicSlug: input.publicSlug,
            ...(input.document !== undefined
              ? {
                  document:
                    input.document === null
                      ? Prisma.DbNull
                      : (input.document as unknown as Prisma.InputJsonValue),
                }
              : {}),
            ...(input.premiumStyleId !== undefined
              ? { premiumStyleId: input.premiumStyleId }
              : {}),
            primaryColor: input.primaryColor,
            accentColor: input.accentColor,
            logoUrl: input.logoUrl,
            heroImageUrl: input.heroImageUrl,
            phone: input.phone,
            contactEmail: input.contactEmail,
            address: input.address,
            instagramUrl: input.instagramUrl,
            facebookUrl: input.facebookUrl,
            openingHours: input.openingHours,
          },
        });
        for (const translation of input.translations) {
          await transaction.venueWebsiteTranslation.upsert({
            where: {
              websiteId_locale: {
                websiteId: saved.id,
                locale: databaseLocale[translation.locale],
              },
            },
            create: {
              tenantId: staff.tenantId,
              venueId: staff.venueId,
              websiteId: saved.id,
              locale: databaseLocale[translation.locale],
              heroTitle: translation.heroTitle,
              heroSubtitle: translation.heroSubtitle,
              storyTitle: translation.storyTitle,
              storyBody: translation.storyBody,
              seoTitle: translation.seoTitle,
              seoDescription: translation.seoDescription,
            },
            update: {
              heroTitle: translation.heroTitle,
              heroSubtitle: translation.heroSubtitle,
              storyTitle: translation.storyTitle,
              storyBody: translation.storyBody,
              seoTitle: translation.seoTitle,
              seoDescription: translation.seoDescription,
            },
          });
        }
        await transaction.auditEvent.create({
          data: {
            tenantId: staff.tenantId,
            venueId: staff.venueId,
            actorUserId: staff.userId,
            actorMembershipId: staff.membershipId,
            action: "WEBSITE_UPDATED",
            entityType: "VenueWebsite",
            entityId: saved.id,
            metadata: {
              ...(input.designVersion !== undefined
                ? { designVersion: input.designVersion }
                : {}),
              publicSlug: input.publicSlug,
              sourceProposalId: input.sourceProposalId ?? null,
              before: existing
                ? JSON.parse(
                    JSON.stringify(publicationSnapshot(mapEditor(existing))),
                  )
                : null,
            },
          },
        });
        return transaction.venueWebsite.findUniqueOrThrow({
          where: { id: saved.id },
          include: editorInclude,
        });
      });
      return mapEditor(result);
    } catch (error) {
      return translateConflict(error);
    }
  },

  async publish(staff, expectedUpdatedAt) {
    assertStaffPermission(staff.role, "WEBSITE_MANAGE");
    await subscriptionRepository.assertFeature(
      staff.tenantId,
      "PUBLIC_WEBSITE",
    );
    const publishedAt = new Date();
    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`website:${staff.tenantId}:${staff.venueId}`}, 0))`;
      const current = await transaction.venueWebsite.findFirst({
        where: { tenantId: staff.tenantId, venueId: staff.venueId },
        include: editorInclude,
      });
      if (!current) throw new VenueWebsiteNotFoundError();
      assertWebsiteDraftVersion(expectedUpdatedAt, current.updatedAt);
      const website = mapEditor(current);
      if (
        website.document?.sections.some(
          (section) =>
            section.visible &&
            section.generation &&
            !section.generation.approved,
        )
      )
        throw new SetupImportError("REVIEW_REQUIRED");
      const issues = websitePublicationIssues(publicationInput(website));
      if (issues.length) throw new VenueWebsitePublicationError(issues);
      const latestRevision =
        await transaction.websitePublicationRevision.aggregate({
          where: { websiteId: website.id! },
          _max: { revision: true },
        });
      const revision = (latestRevision._max.revision ?? 0) + 1;
      const saved = await transaction.venueWebsite.update({
        where: { id: website.id! },
        data: { status: "PUBLISHED", publishedAt },
        include: editorInclude,
      });
      await transaction.websitePublicationRevision.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          websiteId: saved.id,
          revision,
          snapshot: publicationSnapshot(
            website,
          ) as unknown as Prisma.InputJsonValue,
          publishedByUserId: staff.userId,
          publishedByMembershipId: staff.membershipId,
          publishedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: "WEBSITE_PUBLISHED",
          entityType: "VenueWebsite",
          entityId: saved.id,
          metadata: { publicSlug: saved.publicSlug, revision },
        },
      });
      return saved;
    });
    return mapEditor(updated);
  },

  async unpublish(staff) {
    assertStaffPermission(staff.role, "WEBSITE_MANAGE");
    const website = await scopedWebsite(staff);
    const updated = await prisma.venueWebsite.update({
      where: { id: website.id },
      data: { status: "DRAFT" },
      include: editorInclude,
    });
    return mapEditor(updated);
  },

  async findPublic(publicSlug, requestedLocale) {
    const website = await prisma.venueWebsite.findUnique({
      where: { publicSlug },
      include: {
        translations: true,
        revisions: { orderBy: { revision: "desc" }, take: 1 },
        tenant: {
          include: {
            billingProfile: true,
            subscription: { include: { entitlements: true } },
          },
        },
        venue: {
          include: {
            categories: {
              where: { published: true },
              orderBy: { sortOrder: "asc" },
              include: {
                translations: true,
                products: {
                  where: { published: true, archivedAt: null },
                  orderBy: { sortOrder: "asc" },
                  include: {
                    translations: true,
                    variants: {
                      orderBy: { sortOrder: "asc" },
                      include: { translations: true },
                    },
                    modifierGroups: {
                      orderBy: { sortOrder: "asc" },
                      include: {
                        translations: true,
                        options: {
                          orderBy: { sortOrder: "asc" },
                          include: { translations: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!website || website.status !== "PUBLISHED") return null;
    const subscription = website.tenant.subscription;
    const publicFeature = subscription?.entitlements.find(
      (entitlement) => entitlement.featureKey === "PUBLIC_WEBSITE",
    );
    const subscriptionActive =
      subscription?.status === "ACTIVE" ||
      (subscription?.status === "TRIALING" &&
        subscription.trialEndsAt !== null &&
        subscription.trialEndsAt > new Date());
    if (!publicFeature?.enabled || !subscriptionActive) return null;

    const requested = databaseLocale[requestedLocale];
    const fallback = website.venue.defaultLocale;
    const snapshot = website.revisions[0]?.snapshot as unknown as
      VenueWebsiteInput | undefined;
    const translation = snapshot
      ? (snapshot.translations.find(
          (item) => item.locale === requestedLocale,
        ) ??
        snapshot.translations.find(
          (item) => item.locale === platformLocale[fallback],
        ))
      : (website.translations.find((item) => item.locale === requested) ??
        website.translations.find((item) => item.locale === fallback));
    if (!translation) return null;
    const canonical = await canonicalMediaRepository.resolve(
      { tenantId: website.tenantId, venueId: website.venueId },
      true,
    );
    const productMedia = new Map(
      canonical.products.map((row) => [row.productId, row.media]),
    );
    return {
      designVersion: snapshot
        ? (snapshot.designVersion ?? 1)
        : website.designVersion === 2
          ? 2
          : 1,
      document: snapshot
        ? (snapshot.document ?? null)
        : website.document
          ? websiteDocumentSchema.parse(website.document)
          : null,
      sectionMedia: await canonicalMediaRepository.websiteReferences(
        { tenantId: website.tenantId, venueId: website.venueId },
        snapshot?.document ?? null,
      ),
      locale: requestedLocale,
      publicSlug: snapshot?.publicSlug ?? website.publicSlug,
      pickupEnabled:
        website.venue.onlinePickupEnabled &&
        subscription?.entitlements.some(
          (entitlement) =>
            entitlement.featureKey === "ONLINE_ORDERING" && entitlement.enabled,
        ) === true,
      deliveryEnabled:
        website.venue.onlineDeliveryEnabled &&
        subscription?.entitlements.some(
          (entitlement) =>
            entitlement.featureKey === "ONLINE_ORDERING" && entitlement.enabled,
        ) === true,
      cateringEnabled:
        website.venue.onlineCateringEnabled &&
        subscription?.entitlements.some(
          (entitlement) =>
            entitlement.featureKey === "ONLINE_ORDERING" && entitlement.enabled,
        ) === true,
      venue: { name: website.venue.name, currency: website.venue.currency },
      brand: {
        premiumStyleId: snapshot
          ? (snapshot.premiumStyleId ?? null)
          : website.premiumStyleId,
        primaryColor: snapshot ? snapshot.primaryColor : website.primaryColor,
        accentColor: snapshot ? snapshot.accentColor : website.accentColor,
        logoUrl:
          (snapshot?.document
            ? null
            : canonical.venue.find((row) => row.role === "LOGO")?.media.url) ??
          (snapshot ? snapshot.logoUrl : website.logoUrl),
        heroImageUrl:
          (snapshot?.document
            ? null
            : canonical.venue.find((row) => row.role === "HERO")?.media.url) ??
          (snapshot ? snapshot.heroImageUrl : website.heroImageUrl),
      },
      contact: {
        phone: snapshot ? snapshot.phone : website.phone,
        email: snapshot ? snapshot.contactEmail : website.contactEmail,
        address: snapshot ? snapshot.address : website.address,
        instagramUrl: snapshot ? snapshot.instagramUrl : website.instagramUrl,
        facebookUrl: snapshot ? snapshot.facebookUrl : website.facebookUrl,
        openingHours: snapshot
          ? snapshot.openingHours
          : asOpeningHours(website.openingHours),
      },
      content: {
        heroTitle: translation.heroTitle,
        heroSubtitle: translation.heroSubtitle,
        storyTitle: translation.storyTitle,
        storyBody: translation.storyBody,
        seoTitle: translation.seoTitle,
        seoDescription: translation.seoDescription,
      },
      legal: website.tenant.billingProfile
        ? {
            legalName: website.tenant.billingProfile.legalName,
            addressLine1: website.tenant.billingProfile.addressLine1,
            postalCode: website.tenant.billingProfile.postalCode,
            city: website.tenant.billingProfile.city,
            countryCode: website.tenant.billingProfile.countryCode,
            vatId: website.tenant.billingProfile.vatId,
          }
        : null,
      menu: website.venue.categories.flatMap((category) => {
        const categoryTranslation =
          category.translations.find((item) => item.locale === requested) ??
          category.translations.find((item) => item.locale === fallback);
        if (!categoryTranslation) return [];
        return [
          {
            id: category.id,
            name: categoryTranslation.name,
            products: category.products.flatMap((product) => {
              const productTranslation =
                product.translations.find(
                  (item) => item.locale === requested,
                ) ??
                product.translations.find((item) => item.locale === fallback);
              return productTranslation
                ? [
                    {
                      id: product.id,
                      ...(productMedia.has(product.id)
                        ? { media: productMedia.get(product.id)! }
                        : {}),
                      name: productTranslation.name,
                      description: productTranslation.description,
                      priceMinor: product.priceMinor,
                      currency: product.currency,
                      available: product.available,
                      variants: product.variants.flatMap((variant) => {
                        const variantTranslation =
                          variant.translations.find(
                            (item) => item.locale === requested,
                          ) ??
                          variant.translations.find(
                            (item) => item.locale === fallback,
                          );
                        return variantTranslation
                          ? [
                              {
                                id: variant.id,
                                name: variantTranslation.name,
                                priceDeltaMinor: variant.priceDeltaMinor,
                                available: variant.available,
                                isDefault: variant.isDefault,
                              },
                            ]
                          : [];
                      }),
                      modifierGroups: product.modifierGroups.flatMap(
                        (group) => {
                          const groupTranslation =
                            group.translations.find(
                              (item) => item.locale === requested,
                            ) ??
                            group.translations.find(
                              (item) => item.locale === fallback,
                            );
                          if (!groupTranslation) return [];
                          return [
                            {
                              id: group.id,
                              name: groupTranslation.name,
                              minSelect: group.minSelect,
                              maxSelect: group.maxSelect,
                              options: group.options.flatMap((option) => {
                                const optionTranslation =
                                  option.translations.find(
                                    (item) => item.locale === requested,
                                  ) ??
                                  option.translations.find(
                                    (item) => item.locale === fallback,
                                  );
                                return optionTranslation
                                  ? [
                                      {
                                        id: option.id,
                                        name: optionTranslation.name,
                                        priceDeltaMinor: option.priceDeltaMinor,
                                        available: option.available,
                                      },
                                    ]
                                  : [];
                              }),
                            },
                          ];
                        },
                      ),
                    },
                  ]
                : [];
            }),
          },
        ];
      }),
    };
  },
};

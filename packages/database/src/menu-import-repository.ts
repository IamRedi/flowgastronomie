import type { Prisma } from "@prisma/client";
import {
  assertStaffPermission,
  importLimits,
  importSessionStatus,
  menuDuplicateCandidates,
  normalizeImportName,
  reviewedMenuItemSchema,
  reviewFromProposal,
  validateMenuImportProposal,
  validateReviewedMenuItem,
  SetupImportError,
  type ImportReviewInput,
  type ImportSourceDescriptor,
  type PlatformLocale,
  type ReviewedMenuItem,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  ensureSmartSetup,
  lockSetup,
  setupScope,
  type SetupStaff,
} from "./smart-setup-repository.js";
import { storeCanonicalMedia } from "./canonical-media-repository.js";

export const importJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const importSourceSelect = {
  sourceUrl: true,
  method: true,
  id: true,
  filename: true,
  mimeType: true,
  contentHash: true,
  byteSize: true,
  pageCount: true,
  mediaAssetId: true,
  createdAt: true,
} as const;
export async function authorizeMenuImport(
  tx: Prisma.TransactionClient,
  staff: SetupStaff,
) {
  assertStaffPermission(staff.role, "IMPORT_MANAGE");
  if (
    !(await tx.membership.findFirst({
      where: {
        ...setupScope(staff),
        id: staff.membershipId,
        userId: staff.userId,
        active: true,
        role: { in: ["OWNER", "MANAGER"] },
        venue: { tenant: { retiredAt: null } },
      },
      select: { id: true },
    }))
  )
    throw new SetupImportError("NOT_FOUND");
}
export async function scopedImportSession(
  tx: Prisma.TransactionClient,
  staff: SetupStaff,
  id: string,
) {
  await authorizeMenuImport(tx, staff);
  const session = await tx.importSession.findFirst({
    where: { ...setupScope(staff), id },
    include: {
      sources: { select: importSourceSelect, orderBy: { createdAt: "asc" } },
      items: { orderBy: { id: "asc" } },
    },
  });
  if (!session) throw new SetupImportError("NOT_FOUND");
  return session;
}
export async function menuImportProducts(
  tx: Prisma.TransactionClient,
  staff: SetupStaff,
) {
  return (
    await tx.product.findMany({
      where: { ...setupScope(staff), archivedAt: null },
      include: { translations: { select: { name: true } } },
    })
  ).map((p) => ({
    id: p.id,
    names: p.translations.map((t) => t.name),
    priceMinor: p.priceMinor,
  }));
}
function expected(actual: number, version: number) {
  if (actual !== version)
    throw new SetupImportError(
      "CONFLICT",
      "This import changed. Reload the saved review before continuing.",
    );
}
export type MenuSourceUpload = {
  filename: string;
  mimeType: string;
  contentHash: string;
  bytes: Buffer;
  byteSize: number;
  pageCount: number;
  width: number;
  height: number;
};
export const menuImportRepository = {
  async create(staff: SetupStaff, requestKey: string, locale: PlatformLocale) {
    return prisma.$transaction(async (tx) => {
      await authorizeMenuImport(tx, staff);
      await lockSetup(tx, staff);
      await ensureSmartSetup(tx, staff);
      const scope = setupScope(staff);
      const prior = await tx.importSession.findUnique({
        where: { tenantId_venueId_requestKey: { ...scope, requestKey } },
      });
      if (prior) {
        if (prior.locale !== locale.toUpperCase())
          throw new SetupImportError("CONFLICT");
        return prior;
      }
      if (
        (await tx.importSession.count({
          where: {
            ...scope,
            createdAt: { gte: new Date(Date.now() - 86_400_000) },
          },
        })) >= importLimits.sessionsPerDay
      )
        throw new SetupImportError("LIMIT", "Daily import limit reached.");
      const session = await tx.importSession.create({
        data: {
          ...scope,
          requestKey,
          locale: locale.toUpperCase() as "EN" | "DE" | "IT" | "SQ",
          createdBy: staff.userId,
        },
      });
      await tx.smartSetup.update({
        where: { tenantId_venueId: scope },
        data: {
          activeImportSessionId: session.id,
          step: 2,
          status: "IN_PROGRESS",
          version: { increment: 1 },
          updatedBy: staff.userId,
        },
      });
      return session;
    });
  },
  async list(staff: SetupStaff) {
    return prisma.$transaction(async (tx) => {
      await authorizeMenuImport(tx, staff);
      return tx.importSession.findMany({
        where: setupScope(staff),
        select: {
          id: true,
          status: true,
          extractionState: true,
          createdAt: true,
          importedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    });
  },
  async get(staff: SetupStaff, id: string) {
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      let session = await scopedImportSession(tx, staff, id);
      if (
        session.extractionState === "RUNNING" &&
        session.extractionStartedAt &&
        Date.now() - session.extractionStartedAt.getTime() > 180_000
      ) {
        await tx.importSession.update({
          where: { id },
          data: {
            extractionState: "FAILED",
            errorCode: "INTERRUPTED",
            version: { increment: 1 },
          },
        });
        session = await scopedImportSession(tx, staff, id);
      }
      const products = await menuImportProducts(tx, staff);
      const categories = await tx.menuCategory.findMany({
        where: setupScope(staff),
        select: {
          id: true,
          translations: { select: { locale: true, name: true } },
        },
        orderBy: { sortOrder: "asc" },
      });
      return {
        ...session,
        products,
        sources: session.sources.map((source) => ({
          ...source,
          url: `/v1/staff/menu-imports/${id}/sources/${source.id}`,
        })),
        categories,
        items: session.items.map((item) => {
          const reviewed = reviewedMenuItemSchema.parse(item.reviewed);
          const other = session.items
            .filter((row) => row.id !== item.id && row.status !== "REJECTED")
            .map((row) => {
              const r = reviewedMenuItemSchema.parse(row.reviewed);
              return {
                id: `proposal:${row.id}`,
                names: [r.name],
                priceMinor: r.priceMinor ?? 0,
              };
            });
          return {
            ...item,
            reviewed,
            duplicates: menuDuplicateCandidates(reviewed, [
              ...products,
              ...other,
            ]),
          };
        }),
      };
    });
  },
  async upload(
    staff: SetupStaff,
    id: string,
    version: number,
    file: MenuSourceUpload,
  ) {
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const session = await scopedImportSession(tx, staff, id);
      if (
        session.businessData &&
        (session.businessData as { phase?: string }).phase !== "SOURCES"
      )
        throw new SetupImportError("CONFLICT");
      const existing = session.sources.find(
        (s) => s.contentHash === file.contentHash,
      );
      if (existing) return existing;
      expected(session.version, version);
      if (session.extractionState !== "PENDING")
        throw new SetupImportError(
          "CONFLICT",
          "Start a new import to change sources after extraction.",
        );
      if (
        session.sources.length >= importLimits.files ||
        session.sources.reduce((n, s) => n + s.byteSize, 0) + file.byteSize >
          importLimits.totalBytes ||
        session.sources.reduce((n, s) => n + s.pageCount, 0) + file.pageCount >
          importLimits.pages
      )
        throw new SetupImportError(
          "LIMIT",
          "Use at most four files, twenty pages and 24 MB per import.",
        );
      let mediaAssetId: string | null = null;
      if (file.mimeType !== "application/pdf") {
        const asset = await storeCanonicalMedia(tx, staff, {
          image: {
            bytes: Uint8Array.from(file.bytes),
            width: file.width,
            height: file.height,
            mimeType: file.mimeType,
            contentHash: file.contentHash,
          },
          sourceKey: `menu-import:${file.contentHash}`,
          provenance: {
            source: "UPLOAD",
            description:
              "Private menu extraction source; not approved venue/product photography.",
            inputContentHash: file.contentHash,
          },
          approvedForPublicUse: false,
          confirmed: true,
        });
        mediaAssetId = asset.id;
      }
      const source = await tx.importSource.create({
        data: {
          ...setupScope(staff),
          sessionId: id,
          filename: file.filename,
          mimeType: file.mimeType,
          contentHash: file.contentHash,
          byteSize: file.byteSize,
          pageCount: file.pageCount,
          mediaAssetId,
          documentBytes:
            file.mimeType === "application/pdf"
              ? Uint8Array.from(file.bytes)
              : null,
        },
        select: importSourceSelect,
      });
      await tx.importSession.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      return source;
    });
  },
  async source(staff: SetupStaff, sessionId: string, id: string) {
    return prisma.$transaction(async (tx) => {
      await authorizeMenuImport(tx, staff);
      const source = await tx.importSource.findFirst({
        where: { ...setupScope(staff), sessionId, id },
        include: { mediaAsset: { select: { bytes: true } } },
      });
      if (!source) throw new SetupImportError("NOT_FOUND");
      return {
        ...source,
        bytes: Buffer.from(source.documentBytes ?? source.mediaAsset!.bytes),
      };
    });
  },
  async beginExtraction(
    staff: SetupStaff,
    id: string,
    version: number,
    key: string,
    provider: string,
    model: string,
  ) {
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const session = await scopedImportSession(tx, staff, id);
      if (session.businessData)
        throw new SetupImportError(
          "CONFLICT",
          "Use the unified business review.",
        );
      if (session.extractionKey === key) return { claimed: false, session };
      expected(session.version, version);
      if (
        session.extractionState === "RUNNING" ||
        session.proposal !== null ||
        session.importedAt
      )
        throw new SetupImportError(
          "CONFLICT",
          "This extraction is already running or has a saved proposal.",
        );
      if (!session.sources.length)
        throw new SetupImportError("INVALID_INPUT", "Upload a menu first.");
      if (session.extractionAttempts >= importLimits.extractionAttempts)
        throw new SetupImportError(
          "LIMIT",
          "Extraction attempt limit reached. No further provider call was made.",
        );
      await tx.importSession.update({
        where: { id },
        data: {
          extractionState: "RUNNING",
          extractionKey: key,
          provider,
          model,
          extractionAttempts: { increment: 1 },
          extractionStartedAt: new Date(),
          errorCode: null,
          version: { increment: 1 },
        },
      });
      return { claimed: true, session };
    });
  },
  async finishExtraction(
    staff: SetupStaff,
    id: string,
    key: string,
    result:
      | { proposal: unknown; provenance: unknown }
      | { errorCode: string; provenance: unknown },
  ) {
    return prisma.$transaction(
      async (tx) => {
        await lockSetup(tx, staff);
        const session = await scopedImportSession(tx, staff, id);
        if (
          session.extractionKey !== key ||
          session.extractionState !== "RUNNING"
        )
          throw new SetupImportError("CONFLICT");
        if ("errorCode" in result) {
          await tx.importSession.update({
            where: { id },
            data: {
              extractionState: "FAILED",
              errorCode: result.errorCode,
              provenance: importJson(result.provenance),
              extractionFinishedAt: new Date(),
              version: { increment: 1 },
            },
          });
          return;
        }
        const proposal = validateMenuImportProposal(
          result.proposal,
          session.sources as ImportSourceDescriptor[],
        );
        const categories = await tx.menuCategory.findMany({
          where: setupScope(staff),
          include: { translations: true },
        });
        for (const item of proposal.items) {
          const reviewed = reviewFromProposal(item, proposal);
          const matches = categories.filter((c) =>
            c.translations.some(
              (t) =>
                normalizeImportName(t.name) ===
                normalizeImportName(reviewed.categoryName),
            ),
          );
          if (matches.length === 1) reviewed.categoryId = matches[0]!.id;
          await tx.importItem.create({
            data: {
              ...setupScope(staff),
              sessionId: id,
              proposalItemId: item.id,
              original: importJson(item),
              reviewed: importJson(reviewed),
            },
          });
        }
        await tx.importSession.update({
          where: { id },
          data: {
            status: "NEEDS_REVIEW",
            extractionState: "SUCCEEDED",
            proposal: importJson(proposal),
            provenance: importJson(result.provenance),
            extractionFinishedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await tx.smartSetup.updateMany({
          where: { ...setupScope(staff), activeImportSessionId: id },
          data: { step: 3, version: { increment: 1 } },
        });
      },
      { timeout: 30_000 },
    );
  },
  async review(
    staff: SetupStaff,
    id: string,
    itemId: string,
    input: ImportReviewInput,
  ) {
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const session = await scopedImportSession(tx, staff, id);
      if (session.businessData)
        throw new SetupImportError(
          "CONFLICT",
          "Use the unified business review.",
        );
      expected(session.version, input.expectedVersion);
      if (session.importedAt || session.extractionState !== "SUCCEEDED")
        throw new SetupImportError(
          "CONFLICT",
          "Only an extracted, unimported proposal can be reviewed.",
        );
      const row = session.items.find((i) => i.id === itemId);
      if (!row) throw new SetupImportError("NOT_FOUND");
      const item = reviewedMenuItemSchema.parse(input.item);
      if (
        item.categoryId &&
        !(await tx.menuCategory.findFirst({
          where: { ...setupScope(staff), id: item.categoryId },
        }))
      )
        throw new SetupImportError("NOT_FOUND");
      if (input.action !== "SAVE" && !input.confirm)
        throw new SetupImportError(
          "REVIEW_REQUIRED",
          "Confirm this review explicitly.",
        );
      if (input.action === "APPROVE") {
        const venue = await tx.venue.findFirstOrThrow({
          where: { tenantId: staff.tenantId, id: staff.venueId },
        });
        const products = await menuImportProducts(tx, staff);
        const other = session.items
          .filter((i) => i.id !== itemId && i.status !== "REJECTED")
          .map((i) => {
            const value = reviewedMenuItemSchema.parse(i.reviewed);
            return {
              id: i.id,
              names: [value.name],
              priceMinor: value.priceMinor ?? 0,
            };
          });
        validateReviewedMenuItem(
          item,
          venue.currency,
          menuDuplicateCandidates(item, [...products, ...other]),
        );
      }
      const status =
        input.action === "APPROVE"
          ? "APPROVED"
          : input.action === "REJECT"
            ? "REJECTED"
            : "NEEDS_REVIEW";
      await tx.importItem.update({
        where: { id: itemId },
        data: {
          reviewed: importJson(item),
          status,
          approvedBy: status === "APPROVED" ? staff.userId : null,
          approvedAt: status === "APPROVED" ? new Date() : null,
        },
      });
      await tx.importSession.update({
        where: { id },
        data: {
          status: importSessionStatus(
            session.items.map((i) => (i.id === itemId ? status : i.status)),
          ),
          version: { increment: 1 },
        },
      });
      const before = reviewedMenuItemSchema.parse(row.reviewed);
      await tx.auditEvent.create({
        data: {
          ...setupScope(staff),
          actorUserId: staff.userId,
          actorMembershipId: staff.membershipId,
          action: `MENU_IMPORT_${input.action}`,
          entityType: "ImportItem",
          entityId: itemId,
          metadata: {
            sessionId: id,
            changedFields: Object.keys(item).filter(
              (k) =>
                JSON.stringify(item[k as keyof ReviewedMenuItem]) !==
                JSON.stringify(before[k as keyof ReviewedMenuItem]),
            ),
            approvedAllergens: item.approvedAllergens,
          },
        },
      });
    });
  },
};

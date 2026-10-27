import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  businessImportCreateSchema,
  businessImportStateSchema,
  businessReviewSchema,
  assertBusinessImportVersion,
  assertBusinessImportDiscard,
  validateBusinessReview,
  validateMenuImportProposal,
  reviewFromProposal,
  SetupImportError,
  type BusinessImportState,
  reviewedMenuItemSchema,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  authorizeMenuImport,
  importJson,
  menuImportRepository,
  scopedImportSession,
} from "./menu-import-repository.js";
import {
  lockSetup,
  setupScope,
  type SetupStaff,
} from "./smart-setup-repository.js";
import {
  businessCanonicalSnapshot,
  fingerprint,
} from "./business-import-snapshot.js";

export async function businessSession(
  tx: Prisma.TransactionClient,
  staff: SetupStaff,
  id: string,
) {
  const session = await scopedImportSession(tx, staff, id);
  if (!session.businessData) throw new SetupImportError("NOT_FOUND");
  return {
    session,
    state: businessImportStateSchema.parse(session.businessData),
  };
}
export async function businessAudit(
  tx: Prisma.TransactionClient,
  staff: SetupStaff,
  id: string,
  action: string,
  metadata: unknown,
) {
  await tx.auditEvent.create({
    data: {
      ...setupScope(staff),
      actorUserId: staff.userId,
      actorMembershipId: staff.membershipId,
      entityType: "ImportSession",
      entityId: id,
      action,
      metadata: importJson(metadata),
    },
  });
}
export const businessImportRepository = {
  async addManual(
    staff: SetupStaff,
    id: string,
    expectedVersion: number,
    requestKey: string,
    value: unknown,
  ) {
    const item = reviewedMenuItemSchema.parse(value);
    await prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const { session, state } = await businessSession(tx, staff, id);
      if (session.items.some((i) => i.proposalItemId === requestKey)) return;
      assertBusinessImportVersion(session.version, expectedVersion);
      if (state.phase !== "REVIEW" || session.items.length >= 150)
        throw new SetupImportError("CONFLICT");
      const added = await tx.importItem.create({
        data: {
          ...setupScope(staff),
          sessionId: id,
          proposalItemId: requestKey,
          original: { method: "MANUAL", actor: staff.userId },
          reviewed: importJson(item),
        },
      });
      await tx.importSession.update({
        where: { id },
        data: {
          businessData: importJson({
            ...state,
            review: state.review
              ? {
                  ...state.review,
                  confirm: false,
                  items: [
                    ...state.review.items,
                    {
                      id: added.id,
                      item,
                      action: "PENDING",
                      targetProductId: null,
                      approvePrice: false,
                      approveConfiguration: false,
                    },
                  ],
                }
              : null,
          }),
          status: "NEEDS_REVIEW",
          version: { increment: 1 },
        },
      });
      await businessAudit(tx, staff, id, "BUSINESS_IMPORT_MANUAL_ITEM", {
        requestKey,
      });
    });
    return this.get(staff, id);
  },
  async attachImage(
    staff: SetupStaff,
    id: string,
    version: number,
    candidateId: string,
    assetId: string,
  ) {
    await prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const { session, state } = await businessSession(tx, staff, id);
      assertBusinessImportVersion(session.version, version);
      if (
        state.phase !== "REVIEW" ||
        !state.images.some((i) => i.id === candidateId)
      )
        throw new SetupImportError("CONFLICT");
      if (
        !(await tx.mediaAsset.findFirst({
          where: { ...setupScope(staff), id: assetId },
        }))
      )
        throw new SetupImportError("NOT_FOUND");
      await tx.importSession.update({
        where: { id },
        data: {
          businessData: importJson({
            ...state,
            images: state.images.map((i) =>
              i.id === candidateId ? { ...i, assetId } : i,
            ),
            review: state.review ? { ...state.review, confirm: false } : null,
          }),
          status: "NEEDS_REVIEW",
          version: { increment: 1 },
        },
      });
      await businessAudit(
        tx,
        staff,
        id,
        "BUSINESS_IMPORT_IMAGE_RIGHTS_REVIEWED",
        { candidateId, assetId, rightsConfirmed: true },
      );
    });
    return this.get(staff, id);
  },
  async create(staff: SetupStaff, raw: unknown) {
    const input = businessImportCreateSchema.parse(raw);
    const session = await menuImportRepository.create(
      staff,
      input.requestKey,
      input.locale,
    );
    await prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const current = await scopedImportSession(tx, staff, session.id);
      if (current.businessData) {
        const state = businessImportStateSchema.parse(current.businessData);
        if (state.url !== input.url) throw new SetupImportError("CONFLICT");
        return;
      }
      if (current.sources.length || current.proposal || current.importedAt)
        throw new SetupImportError("CONFLICT");
      const state: BusinessImportState = {
        schemaVersion: 2,
        url: input.url,
        authorized: true,
        phase: "SOURCES",
        fields: [],
        images: [],
        warnings: [],
        review: null,
        requestKey: null,
        attempts: 0,
      };
      await tx.importSession.update({
        where: { id: session.id },
        data: { businessData: importJson(state) },
      });
      await businessAudit(tx, staff, session.id, "BUSINESS_IMPORT_AUTHORIZED", {
        sourceUrl: input.url,
        authorized: true,
      });
    });
    return this.get(staff, session.id);
  },
  async list(staff: SetupStaff) {
    await authorizeMenuImport(prisma, staff);
    return prisma.importSession
      .findMany({
        where: {
          ...setupScope(staff),
          businessData: { not: Prisma.DbNull },
          NOT: { businessData: { path: ["phase"], equals: "CANCELLED" } },
        },
        select: {
          id: true,
          version: true,
          businessData: true,
          status: true,
          extractionState: true,
          createdAt: true,
          importedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
      .then((rows) =>
        rows.map(({ businessData, ...row }) => ({
          ...row,
          phase: businessImportStateSchema.parse(businessData).phase,
        })),
      );
  },
  async context(staff: SetupStaff) {
    await authorizeMenuImport(prisma, staff);
    return prisma.venue.findFirstOrThrow({
      where: { tenantId: staff.tenantId, id: staff.venueId },
      select: { id: true, name: true },
    });
  },
  async get(staff: SetupStaff, id: string) {
    return prisma.$transaction(
      async (tx) => {
        await lockSetup(tx, staff);
        let { session, state } = await businessSession(tx, staff, id);
        if (
          state.phase === "ANALYZING" &&
          session.extractionStartedAt &&
          Date.now() - session.extractionStartedAt.getTime() > 240_000
        ) {
          state = {
            ...state,
            phase: "SOURCES",
            warnings: [
              ...state.warnings,
              "Analysis was interrupted. Saved sources are available for a deliberate retry.",
            ].slice(-50),
          };
          await tx.importSession.update({
            where: { id },
            data: {
              businessData: importJson(state),
              extractionState: "FAILED",
              errorCode: "INTERRUPTED",
              version: { increment: 1 },
            },
          });
          session = (await businessSession(tx, staff, id)).session;
        }
        const canonical = await businessCanonicalSnapshot(tx, staff);
        return {
          ...session,
          businessData: state,
          businessReceipt: session.businessReceipt
            ? {
                committed: !!session.importedAt,
                reverted: state.phase === "REVERTED",
              }
            : null,
          canonicalRevision: fingerprint(canonical),
          canonical,
          sources: session.sources.map((s) => ({
            ...s,
            url: `/v1/staff/menu-imports/${id}/sources/${s.id}`,
          })),
        };
      },
      { timeout: 30_000 },
    );
  },
  async begin(
    staff: SetupStaff,
    id: string,
    expectedVersion: number,
    requestKey: string,
    limits = { userPerHour: 10, tenantPerHour: 30 },
  ) {
    return prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const { session, state } = await businessSession(tx, staff, id);
      if (state.phase === "CANCELLED") throw new SetupImportError("CONFLICT");
      if (state.requestKey === requestKey)
        return { claimed: false, session, state };
      assertBusinessImportVersion(session.version, expectedVersion);
      if (state.phase !== "SOURCES" || state.attempts >= 3)
        throw new SetupImportError("CONFLICT");
      if (!state.url && !session.sources.length)
        throw new SetupImportError("REVIEW_REQUIRED");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`business-import-budget:${staff.tenantId}`}, 0))`;
      if (
        await tx.importSession.count({
          where: {
            tenantId: staff.tenantId,
            businessData: { not: Prisma.DbNull },
            extractionState: "RUNNING",
            extractionStartedAt: { gte: new Date(Date.now() - 240_000) },
          },
        })
      )
        throw new SetupImportError(
          "LIMIT",
          "Another import is already analyzing in this organization.",
        );
      const count = await tx.auditEvent.count({
        where: {
          tenantId: staff.tenantId,
          actorUserId: staff.userId,
          action: "BUSINESS_IMPORT_ANALYSIS_STARTED",
          createdAt: { gte: new Date(Date.now() - 3600_000) },
        },
      });
      const tenantCount = await tx.auditEvent.count({
        where: {
          tenantId: staff.tenantId,
          action: "BUSINESS_IMPORT_ANALYSIS_STARTED",
          createdAt: { gte: new Date(Date.now() - 3600_000) },
        },
      });
      if (count >= limits.userPerHour || tenantCount >= limits.tenantPerHour)
        throw new SetupImportError("LIMIT");
      await tx.importSession.update({
        where: { id },
        data: {
          businessData: importJson({
            ...state,
            phase: "ANALYZING",
            attempts: state.attempts + 1,
            requestKey,
          }),
          extractionState: "RUNNING",
          extractionStartedAt: new Date(),
          errorCode: null,
          version: { increment: 1 },
        },
      });
      await businessAudit(tx, staff, id, "BUSINESS_IMPORT_ANALYSIS_STARTED", {
        requestKey,
        attempt: state.attempts + 1,
      });
      return { claimed: true, session, state };
    });
  },
  async source(
    staff: SetupStaff,
    id: string,
    key: string,
    source: {
      id: string;
      bytes: Buffer;
      filename: string;
      mimeType: string;
      contentHash: string;
      pageCount: number;
      sourceUrl: string | null;
      method: string;
    },
  ) {
    await prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const { state, session } = await businessSession(tx, staff, id);
      if (state.phase !== "ANALYZING" || state.requestKey !== key)
        throw new SetupImportError("CONFLICT");
      if (
        source.contentHash !==
        createHash("sha256").update(source.bytes).digest("hex")
      )
        throw new SetupImportError("INVALID_INPUT");
      const previous = session.sources.find(
        (s) => s.contentHash === source.contentHash,
      );
      if (previous) {
        source.id = previous.id;
        return;
      }
      if (
        session.sources.reduce((n, s) => n + s.byteSize, 0) +
          source.bytes.length >
          48_000_000 ||
        session.sources.length >= 30
      )
        throw new SetupImportError("LIMIT");
      await tx.importSource.create({
        data: {
          id: source.id,
          ...setupScope(staff),
          sessionId: id,
          filename: source.filename,
          mimeType: source.mimeType,
          contentHash: source.contentHash,
          byteSize: source.bytes.length,
          pageCount: source.pageCount,
          sourceUrl: source.sourceUrl,
          method: source.method,
          documentBytes: Uint8Array.from(source.bytes),
        },
      });
    });
  },
  async finish(
    staff: SetupStaff,
    id: string,
    key: string,
    result: {
      fields: BusinessImportState["fields"];
      images: BusinessImportState["images"];
      menu: unknown;
      warnings: string[];
      provenance: Record<string, unknown>;
    },
  ) {
    await prisma.$transaction(
      async (tx) => {
        await lockSetup(tx, staff);
        const { state, session } = await businessSession(tx, staff, id);
        if (state.phase !== "ANALYZING" || state.requestKey !== key)
          throw new SetupImportError("CONFLICT");
        const proposal = validateMenuImportProposal(
          result.menu,
          session.sources,
        );
        const next = businessImportStateSchema.parse({
          ...state,
          phase: "REVIEW",
          fields: result.fields,
          images: result.images,
          warnings: result.warnings,
          review: null,
        });
        for (const field of [...next.fields, ...next.images])
          if (
            !session.sources.some(
              (s) =>
                s.id === field.evidence.sourceId &&
                s.contentHash === field.evidence.sourceHash,
            )
          )
            throw new SetupImportError("INVALID_INPUT");
        for (const item of proposal.items)
          await tx.importItem.create({
            data: {
              ...setupScope(staff),
              sessionId: id,
              proposalItemId: item.id,
              original: importJson({
                ...item,
                extractionMethod:
                  (
                    result.provenance.itemMethods as
                      Record<string, string> | undefined
                  )?.[item.id] ?? "UNKNOWN",
                verification:
                  (
                    result.provenance.itemMethods as
                      Record<string, string> | undefined
                  )?.[item.id] === "AI"
                    ? "UNVERIFIED"
                    : "SOURCE_OBSERVED",
                sources: session.sources.map((s) => ({
                  id: s.id,
                  contentHash: s.contentHash,
                  sourceUrl: s.sourceUrl,
                  method: s.method,
                })),
              }),
              reviewed: importJson(reviewFromProposal(item, proposal)),
            },
          });
        await tx.importSession.update({
          where: { id },
          data: {
            businessData: importJson(next),
            proposal: importJson(proposal),
            provenance: importJson(result.provenance),
            extractionState: "SUCCEEDED",
            extractionFinishedAt: new Date(),
            status: "NEEDS_REVIEW",
            version: { increment: 1 },
          },
        });
        await businessAudit(tx, staff, id, "BUSINESS_IMPORT_ANALYZED", {
          fields: next.fields.length,
          products: proposal.items.length,
          sourceHashes: session.sources.map((s) => s.contentHash),
        });
      },
      { timeout: 30_000 },
    );
  },
  async cancel(staff: SetupStaff, id: string, expectedVersion: number) {
    await prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const { session, state } = await businessSession(tx, staff, id);
      assertBusinessImportVersion(session.version, expectedVersion);
      if (state.phase !== "ANALYZING") throw new SetupImportError("CONFLICT");
      await tx.importSession.update({
        where: { id },
        data: {
          businessData: importJson({ ...state, phase: "SOURCES" }),
          extractionState: "FAILED",
          errorCode: "CANCELLED",
          version: { increment: 1 },
        },
      });
      await businessAudit(tx, staff, id, "BUSINESS_IMPORT_CANCELLED", {});
    });
  },
  async discard(staff: SetupStaff, id: string, expectedVersion: number) {
    await prisma.$transaction(async (tx) => {
      await lockSetup(tx, staff);
      const { session, state } = await businessSession(tx, staff, id);
      assertBusinessImportDiscard(
        state,
        !!session.importedAt || !!session.businessReceipt,
      );
      // Replaying a cancellation cannot revive work or write a second audit.
      if (state.phase === "CANCELLED") return;
      assertBusinessImportVersion(session.version, expectedVersion);
      await tx.importSession.update({
        where: { id },
        data: {
          businessData: importJson({
            ...state,
            phase: "CANCELLED",
            review: state.review ? { ...state.review, confirm: false } : null,
          }),
          // Keep the existing database status vocabulary; V2 phase records cancellation.
          status: "REJECTED",
          extractionState: "FAILED",
          errorCode: "CANCELLED",
          version: { increment: 1 },
        },
      });
      await tx.smartSetup.updateMany({
        where: { ...setupScope(staff), activeImportSessionId: id },
        data: { activeImportSessionId: null, version: { increment: 1 } },
      });
      await businessAudit(tx, staff, id, "BUSINESS_IMPORT_DISCARDED", {
        previousPhase: state.phase,
      });
    });
    return this.get(staff, id);
  },
  async review(staff: SetupStaff, id: string, raw: unknown) {
    const input = businessReviewSchema.parse(raw);
    await prisma.$transaction(
      async (tx) => {
        await lockSetup(tx, staff);
        const { session, state } = await businessSession(tx, staff, id);
        assertBusinessImportVersion(session.version, input.expectedVersion);
        if (state.phase !== "REVIEW") throw new SetupImportError("CONFLICT");
        const canonical = await businessCanonicalSnapshot(tx, staff);
        if (fingerprint(canonical) !== input.canonicalRevision)
          throw new SetupImportError(
            "CONFLICT",
            "The canonical business changed. Reload and review the latest data.",
          );
        validateBusinessReview(
          input,
          state,
          canonical.venue.currency,
          session.items.map((i) => i.id),
        );
        for (const item of input.items) {
          if (
            item.targetProductId &&
            !canonical.products.some((p) => p.id === item.targetProductId)
          )
            throw new SetupImportError("NOT_FOUND");
          if (
            item.item.categoryId &&
            !canonical.categories.some((c) => c.id === item.item.categoryId)
          )
            throw new SetupImportError("NOT_FOUND");
          await tx.importItem.update({
            where: { id: item.id },
            data: {
              reviewed: importJson(item.item),
              status: input.confirm
                ? item.action === "SKIP"
                  ? "REJECTED"
                  : "APPROVED"
                : "NEEDS_REVIEW",
              approvedBy: input.confirm ? staff.userId : null,
              approvedAt: input.confirm ? new Date() : null,
            },
          });
        }
        await tx.importSession.update({
          where: { id },
          data: {
            businessData: importJson({ ...state, review: input }),
            status: input.confirm ? "APPROVED" : "NEEDS_REVIEW",
            version: { increment: 1 },
          },
        });
        await businessAudit(
          tx,
          staff,
          id,
          input.confirm
            ? "BUSINESS_IMPORT_APPROVED"
            : "BUSINESS_IMPORT_REVIEW_SAVED",
          { review: input },
        );
      },
      { timeout: 30_000 },
    );
    return this.get(staff, id);
  },
};

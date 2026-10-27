import { Prisma } from "@prisma/client";
import {
  assertStaffPermission,
  assertCreativeAssetLayer,
  CreativeError,
  parseDesignDocument,
  creativeArchiveState,
  type CreativeScope,
  type DesignDocument,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";

export const creativeScope = (staff: CreativeScope) => ({
  tenantId: staff.tenantId,
  venueId: staff.venueId,
});
export const creativeJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const creativeRepository = {
  async list(staff: CreativeScope) {
    assertStaffPermission(staff.role, "CREATIVE_VIEW");
    const projects = await prisma.creativeProject.findMany({
      where: creativeScope(staff),
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        format: true,
        locale: true,
        status: true,
        version: true,
        updatedAt: true,
        exports: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            outputType: true,
            revision: { select: { number: true } },
          },
        },
      },
    });
    return projects.map(({ exports, ...project }) => ({
      ...project,
      archiveState: creativeArchiveState(
        project.status,
        project.version,
        exports[0]?.revision.number,
      ),
      latestExport: exports[0] ?? null,
    }));
  },
  async get(staff: CreativeScope, id: string) {
    assertStaffPermission(staff.role, "CREATIVE_VIEW");
    const project = await prisma.creativeProject.findFirst({
      where: { ...creativeScope(staff), id },
    });
    if (!project) throw new CreativeError("NOT_FOUND");
    return { ...project, document: parseDesignDocument(project.document) };
  },
  async create(staff: CreativeScope, title: string, document: DesignDocument) {
    assertStaffPermission(staff.role, "CREATIVE_EDIT");
    const doc = parseDesignDocument(document);
    return prisma.creativeProject.create({
      data: {
        ...creativeScope(staff),
        title,
        format: doc.format,
        locale: doc.locale,
        document: creativeJson(doc),
        createdBy: staff.userId,
        updatedBy: staff.userId,
      },
    });
  },
  async save(
    staff: CreativeScope,
    id: string,
    expectedVersion: number,
    title: string,
    document: DesignDocument,
    name: string | null = null,
    actor: "USER" | "AI" | "SYSTEM" = "USER",
  ) {
    assertStaffPermission(staff.role, "CREATIVE_EDIT");
    const doc = parseDesignDocument(document);
    return prisma.$transaction(async (tx) => {
      const previous = await tx.creativeProject.findFirst({
        where: { ...creativeScope(staff), id },
      });
      if (!previous) throw new CreativeError("NOT_FOUND");
      const changed = await tx.creativeProject.updateMany({
        where: {
          ...creativeScope(staff),
          id,
          version: expectedVersion,
          status: { not: "ARCHIVED" },
        },
        data: {
          title,
          document: creativeJson(doc),
          format: doc.format,
          locale: doc.locale,
          version: { increment: 1 },
          updatedBy: staff.userId,
          status: "DRAFT",
        },
      });
      if (changed.count !== 1)
        throw new CreativeError(
          "CONFLICT",
          "This design changed in another tab. Reload before saving.",
        );
      const revision = await tx.creativeRevision.create({
        data: {
          ...creativeScope(staff),
          projectId: id,
          number: expectedVersion + 1,
          document: creativeJson(doc),
          sourceSummary: creativeJson(doc.bindings),
          actor,
          createdBy: staff.userId,
          name,
          parentRevisionId: previous.currentRevisionId,
        },
      });
      return tx.creativeProject.update({
        where: { id, ...creativeScope(staff) },
        data: { currentRevisionId: revision.id },
      });
    });
  },
  async revisions(staff: CreativeScope, projectId: string) {
    await this.get(staff, projectId);
    return prisma.creativeRevision.findMany({
      where: { ...creativeScope(staff), projectId },
      orderBy: { number: "desc" },
      take: 50,
      select: {
        id: true,
        number: true,
        name: true,
        actor: true,
        createdAt: true,
      },
    });
  },
  async archive(
    staff: CreativeScope,
    id: string,
    expectedVersion: number,
    archived: boolean,
  ) {
    assertStaffPermission(staff.role, "CREATIVE_EDIT");
    const changed = await prisma.creativeProject.updateMany({
      where: { ...creativeScope(staff), id, version: expectedVersion },
      data: {
        status: archived ? "ARCHIVED" : "DRAFT",
        updatedBy: staff.userId,
      },
    });
    if (changed.count !== 1)
      throw new CreativeError(
        "CONFLICT",
        "This design changed. Reload before continuing.",
      );
    return this.get(staff, id);
  },
  async assets(staff: CreativeScope) {
    assertStaffPermission(staff.role, "CREATIVE_VIEW");
    return prisma.creativeAsset.findMany({
      where: creativeScope(staff),
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        source: true,
        mimeType: true,
        width: true,
        height: true,
        approvedForPublicUse: true,
        provenance: true,
        createdAt: true,
      },
    });
  },
  async asset(staff: CreativeScope, id: string) {
    assertStaffPermission(staff.role, "CREATIVE_VIEW");
    const asset = await prisma.creativeAsset.findFirst({
      where: { ...creativeScope(staff), id },
    });
    if (!asset) throw new CreativeError("NOT_FOUND");
    return asset;
  },
  async validateAssets(
    staff: CreativeScope,
    document: DesignDocument,
    forExport = false,
  ) {
    for (const layer of document.pages.flatMap((p) => p.layers)) {
      if (!("assetId" in layer)) continue;
      const asset = await this.asset(staff, layer.assetId);
      assertCreativeAssetLayer(layer, asset, forExport);
    }
  },
};

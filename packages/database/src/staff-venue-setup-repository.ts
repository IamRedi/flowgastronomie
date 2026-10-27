import { randomBytes } from "node:crypto";

import { Prisma, type ServiceMode as PrismaServiceMode } from "@prisma/client";
import {
  assertStaffPermission,
  resolveServiceMode,
  type ServiceMode,
  type StaffRole,
} from "@flowgastronomie/domain";

import { prisma } from "./client.js";
import { hashQrToken } from "./public-menu-repository.js";

type StaffScope = { tenantId: string; venueId: string; role: StaffRole };

export type VenueSetupArea = {
  id: string;
  name: string;
  serviceModeOverride: ServiceMode | null;
  tableCount: number;
};

export type VenueSetupTable = {
  id: string;
  label: string;
  areaId: string | null;
  areaName: string | null;
  serviceModeOverride: ServiceMode | null;
  effectiveServiceMode: ServiceMode;
  qrConfigured: boolean;
  qrRevoked: boolean;
};

export type VenueSetup = {
  venue: {
    id: string;
    name: string;
    timezone: string;
    currency: string;
    defaultServiceMode: ServiceMode;
  };
  areas: VenueSetupArea[];
  tables: VenueSetupTable[];
};

type AreaInput = {
  name: string;
  serviceModeOverride: ServiceMode | null;
};

type TableInput = {
  label: string;
  areaId: string | null;
  serviceModeOverride: ServiceMode | null;
};

export type StaffVenueSetupRepository = {
  list(staff: StaffScope): Promise<VenueSetup>;
  updateVenue(input: {
    staff: StaffScope;
    defaultServiceMode: ServiceMode;
  }): Promise<VenueSetup["venue"]>;
  createArea(input: {
    staff: StaffScope;
    area: AreaInput;
  }): Promise<VenueSetupArea>;
  updateArea(input: {
    staff: StaffScope;
    areaId: string;
    area: AreaInput;
  }): Promise<VenueSetupArea>;
  createTable(input: {
    staff: StaffScope;
    table: TableInput;
  }): Promise<{ table: VenueSetupTable; qrToken: string }>;
  updateTable(input: {
    staff: StaffScope;
    tableId: string;
    table: TableInput;
  }): Promise<VenueSetupTable>;
  rotateTableQr(input: {
    staff: StaffScope;
    tableId: string;
  }): Promise<{ tableId: string; qrToken: string }>;
};

export class VenueSetupResourceNotFoundError extends Error {
  constructor(resource: "venue" | "area" | "table") {
    super(`The ${resource} was not found in this venue`);
    this.name = "VenueSetupResourceNotFoundError";
  }
}

export class VenueSetupConflictError extends Error {
  constructor() {
    super("An area or table with this name already exists");
    this.name = "VenueSetupConflictError";
  }
}

function asServiceMode(mode: PrismaServiceMode): ServiceMode {
  return mode;
}

function mapArea(area: {
  id: string;
  name: string;
  serviceModeOverride: PrismaServiceMode | null;
  _count: { tables: number };
}): VenueSetupArea {
  return {
    id: area.id,
    name: area.name,
    serviceModeOverride: area.serviceModeOverride
      ? asServiceMode(area.serviceModeOverride)
      : null,
    tableCount: area._count.tables,
  };
}

function mapTable(
  table: {
    id: string;
    label: string;
    areaId: string | null;
    serviceModeOverride: PrismaServiceMode | null;
    qrTokenHash: string;
    qrRevokedAt: Date | null;
    area: {
      name: string;
      serviceModeOverride: PrismaServiceMode | null;
    } | null;
  },
  venueDefault: PrismaServiceMode,
): VenueSetupTable {
  return {
    id: table.id,
    label: table.label,
    areaId: table.areaId,
    areaName: table.area?.name ?? null,
    serviceModeOverride: table.serviceModeOverride
      ? asServiceMode(table.serviceModeOverride)
      : null,
    effectiveServiceMode: resolveServiceMode({
      venueDefault: asServiceMode(venueDefault),
      ...(table.area?.serviceModeOverride
        ? {
            areaOverride: {
              active: true,
              mode: asServiceMode(table.area.serviceModeOverride),
            },
          }
        : {}),
      ...(table.serviceModeOverride
        ? {
            tableOverride: {
              active: true,
              mode: asServiceMode(table.serviceModeOverride),
            },
          }
        : {}),
    }),
    qrConfigured: table.qrTokenHash.length > 0,
    qrRevoked: table.qrRevokedAt !== null,
  };
}

function translateConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new VenueSetupConflictError();
  }
  throw error;
}

async function venueDefault(staff: StaffScope) {
  const venue = await prisma.venue.findFirst({
    where: { id: staff.venueId, tenantId: staff.tenantId },
    select: { defaultServiceMode: true },
  });
  if (!venue) throw new VenueSetupResourceNotFoundError("venue");
  return venue.defaultServiceMode;
}

async function assertArea(staff: StaffScope, areaId: string | null) {
  if (!areaId) return;
  const area = await prisma.area.findFirst({
    where: { id: areaId, tenantId: staff.tenantId, venueId: staff.venueId },
    select: { id: true },
  });
  if (!area) throw new VenueSetupResourceNotFoundError("area");
}

const tableInclude = {
  area: { select: { name: true, serviceModeOverride: true } },
};

export const staffVenueSetupRepository: StaffVenueSetupRepository = {
  async list(staff) {
    assertStaffPermission(staff.role, "VENUE_SETUP_VIEW");
    const venue = await prisma.venue.findFirst({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      include: {
        areas: {
          orderBy: { name: "asc" },
          include: { _count: { select: { tables: true } } },
        },
        tables: { orderBy: { label: "asc" }, include: tableInclude },
      },
    });
    if (!venue) throw new VenueSetupResourceNotFoundError("venue");
    return {
      venue: {
        id: venue.id,
        name: venue.name,
        timezone: venue.timezone,
        currency: venue.currency,
        defaultServiceMode: asServiceMode(venue.defaultServiceMode),
      },
      areas: venue.areas.map(mapArea),
      tables: venue.tables.map((table) =>
        mapTable(table, venue.defaultServiceMode),
      ),
    };
  },

  async updateVenue({ staff, defaultServiceMode }) {
    assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
    const updated = await prisma.venue.updateMany({
      where: { id: staff.venueId, tenantId: staff.tenantId },
      data: { defaultServiceMode },
    });
    if (updated.count !== 1) throw new VenueSetupResourceNotFoundError("venue");
    const venue = await prisma.venue.findUniqueOrThrow({
      where: { id: staff.venueId },
    });
    return {
      id: venue.id,
      name: venue.name,
      timezone: venue.timezone,
      currency: venue.currency,
      defaultServiceMode: asServiceMode(venue.defaultServiceMode),
    };
  },

  async createArea({ staff, area }) {
    assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
    try {
      const created = await prisma.area.create({
        data: { ...area, tenantId: staff.tenantId, venueId: staff.venueId },
        include: { _count: { select: { tables: true } } },
      });
      return mapArea(created);
    } catch (error) {
      return translateConflict(error);
    }
  },

  async updateArea({ staff, areaId, area }) {
    assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
    const existing = await prisma.area.findFirst({
      where: { id: areaId, tenantId: staff.tenantId, venueId: staff.venueId },
      select: { id: true },
    });
    if (!existing) throw new VenueSetupResourceNotFoundError("area");
    try {
      const updated = await prisma.area.update({
        where: { id: areaId },
        data: area,
        include: { _count: { select: { tables: true } } },
      });
      return mapArea(updated);
    } catch (error) {
      return translateConflict(error);
    }
  },

  async createTable({ staff, table }) {
    assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
    await assertArea(staff, table.areaId);
    const qrToken = randomBytes(24).toString("base64url");
    try {
      const created = await prisma.diningTable.create({
        data: {
          ...table,
          tenantId: staff.tenantId,
          venueId: staff.venueId,
          qrTokenHash: hashQrToken(qrToken),
          qrRevokedAt: null,
        },
        include: tableInclude,
      });
      return {
        table: mapTable(created, await venueDefault(staff)),
        qrToken,
      };
    } catch (error) {
      return translateConflict(error);
    }
  },

  async updateTable({ staff, tableId, table }) {
    assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
    await assertArea(staff, table.areaId);
    const existing = await prisma.diningTable.findFirst({
      where: { id: tableId, tenantId: staff.tenantId, venueId: staff.venueId },
      select: { id: true },
    });
    if (!existing) throw new VenueSetupResourceNotFoundError("table");
    try {
      const updated = await prisma.diningTable.update({
        where: { id: tableId },
        data: table,
        include: tableInclude,
      });
      return mapTable(updated, await venueDefault(staff));
    } catch (error) {
      return translateConflict(error);
    }
  },

  async rotateTableQr({ staff, tableId }) {
    assertStaffPermission(staff.role, "VENUE_SETUP_MANAGE");
    const qrToken = randomBytes(24).toString("base64url");
    const updated = await prisma.diningTable.updateMany({
      where: { id: tableId, tenantId: staff.tenantId, venueId: staff.venueId },
      data: { qrTokenHash: hashQrToken(qrToken), qrRevokedAt: null },
    });
    if (updated.count !== 1) throw new VenueSetupResourceNotFoundError("table");
    return { tableId, qrToken };
  },
};

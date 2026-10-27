import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  allowsAutomaticDrawer,
  assertPrintRetry,
  assertStaffPermission,
  HardwareError,
  printerPayload,
  type FinalReceipt,
  type HardwareCapabilities,
  type HardwareCommand,
  type HardwareResult,
} from "@flowgastronomie/domain";
import { prisma } from "./client.js";
import {
  requireActiveShift,
  type StaffActor,
} from "./staff-work-repository.js";
const scope = (staff: StaffActor) => ({
  tenantId: staff.tenantId,
  venueId: staff.venueId,
});
const audit = (
  staff: StaffActor,
  action: string,
  entityId: string,
  metadata: Prisma.InputJsonValue,
) => ({
  ...scope(staff),
  actorUserId: staff.userId,
  actorMembershipId: staff.membershipId,
  action,
  entityType: "Hardware",
  entityId,
  metadata,
});
const json = (value: unknown) => value as Prisma.InputJsonValue;
async function device(
  tx: Prisma.TransactionClient,
  staff: StaffActor,
  id: string,
) {
  const row = await tx.hardwareDevice.findFirst({
    where: { id, ...scope(staff), active: true },
  });
  if (!row)
    throw new HardwareError(
      "NOT_FOUND",
      "Paired device not found in this venue",
    );
  return row;
}
async function receipt(
  tx: Prisma.TransactionClient,
  staff: StaffActor,
  id: string,
) {
  const row = await tx.receipt.findFirst({
    where: { id, ...scope(staff), status: "FINALIZED" },
  });
  if (!row)
    throw new HardwareError(
      "NOT_FOUND",
      "Finalized receipt not found in this venue",
    );
  return printerPayload({
    ...(row.snapshot as unknown as FinalReceipt),
    id: row.id,
    number: row.number,
    orderId: row.orderId,
    onlineOrderId: row.onlineOrderId,
    paymentId: row.paymentId,
    issuedAt: row.issuedAt.toISOString(),
    finalizedAt: row.finalizedAt.toISOString(),
    status: row.status,
  });
}
export const hardwareRepository = {
  async uncertain(staff: StaffActor, id: string, commandId: string) {
    assertStaffPermission(staff.role, "RECEIPT_PRINT");
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PrintJob" WHERE "id"=${id} AND "tenantId"=${staff.tenantId} AND "venueId"=${staff.venueId} FOR UPDATE`;
      const job = await tx.printJob.findFirst({
        where: { id, ...scope(staff) },
      });
      if (!job || job.commandId !== commandId)
        throw new HardwareError("NOT_FOUND", "Current print attempt not found");
      if (job.status !== "PRINTING") return job;
      const updated = await tx.printJob.update({
        where: { id },
        data: { status: "FAILED", lastErrorCode: "UNKNOWN_RESULT" },
      });
      await tx.auditEvent.create({
        data: audit(staff, "RECEIPT_PRINT_UNCERTAIN", id, { commandId }),
      });
      return updated;
    });
  },
  async commandRecord(staff: StaffActor, id: string) {
    assertStaffPermission(staff.role, "RECEIPT_PRINT");
    return prisma.hardwareCommandRecord.findFirst({
      where: { id, ...scope(staff) },
    });
  },
  async list(staff: StaffActor) {
    assertStaffPermission(staff.role, "RECEIPT_PRINT");
    return prisma.hardwareDevice.findMany({
      where: { ...scope(staff), active: true },
      orderBy: { pairedAt: "desc" },
    });
  },
  async pair(
    staff: StaffActor,
    input: {
      displayName: string;
      mode: "SIMULATOR" | "ANDROID";
      fingerprint: string;
      publicKey: string | null;
      capabilities: HardwareCapabilities;
    },
  ) {
    assertStaffPermission(staff.role, "HARDWARE_MANAGE");
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Venue" WHERE "id"=${staff.venueId} AND "tenantId"=${staff.tenantId} FOR UPDATE`;
      const existing = await tx.hardwareDevice.findUnique({
        where: { fingerprint: input.fingerprint },
      });
      if (
        existing &&
        (existing.tenantId !== staff.tenantId ||
          existing.venueId !== staff.venueId)
      )
        throw new HardwareError(
          "NOT_FOUND",
          "Device is paired outside this venue",
        );
      const row = existing
        ? await tx.hardwareDevice.update({
            where: { id: existing.id },
            data: {
              active: true,
              capabilities: json(input.capabilities),
              lastSeen: new Date(),
              displayName: input.displayName,
            },
          })
        : await tx.hardwareDevice.create({
            data: {
              ...scope(staff),
              ...input,
              capabilities: json(input.capabilities),
              lastSeen: new Date(),
            },
          });
      await tx.auditEvent.create({
        data: audit(staff, "HARDWARE_PAIRED", row.id, {
          mode: row.mode,
          fingerprint: row.fingerprint,
        }),
      });
      return row;
    });
  },
  async configure(
    staff: StaffActor,
    id: string,
    input: { autoPrint: boolean; autoDrawer: boolean; active: boolean },
  ) {
    assertStaffPermission(staff.role, "HARDWARE_MANAGE");
    return prisma.$transaction(async (tx) => {
      const row = await device(tx, staff, id);
      const caps = row.capabilities as unknown as HardwareCapabilities;
      if (
        (input.autoPrint && !caps.printerAvailable) ||
        (input.autoDrawer && !caps.drawerAvailable)
      )
        throw new HardwareError(
          "CAPABILITY_UNAVAILABLE",
          "This device has not confirmed the requested capability",
        );
      const updated = await tx.hardwareDevice.update({
        where: { id },
        data: input,
      });
      await tx.auditEvent.create({
        data: audit(staff, "HARDWARE_CONFIGURED", id, input),
      });
      return updated;
    });
  },
  async jobs(staff: StaffActor, receiptId: string) {
    assertStaffPermission(staff.role, "RECEIPT_PRINT");
    return prisma.$transaction(async (tx) => {
      await receipt(tx, staff, receiptId);
      return tx.printJob.findMany({
        where: { ...scope(staff), receiptId },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
    });
  },
  async queue(
    staff: StaffActor,
    input: { receiptId: string; deviceId: string; key: string },
  ) {
    assertStaffPermission(staff.role, "RECEIPT_PRINT");
    return prisma.$transaction(async (tx) => {
      await device(tx, staff, input.deviceId);
      await receipt(tx, staff, input.receiptId);
      const requestKey = `${staff.tenantId}:${staff.venueId}:${input.deviceId}:${input.key}`;
      const job = await tx.printJob.upsert({
        where: { requestKey },
        create: {
          ...scope(staff),
          receiptId: input.receiptId,
          deviceId: input.deviceId,
          requestKey,
        },
        // A nonempty identical update lets Prisma use PostgreSQL ON CONFLICT
        // atomically instead of a raced read-then-create upsert.
        update: { requestKey },
      });
      if (job.receiptId !== input.receiptId)
        throw new HardwareError(
          "IDEMPOTENCY_CONFLICT",
          "Print key already belongs to another receipt",
        );
      return job;
    });
  },
  async beginPrint(
    staff: StaffActor,
    id: string,
    retry: boolean,
    confirmPossibleDuplicate = false,
  ) {
    assertStaffPermission(staff.role, "RECEIPT_PRINT");
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PrintJob" WHERE "id"=${id} AND "tenantId"=${staff.tenantId} AND "venueId"=${staff.venueId} FOR UPDATE`;
      const job = await tx.printJob.findFirst({
        where: { id, ...scope(staff) },
      });
      if (!job) throw new HardwareError("NOT_FOUND", "Print job not found");
      const paired = await device(tx, staff, job.deviceId);
      if (job.status === "PRINTED")
        return { job, command: null, device: paired };
      if (job.status === "PRINTING") {
        const existing = await tx.hardwareCommandRecord.findFirstOrThrow({
          where: { id: job.commandId!, ...scope(staff) },
        });
        if (existing.expiresAt > new Date())
          return {
            job,
            command: existing.payload as unknown as HardwareCommand,
            device: paired,
          };
        if (!retry || !confirmPossibleDuplicate)
          throw new HardwareError(
            "UNKNOWN_RESULT",
            "Check the printer before confirming a retry: output may already exist",
          );
      }
      if (job.status === "FAILED") {
        if (!retry) return { job, command: null, device: paired };
        assertPrintRetry(job.status);
        if (job.lastErrorCode === "UNKNOWN_RESULT" && !confirmPossibleDuplicate)
          throw new HardwareError(
            "UNKNOWN_RESULT",
            "Check physical output before retry",
          );
      }
      const idCommand = randomUUID();
      const expiresAt = new Date(Date.now() + 60_000);
      const command: HardwareCommand = {
        version: 1,
        commandId: idCommand,
        deviceId: paired.id,
        deviceFingerprint: paired.fingerprint,
        ...scope(staff),
        expiresAt: expiresAt.getTime(),
        command: "printReceipt",
        receipt: await receipt(tx, staff, job.receiptId),
      };
      await tx.hardwareCommandRecord.create({
        data: {
          id: idCommand,
          ...scope(staff),
          deviceId: paired.id,
          receiptId: job.receiptId,
          kind: "printReceipt",
          requestKey: `print:${idCommand}`,
          payload: json(command),
          expiresAt,
        },
      });
      const updated = await tx.printJob.update({
        where: { id },
        data: {
          status: "PRINTING",
          attempts: { increment: 1 },
          commandId: idCommand,
          lastErrorCode: null,
        },
      });
      await tx.auditEvent.create({
        data: audit(staff, "RECEIPT_PRINT_STARTED", id, {
          receiptId: job.receiptId,
          deviceId: paired.id,
          attempt: updated.attempts,
        }),
      });
      return { job: updated, command, device: paired };
    });
  },
  async command(
    staff: StaffActor,
    input: {
      deviceId: string;
      kind: "printTest" | "openDrawer";
      receiptId?: string | undefined;
      reason?: string | undefined;
      key: string;
    },
  ) {
    assertStaffPermission(
      staff.role,
      input.kind === "printTest"
        ? "HARDWARE_MANAGE"
        : input.receiptId
          ? "RECEIPT_PRINT"
          : "DRAWER_MANUAL",
    );
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "HardwareDevice" WHERE "id"=${input.deviceId} AND "tenantId"=${staff.tenantId} AND "venueId"=${staff.venueId} FOR UPDATE`;
      const paired = await device(tx, staff, input.deviceId);
      const caps = paired.capabilities as unknown as HardwareCapabilities;
      if (input.kind === "openDrawer") {
        await requireActiveShift(tx, staff);
        if (!caps.drawerAvailable)
          throw new HardwareError("DRAWER_UNAVAILABLE", "Drawer unavailable");
        if (input.receiptId) {
          const paid = await receipt(tx, staff, input.receiptId);
          if (!allowsAutomaticDrawer(paid))
            throw new HardwareError(
              "DRAWER_CASH_ONLY",
              "Automatic drawer commands require a finalized CASH receipt",
            );
          if (Date.now() - Date.parse(paid.finalizedAt) > 300_000)
            throw new HardwareError(
              "DRAWER_MANUAL_REQUIRED",
              "Use an audited manual opening for older receipts",
            );
        } else if (!input.reason?.trim())
          throw new HardwareError(
            "REASON_REQUIRED",
            "Manual drawer opening requires a reason",
          );
      }
      // Automatic drawer identity is server-derived, never client supplied.
      const requestKey =
        input.kind === "openDrawer" && input.receiptId
          ? `drawer:${paired.id}:${input.receiptId}`
          : `${input.kind}:${paired.id}:${input.key}`;
      const existing = await tx.hardwareCommandRecord.findUnique({
        where: { requestKey },
      });
      if (existing) return { record: existing, device: paired };
      const commandId = randomUUID();
      const expiresAt = new Date(Date.now() + 60_000);
      const common = {
        version: 1 as const,
        commandId,
        deviceId: paired.id,
        deviceFingerprint: paired.fingerprint,
        ...scope(staff),
        expiresAt: expiresAt.getTime(),
      };
      const payload: HardwareCommand =
        input.kind === "printTest"
          ? { ...common, command: "printTest" }
          : {
              ...common,
              command: "openDrawer",
              receiptId: input.receiptId ?? null,
              reason: input.receiptId ? "CASH payment recorded" : input.reason!,
            };
      const record = await tx.hardwareCommandRecord.create({
        data: {
          id: commandId,
          ...scope(staff),
          deviceId: paired.id,
          receiptId: input.receiptId ?? null,
          kind: input.kind,
          requestKey,
          payload: json(payload),
          expiresAt,
        },
      });
      await tx.auditEvent.create({
        data: audit(
          staff,
          input.kind === "openDrawer"
            ? "DRAWER_OPEN_REQUESTED"
            : "PRINTER_TEST_REQUESTED",
          record.id,
          {
            deviceId: paired.id,
            receiptId: input.receiptId ?? null,
            reason: input.reason ?? "CASH payment",
          },
        ),
      });
      return { record, device: paired };
    });
  },
  async complete(staff: StaffActor, result: HardwareResult) {
    assertStaffPermission(staff.role, "RECEIPT_PRINT");
    return prisma.$transaction(async (tx) => {
      const paired = await device(tx, staff, result.deviceId);
      await tx.$queryRaw`SELECT "id" FROM "HardwareCommandRecord" WHERE "id"=${result.commandId} AND "tenantId"=${staff.tenantId} AND "venueId"=${staff.venueId} FOR UPDATE`;
      const record = await tx.hardwareCommandRecord.findFirst({
        where: { id: result.commandId, deviceId: paired.id, ...scope(staff) },
      });
      if (!record) throw new HardwareError("NOT_FOUND", "Command not found");
      if (record.result) {
        if (JSON.stringify(record.result) !== JSON.stringify(json(result))) {
          const old = record.result as unknown as HardwareResult;
          if (
            old.success !== result.success ||
            old.errorCode !== result.errorCode
          )
            throw new HardwareError(
              "RESULT_CONFLICT",
              "Command outcome already recorded",
            );
        }
        return tx.printJob.findFirst({
          where: { ...scope(staff), commandId: record.id },
        });
      }
      await tx.hardwareCommandRecord.update({
        where: { id: record.id },
        data: { result: json(result) },
      });
      await tx.hardwareDevice.update({
        where: { id: paired.id },
        data: { lastSeen: new Date(), capabilities: json(result.capabilities) },
      });
      await tx.auditEvent.create({
        data: audit(staff, "HARDWARE_COMMAND_RESULT", record.id, {
          deviceId: paired.id,
          kind: record.kind,
          success: result.success,
          errorCode: result.errorCode,
        }),
      });
      const job = await tx.printJob.findFirst({
        where: { ...scope(staff), commandId: record.id },
      });
      if (!job) return null;
      return tx.printJob.update({
        where: { id: job.id },
        data: {
          status: result.success ? "PRINTED" : "FAILED",
          lastErrorCode: result.success ? null : result.errorCode,
          printedAt: result.success ? new Date() : null,
        },
      });
    });
  },
  async commands(staff: StaffActor, deviceId: string) {
    assertStaffPermission(staff.role, "HARDWARE_MANAGE");
    return prisma.$transaction(async (tx) => {
      await device(tx, staff, deviceId);
      return tx.hardwareCommandRecord.findMany({
        where: { ...scope(staff), deviceId },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
    });
  },
};
export type HardwareRepository = typeof hardwareRepository;

import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
import {
  mkdir,
  readFile,
  writeFile,
  link,
  unlink,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma, counterSaleRepository } from "@flowgastronomie/database";
import { printerPayload, type PrinterPayload } from "@flowgastronomie/domain";
import { SimulatorAdapter } from "../hardware-adapters.js";
import { labStorageStatus } from "./storage.js";
import { assertLabScope, hash } from "./guard.js";
const require = createRequire(import.meta.url);
export const archiveRoot = resolve("artifacts/operations-lab/receipts");
export type ArchiveEntry = {
  receipt_id: string;
  tenant_id: string;
  venue_id: string;
  source_hash: string;
  content_hash: string;
  filename: string;
  renderer_version: number;
};
export async function receiptPdf(receipt: PrinterPayload) {
  if (receipt.status !== "FINALIZED") throw new Error("FINAL_RECEIPT_REQUIRED");
  const doc = new PDFDocument({
    size: [
      226.77,
      Math.max(
        600,
        430 + receipt.items.length * 80 + receipt.breakdown.length * 45,
      ),
    ],
    margins: { top: 14, bottom: 14, left: 12, right: 12 },
    info: {
      Title: "SIMULATED TEST ONLY " + receipt.number,
      CreationDate: new Date(receipt.finalizedAt),
      ModDate: new Date(receipt.finalizedAt),
    },
  });
  doc.registerFont(
    "Regular",
    require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"),
  );
  doc.registerFont(
    "Bold",
    require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff"),
  );
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((ok, fail) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("end", () => ok(Buffer.concat(chunks)));
    doc.on("error", fail);
  });
  const line = (value: string, bold = false) => {
    doc
      .font(bold ? "Bold" : "Regular")
      .fontSize(8)
      .text(value, { width: 202 });
    doc.moveDown(0.4);
  };
  const money = (minor: number) =>
    `${(minor / 100).toFixed(2)} ${receipt.currency}`;
  line("SIMULATED TEST ONLY", true);
  line("NOT FISCAL", true);
  line("NOT VALID CUSTOMER RECEIPT", true);
  line(receipt.business.legalName, true);
  line(receipt.business.venueName);
  line(receipt.business.addressLine1);
  line(
    `${receipt.business.postalCode} ${receipt.business.city} / ${receipt.business.countryCode}`,
  );
  line("Sample tax identity: " + (receipt.business.vatId ?? "TEST ONLY"));
  line("Receipt: " + receipt.number, true);
  line("ID: " + receipt.id);
  line("Finalized: " + receipt.finalizedAt);
  line("Cashier: " + receipt.cashier.displayName);
  line("------------------------------------------------");
  // Display ONLY immutable P2 money and tax snapshots. No price/tax calculation.
  for (const item of receipt.items) {
    line(`${item.quantity} x ${item.productName}`, true);
    if (item.variantName) line(item.variantName);
    for (const modifier of item.modifiers) line("+ " + modifier.optionName);
    line(
      `Unit ${money(item.grossUnitMinor)} / Gross ${money(item.grossMinor)}`,
    );
    line(`Net ${money(item.netMinor)} / Tax ${money(item.taxMinor)}`);
    line(`${item.taxCode} / ${item.rateBasisPoints / 100}% (TEST ONLY)`);
  }
  line("------------------------------------------------");
  line("TOTAL " + money(receipt.grossMinor), true);
  line("NET " + money(receipt.netMinor));
  line("TAX " + money(receipt.taxMinor));
  for (const group of receipt.breakdown) {
    line(`${group.taxCode} ${group.rateBasisPoints / 100}%`);
    line(
      `Gross ${money(group.grossMinor)} / Net ${money(group.netMinor)} / Tax ${money(group.taxMinor)}`,
    );
  }
  line("Method: " + receipt.method, true);
  if (receipt.receivedMinor !== null)
    line("Received: " + money(receipt.receivedMinor));
  if (receipt.changeMinor !== null)
    line("Change: " + money(receipt.changeMinor));
  line("Payment: " + receipt.paymentId);
  line("SIMULATED TEST ONLY / NOT FISCAL", true);
  doc.end();
  return done;
}
export async function verifyArchive(entry: ArchiveEntry) {
  if (!/^[a-f0-9]{64}\.pdf$/.test(entry.filename))
    throw new Error("UNSAFE_ARCHIVE_FILENAME");
  const bytes = await readFile(join(archiveRoot, entry.filename));
  if (
    hash(bytes) !== entry.content_hash ||
    bytes.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new Error("ARCHIVE_HASH_MISMATCH");
  return bytes;
}
export async function archiveReceipt(
  tenantId: string,
  venueId: string,
  payload: PrinterPayload,
) {
  await assertLabScope(tenantId, venueId);
  // Re-resolve actual P2 receipt; never trust adapter input as the financial source.
  const receipt = await counterSaleRepository.receipt(
    {
      tenantId,
      venueId,
      role: "OWNER",
      userId: "archive",
      membershipId: "archive",
    },
    payload.id,
  );
  if (JSON.stringify(printerPayload(receipt)) !== JSON.stringify(payload))
    throw new Error("RECEIPT_PAYLOAD_MISMATCH");
  const sourceHash = hash(JSON.stringify(receipt));
  const filename = hash(tenantId + ":" + venueId + ":" + receipt.id) + ".pdf";
  await mkdir(archiveRoot, { recursive: true });
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"lab-pdf:" + receipt.id},0))`;
      const prior = await tx.$queryRaw<
        ArchiveEntry[]
      >`SELECT * FROM operations_lab.archive WHERE receipt_id=${receipt.id} AND tenant_id=${tenantId} AND venue_id=${venueId}`;
      if (prior[0]) {
        if (prior[0].source_hash !== sourceHash)
          throw new Error("ARCHIVE_SOURCE_MISMATCH");
        await verifyArchive(prior[0]);
        return prior[0];
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('lab-pdf-capacity',0))`;
      const bytes = await receiptPdf(printerPayload(receipt));
      const capacity = await labStorageStatus(archiveRoot);
      await writeFile(
        resolve("artifacts/operations-lab/storage-status.json"),
        JSON.stringify(
          { checkedAt: new Date().toISOString(), ...capacity },
          null,
          2,
        ),
      );
      if (
        capacity.full ||
        capacity.bytes + bytes.length > capacity.policy.maxBytes ||
        bytes.length > 1000000
      )
        throw new Error("LAB_ARCHIVE_CAPACITY_REACHED");
      const target = join(archiveRoot, filename);
      const temp = join(archiveRoot, randomUUID() + ".tmp");
      await writeFile(temp, bytes, { flag: "wx" });
      try {
        await link(temp, target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (hash(await readFile(target)) !== hash(bytes))
          throw new Error("ORPHAN_ARCHIVE_MISMATCH");
      } finally {
        await unlink(temp);
      }
      const entry = {
        receipt_id: receipt.id,
        tenant_id: tenantId,
        venue_id: venueId,
        source_hash: sourceHash,
        content_hash: hash(bytes),
        filename,
        renderer_version: 1,
        byte_size: bytes.length,
      };
      await tx.$executeRaw`INSERT INTO operations_lab.archive (receipt_id,tenant_id,venue_id,source_hash,content_hash,filename,renderer_version,byte_size)
      VALUES (${receipt.id},${tenantId},${venueId},${sourceHash},${entry.content_hash},${filename},1,${bytes.length})`;
      await verifyArchive(entry);
      return entry;
    },
    { timeout: 15000 },
  );
}
export class PdfSimulatorAdapter extends SimulatorAdapter {
  private scopes = new AsyncLocalStorage<{
    tenantId: string;
    venueId: string;
    commandId: string;
  }>();
  override async execute(command: Parameters<SimulatorAdapter["execute"]>[0]) {
    return this.scopes.run(
      {
        tenantId: command.tenantId,
        venueId: command.venueId,
        commandId: command.commandId,
      },
      () => super.execute(command),
    );
  }
  override async printReceipt(receipt: PrinterPayload) {
    if (this.nextPrintFailure) return super.printReceipt(receipt);
    const scope = this.scopes.getStore();
    if (!scope) throw new Error("LAB_SCOPE_REQUIRED");
    try {
      const entry = await archiveReceipt(
        scope.tenantId,
        scope.venueId,
        receipt,
      );
      const job = await prisma.printJob.findFirst({
        where: {
          tenantId: scope.tenantId,
          venueId: scope.venueId,
          commandId: scope.commandId,
          receiptId: receipt.id,
        },
        select: { id: true },
      });
      if (!job) throw new Error("LAB_PRINT_JOB_ASSOCIATION_REQUIRED");
      await prisma.$executeRaw`INSERT INTO operations_lab.archive_print(job_id,receipt_id,tenant_id,venue_id,content_hash) VALUES (${job.id},${receipt.id},${scope.tenantId},${scope.venueId},${entry.content_hash}) ON CONFLICT(job_id) DO NOTHING`;
    } catch {
      return "PRINTER_UNAVAILABLE" as const;
    }
    return super.printReceipt(receipt);
  }
}

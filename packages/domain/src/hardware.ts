import type { FinalReceipt } from "./counter-sale";
export const HARDWARE_VERSION = 1 as const;
export const HARDWARE_ERRORS = [
  "OK",
  "PRINTER_UNAVAILABLE",
  "DRAWER_UNAVAILABLE",
  "PAPER_OUT",
  "BRIDGE_UNAVAILABLE",
  "INVALID_COMMAND",
  "DEVICE_UNPAIRED",
  "UNKNOWN_RESULT",
] as const;
export type HardwareErrorCode = (typeof HARDWARE_ERRORS)[number];
export type HardwareCapabilities = {
  printerAvailable: boolean;
  paperWidth: 58 | 80 | null;
  cutterAvailable: boolean;
  drawerAvailable: boolean;
  vendor: string;
  model: string;
  bridgeVersion: string;
};
export type PrinterPayload = FinalReceipt & { footer?: string };
export type HardwareCommand = {
  version: 1;
  commandId: string;
  deviceId: string;
  deviceFingerprint: string;
  tenantId: string;
  venueId: string;
  expiresAt: number;
} & (
  | { command: "printReceipt"; receipt: PrinterPayload }
  | { command: "printTest" }
  | { command: "openDrawer"; receiptId: string | null; reason: string }
);
export type HardwareResult = {
  version: 1;
  commandId: string;
  deviceId: string;
  success: boolean;
  errorCode: HardwareErrorCode;
  retryable: boolean;
  capabilities: HardwareCapabilities;
};
export interface PrinterAdapter {
  capabilities: HardwareCapabilities;
  printReceipt(receipt: PrinterPayload): Promise<HardwareErrorCode>;
  printTest(): Promise<HardwareErrorCode>;
}
export interface DrawerAdapter {
  openDrawer(): Promise<HardwareErrorCode>;
}
export interface HardwareBridge {
  health(): Promise<HardwareCapabilities>;
  execute(command: HardwareCommand): Promise<HardwareResult>;
}
export class HardwareError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "HardwareError";
  }
}
const text = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ");
export function printerPayload(receipt: FinalReceipt): PrinterPayload {
  if (receipt.status !== "FINALIZED")
    throw new HardwareError(
      "INVALID_COMMAND",
      "Only finalized receipts can print",
    );
  // Strip printer control characters from descriptive text. Money/tax snapshots
  // are copied exactly; neither adapters nor this mapper recalculate them.
  return {
    ...receipt,
    business: {
      ...receipt.business,
      legalName: text(receipt.business.legalName),
      postalCode: text(receipt.business.postalCode),
      countryCode: text(receipt.business.countryCode),
      vatId:
        receipt.business.vatId == null ? null : text(receipt.business.vatId),
      addressLine1: text(receipt.business.addressLine1),
      city: text(receipt.business.city),
      venueName: text(receipt.business.venueName),
    },
    cashier: {
      ...receipt.cashier,
      displayName: text(receipt.cashier.displayName),
    },
    items: receipt.items.map((item) => ({
      ...item,
      taxCode: text(item.taxCode),
      productName: text(item.productName),
      variantName: item.variantName == null ? null : text(item.variantName),
      modifiers: item.modifiers.map((m) => ({
        ...m,
        optionName: text(m.optionName),
      })),
    })),
    breakdown: receipt.breakdown.map((group) => ({
      ...group,
      taxCode: text(group.taxCode),
    })),
  };
}
export function allowsAutomaticDrawer(
  receipt: Pick<FinalReceipt, "method" | "status">,
): boolean {
  return receipt.status === "FINALIZED" && receipt.method === "CASH";
}
export function hardwareResult(
  command: Pick<HardwareCommand, "commandId" | "deviceId">,
  capabilities: HardwareCapabilities,
  code: HardwareErrorCode,
): HardwareResult {
  return {
    version: 1,
    commandId: command.commandId,
    deviceId: command.deviceId,
    success: code === "OK",
    errorCode: code,
    retryable: ["PAPER_OUT", "BRIDGE_UNAVAILABLE"].includes(code),
    capabilities,
  };
}
export function assertPrintRetry(status: string) {
  if (status !== "FAILED")
    throw new HardwareError(
      "JOB_CONFLICT",
      "Only failed jobs can retry; reprint creates a new job for the same receipt",
    );
}

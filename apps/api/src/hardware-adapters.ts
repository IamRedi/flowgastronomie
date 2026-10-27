import {
  hardwareResult,
  HardwareError,
  type DrawerAdapter,
  type HardwareBridge,
  type HardwareCapabilities,
  type HardwareCommand,
  type HardwareErrorCode,
  type HardwareResult,
  type PrinterAdapter,
  type PrinterPayload,
} from "@flowgastronomie/domain";

export class SimulatorAdapter
  implements PrinterAdapter, DrawerAdapter, HardwareBridge
{
  readonly capabilities: HardwareCapabilities = {
    printerAvailable: true,
    paperWidth: 80,
    cutterAvailable: true,
    drawerAvailable: true,
    vendor: "SIMULATOR",
    model: "Test-only 80mm",
    bridgeVersion: "1.0.0",
  };
  readonly commands: HardwareCommand[] = [];
  readonly operations: Array<{ action: string; receiptId?: string }> = [];
  private results = new Map<string, HardwareResult>();
  private pending = new Map<string, Promise<HardwareResult>>();
  nextPrintFailure: HardwareErrorCode | null = null;
  async health() {
    return this.capabilities;
  }
  async printReceipt(receipt: PrinterPayload): Promise<HardwareErrorCode> {
    if (this.nextPrintFailure) {
      const code = this.nextPrintFailure;
      this.nextPrintFailure = null;
      return code;
    }
    this.operations.push(
      { action: "print", receiptId: receipt.id },
      { action: "feed" },
      { action: "cut" },
    );
    return "OK";
  }
  async printTest(): Promise<HardwareErrorCode> {
    this.operations.push(
      { action: "test" },
      { action: "feed" },
      { action: "cut" },
    );
    return "OK";
  }
  async openDrawer(): Promise<HardwareErrorCode> {
    this.operations.push({ action: "drawer" });
    return "OK";
  }
  async execute(command: HardwareCommand) {
    if (
      command.version !== 1 ||
      !["printReceipt", "printTest", "openDrawer"].includes(command.command)
    )
      throw new HardwareError("INVALID_COMMAND", "Unsupported command");
    const cached = this.results.get(command.commandId);
    if (cached) return cached;
    const running = this.pending.get(command.commandId);
    if (running) return running;
    const run = this.run(command);
    this.pending.set(command.commandId, run);
    try {
      return await run;
    } finally {
      this.pending.delete(command.commandId);
    }
  }
  private async run(command: HardwareCommand) {
    this.commands.push(structuredClone(command));
    const code =
      command.command === "printReceipt"
        ? await this.printReceipt(command.receipt)
        : command.command === "printTest"
          ? await this.printTest()
          : await this.openDrawer();
    const result = hardwareResult(command, this.capabilities, code);
    this.results.set(command.commandId, result);
    return result;
  }
}

// No undocumented vendor commands, voltages, pin numbers or ESC/POS dialect.
// Implement this boundary only after SDK and real-device acceptance are available.
export class GeonNb11Adapter implements PrinterAdapter, DrawerAdapter {
  readonly capabilities: HardwareCapabilities = {
    printerAvailable: false,
    paperWidth: null,
    cutterAvailable: false,
    drawerAvailable: false,
    vendor: "GEON",
    model: "NB11 (unverified)",
    bridgeVersion: "1.0.0",
  };
  async printReceipt(_receipt: PrinterPayload): Promise<HardwareErrorCode> {
    return "PRINTER_UNAVAILABLE";
  }
  async printTest(): Promise<HardwareErrorCode> {
    return "PRINTER_UNAVAILABLE";
  }
  async openDrawer(): Promise<HardwareErrorCode> {
    return "DRAWER_UNAVAILABLE";
  }
}

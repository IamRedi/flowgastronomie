import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { z } from "zod";
import { hardwareRepository, type StaffActor } from "@flowgastronomie/database";
import {
  assertStaffPermission,
  HARDWARE_ERRORS,
  HardwareError,
  type HardwareCapabilities,
  type HardwareCommand,
  type HardwareResult,
} from "@flowgastronomie/domain";
import { SimulatorAdapter } from "./hardware-adapters.js";
export const capabilitiesSchema = z
  .object({
    printerAvailable: z.boolean(),
    paperWidth: z.union([z.literal(58), z.literal(80)]).nullable(),
    cutterAvailable: z.boolean(),
    drawerAvailable: z.boolean(),
    vendor: z.string().max(80),
    model: z.string().max(100),
    bridgeVersion: z.string().max(40),
  })
  .strict();
export const resultSchema = z
  .object({
    version: z.literal(1),
    commandId: z.string().uuid(),
    deviceId: z.string().min(1).max(100),
    success: z.boolean(),
    errorCode: z.enum(HARDWARE_ERRORS),
    retryable: z.boolean(),
    capabilities: capabilitiesSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.success === (value.errorCode === "OK") &&
      value.retryable ===
        ["PAPER_OUT", "BRIDGE_UNAVAILABLE"].includes(value.errorCode),
    "Inconsistent normalized result",
  );
const proofSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("PAIR"),
    publicKeyBase64: z.string().min(1).max(4096),
    nonce: z.string().min(16).max(100),
    issuedAt: z.number().int(),
    capabilities: capabilitiesSchema,
  })
  .strict();
export type SignedEnvelope = {
  version: 1;
  bodyBase64: string;
  signatureBase64: string;
};
function decode(body: string) {
  if (body.length > 1_000_000)
    throw new HardwareError("INVALID_COMMAND", "Payload too large");
  return JSON.parse(Buffer.from(body, "base64").toString("utf8")) as unknown;
}
function publicKey(encoded: string) {
  const key = createPublicKey({
    key: Buffer.from(encoded, "base64"),
    format: "der",
    type: "spki",
  });
  if (
    key.asymmetricKeyType !== "rsa" ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new HardwareError(
      "INVALID_DEVICE_KEY",
      "RSA device key must be at least 2048 bits",
    );
  return key;
}
export function verifyDeviceBody(
  bodyBase64: string,
  signatureBase64: string,
  encodedKey: string,
): unknown {
  const key = publicKey(encodedKey);
  if (
    !verify(
      "RSA-SHA256",
      Buffer.from(bodyBase64, "base64"),
      key,
      Buffer.from(signatureBase64, "base64"),
    )
  )
    throw new HardwareError("INVALID_SIGNATURE", "Device signature is invalid");
  return decode(bodyBase64);
}

export class HardwareService {
  private simulators = new Map<string, SimulatorAdapter>();
  private key: KeyObject | null = null;
  readonly simulatorEnabled: boolean;
  constructor(
    private options: {
      simulatorEnabled?: boolean;
      privateKeyBase64?: string;
      production?: boolean;
      simulatorFactory?: () => SimulatorAdapter;
    } = {},
  ) {
    this.simulatorEnabled =
      !(options.production ?? process.env.NODE_ENV === "production") &&
      (options.simulatorEnabled ??
        process.env.HARDWARE_SIMULATOR_ENABLED === "true");
  }
  private signingKey() {
    if (!this.key) {
      const encoded =
        this.options.privateKeyBase64 ??
        process.env.HARDWARE_COMMAND_PRIVATE_KEY_BASE64;
      if (encoded)
        this.key = createPrivateKey({
          key: Buffer.from(encoded, "base64"),
          format: "der",
          type: "pkcs8",
        });
      else if (!(
        this.options.production ?? process.env.NODE_ENV === "production"
      ))
        this.key = generateKeyPairSync("rsa", {
          modulusLength: 2048,
        }).privateKey;
      else
        throw new HardwareError(
          "BRIDGE_NOT_CONFIGURED",
          "Configure the server command signing key before Android pairing",
        );
      if (
        this.key.asymmetricKeyType !== "rsa" ||
        (this.key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      )
        throw new HardwareError(
          "BRIDGE_NOT_CONFIGURED",
          "Server signing key must be RSA 2048 or stronger",
        );
    }
    return this.key;
  }
  publicSigningKey() {
    return {
      version: 1,
      publicKeyBase64: createPublicKey(this.signingKey())
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    };
  }
  signCommand(command: HardwareCommand): SignedEnvelope {
    const bytes = Buffer.from(JSON.stringify(command));
    return {
      version: 1,
      bodyBase64: bytes.toString("base64"),
      signatureBase64: sign("RSA-SHA256", bytes, this.signingKey()).toString(
        "base64",
      ),
    };
  }
  private simulator(id: string) {
    if (!this.simulatorEnabled)
      throw new HardwareError(
        "SIMULATOR_DISABLED",
        "Simulator is explicitly development/test only",
      );
    let adapter = this.simulators.get(id);
    if (!adapter) {
      adapter = this.options.simulatorFactory?.() ?? new SimulatorAdapter();
      this.simulators.set(id, adapter);
    }
    return adapter;
  }
  async pairSimulator(staff: StaffActor, displayName: string) {
    const caps = this.simulator("capabilities").capabilities;
    return hardwareRepository.pair(staff, {
      displayName,
      mode: "SIMULATOR",
      fingerprint: `sim:${staff.tenantId}:${staff.venueId}`,
      publicKey: null,
      capabilities: caps,
    });
  }
  async pairAndroid(
    staff: StaffActor,
    displayName: string,
    envelope: SignedEnvelope,
  ) {
    assertStaffPermission(staff.role, "HARDWARE_MANAGE");
    this.signingKey();
    const unsigned = proofSchema.parse(decode(envelope.bodyBase64));
    if (Math.abs(Date.now() - unsigned.issuedAt) > 60_000)
      throw new HardwareError(
        "PAIRING_EXPIRED",
        "Refresh the local pairing proof",
      );
    const proof = proofSchema.parse(
      verifyDeviceBody(
        envelope.bodyBase64,
        envelope.signatureBase64,
        unsigned.publicKeyBase64,
      ),
    );
    const key = publicKey(proof.publicKeyBase64);
    const normalized = key
      .export({ format: "der", type: "spki" })
      .toString("base64");
    const fingerprint = createHash("sha256")
      .update(Buffer.from(normalized, "base64"))
      .digest("hex");
    return hardwareRepository.pair(staff, {
      displayName,
      mode: "ANDROID",
      fingerprint,
      publicKey: normalized,
      capabilities: proof.capabilities,
    });
  }
  async executePrint(
    staff: StaffActor,
    jobId: string,
    retry: boolean,
    confirmPossibleDuplicate = false,
  ) {
    const pending = await hardwareRepository.beginPrint(
      staff,
      jobId,
      retry,
      confirmPossibleDuplicate,
    );
    if (!pending.command) return { job: pending.job, envelope: null };
    if (pending.device.mode === "SIMULATOR") {
      const previous = (
        await hardwareRepository.commandRecord(staff, pending.command.commandId)
      )?.result;
      const result = previous
        ? resultSchema.parse(previous)
        : await this.simulator(pending.device.id).execute(pending.command);
      const job = await hardwareRepository.complete(staff, result);
      return { job, envelope: null };
    }
    return { job: pending.job, envelope: this.signCommand(pending.command) };
  }
  async executeCommand(
    staff: StaffActor,
    input: Parameters<typeof hardwareRepository.command>[1],
  ) {
    const pending = await hardwareRepository.command(staff, input);
    if (pending.record.result)
      return {
        result: resultSchema.parse(pending.record.result),
        envelope: null,
      };
    const command = pending.record.payload as unknown as HardwareCommand;
    if (pending.device.mode === "SIMULATOR") {
      const result = await this.simulator(pending.device.id).execute(command);
      await hardwareRepository.complete(staff, result);
      return { result, envelope: null };
    }
    return { result: null, envelope: this.signCommand(command) };
  }
  async completeNative(staff: StaffActor, envelope: SignedEnvelope) {
    const decoded = resultSchema.parse(decode(envelope.bodyBase64));
    const devices = await hardwareRepository.list(staff);
    const paired = devices.find(
      (d) => d.id === decoded.deviceId && d.mode === "ANDROID",
    );
    if (!paired?.publicKey)
      throw new HardwareError("NOT_FOUND", "Paired native device not found");
    const result = resultSchema.parse(
      verifyDeviceBody(
        envelope.bodyBase64,
        envelope.signatureBase64,
        paired.publicKey,
      ),
    );
    const job = await hardwareRepository.complete(staff, result);
    return { job, result };
  }
  async diagnostics(
    staff: StaffActor,
    deviceId: string,
    failure: "PAPER_OUT" | "UNKNOWN_RESULT" | null,
  ) {
    assertStaffPermission(staff.role, "HARDWARE_MANAGE");
    const paired = (await hardwareRepository.list(staff)).find(
      (d) => d.id === deviceId && d.mode === "SIMULATOR",
    );
    if (!paired)
      throw new HardwareError("NOT_FOUND", "Simulator not found in this venue");
    const adapter = this.simulator(deviceId);
    adapter.nextPrintFailure = failure;
    return {
      capabilities: adapter.capabilities,
      operations: adapter.operations,
      commands: await hardwareRepository.commands(staff, deviceId),
    };
  }
}

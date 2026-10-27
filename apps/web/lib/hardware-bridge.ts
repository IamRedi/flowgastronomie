type Envelope = { version: 1; bodyBase64: string; signatureBase64: string };
type NativeBridge = {
  postMessage: (message: string) => void;
  onmessage: ((event: { data: string }) => void) | null;
};
declare global {
  interface Window {
    FlowHardware?: NativeBridge;
  }
}
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let initialized: NativeBridge | undefined;
export function nativeAvailable() {
  return typeof window !== "undefined" && !!window.FlowHardware;
}
export function nativeCall(
  method:
    "health" | "capabilities" | "printReceipt" | "printTest" | "openDrawer",
  envelope?: Envelope,
): Promise<unknown> {
  const bridge = window.FlowHardware;
  if (!bridge) return Promise.reject(new Error("BRIDGE_UNAVAILABLE"));
  if (initialized !== bridge) {
    initialized = bridge;
    bridge.onmessage = (event) => {
      try {
        const reply = JSON.parse(event.data) as {
          requestId: string;
          payload?: unknown;
          error?: string;
        };
        const entry = pending.get(reply.requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(reply.requestId);
        if (reply.error) entry.reject(new Error(reply.error));
        else entry.resolve(reply.payload);
      } catch {
        /* Ignore unsolicited/malformed native messages. */
      }
    };
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("UNKNOWN_RESULT"));
    }, 15_000);
    pending.set(requestId, { resolve, reject, timer });
    bridge.postMessage(
      JSON.stringify({ requestId, method, ...(envelope ? { envelope } : {}) }),
    );
  });
}
export async function hardwareRequest(path: string, body?: unknown) {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/staff/hardware/${path}`,
    {
      credentials: "include",
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.code ?? "BRIDGE_UNAVAILABLE");
  return result;
}
export async function dispatchNative(response: {
  envelope?: Envelope | null;
  job?: unknown;
  result?: unknown;
}) {
  if (!response.envelope) return response;
  const command = JSON.parse(atob(response.envelope.bodyBase64)) as {
    command: "printReceipt" | "printTest" | "openDrawer";
  };
  const signedResult = await nativeCall(command.command, response.envelope);
  return hardwareRequest("results", signedResult);
}

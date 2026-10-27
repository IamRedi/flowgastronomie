"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dictionary } from "../../../../lib/dictionaries";
import {
  dispatchNative,
  hardwareRequest,
  nativeAvailable,
  nativeCall,
} from "../../../../lib/hardware-bridge";
type Device = {
  id: string;
  displayName: string;
  mode: string;
  autoPrint: boolean;
  autoDrawer: boolean;
  capabilities: {
    printerAvailable: boolean;
    drawerAvailable: boolean;
    paperWidth: number | null;
  };
};
export function HardwareSettings({
  labels,
}: {
  labels: Dictionary["hardware"];
}) {
  const [device, setDevice] = useState<Device | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canDrawer, setCanDrawer] = useState(false);
  const [simulator, setSimulator] = useState(false);
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("Counter 1");
  const [reason, setReason] = useState("");
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const body = await hardwareRequest("devices");
    setDevice(body.devices[0] ?? null);
    setCanManage(body.canManage);
    setCanDrawer(body.canDrawer);
    setSimulator(body.simulatorEnabled);
    setNative(nativeAvailable());
  }, []);
  useEffect(() => {
    void load().catch(() => setMessage(labels.unavailable));
  }, [load, labels.unavailable]);
  async function action(run: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = (await run()) as {
        result?: { success: boolean; errorCode: string };
      };
      setMessage(
        result?.result?.success === false
          ? result.result.errorCode
          : labels.done,
      );
      await load();
    } catch (failure) {
      setMessage(
        failure instanceof Error ? failure.message : labels.unavailable,
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function configure(autoPrint: boolean, autoDrawer: boolean) {
    if (!device) return;
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1/staff/hardware/devices/${device.id}`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: true, autoPrint, autoDrawer }),
      },
    );
    if (!response.ok) throw new Error((await response.json()).code);
    return response.json();
  }
  function toggle(field: "autoPrint" | "autoDrawer", checked: boolean) {
    if (!device || inFlight.current) return;
    const previous = device;
    const updated = { ...device, [field]: checked };
    setDevice(updated);
    void action(async () => {
      try {
        return await configure(updated.autoPrint, updated.autoDrawer);
      } catch (error) {
        setDevice(previous);
        throw error;
      }
    });
  }
  return (
    <section className="register-panel" aria-label={labels.settings}>
      <h2>{labels.settings}</h2>
      <p>
        {device
          ? `${device.displayName} · ${device.mode} · ${device.capabilities.paperWidth ?? "—"} mm`
          : labels.unpaired}
      </p>
      {canManage && (
        <>
          <label>
            {labels.name}
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {simulator && (
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() =>
                void action(() =>
                  hardwareRequest("pair", {
                    mode: "SIMULATOR",
                    displayName: name,
                  }),
                )
              }
            >
              {labels.pairSimulator}
            </button>
          )}
          {native && (
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() =>
                void action(async () => {
                  const local = (await nativeCall("capabilities")) as {
                    proof: unknown;
                  };
                  return hardwareRequest("pair", {
                    mode: "ANDROID",
                    displayName: name,
                    proof: local.proof,
                  });
                })
              }
            >
              {labels.pairAndroid}
            </button>
          )}
          {device && (
            <>
              <label>
                <input
                  type="checkbox"
                  disabled={busy || !device.capabilities.printerAvailable}
                  checked={device.autoPrint}
                  onChange={(event) =>
                    toggle("autoPrint", event.target.checked)
                  }
                />
                {labels.autoPrint}
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={busy || !device.capabilities.drawerAvailable}
                  checked={device.autoDrawer}
                  onChange={(event) =>
                    toggle("autoDrawer", event.target.checked)
                  }
                />
                {labels.autoDrawer}
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    dispatchNative(
                      await hardwareRequest("command", {
                        deviceId: device.id,
                        kind: "printTest",
                        key: crypto.randomUUID(),
                      }),
                    ),
                  )
                }
              >
                {labels.testPrinter}
              </button>
              {device.mode === "SIMULATOR" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      hardwareRequest(`simulator/${device.id}/diagnostics`, {
                        nextPrintFailure: "PAPER_OUT",
                      }),
                    )
                  }
                >
                  {labels.simulateFailure}
                </button>
              )}
            </>
          )}
        </>
      )}
      {canDrawer && device && (
        <>
          <label>
            {labels.reason}
            <input
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() =>
              void action(async () =>
                dispatchNative(
                  await hardwareRequest("command", {
                    deviceId: device.id,
                    kind: "openDrawer",
                    reason,
                    key: crypto.randomUUID(),
                  }),
                ),
              )
            }
          >
            {labels.manualDrawer}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FinalReceipt } from "@flowgastronomie/domain";
import type { Dictionary } from "../../../../lib/dictionaries";
import { pilotText } from "../../../../lib/pilot-copy";
import {
  dispatchNative,
  hardwareRequest,
} from "../../../../lib/hardware-bridge";
type Device = {
  id: string;
  displayName: string;
  autoPrint: boolean;
  autoDrawer: boolean;
  mode: string;
};
type Job = {
  commandId: string | null;
  id: string;
  status: string;
  attempts: number;
  lastErrorCode: string | null;
};
export function HardwareActions({
  receipt,
  automatic = false,
  labels,
  locale,
}: {
  receipt: FinalReceipt;
  automatic?: boolean;
  labels: Dictionary["hardware"];
  locale: string;
}) {
  const [device, setDevice] = useState<Device | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerError, setDrawerError] = useState(false);
  const started = useRef(false);
  const inFlight = useRef(false);
  const key = useRef(crypto.randomUUID());
  const print = useCallback(
    async (selected: Device, retryJob?: Job, auto = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      let pendingJob: Job | null = null;
      try {
        const queued: Job =
          retryJob ??
          (await hardwareRequest("jobs", {
            receiptId: receipt.id,
            deviceId: selected.id,
            key: auto ? `auto:${receipt.id}` : key.current,
          }));
        setJob(queued);
        const dispatched = await hardwareRequest(`jobs/${queued.id}/execute`, {
          retry: !!retryJob,
          confirmPossibleDuplicate:
            retryJob?.lastErrorCode === "UNKNOWN_RESULT" ||
            retryJob?.status === "PRINTING"
              ? window.confirm(labels.unknown)
              : false,
        });
        pendingJob = dispatched.job as Job;
        setJob(pendingJob);
        const response = await dispatchNative(dispatched);
        setJob(response.job as Job);
        if ((response.job as Job)?.status === "PRINTED")
          key.current = crypto.randomUUID();
      } catch (failure) {
        if (pendingJob?.status === "PRINTING" && pendingJob.commandId) {
          try {
            setJob(
              (await hardwareRequest(`jobs/${pendingJob.id}/uncertain`, {
                commandId: pendingJob.commandId,
              })) as Job,
            );
          } catch {
            /* Scoped ledger remains available for later recovery. */
          }
        }
        setError(
          failure instanceof Error ? failure.message : "BRIDGE_UNAVAILABLE",
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [receipt.id, labels.unknown],
  );
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const body = await hardwareRequest("devices");
      if (cancelled) return;
      const selected = body.devices[0] as Device | undefined;
      setDevice(selected ?? null);
      const history = (await hardwareRequest(
        `receipts/${receipt.id}/jobs`,
      )) as Job[];
      if (cancelled) return;
      setJob(history[0] ?? null);
      if (!automatic || !selected || started.current) return;
      started.current = true;
      if (selected.autoDrawer && receipt.method === "CASH") {
        try {
          const result = await dispatchNative(
            await hardwareRequest("command", {
              deviceId: selected.id,
              kind: "openDrawer",
              receiptId: receipt.id,
              key: `cash:${receipt.id}`,
            }),
          );
          if ((result.result as { success?: boolean })?.success === false)
            setDrawerError(true);
        } catch {
          setDrawerError(true);
        }
      }
      if (selected.autoPrint) await print(selected, undefined, true);
    }
    void load().catch(() => {
      if (!cancelled) setError("BRIDGE_UNAVAILABLE");
    });
    return () => {
      cancelled = true;
    };
  }, [automatic, receipt.id, receipt.method, print]);
  return (
    <section className="counter-payment" aria-label={labels.receiptPrinting}>
      {device ? (
        <p>
          {device.displayName}
          {device.mode === "SIMULATOR" && ` · ${labels.simulator}`}
        </p>
      ) : (
        <p>
          {labels.unpaired}. {pilotText(locale).printerError}
        </p>
      )}
      {drawerError && <p role="alert">{labels.drawerFailed}</p>}
      {job && (
        <p role="status" data-testid="print-job-status">
          {labels.status}: {job.status} · {labels.attempts}: {job.attempts}
        </p>
      )}
      {(job?.status === "FAILED" || error) && (
        <p role="alert">
          {labels.paymentRecorded} {pilotText(locale).printerError}
        </p>
      )}
      <button
        type="button"
        disabled={!device || busy}
        onClick={() => {
          if (device)
            void print(
              device,
              job?.status === "FAILED" || job?.status === "PRINTING"
                ? job
                : undefined,
            );
        }}
      >
        {job?.status === "FAILED" || job?.status === "PRINTING"
          ? labels.retry
          : job?.status === "PRINTED"
            ? labels.reprint
            : labels.print}
      </button>
    </section>
  );
}

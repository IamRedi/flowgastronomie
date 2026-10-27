"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OnlineOrderPublicStatus } from "@flowgastronomie/domain";
import { PilotDialog } from "../app/[lang]/staff/pilot-dialog";
import type { Locale } from "../lib/i18n";
import { orderingUxCopy } from "../lib/ordering-ux-copy";
import { onlineOrderStatusLabels } from "../lib/online-order-copy";
import { formatVenueTime } from "../lib/venue-time";
import { recentOrder, type RecentOrder } from "../lib/recent-order";
import "./online-ordering.css";

export function TrackOrderEntry({
  locale,
  publicSlug,
  recentOnly = false,
}: {
  locale: Locale;
  publicSlug: string;
  recentOnly?: boolean;
}) {
  const text = orderingUxCopy[locale];
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentOrder | null>(null);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    setRecent(recentOrder(publicSlug));
  }, [publicSlug]);
  if (recentOnly && !recent) return null;
  return (
    <>
      <button
        type="button"
        className="track-order-entry"
        onClick={() => {
          setRecent(recentOrder(publicSlug));
          setManual(false);
          setOpen(true);
        }}
      >
        {text.track}
      </button>
      {open && (
        <PilotDialog
          title={text.track}
          closeLabel={text.close}
          onClose={() => setOpen(false)}
          className="pickup-slot-overlay"
        >
          <div className="pickup-picker order-recovery">
            {recent && !manual ? (
              <>
                <p>
                  {text.recent} <strong>{recent.referenceCode}</strong>
                </p>
                <a
                  className="ordering-primary"
                  href={recent.destination.replace(
                    /^\/(sq|de|it|en)\//,
                    `/${locale}/`,
                  )}
                >
                  {text.continue}
                </a>
                <button type="button" onClick={() => setManual(true)}>
                  {text.otherOrder}
                </button>
              </>
            ) : (
              <PublicOrderStatusLookup
                key={`${locale}:${publicSlug}`}
                locale={locale}
                publicSlug={publicSlug}
              />
            )}
          </div>
        </PilotDialog>
      )}
    </>
  );
}

function PublicOrderStatusLookup({
  locale,
  publicSlug,
}: {
  locale: Locale;
  publicSlug: string;
}) {
  const text = orderingUxCopy[locale];
  const [order, setOrder] = useState<OnlineOrderPublicStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"missing" | "limited" | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const referenceCode = new FormData(event.currentTarget).get(
      "referenceCode",
    );
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);
    setOrder(null);
    try {
      const api =
        process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
        "http://localhost:4000";
      const response = await fetch(
        `${api}/v1/public/online-orders/${encodeURIComponent(publicSlug)}/status`,
        {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ referenceCode }),
          signal: controller.signal,
        },
      );
      if (response.status === 429) {
        setError("limited");
        return;
      }
      if (!response.ok) throw new Error();
      setOrder((await response.json()) as OnlineOrderPublicStatus);
    } catch {
      if (!controller.signal.aborted) setError("missing");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <form onSubmit={(event) => void lookup(event)} aria-busy={busy}>
      <p>{text.publicStatusHelp}</p>
      <label>
        {text.reference}
        <input
          name="referenceCode"
          required
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          disabled={busy}
          onChange={() => {
            setOrder(null);
            setError(null);
          }}
        />
      </label>
      {error && (
        <p role="alert">
          {error === "limited"
            ? text.publicStatusLimited
            : text.publicStatusFailed}
        </p>
      )}
      {order && (
        <div
          className="public-order-status"
          role="status"
          data-state={order.status}
        >
          <strong>{onlineOrderStatusLabels[locale][order.status]}</strong>
          <p>
            {order.timingMode === "ASAP" ? (
              text.asapConfirmation
            ) : (
              <>
                {text.requested}:{" "}
                {order.requestedFor && (
                  <time dateTime={order.requestedFor}>
                    {formatVenueTime(
                      locale,
                      order.requestedFor,
                      order.venue.timezone,
                    )}
                  </time>
                )}
              </>
            )}
          </p>
          {order.timingMode !== "ASAP" && <small>{text.venueTime}</small>}
        </div>
      )}
      <button className="ordering-primary" type="submit" disabled={busy}>
        {busy ? text.loading : order ? text.publicStatusRefresh : text.lookup}
      </button>
    </form>
  );
}

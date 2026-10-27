"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Locale } from "../../../../../lib/i18n";
import { reservationRequestCopy } from "../../../../../lib/reservation-copy";
export function ReservationRequestForm({
  locale,
  publicSlug,
}: {
  locale: Locale;
  publicSlug: string;
}) {
  const labels = reservationRequestCopy[locale];
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [message, setMessage] = useState("");
  const [businessPhone, setBusinessPhone] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  useEffect(() => {
    void fetch(
      `${apiUrl}/v1/public/websites/${encodeURIComponent(publicSlug)}?locale=${locale}`,
    )
      .then(async (response) =>
        response.ok
          ? (response.json() as Promise<{
              contact?: { phone?: string | null };
            }>)
          : null,
      )
      .then((website) => setBusinessPhone(website?.contact?.phone ?? null));
  }, [apiUrl, locale, publicSlug]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await fetch(
      `${apiUrl}/v1/public/reservations/${encodeURIComponent(publicSlug)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          guestName: f.get("name"),
          phone: f.get("phone"),
          email: f.get("email") || null,
          locale,
          requestedFor: new Date(String(f.get("requestedFor"))).toISOString(),
          partySize: Number(f.get("partySize")),
          guestNotes: f.get("notes") || null,
        }),
      },
    );
    if (!r.ok) return setMessage(labels.error);
    form.reset();
    idempotencyKey.current = crypto.randomUUID();
    setMessage(labels.submitted);
  }
  return (
    <main className="reservation-request">
      <a href={`/${locale}/venue/${publicSlug}`}>{labels.back}</a>
      <h1>{labels.title}</h1>
      <form onSubmit={submit}>
        <label>
          {labels.name}
          <input name="name" required />
        </label>
        <label>
          {labels.phone}
          <input name="phone" required type="tel" />
        </label>
        <label>
          {labels.email}
          <input name="email" type="email" />
        </label>
        <label>
          {labels.requestedFor}
          <input name="requestedFor" required type="datetime-local" />
        </label>
        <label>
          {labels.partySize}
          <input min="1" name="partySize" required type="number" />
        </label>
        <label>
          {labels.notes}
          <textarea name="notes" />
        </label>
        <button type="submit">{labels.submit}</button>
      </form>
      {businessPhone && (
        <a
          className="reservation-whatsapp"
          href={`https://wa.me/${businessPhone.replace(/\D/g, "")}`}
          rel="noreferrer"
          target="_blank"
        >
          {labels.whatsapp}
        </a>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}

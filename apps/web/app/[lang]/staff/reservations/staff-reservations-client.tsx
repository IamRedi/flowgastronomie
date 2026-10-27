"use client";
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../lib/i18n";
import { reservationSettingsCopy } from "../../../../lib/reservation-copy";
type Reservation = {
  id: string;
  status:
    | "REQUESTED"
    | "CONFIRMED"
    | "SEATED"
    | "COMPLETED"
    | "REJECTED"
    | "CANCELLED"
    | "NO_SHOW";
  guestName: string;
  phone: string;
  requestedFor: string;
  partySize: number;
  guestNotes: string | null;
  table: { label: string } | null;
};
type VenueTable = { id: string; label: string };
const copy = {
  en: [
    "Reservations",
    "No reservations for this day.",
    "Confirm",
    "Reject",
    "Seat",
    "Complete",
    "No show",
    "Could not save the change.",
  ],
  de: [
    "Reservierungen",
    "Keine Reservierungen für diesen Tag.",
    "Bestätigen",
    "Ablehnen",
    "Platzieren",
    "Abschließen",
    "Nicht erschienen",
    "Änderung konnte nicht gespeichert werden.",
  ],
  it: [
    "Prenotazioni",
    "Nessuna prenotazione per questo giorno.",
    "Conferma",
    "Rifiuta",
    "Accomoda",
    "Completa",
    "No-show",
    "Impossibile salvare la modifica.",
  ],
  sq: [
    "Rezervimet",
    "Nuk ka rezervime për këtë ditë.",
    "Konfirmo",
    "Refuzo",
    "Ule",
    "Përfundo",
    "Nuk u paraqit",
    "Ndryshimi nuk u ruajt.",
  ],
} as const;
export function StaffReservationsClient({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const settingsLabels = reservationSettingsCopy[locale];
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ??
    "http://localhost:4000";
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<VenueTable[]>([]);
  const [tableChoices, setTableChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [canManage, setCanManage] = useState(false);
  const load = useCallback(async () => {
    const [r, setup, identity] = await Promise.all([
      fetch(`${apiUrl}/v1/staff/reservations?date=${date}`, {
        credentials: "include",
      }),
      fetch(`${apiUrl}/v1/staff/setup`, { credentials: "include" }),
      fetch(`${apiUrl}/v1/staff/me`, { credentials: "include" }),
    ]);
    if (r.status === 401)
      return window.location.assign(`/${locale}/staff/login`);
    if (!r.ok) return setError(t[7]);
    setItems((await r.json()) as Reservation[]);
    if (setup.ok)
      setTables(((await setup.json()) as { tables: VenueTable[] }).tables);
    if (identity.ok) {
      const { staff } = (await identity.json()) as {
        staff: { role: "OWNER" | "MANAGER" | "WAITER" | "BAR" | "KITCHEN" };
      };
      setCanManage(["OWNER", "MANAGER"].includes(staff.role));
    }
  }, [apiUrl, date, locale, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function change(id: string, status: Reservation["status"]) {
    const r = await fetch(`${apiUrl}/v1/staff/reservations/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, tableId: tableChoices[id] || null }),
    });
    if (!r.ok) return setError(t[7]);
    await load();
  }
  const actions: Partial<
    Record<Reservation["status"], Array<[Reservation["status"], string]>>
  > = {
    REQUESTED: [
      ["CONFIRMED", t[2]],
      ["REJECTED", t[3]],
    ],
    CONFIRMED: [
      ["SEATED", t[4]],
      ["NO_SHOW", t[6]],
    ],
    SEATED: [["COMPLETED", t[5]]],
  };
  return (
    <main className="reservations-page">
      <header className="menu-admin-header shell">
        <a className="brand" href={`/${locale}/staff/radar`}>
          <span className="brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
      </header>
      <section className="schedule-intro shell">
        <h1>{t[0]}</h1>
        {canManage && (
          <a href={`/app/${locale}/reservations/settings`}>
            {settingsLabels.title}
          </a>
        )}
        <input
          onChange={(e) => setDate(e.target.value)}
          type="date"
          value={date}
        />
      </section>
      <section className="reservations-list shell">
        {error && <p role="alert">{error}</p>}
        {items.length === 0 ? (
          <p>{t[1]}</p>
        ) : (
          items.map((item) => (
            <article key={item.id}>
              <div>
                <strong>
                  {new Date(item.requestedFor).toLocaleTimeString(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {item.partySize}
                </strong>
                <h2>{item.guestName}</h2>
                <p>
                  {item.phone}
                  {item.table ? ` · ${item.table.label}` : ""}
                </p>
                {item.guestNotes && <small>{item.guestNotes}</small>}
              </div>
              <div>
                {item.status === "REQUESTED" && (
                  <label>
                    Table
                    <select
                      onChange={(event) =>
                        setTableChoices({
                          ...tableChoices,
                          [item.id]: event.target.value,
                        })
                      }
                      value={tableChoices[item.id] ?? ""}
                    >
                      <option value="">Assign later</option>
                      {tables.map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {actions[item.status]?.map(([status, label]) => (
                  <button
                    key={status}
                    onClick={() => void change(item.id, status)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
                <a
                  className="reservation-whatsapp"
                  href={`https://wa.me/${item.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hello ${item.guestName}, regarding your reservation at ${new Date(item.requestedFor).toLocaleString(locale)}: `)}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  WhatsApp
                </a>
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}

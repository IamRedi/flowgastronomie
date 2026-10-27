"use client";
import { useEffect, useState } from "react";
import type { Locale } from "../lib/i18n";
export function WebsiteDraftHistory({
  locale,
  updatedAt,
  onRestored,
}: {
  locale: Locale;
  updatedAt: string | undefined;
  onRestored: () => void;
}) {
  const copy = {
    en: [
      "Restore an earlier draft",
      "Choose a saved revision",
      "Restore",
      "I confirm replacing website text and style with this revision. Menu and original photos are preserved.",
      "Could not restore. Reload and try again.",
      "Restoring…",
    ],
    de: [
      "Früheren Entwurf wiederherstellen",
      "Gespeicherte Revision wählen",
      "Wiederherstellen",
      "Ich bestätige das Wiederherstellen von Text und Stil. Speisekarte und Originalfotos bleiben erhalten.",
      "Wiederherstellung fehlgeschlagen. Neu laden und erneut versuchen.",
      "Wird wiederhergestellt…",
    ],
    it: [
      "Ripristina una bozza precedente",
      "Scegli una revisione salvata",
      "Ripristina",
      "Confermo il ripristino di testi e stile. Menu e foto originali restano invariati.",
      "Ripristino non riuscito. Ricarica e riprova.",
      "Ripristino…",
    ],
    sq: [
      "Rikthe një draft të mëparshëm",
      "Zgjidh një version të ruajtur",
      "Rikthe",
      "Konfirmoj rikthimin e teksteve dhe stilit. Menuja dhe fotot origjinale ruhen.",
      "Rikthimi dështoi. Ringarko dhe provo përsëri.",
      "Duke rikthyer…",
    ],
  }[locale];
  const [rows, setRows] = useState<{ id: string; createdAt: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState(false);
  const api = (
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  ).replace(/\/$/, "");
  useEffect(() => {
    let active = true;
    fetch(`${api}/v1/staff/website-history`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (active) setRows(data);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [api, updatedAt]);
  return (
    <details className="website-draft-history">
      <summary>{copy[0]}</summary>
      {restored && (
        <p role="status">
          {
            {
              en: "Draft restored.",
              de: "Entwurf wiederhergestellt.",
              it: "Bozza ripristinata.",
              sq: "Drafti u rikthye.",
            }[locale]
          }
        </p>
      )}
      <label>
        {copy[1]}
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setConfirmed(false);
          }}
          disabled={busy}
        >
          <option value="">—</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.createdAt).toLocaleString(locale)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={busy}
        />
        {copy[3]}
      </label>
      {error && <p role="alert">{copy[4]}</p>}
      <button
        type="button"
        disabled={busy || !selected || !confirmed || !updatedAt}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            const res = await fetch(`${api}/v1/staff/website-history/revert`, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                revisionId: selected,
                expectedUpdatedAt: updatedAt,
                confirmed: true,
              }),
            });
            if (!res.ok) throw new Error();
            setSelected("");
            setConfirmed(false);
            setRestored(true);
            onRestored();
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? copy[5] : copy[2]}
      </button>
    </details>
  );
}

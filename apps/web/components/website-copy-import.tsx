"use client";
import { useEffect, useState } from "react";
import type { Locale } from "../lib/i18n";
export function WebsiteCopyImport({
  locale,
  onSaved,
}: {
  locale: Locale;
  onSaved: () => void;
}) {
  const words = {
    en: [
      "Import website text",
      "Public HTTPS website",
      "I own this website or have permission to import its text.",
      "Read website",
      "Unverified proposal · review both fields",
      "Website title",
      "Short description",
      "Save these reviewed fields as draft",
      "I approve these changes in the selected language. Nothing will be published.",
      "Could not complete this request. Check permissions and reload before trying again.",
      "Working…",
      "Only the page title and description are proposed. Contact details, hours, prices and images require manual review and entry.",
      "Current → proposed",
    ],
    de: [
      "Website-Text importieren",
      "Öffentliche HTTPS-Website",
      "Ich besitze diese Website oder darf ihre Texte importieren.",
      "Website lesen",
      "Ungeprüfter Vorschlag · beide Felder prüfen",
      "Website-Titel",
      "Kurzbeschreibung",
      "Geprüfte Felder als Entwurf speichern",
      "Ich bestätige die Änderungen in der gewählten Sprache. Es wird nichts veröffentlicht.",
      "Anfrage fehlgeschlagen. Berechtigungen prüfen und neu laden.",
      "Wird bearbeitet…",
      "Nur Seitentitel und Beschreibung werden vorgeschlagen. Kontakt, Zeiten, Preise und Bilder müssen manuell geprüft und eingetragen werden.",
      "Aktuell → Vorschlag",
    ],
    it: [
      "Importa testi dal sito",
      "Sito HTTPS pubblico",
      "Possiedo questo sito o ho il permesso di importarne i testi.",
      "Leggi il sito",
      "Proposta non verificata · controlla entrambi i campi",
      "Titolo del sito",
      "Breve descrizione",
      "Salva i campi verificati come bozza",
      "Approvo le modifiche nella lingua selezionata. Nulla verrà pubblicato.",
      "Richiesta non riuscita. Verifica i permessi e ricarica.",
      "Elaborazione…",
      "Vengono proposti solo titolo e descrizione. Contatti, orari, prezzi e immagini richiedono verifica e inserimento manuali.",
      "Attuale → proposta",
    ],
    sq: [
      "Importo tekstin e website-it",
      "Website publik HTTPS",
      "Jam pronar i këtij website-i ose kam leje të importoj tekstet.",
      "Lexo website-in",
      "Propozim i paverifikuar · kontrollo të dyja fushat",
      "Titulli i website-it",
      "Përshkrimi i shkurtër",
      "Ruaji fushat e miratuara si draft",
      "Miratoj ndryshimet në gjuhën e zgjedhur. Asgjë nuk publikohet.",
      "Kërkesa dështoi. Kontrollo lejet dhe ringarko faqen.",
      "Duke punuar…",
      "Propozohen vetëm titulli dhe përshkrimi. Kontaktet, orari, çmimet dhe fotot kërkojnë kontroll dhe plotësim manual.",
      "Aktual → propozim",
    ],
  }[locale];
  const aiWords = {
    en: [
      "AI copy assistant",
      "Describe your change",
      "Propose changes",
      "AI is not configured. You can edit all fields manually.",
    ],
    de: [
      "KI-Textassistent",
      "Änderung beschreiben",
      "Änderungen vorschlagen",
      "KI ist nicht eingerichtet. Alle Felder bleiben manuell bearbeitbar.",
    ],
    it: [
      "Assistente testi IA",
      "Descrivi la modifica",
      "Proponi modifiche",
      "IA non configurata. Puoi modificare tutti i campi manualmente.",
    ],
    sq: [
      "Asistent AI për tekstet",
      "Përshkruaj ndryshimin",
      "Propozo ndryshimet",
      "AI nuk është konfiguruar. Mund të ndryshosh çdo fushë manualisht.",
    ],
  }[locale];
  const [aiEnabled, setAiEnabled] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [url, setUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [approved, setApproved] = useState(false);
  type Snapshot = {
    status: string;
    updatedAt: string;
    translations: { locale: string; heroTitle: string; heroSubtitle: string }[];
    [key: string]: unknown;
  };
  const [proposal, setProposal] = useState<{
    id: string;
    sourceUrl: string;
    title: string;
    description: string;
    snapshot: Snapshot;
  } | null>(null);
  const api = (
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  ).replace(/\/$/, "");
  useEffect(() => {
    let active = true;
    fetch(`${api}/v1/staff/website-ai/capabilities`, { credentials: "include" })
      .then(async (r) => {
        if (r.ok) {
          const c = await r.json();
          if (active) setAiEnabled(c.enabled === true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);
  async function call(path: string, body?: unknown) {
    const res = await fetch(`${api}${path}`, {
      credentials: "include",
      ...(body
        ? {
            method: path.includes("/propose") ? "POST" : "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    if (!res.ok) throw new Error();
    return res.json();
  }
  return (
    <details className="website-copy-import">
      <summary>
        {words[0]} / {aiWords[0]}
      </summary>
      <section>
        <h3>{aiWords[0]}</h3>
        {aiEnabled ? (
          <>
            <label>
              {aiWords[1]}
              <textarea
                maxLength={1000}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled={busy}
              />
            </label>
            <button
              type="button"
              disabled={busy || instruction.trim().length < 3}
              onClick={async () => {
                setBusy(true);
                setError(false);
                setApproved(false);
                try {
                  const snapshot = (await call(
                    "/v1/workspace/website",
                  )) as Snapshot;
                  if (snapshot.status !== "DRAFT") throw new Error();
                  const value = await call("/v1/staff/website-ai/propose", {
                    instruction,
                    locale,
                    expectedUpdatedAt: snapshot.updatedAt,
                    requestKey: crypto.randomUUID(),
                  });
                  setProposal({
                    ...value,
                    sourceUrl: "AI · " + aiWords[0],
                    snapshot,
                  });
                } catch {
                  setError(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? words[10] : aiWords[2]}
            </button>
          </>
        ) : (
          <p>{aiWords[3]}</p>
        )}
      </section>
      <p>{words[11]}</p>
      <label>
        {words[1]}
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setProposal(null);
            setAuthorized(false);
          }}
          maxLength={2048}
          placeholder="https://example.com"
          disabled={busy}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={authorized}
          onChange={(e) => setAuthorized(e.target.checked)}
          disabled={busy}
        />
        {words[2]}
      </label>
      <button
        type="button"
        disabled={!url || !authorized || busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          setApproved(false);
          try {
            const snapshot = (await call("/v1/workspace/website")) as Snapshot;
            if (snapshot.status !== "DRAFT") throw new Error();
            const value = await call("/v1/staff/website-import/propose", {
              url,
              authorized: true,
            });
            setProposal({ ...value, snapshot });
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? words[10] : words[3]}
      </button>
      {error && <p role="alert">{words[9]}</p>}
      {proposal && (
        <section>
          <h3>{words[4]}</h3>
          <p>{proposal.sourceUrl}</p>
          <p>{words[12]}</p>
          <blockquote>
            {
              proposal.snapshot.translations.find((t) => t.locale === locale)
                ?.heroTitle
            }
            <br />
            {
              proposal.snapshot.translations.find((t) => t.locale === locale)
                ?.heroSubtitle
            }
          </blockquote>
          <label>
            {words[5]}
            <input
              maxLength={120}
              value={proposal.title}
              onChange={(e) => {
                setProposal({ ...proposal, title: e.target.value });
                setApproved(false);
              }}
            />
          </label>
          <label>
            {words[6]}
            <textarea
              maxLength={280}
              value={proposal.description}
              onChange={(e) => {
                setProposal({ ...proposal, description: e.target.value });
                setApproved(false);
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            {words[8]}
          </label>
          <button
            type="button"
            disabled={busy || !approved || !proposal.title}
            onClick={async () => {
              setBusy(true);
              setError(false);
              try {
                await call("/v1/workspace/website", {
                  ...proposal.snapshot,
                  sourceProposalId: proposal.id,
                  expectedUpdatedAt: proposal.snapshot.updatedAt,
                  translations: proposal.snapshot.translations.map((t) =>
                    t.locale === locale
                      ? {
                          ...t,
                          heroTitle: proposal.title,
                          heroSubtitle: proposal.description,
                        }
                      : t,
                  ),
                });
                setProposal(null);
                onSaved();
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? words[10] : words[7]}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setProposal(null);
              setApproved(false);
              setError(false);
            }}
          >
            {
              {
                en: "Cancel proposal",
                de: "Vorschlag verwerfen",
                it: "Annulla proposta",
                sq: "Anulo propozimin",
              }[locale]
            }
          </button>
        </section>
      )}
    </details>
  );
}

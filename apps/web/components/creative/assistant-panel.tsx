"use client";
import { useEffect, useState } from "react";
import type { DesignDocument } from "@flowgastronomie/domain";
import { studioRequest } from "./api";
import { AiTextActions } from "../ai-text-actions";
export function AssistantPanel({
  projectId,
  locale,
  selected,
  prepare,
  accept,
}: {
  projectId: string;
  locale: DesignDocument["locale"];
  selected: string[];
  prepare: () => Promise<number | null>;
  accept: (document: DesignDocument, version: number) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState("PATCH");
  const [quality, setQuality] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(false);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [proposal, setProposal] = useState<{
    id: string;
    summary: string;
    baseVersion: number;
  } | null>(null);
  const [messages, setMessages] = useState<
    { id: string; message: string; summary: string }[]
  >([]);
  useEffect(() => {
    void Promise.all([
      studioRequest<{ planner: boolean }>("/capabilities"),
      studioRequest<{ products: typeof products }>(`/sources?locale=${locale}`),
      studioRequest<typeof messages>(`/projects/${projectId}/conversation`),
    ])
      .then(([capabilities, sources, history]) => {
        setConfigured(capabilities.planner);
        setProducts(sources.products);
        setMessages(history);
      })
      .catch((e) => setError(e.message));
  }, [projectId, locale]);
  return (
    <details className="cs-assistant">
      <summary>✦ Design assistant</summary>
      <div className="cs-export-body">
        <p>
          Describe a layout change. Review the suggestion before applying it.
        </p>
        {!configured && (
          <p className="cs-muted">
            AI is not configured. The manual editor and export are available.
          </p>
        )}
        <label>
          Request
          <textarea
            placeholder="Make this more minimal, keep the product and price."
            value={instruction}
            maxLength={2000}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        <div className="cs-row">
          <AiTextActions
            locale={locale}
            disabled={!configured || busy || selected.length === 0}
            onAction={(action) => {
              setMode("PATCH");
              setInstruction(
                `${action} the selected editable text in ${locale}. Preserve verified facts, canonical bindings and all other layers.`,
              );
            }}
          />
          <label>
            Action
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="PATCH">Edit current design</option>
              <option value="PLAN">Create a new composition</option>
            </select>
          </label>
          <label>
            Selected products
            <select
              multiple
              value={productIds}
              onChange={(e) =>
                setProductIds(
                  Array.from(e.target.selectedOptions, (o) => o.value),
                )
              }
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            checked={quality}
            onChange={(e) => setQuality(e.target.checked)}
          />
          Use the quality model (higher cost)
        </label>
        <small>
          New AI copy uses approved phrases. Enter custom claims or campaign
          wording manually.{" "}
          {selected.length
            ? `${selected.length} selected layers will be edited.`
            : "All unlocked layers may be edited."}
        </small>
        <button
          disabled={!configured || busy || !instruction.trim()}
          onClick={async () => {
            setBusy(true);
            setError("");
            setProposal(null);
            try {
              const version = await prepare();
              if (version === null)
                throw new Error("Save the design before requesting an edit.");
              const result = await studioRequest<typeof proposal>(
                `/projects/${projectId}/ai`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    instruction,
                    mode,
                    quality,
                    productIds,
                    selectedLayerIds: mode === "PATCH" ? selected : [],
                    expectedVersion: version,
                    requestKey: crypto.randomUUID(),
                  }),
                },
              );
              setProposal(result);
              setMessages(
                await studioRequest(`/projects/${projectId}/conversation`),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Planning…" : "Suggest a design"}
        </button>
        {error && (
          <p role="alert" className="cs-error">
            {error}
          </p>
        )}
        {proposal && (
          <div className="cs-proposal">
            <h3>Suggestion</h3>
            <p>{proposal.summary}</p>
            <button
              className="cs-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const version = await prepare();
                  if (version !== proposal.baseVersion)
                    throw new Error(
                      "Your design changed. Request a new suggestion.",
                    );
                  const result = await studioRequest<{
                    document: DesignDocument;
                    version: number;
                  }>(`/projects/${projectId}/ai/accept`, {
                    method: "POST",
                    body: JSON.stringify({
                      conversationId: proposal.id,
                      expectedVersion: version,
                    }),
                  });
                  accept(result.document, result.version);
                  setProposal(null);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Apply suggestion
            </button>
            <button onClick={() => setProposal(null)}>Discard</button>
          </div>
        )}
        <details>
          <summary>Conversation</summary>
          {messages.map((m) => (
            <article key={m.id}>
              <p>
                <strong>You:</strong> {m.message}
              </p>
              <p>{m.summary}</p>
            </article>
          ))}
        </details>
      </div>
    </details>
  );
}

"use client";
import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  documentTranslations,
  legacyWebsiteDocument,
  websiteDocumentSchema,
} from "@flowgastronomie/domain";
import type { WebsiteEditor } from "../app/app/[lang]/website/website-editor-client";
export type WebsiteDraft = WebsiteEditor & {
  document: NonNullable<WebsiteEditor["document"]>;
};
export function websiteDraftValue(value: WebsiteEditor) {
  const {
    id,
    venueId,
    venueName,
    businessProfileId,
    updatedAt,
    publishedAt,
    status,
    ...content
  } = value;
  return {
    ...content,
    translations: value.document
      ? documentTranslations(value.document, value.translations)
      : value.translations,
  };
}
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const same = (a: WebsiteEditor, b: WebsiteEditor) =>
  stable(websiteDraftValue(a)) === stable(websiteDraftValue(b));
const draftOf = (value: WebsiteEditor): WebsiteDraft => ({
  ...value,
  document: value.document ?? legacyWebsiteDocument(value.translations),
});
export function useWebsiteDraft(
  website: WebsiteEditor,
  api: string,
  onSaved: (v: WebsiteEditor) => void,
  paused: boolean,
) {
  const [draft, render] = useState<WebsiteDraft>(() => draftOf(website));
  const current = useRef(draft),
    base = useRef(website),
    sequence = useRef(0),
    task = useRef<Promise<WebsiteDraft> | null>(null);
  const [dirty, setDirty] = useState(false),
    [status, setStatus] = useState<
      "saved" | "pending" | "saving" | "offline" | "conflict"
    >("saved");
  const [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false),
    [historyTick, tick] = useState(0);
  const undo = useRef<WebsiteDraft[]>([]),
    redo = useRef<WebsiteDraft[]>([]);
  const key = `website-draft-v2:${website.venueId}`;
  function persist(value: WebsiteDraft) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          baseUpdatedAt: base.current.updatedAt,
          value,
        }),
      );
    } catch {
      /* Server save still works if browser storage is unavailable. */
    }
  }
  function setDraft(change: SetStateAction<WebsiteDraft>) {
    const next =
      typeof change === "function" ? change(current.current) : change;
    if (same(next, current.current)) return;
    undo.current = [...undo.current.slice(-29), current.current];
    redo.current = [];
    current.current = next;
    sequence.current++;
    render(next);
    setDirty(true);
    setStatus((s) => (s === "conflict" ? s : "pending"));
    persist(next);
    tick((n) => n + 1);
  }
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.version === 1 && cached.value?.venueId === website.venueId) {
          if (same(cached.value, website)) localStorage.removeItem(key);
          else {
            websiteDocumentSchema.parse(cached.value.document);
            base.current = { ...website, updatedAt: cached.baseUpdatedAt };
            current.current = draftOf(cached.value);
            render(current.current);
            setDirty(true);
            setStatus(
              cached.baseUpdatedAt === website.updatedAt
                ? "pending"
                : "conflict",
            );
          }
        }
      }
    } catch {
      /* Invalid local state is never submitted. */
    }
    setReady(true);
    const online = () => {
      setRetry((n) => n + 1);
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
    // Remount is scoped to the authenticated venue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    if (website.updatedAt === base.current.updatedAt) return;
    if (!dirty && !task.current) {
      base.current = website;
      current.current = draftOf(website);
      render(current.current);
      undo.current = [];
      redo.current = [];
      tick((n) => n + 1);
    }
    // Parent updates caused by our own save already match base.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [website, ready]);
  async function save(
    value?: WebsiteDraft,
    sourceProposalId?: string,
  ): Promise<WebsiteDraft> {
    if (task.current) await task.current;
    if (status === "conflict") throw Error("CONFLICT");
    if (value) setDraft(value);
    const sent = current.current,
      revision = sequence.current;
    setStatus("saving");
    const operation = (async () => {
      let saved: WebsiteEditor;
      try {
        const response = await fetch(`${api}/v1/workspace/website`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...websiteDraftValue(sent),
            expectedUpdatedAt: base.current.updatedAt,
            ...(sourceProposalId ? { sourceProposalId } : {}),
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
          throw Error(response.status === 409 ? "CONFLICT" : "SAVE_FAILED");
        saved = await response.json();
      } catch (error) {
        // The response may have been lost after commit. Compare the actual saved
        // content before offering retry; do not overwrite a concurrent editor.
        try {
          const response = await fetch(`${api}/v1/workspace/website`, {
            credentials: "include",
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw error;
          const actual = await response.json();
          if (!same(actual, sent)) {
            setStatus(
              actual.updatedAt !== base.current.updatedAt
                ? "conflict"
                : "offline",
            );
            throw error;
          }
          saved = actual;
        } catch (recovery) {
          setStatus((s) => (s === "conflict" ? s : "offline"));
          persist(current.current);
          throw recovery;
        }
      }
      base.current = saved;
      if (revision === sequence.current) {
        current.current = draftOf(saved);
        render(current.current);
        setDirty(false);
        setStatus("saved");
        try {
          localStorage.removeItem(key);
        } catch {}
      } else {
        current.current = { ...current.current, updatedAt: saved.updatedAt };
        render(current.current);
        persist(current.current);
        setStatus("pending");
      }
      onSaved(saved);
      return draftOf(saved);
    })();
    task.current = operation;
    try {
      return await operation;
    } finally {
      task.current = null;
    }
  }
  useEffect(() => {
    if (
      !ready ||
      !dirty ||
      paused ||
      status === "conflict" ||
      status === "offline" ||
      status === "saving"
    )
      return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
    // A single serialized writer owns the version; editing during a request stays queued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, paused, ready, status, retry]);
  useEffect(() => {
    if (retry) setStatus((s) => (s === "offline" ? "pending" : s));
  }, [retry]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function travel(direction: "undo" | "redo") {
    const source = direction === "undo" ? undo.current : redo.current,
      target = direction === "undo" ? redo.current : undo.current;
    const next = source.pop();
    if (!next) return;
    target.push(current.current);
    current.current = { ...next, updatedAt: base.current.updatedAt };
    sequence.current++;
    render(current.current);
    setDirty(true);
    setStatus((s) => (s === "conflict" ? s : "pending"));
    persist(current.current);
    tick((n) => n + 1);
  }
  async function resolveConflict(keepLocal: boolean) {
    const response = await fetch(`${api}/v1/workspace/website`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw Error();
    base.current = await response.json();
    if (keepLocal) {
      setStatus("pending");
      persist(current.current);
    } else {
      current.current = draftOf(base.current);
      render(current.current);
      setDirty(false);
      setStatus("saved");
      localStorage.removeItem(key);
    }
  }
  return {
    draft,
    setDraft,
    dirty,
    status,
    save,
    undo: () => travel("undo"),
    redo: () => travel("redo"),
    canUndo: historyTick >= 0 && undo.current.length > 0,
    canRedo: redo.current.length > 0,
    retry: () => setRetry((n) => n + 1),
    resolveConflict,
  };
}

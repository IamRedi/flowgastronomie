"use client";
import { useRef, useState } from "react";
import type { PlatformLocale } from "@flowgastronomie/domain";
import { entryCopy } from "./entry-copy";
import { businessImportCopy } from "./import-copy";
export function ImportEntry({
  locale,
  busy,
  start,
}: {
  locale: PlatformLocale;
  busy: boolean;
  start: (files: File[], url: string | null) => void;
}) {
  const e = entryCopy(locale),
    w = businessImportCopy(locale);
  const [files, setFiles] = useState<File[]>([]);
  const [website, setWebsite] = useState(false);
  const [url, setUrl] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const choose = (next: File[]) => {
    setFiles(next);
    setWebsite(false);
    setUrl("");
  };
  return (
    <form
      className="bi-panel bi-entry"
      onSubmit={(event) => {
        event.preventDefault();
        if (authorized && (files.length || url.trim()))
          start(files, website ? url.trim() : null);
      }}
    >
      <label
        className="bi-file-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy) choose(Array.from(event.dataTransfer.files));
        }}
      >
        <svg
          aria-hidden="true"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
        </svg>
        <strong>{e.files}</strong>
        <span>{e.drop}</span>
        <input
          ref={fileInput}
          aria-label={w.upload}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          multiple
          disabled={busy}
          onChange={(event) => choose(Array.from(event.target.files ?? []))}
        />
      </label>
      {files.length > 0 && (
        <ul className="bi-selected-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>{file.name}</li>
          ))}
        </ul>
      )}
      <button
        className="bi-website-choice"
        type="button"
        disabled={busy}
        aria-expanded={website}
        onClick={() => {
          setWebsite(!website);
          setFiles([]);
          setUrl("");
          if (fileInput.current) fileInput.current.value = "";
        }}
      >
        {e.website}
      </button>
      {website && (
        <label>
          {w.url}
          <input
            autoFocus
            type="url"
            placeholder="https://"
            value={url}
            maxLength={2048}
            required
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
      )}
      <label className="bi-check">
        <input
          type="checkbox"
          checked={authorized}
          onChange={(event) => setAuthorized(event.target.checked)}
          disabled={busy}
        />
        {w.authorize}
      </label>
      <button
        className="bi-primary"
        disabled={busy || !authorized || (!files.length && !url.trim())}
      >
        {w.analyze} →
      </button>
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { CanonicalMediaReference } from "@flowgastronomie/domain";
import type { Locale } from "../lib/i18n";
import { productPhotoCopy } from "./product-photo-copy";
import { ProductAiPhoto } from "./product-ai-photo";

export function ProductPhotoEditor({
  productId,
  target = "products",
  upload,
  name,
  category,
  locale,
  apiUrl,
  onClose,
  onSaved,
}: {
  productId: string;
  target?: "products" | "website-sections";
  upload?: (blob: Blob) => Promise<CanonicalMediaReference>;
  name: string;
  category: string;
  locale: Locale;
  apiUrl: string;
  onClose: () => void;
  onSaved: (media: CanonicalMediaReference) => void;
}) {
  const c = productPhotoCopy(locale, target);
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [source, setSource] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(
    null,
  );
  const [fit, setFit] = useState(false);
  const [camera, setCamera] = useState(false);
  const [ai, setAi] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const stopCamera = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      generation.current++;
      stopCamera();
    };
  }, []);
  useEffect(() => {
    if (camera && video.current && stream.current) {
      video.current.srcObject = stream.current;
      void video.current.play().catch(() => {
        stopCamera();
        setCamera(false);
        setError(c.cameraFallback);
      });
    }
  }, [camera, c.cameraFallback]);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    let url: string | undefined;
    setProcessing(true);
    setPreview(null);
    void (async () => {
      const bitmap = await createImageBitmap(source);
      try {
        if (bitmap.width * bitmap.height > 25_000_000) throw Error();
        const ratio = 4 / 3;
        const width = Math.min(1200, bitmap.width, Math.round(1200 * ratio));
        const height = Math.round(width / ratio);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#f7f4ee";
        ctx.fillRect(0, 0, width, height);
        const scale = (fit ? Math.min : Math.max)(
          width / bitmap.width,
          height / bitmap.height,
        );
        ctx.drawImage(
          bitmap,
          (width - bitmap.width * scale) / 2,
          (height - bitmap.height * scale) / 2,
          bitmap.width * scale,
          bitmap.height * scale,
        );
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(Error())),
            "image/webp",
            0.85,
          ),
        );
        if (blob.size > 5 * 1024 * 1024) throw Error();
        if (alive) {
          url = URL.createObjectURL(blob);
          setPreview({ blob, url });
        }
      } finally {
        bitmap.close();
      }
    })()
      .catch(() => {
        if (alive) setError(c.invalid);
      })
      .finally(() => {
        if (alive) setProcessing(false);
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, fit, c.invalid]);
  function select(file?: File) {
    if (!file) return;
    setError("");
    setAi(false);
    stopCamera();
    setCamera(false);
    if (
      !/^(image\/(jpeg|png|webp))$/.test(file.type) ||
      file.size > 10 * 1024 * 1024 ||
      !file.size
    ) {
      setSource(null);
      setPreview(null);
      setProcessing(false);
      setError(c.invalid);
      return;
    }
    setSource(file);
  }
  async function startCamera() {
    const current = ++generation.current;
    stopCamera();
    setCamera(false);
    setAi(false);
    setError("");
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
      });
      if (generation.current !== current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = next;
      setCamera(true);
    } catch {
      if (generation.current === current) {
        setError(c.cameraFallback);
        picker.current?.click();
      }
    }
  }
  async function capture() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    stopCamera();
    setCamera(false);
    if (blob) {
      setSource(blob);
      setError("");
    } else setError(c.cameraFallback);
  }
  async function save() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      if (upload) {
        onSaved(await upload(preview.blob));
        onClose();
        return;
      }
      const response = await fetch(
        `${apiUrl}/v1/workspace/products/${encodeURIComponent(productId)}/media?approved=true`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": preview.blob.type },
          body: preview.blob,
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw Error();
      onSaved((await response.json()) as CanonicalMediaReference);
      onClose();
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="product-photo-dialog"
      aria-labelledby="photo-title"
      onCancel={(event) => {
        // Cancelling the native file picker also bubbles a cancel event.
        // Only Escape on this dialog should dismiss the editor.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <span>{c.photo}</span>
          <h2 id="photo-title">{name}</h2>
        </div>
        <button
          type="button"
          aria-label={c.close}
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="photo-methods">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            generation.current++;
            stopCamera();
            setCamera(false);
            setAi(false);
            picker.current?.click();
          }}
        >
          {c.upload}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void startCamera()}
        >
          {c.camera}
        </button>
        <button
          type="button"
          aria-pressed={ai}
          disabled={busy}
          onClick={() => {
            generation.current++;
            stopCamera();
            setCamera(false);
            setAi(true);
          }}
        >
          {c.ai}
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={c.upload}
        hidden
        onChange={(event) => {
          select(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {ai ? (
        <ProductAiPhoto
          productId={productId}
          target={target}
          name={name}
          category={category}
          locale={locale}
          apiUrl={apiUrl}
          sourceBlob={preview?.blob ?? null}
          onSaved={(media) => {
            onSaved(media);
            onClose();
          }}
        />
      ) : camera ? (
        <div className="photo-camera">
          <video ref={video} muted playsInline autoPlay aria-label={c.camera} />
          <button type="button" onClick={() => void capture()}>
            {c.capture}
          </button>
        </div>
      ) : (
        <>
          <div className="photo-preview" aria-busy={processing}>
            {preview ? (
              /* Blob preview is deliberately local, never sent to an image optimizer. */ <img
                src={preview.url}
                alt={name}
              />
            ) : (
              <p>{processing ? c.saving : c.empty}</p>
            )}
          </div>
          {source && (
            <div className="photo-fit">
              <button
                type="button"
                disabled={busy}
                aria-pressed={!fit}
                onClick={() => setFit(false)}
              >
                {c.crop}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={fit}
                onClick={() => setFit(true)}
              >
                {c.fit}
              </button>
            </div>
          )}
          {preview && (
            <button
              type="button"
              disabled={busy || processing}
              onClick={() => setAi(true)}
            >
              {c.editWithAi}
            </button>
          )}
        </>
      )}
      {error && (
        <p className="photo-error" role="alert">
          {error}
        </p>
      )}
      {!ai && (
        <footer>
          <p>{c.hint}</p>
          <button
            className="button button-primary"
            type="button"
            disabled={busy || processing || !preview || camera || ai}
            onClick={() => void save()}
          >
            {busy ? c.saving : c.save}
          </button>
        </footer>
      )}
    </dialog>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import {
  creativeFormats,
  type CreativeLayer,
  type DesignDocument,
} from "@flowgastronomie/domain";
import type { DesignCanvasAdapter } from "./canvas-adapter";
import { creativeApi } from "./api";
import "@fontsource/noto-sans/latin-400.css";
import "@fontsource/noto-sans/latin-700.css";
import "@fontsource/noto-sans/latin-400-italic.css";
import "@fontsource/noto-sans/latin-700-italic.css";
import "@fontsource/noto-serif/latin-400.css";
import "@fontsource/noto-serif/latin-700.css";
import "@fontsource/noto-serif/latin-400-italic.css";
import "@fontsource/noto-serif/latin-700-italic.css";

export function DesignCanvas({
  document,
  onChange,
  selected,
  onSelect,
  zoom,
}: {
  document: DesignDocument;
  onChange: (layers: CreativeLayer[]) => void;
  selected: string[];
  onSelect: (ids: string[]) => void;
  zoom: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const adapter = useRef<DesignCanvasAdapter | null>(null);
  const callbacks = useRef({ onChange, onSelect });
  callbacks.current = { onChange, onSelect };
  const [ready, setReady] = useState(false);
  const [fit, setFit] = useState(0.5);
  const urls = useRef(new Map<string, string>());
  const currentDocument = useRef(document);
  currentDocument.current = document;
  useEffect(() => {
    const element = documentGlobal().createElement("canvas");
    host.current!.append(element);
    let disposed = false;
    void import("./canvas-adapter").then(({ FabricDesignCanvas }) => {
      if (disposed) return;
      adapter.current = new FabricDesignCanvas(
        element,
        (layers) => callbacks.current.onChange(layers),
        (ids) => callbacks.current.onSelect(ids),
        async (layer) => {
          if (layer.type === "qr") {
            const binding = currentDocument.current.bindings.find(
              (b) => b.id === layer.bindingId,
            );
            if (!binding) return null;
            const cacheKey = `qr:${binding.version}:${binding.value}`;
            if (!urls.current.has(cacheKey)) {
              const response = await fetch(`${creativeApi}/sources/qr`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  binding,
                  locale: currentDocument.current.locale,
                }),
              });
              if (!response.ok) return null;
              urls.current.set(
                cacheKey,
                URL.createObjectURL(await response.blob()),
              );
            }
            return urls.current.get(cacheKey)!;
          }
          const key = "assetId" in layer ? layer.assetId : "";
          if (!key) return null;
          if (!urls.current.has(key)) {
            const response = await fetch(
              `${creativeApi}/assets/${key}/content`,
              { credentials: "include" },
            );
            if (!response.ok) return null;
            urls.current.set(key, URL.createObjectURL(await response.blob()));
          }
          return urls.current.get(key)!;
        },
      );
      setReady(true);
    });
    return () => {
      disposed = true;
      void adapter.current?.dispose();
      adapter.current = null;
      element.remove();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current.clear();
    };
  }, []);
  useEffect(() => {
    const resize = () => {
      const width = host.current?.parentElement?.clientWidth ?? 600;
      setFit(
        Math.min(
          (width - 48) / creativeFormats[document.format].width,
          660 / creativeFormats[document.format].height,
        ),
      );
    };
    const observer = new ResizeObserver(resize);
    if (host.current?.parentElement)
      observer.observe(host.current.parentElement);
    resize();
    return () => observer.disconnect();
  }, [document.format]);
  useEffect(() => {
    if (ready) void adapter.current?.render(document, fit * zoom, selected);
  }, [document, fit, zoom, ready, selected]);
  return (
    <div
      className="cs-canvas-wrap"
      role="region"
      aria-label="Design canvas"
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).tagName === "TEXTAREA") return;
        const directions: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        onChange(
          document.pages[0]!.layers.map((layer) =>
            selected.includes(layer.id) && !layer.locked
              ? {
                  ...layer,
                  x: layer.x + direction[0] * step,
                  y: layer.y + direction[1] * step,
                }
              : layer,
          ),
        );
      }}
    >
      <div ref={host} className="cs-canvas" />
    </div>
  );
}
function documentGlobal() {
  return globalThis.document;
}

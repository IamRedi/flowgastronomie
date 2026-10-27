"use client";
import { useEffect, useRef, useState } from "react";
import {
  creativeFormatIds,
  creativeFormats,
  createTextLayer,
  adaptDesign,
  replaceCreativeLayer,
  groupCreativeLayers,
  removeCreativeLayers,
  duplicateCreativeLayers,
  type CreativeLayer,
  type DesignDocument,
} from "@flowgastronomie/domain";
import { studioRequest, creativeApi } from "./api";
import { DesignCanvas } from "./design-canvas";
import { DesignHistory } from "./history";
import { Inspector } from "./inspector";
import { SourcesPanel } from "./sources-panel";
import { ExportPanel } from "./export-panel";
import { AssistantPanel } from "./assistant-panel";
import { ImagePanel } from "./image-panel";
import "./studio.css";

export type StudioProject = {
  id: string;
  title: string;
  format: DesignDocument["format"];
  locale: DesignDocument["locale"];
  status: string;
  version: number;
  document: DesignDocument;
  updatedAt: string;
};
export type StudioAsset = {
  id: string;
  name: string;
  source: string;
  approvedForPublicUse: boolean;
};
const uid = () => crypto.randomUUID();
export function StudioEditor({
  initial,
  onClose,
}: {
  initial: StudioProject;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState(initial.document);
  const [title, setTitle] = useState(initial.title);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("Saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState("layers");
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [revisions, setRevisions] = useState<
    { id: string; name: string | null; number: number }[]
  >([]);
  const history = useRef(new DesignHistory(initial.document));
  const version = useRef(initial.version);
  const saving = useRef(false);
  const latest = useRef({ doc, title });
  latest.current = { doc, title };
  const saved = useRef(
    JSON.stringify({ doc: initial.document, title: initial.title }),
  );
  function change(next: DesignDocument) {
    history.current.push(next);
    setDoc(next);
    setStatus("Unsaved changes");
  }
  const layers = doc.pages[0]!.layers;
  function setLayers(next: CreativeLayer[]) {
    change({ ...doc, pages: [{ ...doc.pages[0]!, layers: next }] });
  }
  function update(layer: CreativeLayer) {
    try {
      change(replaceCreativeLayer(doc, layer));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(name: string | null = null) {
    if (saving.current || conflict) return;
    const snapshot = latest.current;
    const serial = JSON.stringify(snapshot);
    if (!name && serial === saved.current) return;
    saving.current = true;
    setStatus("Saving…");
    try {
      const result = await studioRequest<StudioProject>(
        `/projects/${initial.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title: snapshot.title,
            document: snapshot.doc,
            expectedVersion: version.current,
            name,
          }),
        },
      );
      version.current = result.version;
      saved.current = serial;
      setStatus(
        JSON.stringify(latest.current) === serial ? "Saved" : "Unsaved changes",
      );
      setError("");
      if (name)
        setRevisions(await studioRequest(`/projects/${initial.id}/revisions`));
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      setStatus("Not saved");
      if (message.includes("another tab")) setConflict(true);
    } finally {
      saving.current = false;
    }
  }
  useEffect(() => {
    const timer = setInterval(() => {
      void save();
    }, 1800);
    return () => clearInterval(timer);
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(latest.current) !== saved.current)
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    void studioRequest<StudioAsset[]>("/assets")
      .then(setAssets)
      .catch((e) => setError(e.message));
  }, []);
  const selectedLayer = layers.find((l) => l.id === selected[0]);
  function add(type: "text" | "shape" | "image" | "logo", assetId?: string) {
    const text = createTextLayer(uid());
    const spec = creativeFormats[doc.format];
    text.width = Math.min(500, spec.width - 80);
    const layer: CreativeLayer =
      type === "text"
        ? text
        : type === "shape"
          ? {
              id: text.id,
              name: "Shape",
              type,
              x: 60,
              y: 240,
              width: 240,
              height: 140,
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
              groupId: null,
              bindingId: null,
              fill: doc.theme.accent,
              radius: 12,
            }
          : {
              id: text.id,
              name: type === "logo" ? "Logo" : "Photo",
              type,
              x: 60,
              y: 240,
              width: 300,
              height: 240,
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
              groupId: null,
              bindingId: null,
              assetId: assetId!,
              fit: "contain",
              focalX: 0.5,
              focalY: 0.5,
              radius: 0,
            };
    setLayers([...layers, layer]);
    setSelected([layer.id]);
  }
  return (
    <main className="cs-root cs-editor">
      <header className="cs-editor-bar">
        <button
          onClick={async () => {
            await save();
            if (JSON.stringify(latest.current) === saved.current) onClose();
          }}
        >
          ← Library
        </button>
        <label className="cs-title">
          Design name
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setStatus("Unsaved changes");
            }}
          />
        </label>
        <span role="status" className="cs-save-status">
          {status}
        </span>
        <select
          aria-label="Design format"
          value={doc.format}
          onChange={(e) =>
            change(adaptDesign(doc, e.target.value as DesignDocument["format"]))
          }
        >
          {creativeFormatIds.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <select
          aria-label="Design language"
          value={doc.locale}
          onChange={(e) =>
            change({
              ...doc,
              locale: e.target.value as DesignDocument["locale"],
            })
          }
        >
          {["en", "de", "it", "sq"].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <button
          onClick={() => {
            setDoc(history.current.undo());
            setStatus("Unsaved changes");
          }}
        >
          Undo
        </button>
        <button
          onClick={() => {
            setDoc(history.current.redo());
            setStatus("Unsaved changes");
          }}
        >
          Redo
        </button>
        <button onClick={() => void save(`Version ${version.current + 1}`)}>
          Save version
        </button>
      </header>
      {error && (
        <div className="cs-error" role="alert">
          {error}
          {conflict ? (
            <button onClick={() => window.location.reload()}>
              Reload saved version
            </button>
          ) : (
            <button onClick={() => void save()}>Retry save</button>
          )}
        </div>
      )}
      <ExportPanel
        projectId={initial.id}
        prepare={async () => {
          await save();
          return (
            !saving.current && JSON.stringify(latest.current) === saved.current
          );
        }}
        refresh={async () => {
          const current = await studioRequest<StudioProject>(
            `/projects/${initial.id}`,
          );
          if (
            JSON.stringify(current.document) ===
            JSON.stringify(latest.current.doc)
          )
            version.current = current.version;
        }}
      />
      <AssistantPanel
        projectId={initial.id}
        locale={doc.locale}
        selected={selected}
        prepare={async () => {
          await save();
          return !saving.current &&
            JSON.stringify(latest.current) === saved.current
            ? version.current
            : null;
        }}
        accept={(next, nextVersion) => {
          change(next);
          version.current = nextVersion;
          saved.current = JSON.stringify({
            doc: next,
            title: latest.current.title,
          });
          setStatus("Saved");
        }}
      />
      <ImagePanel
        projectId={initial.id}
        sourceLayerId={
          selectedLayer?.type === "image" ? selectedLayer.id : null
        }
        prepare={async () => {
          await save();
          return (
            !saving.current && JSON.stringify(latest.current) === saved.current
          );
        }}
        refreshAssets={async () => setAssets(await studioRequest("/assets"))}
        useAsset={(assetId, replace) => {
          if (replace && selectedLayer?.type === "image")
            update({ ...selectedLayer, assetId });
          else add("image", assetId);
        }}
      />
      <div className="cs-mobile-tabs">
        {["layers", "properties"].map((tab) => (
          <button
            key={tab}
            aria-pressed={panel === tab}
            onClick={() => setPanel(panel === tab ? "" : tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className={`cs-workspace cs-show-${panel}`}>
        <aside className="cs-panel cs-layers">
          <SourcesPanel
            document={doc}
            projectId={initial.id}
            change={change}
            error={setError}
            refreshAssets={async () =>
              setAssets(await studioRequest("/assets"))
            }
          />
          <h2>Add to your design</h2>
          <div className="cs-row">
            <button onClick={() => add("text")}>＋ Text</button>
            <button onClick={() => add("shape")}>＋ Shape</button>
          </div>
          <label className="cs-upload">
            Upload photo or logo
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const asset = await studioRequest<StudioAsset>("/assets", {
                    method: "POST",
                    body: file,
                    headers: { "Content-Type": file.type },
                  });
                  setAssets((previous) => [asset, ...previous]);
                  add("image", asset.id);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </label>
          {assets.map((asset) => (
            <div className="cs-asset" key={asset.id}>
              <button onClick={() => add("image", asset.id)}>
                {asset.name} · {asset.source.toLowerCase()}
              </button>
              {asset.source !== "GENERATED" && (
                <button onClick={() => add("logo", asset.id)}>
                  Use as logo
                </button>
              )}
              {!asset.approvedForPublicUse && (
                <button
                  onClick={async () => {
                    try {
                      await studioRequest(`/assets/${asset.id}/approve`, {
                        method: "POST",
                      });
                      setAssets(await studioRequest("/assets"));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Approve for export
                </button>
              )}
            </div>
          ))}
          <h2>
            Layers <small>{layers.length}</small>
          </h2>
          <ol className="cs-layer-list">
            {[...layers].reverse().map((layer) => (
              <li key={layer.id}>
                <button
                  aria-pressed={selected.includes(layer.id)}
                  onClick={() => setSelected([layer.id])}
                >
                  <span>{layer.type === "text" ? "T" : "◇"}</span>
                  {layer.name}
                  {layer.locked ? " · Locked" : ""}
                  {!layer.visible ? " · Hidden" : ""}
                </button>
              </li>
            ))}
          </ol>
          {selectedLayer && (
            <div className="cs-row">
              {selected.length > 1 && (
                <button
                  onClick={() => {
                    try {
                      const id = uid();
                      change(groupCreativeLayers(doc, selected, id));
                      setSelected([id]);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Group selection
                </button>
              )}
              {selectedLayer.type === "group" && (
                <button
                  disabled={selectedLayer.locked}
                  onClick={() =>
                    setLayers(
                      layers
                        .filter((l) => l.id !== selectedLayer.id)
                        .map((l) =>
                          l.groupId === selectedLayer.id
                            ? { ...l, groupId: null }
                            : l,
                        ),
                    )
                  }
                >
                  Ungroup
                </button>
              )}
              <button
                disabled={selectedLayer.locked}
                onClick={() => {
                  change(duplicateCreativeLayers(doc, selected, uid));
                }}
              >
                Duplicate
              </button>
              <button
                disabled={selectedLayer.locked}
                onClick={() => change(removeCreativeLayers(doc, selected))}
              >
                Delete
              </button>
              <button
                onClick={() =>
                  setLayers([
                    ...layers.filter((l) => !selected.includes(l.id)),
                    ...layers.filter((l) => selected.includes(l.id)),
                  ])
                }
              >
                Bring forward
              </button>
              <button
                onClick={() =>
                  setLayers([
                    ...layers.filter((l) => selected.includes(l.id)),
                    ...layers.filter((l) => !selected.includes(l.id)),
                  ])
                }
              >
                Send back
              </button>
            </div>
          )}
          <details>
            <summary>Versions</summary>
            <button
              onClick={async () =>
                setRevisions(
                  await studioRequest(`/projects/${initial.id}/revisions`),
                )
              }
            >
              Load history
            </button>
            {revisions.map((r) => (
              <p key={r.id}>
                #{r.number} · {r.name ?? "Autosave"}
              </p>
            ))}
          </details>
        </aside>
        <section className="cs-stage">
          <div className="cs-stage-bar">
            <span>
              {doc.format} · {doc.locale.toUpperCase()}
            </span>
            <div>
              <button
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                aria-label="Zoom out"
              >
                −
              </button>
              <button onClick={() => setZoom(1)}>Fit</button>
              <button
                onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                aria-label="Zoom in"
              >
                ＋
              </button>
            </div>
          </div>
          <DesignCanvas
            document={doc}
            onChange={setLayers}
            selected={selected}
            onSelect={setSelected}
            zoom={zoom}
          />
          <p className="cs-canvas-note">
            Dashed line: safe area · Shift-click to select multiple layers
          </p>
        </section>
        <div className="cs-inspector">
          <Inspector layer={selectedLayer} update={update} />
        </div>
      </div>
    </main>
  );
}

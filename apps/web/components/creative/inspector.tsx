"use client";
import type { CreativeLayer } from "@flowgastronomie/domain";
export function Inspector({
  layer,
  update,
}: {
  layer: CreativeLayer | undefined;
  update: (layer: CreativeLayer) => void;
}) {
  if (!layer)
    return (
      <aside className="cs-panel">
        <h2>Make it yours</h2>
        <p>
          Select a layer on the canvas or in the layer list to edit its
          properties.
        </p>
        <p className="cs-muted">
          Shift-select to move multiple layers. Arrow keys nudge; Shift moves by
          10.
        </p>
      </aside>
    );
  return (
    <aside className="cs-panel">
      <h2>{layer.name}</h2>
      <p className="cs-tag">
        {layer.bindingId ? "Connected to your venue" : "Editable layer"}
      </p>
      <label>
        Layer name
        <input
          value={layer.name}
          onChange={(e) => update({ ...layer, name: e.target.value })}
        />
      </label>
      {"text" in layer && (
        <>
          <label>
            Text
            <textarea
              rows={4}
              value={layer.text}
              disabled={!!layer.bindingId || layer.locked}
              onChange={(e) => update({ ...layer, text: e.target.value })}
            />
          </label>
          {layer.bindingId && (
            <small>Update connected content from Sources.</small>
          )}
          <label>
            Font
            <select
              value={layer.font}
              onChange={(e) =>
                update({ ...layer, font: e.target.value as typeof layer.font })
              }
            >
              <option>Studio Sans</option>
              <option>Studio Serif</option>
            </select>
          </label>
          <label>
            Size
            <input
              type="number"
              min={6}
              max={400}
              step={0.1}
              value={Math.round(layer.fontSize * 10) / 10}
              onChange={(e) =>
                update({
                  ...layer,
                  fontSize: Math.max(6, Math.min(400, Number(e.target.value))),
                })
              }
            />
          </label>
          <div className="cs-row">
            <button
              aria-pressed={layer.weight === "bold"}
              onClick={() =>
                update({
                  ...layer,
                  weight: layer.weight === "bold" ? "normal" : "bold",
                })
              }
            >
              Bold
            </button>
            <button
              aria-pressed={layer.italic}
              onClick={() => update({ ...layer, italic: !layer.italic })}
            >
              Italic
            </button>
          </div>
          <label>
            Alignment
            <select
              value={layer.align}
              onChange={(e) =>
                update({
                  ...layer,
                  align: e.target.value as typeof layer.align,
                })
              }
            >
              <option>left</option>
              <option>center</option>
              <option>right</option>
            </select>
          </label>
        </>
      )}
      {"fill" in layer && layer.type !== "qr" && (
        <label>
          Color
          <input
            type="color"
            value={layer.fill}
            onChange={(e) =>
              update({ ...layer, fill: e.target.value } as CreativeLayer)
            }
          />
        </label>
      )}
      {"fit" in layer && (
        <>
          <label>
            Image fit
            <select
              value={layer.fit}
              onChange={(e) =>
                update({ ...layer, fit: e.target.value as typeof layer.fit })
              }
            >
              <option>cover</option>
              <option>contain</option>
            </select>
          </label>
          <label>
            Crop focus X
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layer.focalX}
              onChange={(e) =>
                update({ ...layer, focalX: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Crop focus Y
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layer.focalY}
              onChange={(e) =>
                update({ ...layer, focalY: Number(e.target.value) })
              }
            />
          </label>
        </>
      )}
      <details>
        <summary>Position & size</summary>
        {layer.type !== "qr" && (
          <label>
            Opacity
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layer.opacity}
              onChange={(e) =>
                update({ ...layer, opacity: Number(e.target.value) })
              }
            />
          </label>
        )}
        {"radius" in layer && (
          <label>
            Corner radius
            <input
              type="range"
              min={0}
              max={Math.min(layer.width, layer.height) / 2}
              value={layer.radius}
              onChange={(e) =>
                update({ ...layer, radius: Number(e.target.value) })
              }
            />
          </label>
        )}
        {"text" in layer && (
          <>
            <label>
              Line height
              <input
                type="number"
                min={1}
                max={3}
                step={0.1}
                value={layer.lineHeight}
                onChange={(e) =>
                  update({ ...layer, lineHeight: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Letter spacing
              <input
                type="number"
                min={-2}
                max={30}
                step={0.5}
                value={layer.letterSpacing}
                onChange={(e) =>
                  update({ ...layer, letterSpacing: Number(e.target.value) })
                }
              />
            </label>
          </>
        )}
        <div className="cs-fields">
          {(["x", "y", "width", "height", "rotation"] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                type="number"
                disabled={
                  layer.locked ||
                  (layer.type === "qr" &&
                    (key === "height" || key === "rotation"))
                }
                value={Math.round(layer[key])}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  update({
                    ...layer,
                    [key]: value,
                    ...(layer.type === "qr" && key === "width"
                      ? {
                          width: Math.max(76, value),
                          height: Math.max(76, value),
                        }
                      : {}),
                  });
                }}
              />
            </label>
          ))}
        </div>
      </details>
      <div className="cs-row">
        <button
          aria-pressed={layer.locked}
          onClick={() => update({ ...layer, locked: !layer.locked })}
        >
          {layer.locked ? "Unlock" : "Lock"}
        </button>
        <button
          aria-pressed={!layer.visible}
          onClick={() => update({ ...layer, visible: !layer.visible })}
        >
          {layer.visible ? "Hide" : "Show"}
        </button>
      </div>
    </aside>
  );
}

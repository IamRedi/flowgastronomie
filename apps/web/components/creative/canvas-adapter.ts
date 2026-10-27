import {
  Canvas,
  Rect,
  Textbox,
  FabricImage,
  FabricObject,
  ActiveSelection,
  util,
} from "fabric";
import {
  creativeFormats,
  effectiveCreativeLayers,
  type CreativeLayer,
  type DesignDocument,
} from "@flowgastronomie/domain";

export interface DesignCanvasAdapter {
  render(
    document: DesignDocument,
    zoom: number,
    selected: string[],
  ): Promise<void>;
  dispose(): Promise<boolean>;
}
// Only this adapter knows Fabric. It maps controlled properties in both
// directions and never calls Fabric's JSON serialization.
export class FabricDesignCanvas implements DesignCanvasAdapter {
  private canvas: Canvas;
  private ids = new WeakMap<FabricObject, string>();
  private document: DesignDocument | null = null;
  private generation = 0;
  private rendering = false;
  private lastZoom = 0;
  constructor(
    element: HTMLCanvasElement,
    private change: (layers: CreativeLayer[]) => void,
    select: (ids: string[]) => void,
    private imageUrl: (layer: CreativeLayer) => Promise<string | null>,
  ) {
    this.canvas = new Canvas(element, {
      preserveObjectStacking: true,
      selection: true,
      enableRetinaScaling: true,
    });
    const selection = () => {
      if (!this.rendering)
        select(
          this.canvas
            .getActiveObjects()
            .map((o) => this.ids.get(o)!)
            .filter(Boolean),
        );
    };
    this.canvas.on("selection:created", selection);
    this.canvas.on("selection:updated", selection);
    this.canvas.on("selection:cleared", selection);
    this.canvas.on("object:modified", () => this.commit());
    this.canvas.on("text:editing:exited", () => this.commit());
    this.canvas.on("object:moving", ({ target }) => {
      if (!this.document) return;
      const spec = creativeFormats[this.document.format];
      const tolerance = 8 / this.canvas.getZoom();
      for (const line of [0, spec.safe, spec.width / 2, spec.width - spec.safe])
        if (Math.abs(target.left - line) < tolerance) target.set("left", line);
      for (const line of [
        0,
        spec.safe,
        spec.height / 2,
        spec.height - spec.safe,
      ])
        if (Math.abs(target.top - line) < tolerance) target.set("top", line);
    });
  }
  private commit() {
    if (!this.document || this.rendering) return;
    const objects = new Map(
      this.canvas.getObjects().map((o) => [this.ids.get(o), o]),
    );
    this.change(
      this.document.pages[0]!.layers.map((layer) => {
        const object = objects.get(layer.id);
        if (!object || layer.locked) return layer;
        const matrix = util.qrDecompose(object.calcTransformMatrix());
        const radians = (matrix.angle * Math.PI) / 180;
        const width = Math.max(1, object.width * Math.abs(matrix.scaleX));
        const height = Math.max(1, object.height * Math.abs(matrix.scaleY));
        return {
          ...layer,
          x:
            matrix.translateX -
            (width * Math.cos(radians) - height * Math.sin(radians)) / 2,
          y:
            matrix.translateY -
            (width * Math.sin(radians) + height * Math.cos(radians)) / 2,
          width: layer.type === "qr" ? Math.max(76, width) : width,
          height: layer.type === "qr" ? Math.max(76, width) : height,
          rotation: layer.type === "qr" ? 0 : matrix.angle,
          ...(object instanceof Textbox && "text" in layer
            ? {
                text: layer.bindingId ? layer.text : object.text,
                fontSize: Math.max(
                  6,
                  Math.min(400, layer.fontSize * Math.abs(matrix.scaleY)),
                ),
              }
            : {}),
        };
      }),
    );
  }
  async render(document: DesignDocument, zoom: number, selected: string[]) {
    await Promise.all([
      globalThis.document.fonts.load('16px "Noto Sans"'),
      globalThis.document.fonts.load('16px "Noto Serif"'),
    ]);
    if (this.document === document && this.lastZoom === zoom) {
      const active = this.canvas.getActiveObjects().map((o) => this.ids.get(o));
      if (
        active.length === selected.length &&
        active.every((id) => selected.includes(id!))
      )
        return;
      this.rendering = true;
      this.canvas.discardActiveObject();
      const objects = this.canvas
        .getObjects()
        .filter((o) => selected.includes(this.ids.get(o)!) && o.selectable);
      if (objects.length === 1) this.canvas.setActiveObject(objects[0]!);
      else if (objects.length > 1)
        this.canvas.setActiveObject(
          new ActiveSelection(objects, { canvas: this.canvas }),
        );
      this.canvas.requestRenderAll();
      this.rendering = false;
      return;
    }
    const generation = ++this.generation;
    const spec = creativeFormats[document.format];
    const objects = await Promise.all(
      effectiveCreativeLayers(document).map(async (layer) => {
        let object: FabricObject;
        if ("text" in layer)
          object = new Textbox(layer.text, {
            fontFamily:
              layer.font === "Studio Serif" ? "Noto Serif" : "Noto Sans",
            fontSize: layer.fontSize,
            fontWeight: layer.weight,
            fontStyle: layer.italic ? "italic" : "normal",
            lineHeight: layer.lineHeight,
            charSpacing: (layer.letterSpacing * 1000) / layer.fontSize,
            textAlign: layer.align,
            fill: layer.fill,
            editable: !layer.bindingId && !layer.locked,
            width: layer.width,
            height: layer.height,
          });
        else if (
          layer.type === "image" ||
          layer.type === "logo" ||
          layer.type === "qr"
        ) {
          const url = await this.imageUrl(layer);
          if (url) {
            try {
              const source = await FabricImage.fromURL(url);
              const canvas = globalThis.document.createElement("canvas");
              const ratio = Math.min(
                2,
                2000 / Math.max(layer.width, layer.height),
              );
              canvas.width = Math.max(1, Math.round(layer.width * ratio));
              canvas.height = Math.max(1, Math.round(layer.height * ratio));
              const ctx = canvas.getContext("2d")!;
              const scale =
                layer.type === "qr" || layer.fit === "contain"
                  ? Math.min(
                      canvas.width / source.width,
                      canvas.height / source.height,
                    )
                  : Math.max(
                      canvas.width / source.width,
                      canvas.height / source.height,
                    );
              if ("radius" in layer && layer.radius) {
                ctx.beginPath();
                ctx.roundRect(
                  0,
                  0,
                  canvas.width,
                  canvas.height,
                  layer.radius * ratio,
                );
                ctx.clip();
              }
              const fx =
                "focalX" in layer && layer.fit === "cover" ? layer.focalX : 0.5;
              const fy =
                "focalY" in layer && layer.fit === "cover" ? layer.focalY : 0.5;
              ctx.drawImage(
                source.getElement() as HTMLImageElement,
                (canvas.width - source.width * scale) * fx,
                (canvas.height - source.height * scale) * fy,
                source.width * scale,
                source.height * scale,
              );
              const img = new FabricImage(canvas);
              img.set({
                scaleX: layer.width / canvas.width,
                scaleY: layer.height / canvas.height,
              });
              object = img;
            } catch {
              object = new Rect({
                width: layer.width,
                height: layer.height,
                fill: "#e2d9ca",
              });
            }
          } else
            object = new Rect({
              width: layer.width,
              height: layer.height,
              fill: "#e2d9ca",
            });
        } else
          object = new Rect({
            width: layer.width,
            height: layer.height,
            fill: "fill" in layer ? layer.fill : "transparent",
            rx: "radius" in layer ? layer.radius : 0,
            ry: "radius" in layer ? layer.radius : 0,
          });
        object.set({
          left: layer.x,
          top: layer.y,
          originX: "left",
          originY: "top",
          angle: layer.rotation,
          opacity: layer.opacity,
          visible: layer.visible,
          selectable: !layer.locked && layer.type !== "group",
          evented: !layer.locked,
          lockRotation: layer.type === "qr",
          lockScalingFlip: true,
          cornerSize: 16,
          transparentCorners: false,
          cornerColor: "#17382f",
          borderColor: "#b78b52",
          padding: 4,
        });
        this.ids.set(object, layer.id);
        return object;
      }),
    );
    if (generation !== this.generation) return;
    this.rendering = true;
    this.document = document;
    this.lastZoom = zoom;
    this.canvas.discardActiveObject();
    this.canvas.clear();
    this.canvas.backgroundColor = document.pages[0]!.background;
    this.canvas.setDimensions({
      width: spec.width * zoom,
      height: spec.height * zoom,
    });
    this.canvas.setZoom(zoom);
    objects.forEach((object) => this.canvas.add(object));
    const guide = new Rect({
      left: spec.safe,
      top: spec.safe,
      width: spec.width - spec.safe * 2,
      height: spec.height - spec.safe * 2,
      fill: "transparent",
      stroke: "#b78b52",
      strokeWidth: 1 / zoom,
      strokeDashArray: [5 / zoom, 5 / zoom],
      selectable: false,
      evented: false,
      originX: "left",
      originY: "top",
    });
    this.canvas.add(guide);
    if (selected.length === 1) {
      const object = objects.find((o) => this.ids.get(o) === selected[0]);
      if (object?.selectable) this.canvas.setActiveObject(object);
    }
    this.canvas.requestRenderAll();
    this.rendering = false;
  }
  dispose() {
    ++this.generation;
    return this.canvas.dispose();
  }
}

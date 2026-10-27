import {
  CreativeError,
  creativeFormats,
  parseDesignDocument,
  type CreativeLayer,
  type DesignDocument,
} from "./creative";
export function replaceCreativeLayer(
  document: DesignDocument,
  replacement: CreativeLayer,
) {
  const previous = document.pages[0]!.layers.find(
    (l) => l.id === replacement.id,
  );
  if (!previous) throw new CreativeError("INVALID_DESIGN");
  const sx = replacement.width / previous.width,
    sy = replacement.height / previous.height;
  const angle = ((replacement.rotation - previous.rotation) * Math.PI) / 180;
  const layers = document.pages[0]!.layers.map((layer) => {
    if (layer.id === replacement.id) return replacement;
    if (previous.type !== "group" || layer.groupId !== previous.id)
      return layer;
    if (layer.locked)
      throw new CreativeError(
        "INVALID_DESIGN",
        "Unlock grouped layers before transforming the group.",
      );
    const x = (layer.x - previous.x) * sx,
      y = (layer.y - previous.y) * sy;
    return {
      ...layer,
      x: replacement.x + x * Math.cos(angle) - y * Math.sin(angle),
      y: replacement.y + x * Math.sin(angle) + y * Math.cos(angle),
      width: layer.width * sx,
      height: layer.height * sy,
      rotation: layer.rotation + replacement.rotation - previous.rotation,
      ...("fontSize" in layer
        ? {
            fontSize: Math.max(
              6,
              Math.min(400, layer.fontSize * Math.min(sx, sy)),
            ),
          }
        : {}),
    };
  });
  return parseDesignDocument({
    ...document,
    pages: [{ ...document.pages[0]!, layers }],
  });
}
export function groupCreativeLayers(
  document: DesignDocument,
  ids: string[],
  id: string,
) {
  const selected = document.pages[0]!.layers.filter((l) => ids.includes(l.id));
  if (
    selected.length < 2 ||
    selected.some((l) => l.locked || l.type === "group" || l.groupId)
  )
    throw new CreativeError(
      "INVALID_DESIGN",
      "Select two or more unlocked, ungrouped layers.",
    );
  const x = Math.min(...selected.map((l) => l.x)),
    y = Math.min(...selected.map((l) => l.y));
  const group: CreativeLayer = {
    id,
    type: "group",
    name: "Group",
    x,
    y,
    width: Math.max(...selected.map((l) => l.x + l.width)) - x,
    height: Math.max(...selected.map((l) => l.y + l.height)) - y,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    bindingId: null,
    groupId: null,
  };
  return parseDesignDocument({
    ...document,
    pages: [
      {
        ...document.pages[0]!,
        layers: [
          ...document.pages[0]!.layers.map((l) =>
            ids.includes(l.id) ? { ...l, groupId: id } : l,
          ),
          group,
        ],
      },
    ],
  });
}
export function effectiveCreativeLayers(document: DesignDocument) {
  return document.pages[0]!.layers.map((layer) => {
    const group = document.pages[0]!.layers.find((g) => g.id === layer.groupId);
    return group
      ? {
          ...layer,
          visible: layer.visible && group.visible,
          locked: layer.locked || group.locked,
          opacity: layer.opacity * group.opacity,
        }
      : layer;
  });
}
export function creativeExportWarnings(
  document: DesignDocument,
  assets: {
    id: string;
    width: number;
    height: number;
    source: string;
    approvedForPublicUse: boolean;
  }[],
) {
  const warnings: string[] = [];
  const spec = creativeFormats[document.format];
  const layers = effectiveCreativeLayers(document).filter(
    (l) => l.visible && l.type !== "group",
  );
  for (const [index, layer] of layers.entries()) {
    if (
      layer.x < 0 ||
      layer.y < 0 ||
      layer.x + layer.width > spec.width ||
      layer.y + layer.height > spec.height
    )
      warnings.push(`“${layer.name}” extends beyond the page.`);
    if (layer.type === "qr") {
      if (
        layer.x < spec.safe ||
        layer.y < spec.safe ||
        layer.x + layer.width > spec.width - spec.safe ||
        layer.y + layer.height > spec.height - spec.safe ||
        layer.opacity !== 1
      )
        throw new CreativeError(
          "INVALID_DESIGN",
          "Move opaque QR codes fully inside the safe area.",
        );
      if (
        layers
          .slice(index + 1)
          .some(
            (other) =>
              other.x < layer.x + layer.width &&
              other.x + other.width > layer.x &&
              other.y < layer.y + layer.height &&
              other.y + other.height > layer.y,
          )
      )
        throw new CreativeError(
          "INVALID_DESIGN",
          "A layer overlaps a QR code. Move it or bring the QR to the front.",
        );
    }
    if ("assetId" in layer) {
      const asset = assets.find((a) => a.id === layer.assetId);
      if (!asset) throw new CreativeError("NOT_FOUND");
      assertCreativeAssetLayer(layer, asset, true);
      if (
        spec.widthMm &&
        Math.min(asset.width / layer.width, asset.height / layer.height) * 96 <
          150
      )
        warnings.push(`“${layer.name}” is below 150 dpi at this print size.`);
    }
  }
  return warnings;
}
export function assertCreativeAssetLayer(
  layer: CreativeLayer,
  asset: { source: string; approvedForPublicUse: boolean },
  forExport: boolean,
) {
  if (layer.type === "logo" && asset.source === "GENERATED")
    throw new CreativeError(
      "INVALID_DESIGN",
      "Generated imagery cannot replace your real logo.",
    );
  if (forExport && !asset.approvedForPublicUse)
    throw new CreativeError("UNAPPROVED_ASSET");
}
export function removeCreativeLayers(document: DesignDocument, ids: string[]) {
  const effective = effectiveCreativeLayers(document);
  const selected = new Set(
    ids.filter((id) => !effective.find((l) => l.id === id)?.locked),
  );
  const layers = document.pages[0]!.layers.filter(
    (l) =>
      !(selected.has(l.id) || (l.groupId && selected.has(l.groupId))) ||
      effective.find((current) => current.id === l.id)?.locked,
  );
  const removedGroups = document.pages[0]!.layers.filter(
    (l) => l.type === "group" && !layers.some((kept) => kept.id === l.id),
  ).map((l) => l.id);
  const normalized = layers.map((l) =>
    l.groupId && removedGroups.includes(l.groupId)
      ? { ...l, groupId: null }
      : l,
  );
  return parseDesignDocument({
    ...document,
    pages: [{ ...document.pages[0]!, layers: normalized }],
    bindings: document.bindings.filter((b) =>
      normalized.some((l) => l.bindingId === b.id),
    ),
  });
}

export function duplicateCreativeLayers(
  document: DesignDocument,
  ids: string[],
  newId: () => string,
) {
  const effective = effectiveCreativeLayers(document);
  const selected = new Set(
    ids.filter((id) => !effective.find((l) => l.id === id)?.locked),
  );
  const originals = document.pages[0]!.layers.filter(
    (l) => selected.has(l.id) || (l.groupId && selected.has(l.groupId)),
  );
  const mapping = new Map(originals.map((l) => [l.id, newId()]));
  const copies = originals.map((l) => ({
    ...l,
    id: mapping.get(l.id)!,
    name: `${l.name.slice(0, 115)} copy`,
    x: l.x + 16,
    y: l.y + 16,
    groupId: l.groupId ? (mapping.get(l.groupId) ?? null) : null,
  }));
  return parseDesignDocument({
    ...document,
    pages: [
      {
        ...document.pages[0]!,
        layers: [...document.pages[0]!.layers, ...copies],
      },
    ],
  });
}

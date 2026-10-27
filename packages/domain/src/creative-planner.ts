import { z } from "zod";
import {
  creativeLayerSchema,
  creativeFormatIds,
  parseDesignDocument,
  adaptDesign,
  CreativeError,
  type DesignDocument,
  type CreativeBinding,
} from "./creative";
import { creativeTemplates } from "./creative-templates";

export const creativeCopy = {
  en: [
    "Fresh from our kitchen",
    "Discover our menu",
    "Made for good company",
    "A little something to look forward to",
    "Take a seat",
    "See you soon",
  ],
  de: [
    "Frisch aus unserer Küche",
    "Unsere Speisekarte entdecken",
    "Für eine gute Zeit zusammen",
    "Ein guter Grund zum Wiederkommen",
    "Nehmen Sie Platz",
    "Bis bald",
  ],
  it: [
    "Fresco dalla nostra cucina",
    "Scopri il nostro menu",
    "Il piacere di stare insieme",
    "Un buon motivo per tornare",
    "Accomodati",
    "A presto",
  ],
  sq: [
    "Freskët nga kuzhina jonë",
    "Zbuloni menunë tonë",
    "Kënaqësi në shoqëri të mirë",
    "Një arsye e mirë për t’u kthyer",
    "Uluni me ne",
    "Shihemi së shpejti",
  ],
} as const;
const patchSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add"), layer: creativeLayerSchema }),
  z.strictObject({ op: z.literal("replace"), layer: creativeLayerSchema }),
  z.strictObject({
    op: z.literal("remove"),
    layerId: z.string().min(1).max(100),
  }),
  z.strictObject({
    op: z.literal("format"),
    format: z.enum(creativeFormatIds),
  }),
]);
export const designPatchSetSchema = z.strictObject({
  summary: z.string().max(600),
  patches: z.array(patchSchema).max(40),
});
export const designPlanSchema = z.strictObject({
  intent: z.string().max(600),
  template: z.enum(creativeTemplates),
  format: z.enum(creativeFormatIds),
  selectedSourceIds: z.array(z.string().min(1).max(100)).max(40),
  patchSet: designPatchSetSchema,
});
export type DesignPatchSet = z.infer<typeof designPatchSetSchema>;
export type DesignPlan = z.infer<typeof designPlanSchema>;
export function applyCreativePatch(
  document: DesignDocument,
  value: unknown,
  context: {
    bindings: CreativeBinding[];
    assetIds: string[];
    approvedCopy?: readonly string[];
  },
): DesignDocument {
  const parsed = designPatchSetSchema.safeParse(value);
  if (!parsed.success)
    throw new CreativeError(
      "INVALID_DESIGN",
      "The planner returned an unsupported edit.",
    );
  let next = structuredClone(document);
  const allowedCopy = new Set<string>([
    ...creativeCopy[document.locale],
    ...(context.approvedCopy ?? []),
    ...document.pages[0]!.layers.flatMap((l) =>
      "text" in l && !l.bindingId ? [l.text] : [],
    ),
  ]);
  const allowedBindings = new Map(context.bindings.map((b) => [b.id, b]));
  for (const patch of parsed.data.patches) {
    if (patch.op === "format") {
      next = adaptDesign(next, patch.format);
      continue;
    }
    const id = patch.op === "remove" ? patch.layerId : patch.layer.id;
    const current = next.pages[0]!.layers.find((l) => l.id === id);
    if (current?.locked)
      throw new CreativeError(
        "INVALID_DESIGN",
        "Unlock a layer before asking AI to change it.",
      );
    if (patch.op === "remove") {
      if (!current) throw new CreativeError("INVALID_DESIGN");
      next.pages[0]!.layers = next.pages[0]!.layers.filter((l) => l.id !== id);
      continue;
    }
    let layer = patch.layer;
    if ((patch.op === "replace" && !current) || (patch.op === "add" && current))
      throw new CreativeError("INVALID_DESIGN");
    if (
      current &&
      (layer.bindingId !== current.bindingId || layer.type !== current.type)
    )
      throw new CreativeError(
        "INVALID_DESIGN",
        "AI cannot replace source semantics.",
      );
    if (layer.bindingId) {
      const binding = allowedBindings.get(layer.bindingId);
      if (!binding)
        throw new CreativeError(
          "INVALID_DESIGN",
          "AI selected an unavailable source.",
        );
      if ("text" in layer) layer = { ...layer, text: binding.value };
      if (!next.bindings.some((b) => b.id === binding.id))
        next.bindings.push(binding);
    } else if ("text" in layer && !allowedCopy.has(layer.text))
      throw new CreativeError(
        "INVALID_DESIGN",
        "AI copy must use approved phrases or existing editable copy. Enter custom campaign wording manually.",
      );
    if ("assetId" in layer && !context.assetIds.includes(layer.assetId))
      throw new CreativeError("NOT_FOUND");
    next.pages[0]!.layers =
      patch.op === "add"
        ? [...next.pages[0]!.layers, layer]
        : next.pages[0]!.layers.map((l) => (l.id === id ? layer : l));
  }
  return parseDesignDocument(next);
}

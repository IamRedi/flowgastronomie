import {
  CreativeError,
  applyResolvedBindings,
  type CreativeBinding,
  type DesignDocument,
} from "./creative";
// The client may keep an authenticated previous snapshot, or use a freshly
// resolved value. It cannot introduce invented commercial values/version stamps.
export function validateCreativeSources(
  document: DesignDocument,
  previous: DesignDocument,
  resolved: CreativeBinding[],
): DesignDocument {
  for (const binding of document.bindings) {
    const equal = (candidate: CreativeBinding) =>
      JSON.stringify(candidate) === JSON.stringify(binding);
    const old =
      previous.locale === document.locale && previous.bindings.some(equal);
    if (!old && !resolved.some(equal))
      throw new CreativeError(
        "INVALID_DESIGN",
        "Source content must match the venue record or a saved design version.",
      );
  }
  return applyResolvedBindings(document, document.bindings);
}

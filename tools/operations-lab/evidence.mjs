// Evidence collections are sets of source identities, not SQL result order.
// Preserve every field/value while ordering nested collections deterministically.
export function canonicalEvidence(value) {
  if (Array.isArray(value))
    return value
      .map(canonicalEvidence)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalEvidence(value[key])]),
    );
  return value;
}

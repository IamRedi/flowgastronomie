import { normalizeImportName } from "./menu-import";
/** A comparison is advisory: it never selects update/delete actions. */
export function compareMenuImport(
  rows: {
    id: string;
    item: {
      name: string;
      priceMinor: number | null;
      currency: string;
      variants?: unknown[];
    };
  }[],
  products: {
    id: string;
    priceMinor: number;
    currency: string;
    archivedAt?: unknown;
    translations: { name: string }[];
  }[],
) {
  const active = products.filter((p) => !p.archivedAt),
    seen = new Set<string>();
  const items = rows.map((row) => {
    const key = normalizeImportName(row.item.name);
    const candidates = active.filter((p) =>
      p.translations.some((t) => normalizeImportName(t.name) === key),
    );
    candidates.forEach((p) => seen.add(p.id));
    const duplicate =
      rows.filter((r) => normalizeImportName(r.item.name) === key).length > 1;
    const match = candidates.length === 1 ? candidates[0] : undefined;
    return {
      id: row.id,
      candidates: candidates.map((p) => p.id),
      kind:
        duplicate || candidates.length > 1
          ? ("REVIEW" as const)
          : !match
            ? ("NEW" as const)
            : match.priceMinor !== row.item.priceMinor ||
                match.currency !== row.item.currency
              ? ("PRICE_CHANGED" as const)
              : ("EXISTING" as const),
      variants: row.item.variants?.length ?? 0,
    };
  });
  return {
    items,
    absent: active.filter((p) => !seen.has(p.id)).map((p) => p.id),
  };
}

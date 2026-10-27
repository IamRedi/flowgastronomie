import { randomUUID } from "node:crypto";
import {
  importPriceMinor,
  type MenuImportProposal,
} from "@flowgastronomie/domain";
import type { DiscoverySource } from "./business-import-extraction.js";
export type PdfMenuLine = {
  text: string;
  x: number;
  y: number;
  height: number;
};
export type PdfMenuToken = {
  str: string;
  transform: number[];
  height: number;
  width: number;
};

// Preserve separate columns and headings. Content-stream order is not reading order.
export function pdfMenuLines(tokens: PdfMenuToken[]): PdfMenuLine[] {
  const rows: Array<{ y: number; tokens: PdfMenuToken[] }> = [];
  for (const token of [...tokens].sort(
    (a, b) => b.transform[5]! - a.transform[5]!,
  )) {
    if (
      !token.str.trim() ||
      !Number.isFinite(token.transform[4]) ||
      !Number.isFinite(token.transform[5])
    )
      continue;
    const y = token.transform[5]!;
    let row = rows.at(-1);
    // Different font sizes shift visual baselines. Bound alignment by the smaller
    // text height so a neighbouring column cannot split a name from its price.
    const tolerance = row
      ? Math.max(
          2,
          Math.min(
            4,
            Math.min(token.height, ...row.tokens.map((t) => t.height)) * 0.35,
          ),
        )
      : 2;
    if (row && Math.abs(row.y - y) > tolerance) row = undefined;
    if (!row) {
      row = { y, tokens: [] };
      rows.push(row);
    }
    row.tokens.push(token);
  }
  const lines: PdfMenuLine[] = [];
  for (const row of rows.sort((a, b) => b.y - a.y)) {
    let line: PdfMenuLine | null = null;
    let right = 0;
    for (const t of row.tokens.sort(
      (a, b) => a.transform[4]! - b.transform[4]!,
    )) {
      const x = t.transform[4]!;
      const price =
        /^\d+(?:[.,]\d{1,2})?\s*(?:€|EUR|ALL|Lek)(?:\s|$)|^\d+[.,]\d{1,2}$|^(?:€|EUR|ALL|Lek|\/)$|^(?:PREIS FEHLT|PRICE MISSING|ÇMIMI MUNGON)/i.test(
          t.str.trim(),
        );
      if (!line || (!price && (x - right > 65 || rowPattern.test(line.text)))) {
        line = { text: t.str.trim(), x, y: row.y, height: t.height };
        lines.push(line);
      } else {
        line.text += " " + t.str.trim();
        line.height = Math.max(line.height, t.height);
      }
      right = x + t.width;
    }
  }
  return lines;
}
const amount = "(?:\\d+(?:[.,]\\d{1,2})?\\s*(?:EUR|ALL|€|Lek)|\\d+[.,]\\d{2})";
const rowPattern = new RegExp(
  `^(.{2,160}?)\\s+(${amount}(?:\\s*/\\s*${amount})*|PREIS FEHLT|PRICE MISSING|ÇMIMI MUNGON)\\s*$`,
  "i",
);
const warning =
  /test|demo|fiktiv|synthe|speisekarte|testmenü|preis fehlt|ohne preis|wichtig|variant|^prices?\b|^preise\b/i;

export function extractPdfMenu(
  source: DiscoverySource,
  pages: PdfMenuLine[][],
): MenuImportProposal {
  const result: MenuImportProposal = {
    schemaVersion: 1,
    categories: [],
    items: [],
  };
  for (const [pageIndex, lines] of pages.entries()) {
    const observed = <T>(value: T | null, quote: string) => ({
      value,
      confidence: null,
      evidence:
        value === null
          ? []
          : [
              {
                sourceId: source.id,
                page: pageIndex + 1,
                quote: quote.slice(0, 1000),
                box: null,
              },
            ],
    });
    const productRows = lines.filter((l) => {
      const row = rowPattern.exec(l.text);
      return (
        !!row && /\p{L}/u.test(row[1]!.replace(/\b(?:EUR|ALL|Lek)\b/gi, ""))
      );
    });
    const headings = lines.filter(
      (l) =>
        !rowPattern.test(l.text) &&
        !warning.test(l.text) &&
        /^\p{L}[\p{L}\s&/·-]{1,100}$/u.test(l.text) &&
        (l.text === l.text.toUpperCase() ||
          (l.height >= Math.max(0, ...productRows.map((p) => p.height)) &&
            !productRows.some((p) => Math.abs(p.x - l.x) < 20 && p.y > l.y))),
    );
    const orderPattern =
      /^(?:Preise|Prices|Çmimet|Prezzi)\s*:\s*([\p{L}]+)\s*\/\s*([\p{L}]+)/iu;
    const orderLine = lines.find((l) => orderPattern.test(l.text));
    const priceOrder = orderLine ? orderPattern.exec(orderLine.text) : null;
    const headingFor = (point: PdfMenuLine) =>
      headings
        .filter((h) => h.y > point.y && h.x <= point.x + 20)
        .sort((a, b) => a.y - b.y || b.x - a.x)[0];
    const sizes = priceOrder
      ? priceOrder.slice(1, 3).map((label) => {
          const definition = lines.find((l) =>
            l.text
              .toLocaleLowerCase()
              .startsWith(label!.toLocaleLowerCase() + ":"),
          );
          return definition
            ? { name: definition.text.replace(":", ""), quote: definition.text }
            : null;
        })
      : [];
    for (const line of productRows) {
      if (result.items.length >= 150) break;
      const match = rowPattern.exec(line.text)!;
      const prices = [...match[2]!.matchAll(/\d+(?:[.,]\d{1,2})?/g)].map((m) =>
        importPriceMinor(m[0], "EUR"),
      );
      const currency = /€|\bEUR\b/i.test(match[2]!)
        ? "EUR"
        : /\bALL\b|\bLek\b/i.test(match[2]!)
          ? "ALL"
          : null;
      const variants =
        prices.length === 2 &&
        sizes.length === 2 &&
        sizes.every(Boolean) &&
        orderLine &&
        headingFor(orderLine) &&
        headingFor(line) === headingFor(orderLine)
          ? sizes.map((s, i) => ({
              name: observed(s!.name, s!.quote),
              priceDeltaMinor: observed(prices[i]! - prices[0]!, line.text),
            }))
          : [];
      const base =
        prices.length === 1 || variants.length === 2 ? prices[0]! : null;
      const heading = headingFor(line);
      const categoryName = heading?.text.split(/\s+·\s+/)[0] ?? null;
      let category = result.categories.find(
        (c) => c.name.value === categoryName,
      );
      if (!category && result.categories.length < 50) {
        category = {
          id: randomUUID(),
          name: observed(categoryName, heading?.text ?? ""),
        };
        result.categories.push(category);
      }
      const description = lines
        .filter(
          (l) =>
            l.y < line.y &&
            line.y - l.y <= 25 &&
            Math.abs(l.x - line.x) <= 12 &&
            l.height < line.height &&
            !warning.test(l.text) &&
            !rowPattern.test(l.text),
        )
        .sort((a, b) => b.y - a.y)[0];
      result.items.push({
        id: randomUUID(),
        categoryId: observed(category?.id ?? null, heading?.text ?? line.text),
        name: observed(match[1]!.trim(), line.text),
        description: observed(
          description?.text ?? null,
          description?.text ?? "",
        ),
        priceMinor: observed(base, line.text),
        currency: observed(currency, line.text),
        variants,
        modifierGroups: [],
        allergenCandidates: [],
      });
    }
  }
  return result;
}

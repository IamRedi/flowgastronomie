import { randomUUID } from "node:crypto";
import {
  businessFieldSchema,
  type BusinessField,
} from "@flowgastronomie/domain";
import type { DiscoverySource } from "./business-import-extraction.js";
import type { PdfMenuLine } from "./menu-pdf-layout.js";

/** Conservative observed text only. Missing/ambiguous identity remains a review gap. */
export function pdfBusinessFields(
  source: DiscoverySource,
  pages: PdfMenuLine[][],
): BusinessField[] {
  const fields: BusinessField[] = [];
  const add = (field: BusinessField["field"], value: string, quote: string) => {
    const text = value.trim();
    if (!text || fields.some((f) => f.field === field && f.value === text))
      return;
    const row = businessFieldSchema.safeParse({
      id: randomUUID(),
      field,
      value: text,
      evidence: {
        sourceId: source.id,
        sourceUrl: source.sourceUrl,
        sourceHash: source.contentHash,
        excerpt: quote.slice(0, 1000),
        method: "PDF_TEXT",
        status: "SOURCE_OBSERVED",
        confidence: null,
      },
    });
    if (row.success) fields.push(row.data);
  };
  for (const page of pages)
    for (let i = 0; i < page.length; i++) {
      const line = page[i]!.text.trim();
      for (const email of line.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      ) ?? [])
        add("contactEmail", email, line);
      const phone =
        line.match(
          /(?:tel(?:efon|ephone)?\.?|phone|telefon[ia]?)\s*[:.]?\s*(\+?\d[\d\s()/.-]{5,}\d)/i,
        ) ?? line.match(/^(\+\d[\d\s()/.-]{7,}\d)$/);
      const international = line.match(/(\+\d[\d\s()/.-]{7,}\d)/);
      if (phone || international)
        add("phone", (phone ?? international)![1]!, line);
      const named = line.match(
        /^(?:business name|restaurant name|betriebsname|emri i lokalit)\s*:\s*(.+)$/i,
      );
      if (named) add("venueName", named[1]!, line);
      else if (
        i < 10 &&
        /^(?:pizzeria|ristorante|restaurant|restorant|bistro|café|cafe|gasthaus)\b\s+\S/i.test(
          line,
        ) &&
        !/(?:\d[,.]\d{2}|demo[- ]?test|speisekarte|menu\b)/i.test(line)
      )
        add("venueName", line, line);
      const address = line.match(/^(?:address|adresse|adresa)\s*:\s*(.+)$/i);
      if (address) add("address", address[1]!, line);
      else if (
        /(?:[\p{L}]+(?:straße|strasse|str\.|weg|platz)\s+\d|\b(?:Rruga|Bulevardi|Street|Via|Viale)\s+\S)/iu.test(
          line,
        ) &&
        !/[€$]/.test(line)
      ) {
        const next = page[i + 1]?.text.trim();
        add(
          "address",
          line + (next && /^\d{4,5}\s+\p{L}/u.test(next) ? `, ${next}` : ""),
          line + (next ? `\n${next}` : ""),
        );
      }
    }
  return fields.slice(0, 100);
}

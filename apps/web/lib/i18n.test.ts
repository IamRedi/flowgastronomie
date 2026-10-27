import { describe, expect, it } from "vitest";

import de from "../dictionaries/de.json";
import en from "../dictionaries/en.json";
import italian from "../dictionaries/it.json";
import sq from "../dictionaries/sq.json";
import { detectLocale, hasLocale } from "./i18n";

function dictionaryKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    dictionaryKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

describe("locale support", () => {
  it.each(["en", "de", "it", "sq"])("accepts %s", (locale) => {
    expect(hasLocale(locale)).toBe(true);
  });

  it("uses the highest-priority supported browser language", () => {
    expect(detectLocale("fr-FR;q=0.9,de-DE;q=0.8,en;q=0.7")).toBe("de");
  });

  it("falls back to Albanian when no supported language is present", () => {
    expect(detectLocale("fr-FR,es;q=0.8")).toBe("sq");
  });

  it.each([
    ["de", de],
    ["it", italian],
    ["sq", sq],
  ])(
    "keeps the %s dictionary structurally aligned with English",
    (_, value) => {
      expect(dictionaryKeys(value).sort()).toEqual(dictionaryKeys(en).sort());
    },
  );
});

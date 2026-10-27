import type { Locale } from "../lib/i18n";

const copy = {
  en: {
    back: "Back",
    tools: "Website tools",
    preview: "Preview",
    publish: "Publish",
    devices: "Preview size",
  },
  sq: {
    back: "Kthehu",
    tools: "Mjetet e website-it",
    preview: "Preview",
    publish: "Publiko",
    devices: "Madhësia e preview-t",
  },
  de: {
    back: "Zurück",
    tools: "Website-Werkzeuge",
    preview: "Vorschau",
    publish: "Veröffentlichen",
    devices: "Vorschaugröße",
  },
  it: {
    back: "Indietro",
    tools: "Strumenti del sito",
    preview: "Anteprima",
    publish: "Pubblica",
    devices: "Dimensione anteprima",
  },
};

export const websiteEditorCopy = (locale: Locale) => copy[locale];

import { notFound } from "next/navigation";

import { getDictionary } from "../../../../lib/dictionaries";
import { hasLocale } from "../../../../lib/i18n";

import { RadarClient } from "./radar-client";

export default async function DemoRadarPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const dictionary = await getDictionary(lang);

  return (
    <main className="real-radar-page">
      <header className="real-radar-header shell">
        <a className="brand brand-light" href={`/${lang}`}>
          <span className="brand-mark radar-brand-mark">FG</span>
          <span>FlowGastronomie</span>
        </a>
        <a href={`/${lang}`}>← {dictionary.radar.back}</a>
      </header>
      <section className="real-radar-intro shell">
        <p className="eyebrow eyebrow-light">{dictionary.radar.eyebrow}</p>
        <h1>Service Radar</h1>
        <p>{dictionary.radar.text}</p>
      </section>
      <RadarClient labels={dictionary.radar} locale={lang} />
    </main>
  );
}

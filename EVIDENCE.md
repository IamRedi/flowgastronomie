# Prüfprotokoll / Verification record

**Stand: 27. Oktober 2026.** Dieses Protokoll trennt, was gemessen wurde, von dem, was nur im Code vorhanden ist. Zahlen ohne Quelle gibt es hier nicht.

## Automatisierte Prüfungen

### Lokal, 27.10.2026

Frischer Checkout dieser Fassung, Node.js 22.22, PostgreSQL 16, Datenbank mit `prisma migrate deploy` (67 Migrationen) und `npm run db:seed` aufgebaut. Der Code entspricht dem Stand, der auf dem Server in Betrieb ist, ergänzt um die Änderungen für die öffentliche Fassung.

| Schritt                                                                              | Ergebnis                                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check` (Prettier)                                                    | bestanden                                                                                                           |
| `npm run typecheck` (TypeScript strict, alle Workspaces)                             | bestanden                                                                                                           |
| `npm test`: Node-Tests der Betriebsskripte                                           | **35 bestanden**                                                                                                    |
| `npm test`: Vitest in `apps/api`, `apps/web`, `packages/database`, `packages/domain` | **683 bestanden**; 103 Datenbanktests übersprungen, weil sie nur mit gesetzter Testdatenbank laufen                 |
| `npm run test:integration` gegen eine frisch migrierte PostgreSQL ohne Seed          | **77 bestanden** in 12 Dateien                                                                                      |
| `npm run build` (Next.js-Produktionsbuild und Typprüfung der Pakete)                 | bestanden                                                                                                           |
| gitleaks 8 über alle Dateien                                                         | keine Funde (Testkennungen wie `pos-idempotency-1` sind in [`.gitleaks.toml`](.gitleaks.toml) ausdrücklich erlaubt) |

Hinweis: Läuft `test:integration` gegen eine Datenbank, in der vorher `npm run db:seed` lief, schlägt ein Retention-Test fehl, weil er alle Nachrichten der Datenbank zählt. Gegen eine leere Datenbank laufen alle 77 Tests durch.

Nicht lokal gelaufen: Browser-Tests (`npm run test:e2e`), SSE-Proxy-Test und Backup-Probe, weil dafür Docker fehlte. Sie laufen in der CI.

### CI im öffentlichen Repository, 27.10.2026

Erster Lauf nach der Veröffentlichung ([Run 40495443530](https://github.com/IamRedi/flowgastronomie/actions/runs/40495443530)): gitleaks bestanden. In `release:verify` bestanden Migrationen, Integrationstests, Repository-Prüfung, Premium-Vorlagen und Smart Business Import V2; danach brach der Workforce-Upgrade-Test ab, weil er ein altes Prisma-Schema per `git show` aus einem Commit las, den dieses Repository ohne Vorgeschichte nicht enthält. Kein Fehler im Produktcode. Die drei betroffenen Upgrade-Tests lesen ihre Ausgangsschemata jetzt aus [`tests/fixtures/prisma-baselines`](tests/fixtures/prisma-baselines) und laufen lokal durch (Legacy, WF2 mit 13 Tabellen, WF3 mit 25 Tabellen unverändert). Das Ergebnis des nächsten vollständigen CI-Laufs wird hier nachgetragen.

## Manuelle Prüfungen

| Prüfung                                     | Beobachtung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screenshots in der README (27.10.2026)      | Aufgenommen mit Playwright/Chromium gegen den lokalen Produktionsbuild, nach `npm run db:seed` und `npm run demo:showcase` (fiktiver Betrieb; das Skript zeigt nur Gerichte, zu denen ein passendes Foto aus `apps/web/public` mit Quellenangabe vorliegt, und nimmt die übrigen Seed-Gerichte von der Karte), 1440 × 900 und 390 × 844 Pixel; jedes Bild einzeln angesehen. Das Titelbild der README setzt Kasse und Handy-Ansicht zu einem Bild zusammen.                                                                                                                                                                              |
| Rundgang-Video (27.10.2026)                 | 30 Sekunden mit Playwright aufgenommen (1280 × 800) gegen den lokalen Produktionsbuild nach `npm run db:seed` und `npm run demo:showcase`. Die gezeigte Bestellung für Tisch 06 wurde dabei wirklich an der Kasse angelegt und erscheint im Küchenmonitor und im Tagesbericht.                                                                                                                                                                                                                                                                                                                                                           |
| Browser-Durchgang Team-Bereich (27.10.2026) | Startseite, Kasse, Bestellungen, Küche, Speisekarte, Website, Reservierungen, Dienstplan, Team, Bericht und Wareneinsatz als Inhaber geöffnet. Behoben am selben Tag: Umlaute als Fragezeichen in Kasse und Zahlung, englische Allergen-Kürzel und „variants“ im Speisekarten-Editor, albanische Variante und englischer Bereichsname „Terrace“ im Demo-Seed, das Kennzeichen „LEGACY CI FIXTURE“ (jetzt „DEMO SEED“). Noch offen: Allergen-Kürzel im Wareneinsatz, ein Fragezeichen statt Trennzeichen im Dienstplan, die Seite „Online-Bestellungen“ teilweise ohne Gestaltung, leere Abschnitte wie „Personalregeln ·“ im Dienstplan. |

## Was nicht geprüft ist

- **Echter Betrieb.** Laut Betriebsprotokoll läuft die Plattform auf einem eigenen Server mit getrennter Produktionsdatenbank, und ein Pilotrestaurant nutzt die öffentliche Website mit Abholbestellung. Aus dieser Umgebung heraus war der Server nicht erreichbar, das wurde hier also nicht selbst geprüft. Die fiskaly-Anbindung wird nur mit der Sandbox getestet und ist nicht Teil dieses Repositorys. Es gibt keine öffentliche Demo mit fiktiven Daten.
- **Externe Dienste.** E-Mail (Brevo), KI-Import und Creative Studio (OpenAI), Web-Push und Bondrucker über die Android-Brücke sind mit Test-Doubles geprüft, nicht mit echten Konten oder Geräten.
- **Recht und Steuern.** Fiskalkasse (TSE), Online-Zahlung und arbeitsrechtliche Regeln im Dienstplan sind nicht rechtlich abgenommen. RestaurantFlow ist kein Kassensystem im Sinne der KassenSichV.
- **Last und Skalierung.** Es gab keinen Lasttest.

## Daten und Rechte

- Das Repository enthält keine echten Gäste-, Mitarbeiter- oder Betriebsdaten. Der Demo-Betrieb „Restaurant Olive“, seine Adresse („Musterstraße 27, Berlin“), Telefonnummer, Speisekarte und das Team sind erfunden ([`packages/database/prisma/seed.ts`](packages/database/prisma/seed.ts)). Testdaten nutzen `.local`-, `.test`- und `example.com`-Adressen.
- Diese Fassung wurde ohne den Git-Verlauf des privaten Arbeits-Repositorys veröffentlicht. Dort enthaltene Unterlagen eines Pilotbetriebs, interne Arbeitsnotizen und Prüfberichte mit Screenshots sind nicht enthalten.
- Speisenbilder unter `apps/web/public/pilot/demo-food` sind generiert. Produktfotos in den Vorlagen stammen von Unsplash (Unsplash-Lizenz); jede Quelle steht in [`apps/web/public/showcases/products/sources.json`](apps/web/public/showcases/products/sources.json).
- Texte, Gestaltung und Code: Redion Cekrezi. Es wird keine Nutzungslizenz über die [LICENSE](LICENSE) hinaus gewährt.

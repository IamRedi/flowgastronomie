# Prüfprotokoll / Verification record

**Stand: 27. Oktober 2026.** Dieses Protokoll trennt, was gemessen wurde, von dem, was nur im Code vorhanden ist. Zahlen ohne Quelle gibt es hier nicht.

## Automatisierte Prüfungen

### Lokal, 27.10.2026

Frischer Checkout dieser Fassung, Node.js 22.22, PostgreSQL 16, Datenbank mit `npm run db:migrate` (61 Migrationen) und `npm run db:seed` aufgebaut.

| Schritt                                                                              | Ergebnis                                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check` (Prettier)                                                    | bestanden                                                                                                           |
| `npm run typecheck` (TypeScript strict, alle Workspaces)                             | bestanden                                                                                                           |
| `npm test`: Node-Tests der Betriebsskripte                                           | **24 bestanden**                                                                                                    |
| `npm test`: Vitest in `apps/api`, `apps/web`, `packages/database`, `packages/domain` | **624 bestanden**; 89 Datenbanktests übersprungen, weil sie nur mit gesetzter Testdatenbank laufen                  |
| `npm run test:integration` gegen die lokale PostgreSQL                               | **70 bestanden** in 12 Dateien                                                                                      |
| `npm run build` (Next.js-Produktionsbuild und Typprüfung der Pakete)                 | bestanden                                                                                                           |
| gitleaks 8 über alle Dateien und den gesamten Git-Verlauf                            | keine Funde (Testkennungen wie `pos-idempotency-1` sind in [`.gitleaks.toml`](.gitleaks.toml) ausdrücklich erlaubt) |

Nicht lokal gelaufen: Browser-Tests (`npm run test:e2e`), SSE-Proxy-Test und Backup-Probe, weil dafür Docker fehlte. Sie laufen in der CI.

### CI

Die Release-Prüfung `npm run release:verify` (Migrationen, alle Datenbank-Gates, Repository-Tests, Browser-Tests, SSE-Proxy, Backup und Wiederherstellung, `npm audit`) lief zuletzt am **19.10.2026 grün** auf `main` (Commit `4bc6500`, Lauf 166 im privaten Arbeits-Repository). Für diese öffentliche Fassung läuft dieselbe Pipeline auf GitHub-gehosteten Runnern; das erste Ergebnis wird hier nachgetragen.

## Manuelle Prüfungen

| Prüfung                                     | Beobachtung                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screenshots in der README (27.10.2026)      | Aufgenommen mit Playwright/Chromium gegen den lokalen Produktionsbuild mit dem fiktiven Demo-Betrieb aus `npm run db:seed`, 1440 × 900 und 390 × 844 Pixel; jedes Bild einzeln angesehen                                                                                                                                                                                                                                                                                         |
| Browser-Durchgang Team-Bereich (27.10.2026) | Startseite, Kasse, Bestellungen, Küche, Speisekarte, Website, Reservierungen, Dienstplan, Team, Bericht und Wareneinsatz als Inhaber geöffnet. Gefunden: Allergen-Kürzel im Editor und im Wareneinsatz auf Englisch, eine Variante im Demo-Seed auf Albanisch, ein Fragezeichen statt Trennzeichen im Dienstplan, die Seite „Online-Bestellungen“ teilweise ohne Gestaltung, das Kennzeichen „LEGACY CI FIXTURE“ in der Seitenleiste des Seed-Betriebs. Diese Punkte sind offen. |

## Was nicht geprüft ist

- **Echter Betrieb.** Die Plattform lief noch nicht in einem echten Restaurant und nicht auf einem öffentlichen Server. Es gibt keine Live-Demo.
- **Externe Dienste.** E-Mail (Brevo), KI-Import und Creative Studio (OpenAI), Web-Push und Bondrucker über die Android-Brücke sind mit Test-Doubles geprüft, nicht mit echten Konten oder Geräten.
- **Recht und Steuern.** Fiskalkasse (TSE), Online-Zahlung und arbeitsrechtliche Regeln im Dienstplan sind nicht rechtlich abgenommen. RestaurantFlow ist kein Kassensystem im Sinne der KassenSichV.
- **Last und Skalierung.** Es gab keinen Lasttest.

## Daten und Rechte

- Das Repository enthält keine echten Gäste-, Mitarbeiter- oder Betriebsdaten. Der Demo-Betrieb „Restaurant Olive“, seine Adresse („Musterstraße 27, Berlin“), Telefonnummer, Speisekarte und das Team sind erfunden ([`packages/database/prisma/seed.ts`](packages/database/prisma/seed.ts)). Testdaten nutzen `.local`-, `.test`- und `example.com`-Adressen.
- Diese Fassung wurde ohne den Git-Verlauf des privaten Arbeits-Repositorys veröffentlicht. Dort enthaltene Unterlagen eines Pilotbetriebs, interne Arbeitsnotizen und Prüfberichte mit Screenshots sind nicht enthalten.
- Speisenbilder unter `apps/web/public/pilot/demo-food` sind generiert. Produktfotos in den Vorlagen stammen von Unsplash (Unsplash-Lizenz); jede Quelle steht in [`apps/web/public/showcases/products/sources.json`](apps/web/public/showcases/products/sources.json).
- Texte, Gestaltung und Code: Redion Cekrezi. Es wird keine Nutzungslizenz über die [LICENSE](LICENSE) hinaus gewährt.

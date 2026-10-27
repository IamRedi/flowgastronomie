# Sicherheit

## Schwachstellen melden

Bitte keine öffentlichen Issues für Sicherheitslücken. Melde sie vertraulich über
**GitHub → Security → Report a vulnerability** (Private Vulnerability Reporting).
Du bekommst innerhalb von 7 Tagen eine Rückmeldung. Bestätigte Lücken werden
behoben, bevor Details veröffentlicht werden.

## Bedrohungsmodell

### Was geschützt wird

| Asset                                                                                          | Warum es zählt                               |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Daten der Gäste (Name, Telefon, E-Mail, Lieferadresse bei Online-Bestellungen, Reservierungen) | DSGVO-relevant; Leck schadet Personen direkt |
| Personaldaten (Schichten, Arbeitszeiten, Monatskonten, Dokumente)                              | DSGVO-relevant, teils besonders sensibel     |
| Speisekarten-Entwürfe, Preise, Rezepte, Einkaufspreise, Umsätze                                | Geschäftsgeheimnisse des Betriebs            |
| Mitarbeiter-Sitzungen und Tisch-QR-Codes                                                       | Schlüssel zu Bestellungen und Verwaltung     |

### Wer angreift

1. **Anonyme Gäste und Internetnutzer**: erreichen die öffentliche Website, die Speisekarte über den Tisch-QR, Online-Bestellung und Sendungsverfolgung.
2. **Angemeldete Mitarbeitende**: dürfen nur, was ihre Rolle (Inhaber, Manager, Service, Bar, Küche) erlaubt, und nur im eigenen Lokal.
3. **Andere Mandanten**: ein fremder Betrieb auf derselben Instanz. Er darf nie Daten eines anderen Betriebs lesen oder ändern.
4. **Abgegriffene Sitzung oder abfotografierter QR-Code**.

Außerhalb des Modells: ein kompromittierter Server, Datenbank-Superuser und
die Infrastruktur des Hosting-Anbieters.

### Kontrollen

| Bedrohung                                       | Kontrolle                                                                                                                                                                                                 | Wo                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fremder Mandant liest Daten                     | `tenantId` an jedem mandanteneigenen Datensatz; Repository-Methoden verlangen Mandant und Lokal als Pflichtparameter statt eines optionalen Filters                                                       | `packages/database/src/*-repository.ts`, [Architektur](docs/architecture/ARCHITECTURE.md#multi-tenancy) |
| Rechteausweitung                                | Domänen-Berechtigungen pro Rolle, in jeder geschützten Route geprüft; Inhaber-Funktionen nur für Inhaber                                                                                                  | `packages/domain/src`, `apps/api/src/app.ts`                                                            |
| Tisch-QR erraten                                | Hochentropische, nicht fortlaufende Tokens; gespeichert wird nur der SHA-256-Hash; Rotation macht den alten Link sofort ungültig                                                                          | [Architektur](docs/architecture/ARCHITECTURE.md#anonymous-table-sessions)                               |
| Manipulierte Preise                             | Preise, Summen, Verfügbarkeit und Station werden serverseitig ermittelt; vom Gast gesendete Preise werden nie übernommen; Geld als Ganzzahl in Cent                                                       | `packages/domain`, `apps/api/src/app.ts`                                                                |
| Passwort raten                                  | scrypt-Hashes mit Salt; Rate-Limit pro Client für Login, Registrierung, Einladungen und alle Gast-Schreibzugriffe                                                                                         | `packages/database/src/password.ts`, `apps/api/src/guest-rate-limit.ts`                                 |
| Sitzung gestohlen                               | Serverseitige Sitzung, Rohtoken nur im `HttpOnly`-/`SameSite=Lax`-Cookie, in der Datenbank nur der SHA-256-Hash; Ablauf nach 12 Stunden; Entzug der Mitgliedschaft beendet auch offene Live-Streams (SSE) | `apps/api/src/live-session.ts`, `tests/operations/sse-proxy-smoke.mjs`                                  |
| Gleichzeitige Änderungen                        | Bestell-Updates mit erwarteter Version; erlaubte Statusübergänge als Zustandsautomat in der Domäne                                                                                                        | `packages/domain`                                                                                       |
| Ungültige Eingaben                              | Zod-Schemas an jeder API-Grenze                                                                                                                                                                           | `apps/api/src`                                                                                          |
| Server-Side Request Forgery beim Website-Import | Abruf nur öffentlicher Adressen (private, Link-Local- und Metadaten-Adressen werden abgewiesen), Grenzen für Anfragen, Seiten, Tiefe, Bytes und Zeit                                                      | `apps/api/src/business-import-network.ts`                                                               |
| Weitergegebene Kopfzeilen fälschen              | `TRUST_PROXY` muss ausdrücklich gesetzt werden; der NGINX-Rand ersetzt `X-Forwarded-*`                                                                                                                    | `apps/api/src/guest-rate-limit.ts`, `infra/production/nginx.conf.template`                              |
| KI erfindet Allergene                           | KI-Vorschläge für Allergene brauchen eine menschliche Freigabe vor der Veröffentlichung                                                                                                                   | `packages/database/src/menu-import-commit.ts`                                                           |
| Geheimnisse im Repository                       | Statische Prüfung lehnt getrackte `.env`-Dateien und unerwartete `NEXT_PUBLIC_*`-Variablen ab; gitleaks in der CI                                                                                         | `tests/operations/static-security-check.mjs`, `.github/workflows/ci.yml`                                |
| Verwundbare Abhängigkeiten                      | `npm audit --omit=dev --audit-level=high` als Teil von `npm run test:security`                                                                                                                            | `package.json`                                                                                          |
| Clickjacking, MIME-Sniffing, Downgrade          | HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP `frame-ancestors 'self'` am NGINX-Rand                                                                                                      | `infra/production/public-edge.conf`                                                                     |
| Fremder Code auf eigener Hardware               | CI läuft nur auf GitHub-gehosteten Runnern, nie auf einem selbst betriebenen Runner                                                                                                                       | `.github/workflows/*.yml`                                                                               |

### Bekannte Restrisiken

- **Keine Datenbank-Row-Level-Security.** Die Mandantentrennung liegt in der Anwendung (Pflicht-Scope in jedem Repository). Ein Programmierfehler in einer neuen Abfrage würde nicht von PostgreSQL abgefangen.
- **Sicherheits-Header nur am Rand.** HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` und eine schmale CSP (`frame-ancestors`, `base-uri`, `object-src`) setzt der NGINX-Rand (`infra/production/public-edge.conf`). Die Next.js-App selbst setzt keine; ohne diesen Proxy fehlen sie. Eine CSP für Skripte und Styles gibt es noch nicht.
- **Erst im Pilotbetrieb.** Die Plattform läuft mit einem Pilotrestaurant. Zahlungen, Fiskalkasse (TSE, bisher nur fiskaly-Sandbox) und Live-Anbieter (E-Mail, KI, Push) sind nicht mit echten Konten abgenommen.

Was davon gemessen und was nur im Code vorhanden ist, steht in [EVIDENCE.md](EVIDENCE.md).

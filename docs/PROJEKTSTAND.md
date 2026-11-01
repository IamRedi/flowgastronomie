# Projektstand

**Stand: 2. November 2026.** Was erreicht ist, was offen ist und wie das Projekt dahin kam. Belege zu jeder Zahl stehen in [EVIDENCE.md](../EVIDENCE.md).

## Aktueller Betriebsnachweis · 2. November 2026

Die private Betriebsfassung bietet die überarbeitete mehrsprachige Pilotwebsite,
gemeinsame bearbeitbare Produktbilder, Google Maps nach ausdrücklichem Laden und
einen Hinweis auf den Verkauf im Lokal. Öffentliche Bestellung serverseitig OFF;
POS/Fiskalisierung TEST. Neun gezielte Präsentationstests, Web-Typprüfung und der
erforderliche Web-Build bestanden; HTTP- und Browser-Smoke für die öffentliche
Website bestanden. Kein neuer globaler Testlauf, keine Schemaänderung.
Bestehender Kern, Mandant und Infrastruktur bleiben erhalten. Beta / 80 bleibt
unverändert. Details: [EVIDENCE.md](../EVIDENCE.md). Die folgenden älteren
Zusammenfassungen beschreiben ihren jeweils datierten Stand.

## Neuer Betriebsnachweis · 1. November 2026

Bestehende Pilotwebsite auf verifizierter eigener HTTPS-Domain, automatische ACME-Erneuerung, vier Sprachen und Link zur vorhandenen POS-Anmeldung. Nur Gast-APIs erlauben verifizierte Website-Ursprünge. Kein neuer Mandant oder Server, keine Änderung an Fiskal-LIVE, Bankzahlungen oder Gerätefreigaben. Umsetzung in der privaten Betriebsfassung; öffentliche Beschreibung ohne Kundendaten. Ältere Zusammenfassungen unten bleiben datierte Historie.

## Kurzfassung

RestaurantFlow ist funktional weit (Gast, Service, Küche, Kasse, Online-Bestellung, Website-Builder, Personal, Berichte) und läuft auf einem eigenen Server mit getrennter Produktionsdatenbank. Ein Pilotrestaurant nutzt die öffentliche Website mit Speisekarte und Abholbestellung; die Kassenanbindung an fiskaly wird nur gegen die kostenlose Sandbox getestet und liegt noch außerhalb dieses Repositorys. Die nächsten Schritte sind eine öffentliche Demo mit fiktiven Daten und die offenen Oberflächenfehler aus dem Browser-Durchgang.

## Verlauf

| Datum          | Schritt                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 09.08.2026     | Ausgangsbasis: Monorepo, Domäne, QR-Speisekarte, Service Radar, Online-Bestellung mit Küchenablauf, Benachrichtigungs-Schnittstelle, Betriebs-Runbook                                                                 |
| 03.–05.10.2026 | Kasse für den Thekenverkauf, MwSt. und Belege, Android-Brücke für Bondrucker, Betriebsablauf, Zahlungsabgleich, Online-Bestellung mit Zeitfenstern und Sendungsverfolgung                                             |
| 06.10.2026     | Öffentlicher Bestellstatus mit eigenem Rate-Limit                                                                                                                                                                     |
| 07.–08.10.2026 | Creative Studio, Smart Setup mit Speisekarten-Import, Vorlagen für neun Betriebsarten                                                                                                                                 |
| 09.10.2026     | Smart Business Import V2: neue Betriebe registrieren sich selbst, kein Betrieb wird vorab angelegt                                                                                                                    |
| 09.–10.10.2026 | Personal WF1–WF4: Dienstplan, Stempeluhr, Urlaub, Tausch von Schichten, Monatskonten, Benachrichtigungen, Simulation über einen ganzen Monat                                                                          |
| 11.–12.10.2026 | Operations Lab: zwei synthetische Lokale (DE, AL) laufen über echte APIs und PostgreSQL, mit Neustart, Wiederholung und Wiederherstellung                                                                             |
| 13.–16.10.2026 | Staging und danach öffentliche Produktion auf eigenem Server: getrennte Datenbank, verschlüsselte Backups auf Objektspeicher, öffentliche Website V3 mit Warenkorb, kompakter Website-Editor, Konto-Wiederherstellung |
| 18.–19.10.2026 | CI-Ressourcen begrenzt, Abhängigkeiten ohne hohe Schwachstellen, Neon-Leerlaufregeln                                                                                                                                  |
| 20.–25.10.2026 | Stabilisierung für den Pilot, KI-Bildanbieter mit Limits, Website V2 des Pilotrestaurants mit Abholung so bald wie möglich                                                                                            |
| 27.10.2026     | Öffentliche Fassung vorbereitet: Pilotunterlagen und interne Notizen entfernt, Demo-Daten fiktiv, CI nur auf GitHub-Runnern, gitleaks, README, Sicherheits- und Prüfdokumente                                         |

Die ausführlichen Begründungen stehen im [Entscheidungslog](product/DECISIONS.md) und im [Changelog](../CHANGELOG.md).

## Offen

- Oberflächenfehler aus dem Browser-Durchgang vom 27.10.2026 (siehe [EVIDENCE.md](../EVIDENCE.md#manuelle-prüfungen)).
- Der Seed-Betrieb hat Daten, die Demo-Vorlagen (`npm run demo:workspace`) legen dagegen noch leere Betriebe an. Für eine öffentliche Demo braucht es einen Vorlagenbetrieb mit Speisekarte, Tischen und Beispielbestellungen.
- Sicherheits-Header für die Web-App, siehe [SECURITY.md](../SECURITY.md#bekannte-restrisiken).
- Abnahme der externen Dienste (E-Mail, KI, Push, Drucker) mit echten Konten und Geräten.
- Fiskalisierung mit TSE: nur Sandbox-Tests, kein Echtbetrieb.

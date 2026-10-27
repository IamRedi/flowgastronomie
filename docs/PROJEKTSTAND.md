# Projektstand

**Stand: 27. Oktober 2026.** Was erreicht ist, was offen ist und wie das Projekt dahin kam. Belege zu jeder Zahl stehen in [EVIDENCE.md](../EVIDENCE.md).

## Kurzfassung

RestaurantFlow ist funktional weit (Gast, Service, Küche, Kasse, Online-Bestellung, Website, Personal, Berichte), aber noch nicht im Echtbetrieb. Es gibt keinen Pilotbetrieb und keinen öffentlichen Server. Die nächsten Schritte sind eine öffentliche Demo mit fiktiven Daten, die offenen Oberflächenfehler aus dem Browser-Durchgang und danach ein erster Pilot.

## Verlauf

| Datum          | Schritt                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 09.08.2026     | Ausgangsbasis: Monorepo, Domäne, QR-Speisekarte, Service Radar, Online-Bestellung mit Küchenablauf, Benachrichtigungs-Schnittstelle, Betriebs-Runbook                         |
| 03.–05.10.2026 | Kasse für den Thekenverkauf, MwSt. und Belege, Android-Brücke für Bondrucker, Betriebsablauf, Zahlungsabgleich, Online-Bestellung mit Zeitfenstern und Sendungsverfolgung     |
| 06.10.2026     | Öffentlicher Bestellstatus mit eigenem Rate-Limit                                                                                                                             |
| 07.–08.10.2026 | Creative Studio, Smart Setup mit Speisekarten-Import, Vorlagen für neun Betriebsarten                                                                                         |
| 09.10.2026     | Smart Business Import V2: neue Betriebe registrieren sich selbst, kein Betrieb wird vorab angelegt                                                                            |
| 09.–10.10.2026 | Personal WF1–WF4: Dienstplan, Stempeluhr, Urlaub, Tausch von Schichten, Monatskonten, Benachrichtigungen, Simulation über einen ganzen Monat                                  |
| 11.–12.10.2026 | Operations Lab: zwei synthetische Lokale (DE, AL) laufen über echte APIs und PostgreSQL, mit Neustart, Wiederholung und Wiederherstellung                                     |
| 18.–19.10.2026 | CI-Ressourcen begrenzt, Abhängigkeiten ohne hohe Schwachstellen, letzte grüne Release-Prüfung auf `main`                                                                      |
| 27.10.2026     | Öffentliche Fassung vorbereitet: Pilotunterlagen und interne Notizen entfernt, Demo-Daten fiktiv, CI nur auf GitHub-Runnern, gitleaks, README, Sicherheits- und Prüfdokumente |

Die ausführlichen Begründungen stehen im [Entscheidungslog](product/DECISIONS.md) und im [Changelog](../CHANGELOG.md).

## Offen

- Oberflächenfehler aus dem Browser-Durchgang vom 27.10.2026 (siehe [EVIDENCE.md](../EVIDENCE.md#manuelle-prüfungen)).
- Der Seed-Betrieb hat Daten, die Demo-Vorlagen (`npm run demo:workspace`) legen dagegen noch leere Betriebe an. Für eine öffentliche Demo braucht es einen Vorlagenbetrieb mit Speisekarte, Tischen und Beispielbestellungen.
- Sicherheits-Header für die Web-App, siehe [SECURITY.md](../SECURITY.md#bekannte-restrisiken).
- Abnahme der externen Dienste (E-Mail, KI, Push, Drucker) mit echten Konten und Geräten.
- Server-Betrieb: Paket und Runbook liegen vor ([OVH-Paket](operations/OVH_PRODUCTION_PACKAGE.md), [Runbook](operations/PRODUCTION_RUNBOOK.md)), ein Server läuft noch nicht.

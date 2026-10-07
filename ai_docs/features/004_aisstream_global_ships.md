# AISStream: weltweiter Schifftracker

## Kontext & Problemstellung
Der Schiff-Layer (Spec 003) nutzt Digitraffic Marine und zeigt deshalb nur die Ostsee. Außerhalb davon bleibt die Karte leer. AISStream.io liefert einen kostenlosen weltweiten AIS-Datenstrom per WebSocket (`wss://stream.aisstream.io/v0/stream`) mit Bounding-Box-Filter. Der API-Key darf nicht in den Browser gelangen, daher braucht es eine serverseitige Schicht.

## Anforderungen
- [ ] Als Nutzer möchte ich Schiffe auch außerhalb der Ostsee sehen, sobald ich dorthin zoome.
- [ ] Der bestehende Schalter „Schiffe anzeigen“ steuert beide Quellen gemeinsam; es gibt keinen zweiten Schalter.
- [ ] Innerhalb der Ostsee bleibt Digitraffic die Quelle; AISStream deckt den Rest ab. Schiffe erscheinen nie doppelt (Deduplizierung per MMSI).
- [ ] Der AISStream-API-Key liegt ausschließlich serverseitig (Umgebungsvariable `AISSTREAM_API_KEY`), nie im Repo, nie im Client-Bundle, nie in Antworten oder Logs.
- [ ] Eine neue API-Route (z. B. `app/api/ships/route.js`) fragt AISStream mit der aktuellen Bounding-Box des Kartenausschnitts ab und liefert dem Browser eine begrenzte Momentaufnahme als JSON (kein Durchreichen des WebSockets an den Client).
- [ ] Die Route validiert die Bounding-Box (Zahlen, gültige Bereiche, maximale Ausdehnung) und begrenzt die Antwort (höchstens 500 Schiffe, Mindestzoom 5 wie in Spec 003).
- [ ] Die Route begrenzt Anfragen (Rate Limit je Client, Zwischenspeicher für gleiche Ausschnitte), damit das AISStream-Kontingent nicht erschöpft wird.
- [ ] Namen, Ziele und Typen aus AISStream werden wie in `ships.js` ausschließlich per `textContent` eingesetzt; ins `divIcon`-HTML fließen nur geprüfte Zahlen.
- [ ] Fällt AISStream aus oder fehlt der Key, zeigt die Karte weiter Digitraffic-Schiffe und eine dezente Statusmeldung; die App bleibt benutzbar.
- [ ] Die Quelle (AISStream.io) wird in der Karten-Attribution genannt.

## Definition of Done
- [ ] Alle Anforderungen oben sind abgehakt.
- [ ] Alle manuellen Tests (Abschnitt „Tests“) wurden auf `localhost` und auf Vercel durchgeführt und sind abgehakt.
- [ ] Der StackHawk-Neuscan zeigt keine neuen Befunde; die neue Route steht unter `hawk.spider.seedPaths` in `stackhawk.yml`.
- [ ] Im Produktions-Bundle und in allen Netzwerkantworten kommt der API-Key nicht vor.
- [ ] `middleware.js` (CSP) ist angepasst, falls nötig; keine CSP-Fehler in der Browser-Konsole.
- [ ] `CLAUDE.md` (Architektur, Sicherheitsregel, Umgebungsvariable) ist aktualisiert.

## Betroffene Bereiche & Technik
- `app/api/ships/route.js` (neu): Server-Proxy zu AISStream, Bounding-Box-Validierung, Cache, Rate Limit.
- `app/ships.js`: Datenschicht um die zweite Quelle erweitern, Deduplizierung per MMSI, gleiche Sicherheitsregel für Fremddaten.
- `app/IssMap.js`: bei `moveend` Bounding-Box an die neue Route geben, wenn der Ausschnitt außerhalb der Ostsee liegt; Attribution ergänzen.
- `middleware.js`: CSP nur anpassen, wenn der Browser eine neue Domain direkt anspricht. Bei reinem Proxy über die eigene Route bleibt `connect-src` unverändert.
- `stackhawk.yml`: neue Route in `hawk.spider.seedPaths`.
- Konfiguration: `AISSTREAM_API_KEY` in `.env.local` (nicht committen) und in den Vercel-Projektvariablen.

## Tests
Es gibt keinen Test-Runner; die Fälle werden manuell im Browser geprüft (Produktion und `localhost`).
- [ ] Happy Path: Schalter „Schiffe anzeigen“ an, Zoom ≥ 5 auf die Nordsee oder das Mittelmeer: Schiffsmarker erscheinen und bewegen sich nach einigen Minuten.
- [ ] Ostsee: Schiffe erscheinen weiterhin; kein MMSI taucht doppelt auf (Stichprobe per Klick, Anzahl der Marker mit und ohne AISStream-Antwort vergleichen).
- [ ] Zoom < 5: es werden keine Anfragen an `/api/ships` gesendet (Netzwerk-Tab).
- [ ] Schalter aus: keine Anfragen an `/api/ships`, keine Marker.
- [ ] Klick auf ein Schiff: Name und Typ erscheinen; ein präparierter Name mit `<img src=x onerror=alert(1)>` wird als Text angezeigt und führt nichts aus (bei Prüfung mit gemockter Antwort).
- [ ] Key-Schutz: Suche im Quelltext, in den Netzwerkantworten und im `.next/static`-Bundle nach dem Key liefert keinen Treffer.
- [ ] Ungültige Eingaben: `/api/ships?...` mit Nicht-Zahlen, vertauschten Grenzen oder riesigem Ausschnitt liefert 400, keinen Absturz und keine AISStream-Anfrage.
- [ ] Rate Limit: viele schnelle Anfragen von einem Client führen zu 429, danach funktioniert die Route wieder.
- [ ] Fehlerfall: ohne `AISSTREAM_API_KEY` oder bei falschem Key bleibt die App benutzbar, Digitraffic-Schiffe sind sichtbar, die Statusmeldung erscheint, keine Fehler in der Konsole außer der erwarteten Meldung.
- [ ] CSP: keine Verstöße in der Browser-Konsole beim Verschieben und Zoomen der Karte.
- [ ] Regression: ISS-Marker, Spur, Dark Mode (001) und Satellitenansicht (002) funktionieren unverändert.

## Umsetzungsideen / Hinweise (optional)
- Vercel-Funktionen halten keine dauerhaften WebSockets; die Route öffnet pro Anfrage kurz eine Verbindung (z. B. 3–5 s Sammelfenster), sammelt `PositionReport`-Nachrichten und schließt wieder. Ein kurzes Caching (z. B. 15–30 s je gerundeter Bounding-Box) senkt die Last.
- Alternative bei zu geringer Trefferdichte: ein kleiner separater Dienst mit dauerhafter Verbindung (außerhalb von Vercel) und Zwischenspeicher.
- Bounding-Box vor dem Senden auf ein Raster runden, damit der Cache greift.
- Nachrichtentypen auf `PositionReport` und `ShipStaticData` beschränken (`FilterMessageTypes`).

## Offene Fragen / Abhängigkeiten (optional)
- Funktioniert das Sammelfenster-Modell mit AISStream auf Vercel zuverlässig genug (Dichte, Laufzeitlimit, Kaltstart), oder braucht es einen dauerhaften Dienst?
- Welches Kontingent und welche Nutzungsbedingungen gelten für den kostenlosen AISStream-Key (u. a. bei öffentlicher Weitergabe der Daten)? Vor der Umsetzung prüfen.
- Rate-Limit-Speicher: In-Memory reicht auf Vercel nur eingeschränkt (mehrere Instanzen). Genügt das, oder wird ein externer Speicher gebraucht?
- Soll ein Test-Runner (z. B. Vitest) für die Validierungslogik der Route eingeführt werden?
- Annahme: Digitraffic bleibt für die Ostsee die Hauptquelle, weil dort die Daten vollständiger sind. Bestätigen.

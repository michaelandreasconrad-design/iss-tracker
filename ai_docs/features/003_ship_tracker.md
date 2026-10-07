# Schifftracker (Schiffe auf der Karte)

## Kontext & Problemstellung
Die Karte zeigt bisher nur die ISS. Nutzer möchten zusätzlich Schiffe live auf der Karte sehen, auch in der Satellitenansicht (`002_satellite_view.md`), wo die Meere erkennbar sind. Angenommen wird ein zuschaltbarer Layer in der bestehenden Karte, keine eigene zweite App.

## Anforderungen
- [x] Als Nutzer möchte ich per Schalter „Schiffe anzeigen“ Schiffspositionen auf der Karte ein- und ausblenden. Standard: aus.
- [x] Als Nutzer möchte ich ein Schiff anklicken und Name, MMSI, Schiffstyp, Geschwindigkeit, Kurs und Ziel sehen (sofern vorhanden).
- [x] Schiffe erscheinen als eigene Marker, die sich vom ISS-Marker klar unterscheiden und nach Kurs (COG bzw. Heading) gedreht sind. Stehende Schiffe (Geschwindigkeit ≈ 0) werden ohne Richtung dargestellt.
- [ ] Positionen werden alle 60 Sekunden aktualisiert (AIS-Daten ändern sich seltener als die ISS). Der ISS-Takt von ca. 5 s bleibt unberührt.
- [x] Es werden nur Schiffe im sichtbaren Kartenausschnitt dargestellt. Bei zu niedriger Zoomstufe (unter 5) erscheint ein Hinweis „Zum Anzeigen der Schiffe weiter hineinzoomen“, statt Tausende Marker zu zeichnen.
- [x] Höchstens 500 Schiffe gleichzeitig. Wird die Grenze erreicht, steht ein Hinweis „Ausschnitt enthält mehr Schiffe als angezeigt“ da.
- [x] Ist die Datenquelle nicht erreichbar, erscheint ein verständlicher Hinweis. Karte, ISS-Anzeige und Polling bleiben unberührt, und der nächste Abruf versucht es erneut.
- [x] Die Quellenangabe der Datenquelle steht sichtbar auf der Karte (Attribution), solange der Layer aktiv ist.
- [x] Die Wahl „Schiffe anzeigen“ wird in `localStorage` gespeichert (Schlüssel `showShips`).
- [x] Die Schiffe sind in beiden Themes (Hell und Dunkel) und in beiden Kartenansichten (Straße, Satellit) gut erkennbar.
- [ ] Der Schalter ist per Tastatur bedienbar und hat eine Beschriftung für Screenreader.

## Definition of Done
- [ ] Alle Anforderungen oben sind erfüllt, in beiden Themes und beiden Kartenansichten.
- [x] Die Content Security Policy in `middleware.js` erlaubt die Datenquelle unter `connect-src` (bzw. nur `'self'`, falls ein Proxy genutzt wird). Es gibt keine CSP-Fehler in der Konsole.
- [x] Es stehen keine API-Schlüssel oder Secrets im Code oder im Repo.
- [ ] ISS-Marker, Spur, „Karte folgt der ISS“, Astronautenliste und Theme-/Ansichtsumschalter laufen unverändert.
- [x] Der StackHawk-Neuscan (`hawk rescan`) zeigt keine neuen Befunde, auch für eine eventuelle neue API-Route.
- [ ] Tests laufen (siehe „Tests“), Änderung ist auf Vercel deployt und dort geprüft.

## Betroffene Bereiche & Technik
- `app/IssMap.js`: Layer für Schiffsmarker (`L.layerGroup`), Abruf passend zum Kartenausschnitt (`moveend`/`zoomend`), Popup, Zoom- und Mengenbegrenzung. Marker per `L.divIcon` mit gedrehtem Symbol, damit keine Bilddateien nötig sind.
- `app/page.js`: Schalter „Schiffe anzeigen“ neben „Karte folgt der ISS“, Zustand und gespeicherte Wahl.
- `app/api/ships/route.js` (nur falls Proxy nötig): Route Handler mit Zwischenspeicher (z. B. 30–60 s), wie `app/api/astros/route.js`. Die Route nimmt die Kartengrenzen als Parameter entgegen und prüft sie (Zahlen, Wertebereich), damit keine beliebigen Anfragen an die Quelle weitergereicht werden.
- `middleware.js`: `connect-src` und, falls Symbole als Bilder geladen werden, `img-src` anpassen.
- `app/globals.css`: Stil der Schiffsmarker für beide Themes.
- Datenquelle (Annahme, noch zu bestätigen): Digitraffic Marine (Fintraffic), AIS-Positionen `https://meri.digitraffic.fi/api/ais/v1/locations` und Schiffsdaten `https://meri.digitraffic.fi/api/ais/v1/vessels`. Kein API-Schlüssel, offene Daten (CC BY 4.0, Quellenangabe „Fintraffic / digitraffic.fi“). Abdeckung: Ostsee und finnische Gewässer, nicht weltweit.
- Keine neuen Abhängigkeiten.

## Tests
Das Projekt hat noch keinen Test-Runner. Die Fälle sind deshalb manuell im Browser prüfbar formuliert (Produktion und `localhost:3000`):
- [x] Happy Path: „Schiffe anzeigen“ einschalten, auf den Golf von Finnland (Helsinki–Tallinn) zoomen. Mehrere Schiffe erscheinen, Marker sind nach Kurs gedreht.
- [x] Klick auf ein Schiff zeigt ein Popup mit Name, MMSI, Geschwindigkeit und Kurs. Fehlende Felder (z. B. kein Ziel) werden weggelassen oder mit „–“ angezeigt, ohne Fehlermeldung.
- [ ] Nach ca. 60 s bewegen sich fahrende Schiffe sichtbar, ohne dass die Karte flackert oder der Ausschnitt springt.
- [x] Zoom unter Stufe 5: Marker verschwinden, der Hinweis zum Hineinzoomen erscheint.
- [x] Ausschnitt mit sehr vielen Schiffen (z. B. Hafen Helsinki bei Zoom 5): höchstens 500 Marker, der Mengenhinweis erscheint, die Karte bleibt flüssig.
- [x] Außerhalb der Abdeckung (z. B. Karibik): keine Schiffe, aber ein Hinweis „In diesem Gebiet liegen keine Schiffsdaten vor“ statt einer leeren Karte ohne Erklärung.
- [x] Fehlerfall: Datenquelle in den Entwicklerwerkzeugen blockieren. Der Hinweis erscheint, ISS-Marker und Spur laufen weiter, und nach Aufheben der Sperre erscheinen die Schiffe wieder.
- [x] Schalter aus: alle Schiffsmarker verschwinden, es gehen keine Abrufe mehr an die Datenquelle (Netzwerk-Tab).
- [x] Neuladen: die zuletzt gewählte Einstellung ist aktiv.
- [x] Dark Mode und Satellitenansicht: Schiffsmarker bleiben auf Straßenkarte und auf dem Satellitenbild erkennbar.
- [x] Browser-Konsole zeigt keine CSP- oder Hydration-Fehler.
- [ ] Regression: ISS-Marker bewegt sich weiter alle ca. 5 s, „Karte folgt der ISS“ funktioniert mit eingeschaltetem Schiffs-Layer.
- [ ] Bei Proxy-Route: Aufruf mit ungültigen Parametern (Text statt Zahl, Werte außerhalb ±90°/±180°) liefert HTTP 400 und keine Anfrage an die Quelle.

## Umsetzungsideen / Hinweise
- Umgesetzt wurde abweichend vom ersten Entwurf: Die Digitraffic-API kennt keinen Kartenausschnitt (Bounding Box), nur einen Radius. Es sind nur ca. 900 Schiffe (ca. 360 KB), die API cacht 60 s und erlaubt Browser-Aufrufe (CORS). Deshalb holt der Browser einmal pro Minute alle Positionen und filtert auf den sichtbaren Ausschnitt. Ein Proxy und eine neue API-Route entfallen. Die API verlangt gzip (Browser senden es automatisch).
- Positions- und Schiffsdaten sind getrennte Abrufe. Schiffsnamen und -typen nur beim Klick nachladen und zwischenspeichern.
- Optional später: Schiffstyp als Farbe (Fracht, Tanker, Passagier, Fischerei), Suche nach Schiffsname oder MMSI, Spur des angeklickten Schiffs.

## Offene Fragen / Abhängigkeiten
- Soll der Schifftracker weltweit funktionieren? Digitraffic deckt nur die Ostsee ab. Weltweite AIS-Daten gibt es z. B. über AISStream.io (kostenlos, aber API-Schlüssel und WebSocket), das bräuchte einen Server mit Schlüssel als Secret und ist auf Vercel-Funktionen schwierig. Entscheidung nötig: Ostsee zum Start (empfohlen) oder weltweit.
- Meint „Schifftracker“ hier einen Layer in dieser App (Annahme) oder ein eigenes zweites Projekt?
- Darf die Datenquelle direkt aus dem Browser abgefragt werden (CORS, Nutzungsbedingungen, ggf. Pflicht-Header `Digitraffic-User`), oder soll ein eigener Proxy dazwischen, um Anfragen zu bündeln?
- Soll es einen Test-Runner geben (z. B. Vitest), damit Parameterprüfung und Umrechnung (Kurs, Mengenbegrenzung) automatisiert geprüft werden?

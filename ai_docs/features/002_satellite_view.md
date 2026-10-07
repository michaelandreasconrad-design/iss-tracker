# Satellitenansicht der Karte

## Kontext & Problemstellung
Die Karte zeigt heute nur die Straßenkarte von OpenStreetMap (`app/IssMap.js`). Beim Hineinzoomen sieht man Linien und Beschriftungen, aber nicht, was unter der ISS liegt. Nutzer möchten zwischen Straßenkarte und Satellitenbild wechseln und beim Zoomen Berge, Wälder und Meere erkennen.

## Anforderungen
- [ ] Als Nutzer möchte ich per Schalter zwischen „Karte“ und „Satellit“ wechseln, damit ich die Erdoberfläche als Luftbild sehe.
- [ ] Als Nutzer möchte ich in der Satellitenansicht hineinzoomen und dabei Berge, Wälder und Meere unterscheiden können.
- [ ] Der Wechsel wirkt sofort, ohne Neuladen der Seite. Kartenausschnitt, Zoomstufe, ISS-Marker, Spur und „Karte folgt der ISS“ bleiben unverändert.
- [ ] Der Schalter sitzt direkt an der Karte (Ecke oben rechts) und zeigt die aktive Ansicht an.
- [ ] Standard ist die Straßenkarte. Die letzte Wahl wird im Browser gespeichert (`localStorage`, Schlüssel `mapView`, Werte `map` / `satellite`).
- [ ] Die Satellitenkacheln erlauben mindestens Zoomstufe 17. Darüber hinaus wird die letzte verfügbare Stufe hochskaliert, statt graue Kacheln zu zeigen.
- [ ] Die Quellenangabe (Attribution) des Kachelanbieters wird in der Satellitenansicht in der Karte angezeigt.
- [ ] Der Dark-Mode-Kachelfilter (`.leaflet-tile-pane`, siehe `001_dark_mode.md`) gilt nur für die Straßenkarte. Satellitenbilder werden nie invertiert oder abgedunkelt.
- [ ] Marker und Spur (`#38bdf8`) sind auf dem Satellitenbild gut erkennbar. Falls nicht, bekommt die Spur eine helle Kontur oder eine andere Farbe.
- [ ] Der Schalter ist per Tastatur bedienbar, hat ein `aria-label` passend zum Zustand und sichtbaren Fokusrahmen, Klickfläche mindestens 40 × 40 px.
- [ ] Fällt das Laden der Satellitenkacheln aus, bleibt die Karte benutzbar. Ein kurzer Hinweis erklärt, dass das Satellitenbild nicht geladen werden konnte.

## Definition of Done
- [ ] Alle Anforderungen oben sind erfüllt, in beiden Themes (Hell und Dunkel).
- [ ] Die Content Security Policy in `middleware.js` erlaubt den Satelliten-Kachelserver unter `img-src`. Es gibt keine CSP-Fehler in der Browser-Konsole.
- [ ] Polling der ISS-Position (alle ca. 5 s) und alle bisherigen Funktionen laufen unverändert weiter.
- [ ] Der StackHawk-Neuscan (`hawk rescan`) zeigt keine neuen Befunde.
- [ ] Tests laufen (siehe Abschnitt „Tests“), die Änderung ist auf Vercel deployt und dort geprüft.

## Betroffene Bereiche & Technik
- `app/IssMap.js`: zweite Kachelebene `L.tileLayer` für Satellitenbilder, Umschalten der Ebenen (`map.addLayer` / `removeLayer` oder Leaflet-`L.control.layers`), Attribution je Ebene.
- `app/page.js` bzw. eigene Komponente: Schalter und gespeicherte Wahl, falls er außerhalb der Karte liegt.
- `app/globals.css`: Stil des Schalters. Der Dark-Mode-Filter muss auf die Straßenkarten-Ebene beschränkt werden, z. B. über eine eigene Klasse (`className`) am `L.tileLayer` der OSM-Ebene statt über `.leaflet-tile-pane` insgesamt.
- `middleware.js`: `img-src` um den Kachelserver der Satellitenbilder erweitern.
- Kachelquelle (Annahme): Esri World Imagery, `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`. Kein API-Schlüssel nötig, Attribution erforderlich. Das passt zur Regel „keine Secrets im Code“.
- Keine neuen Abhängigkeiten.

## Tests
Das Projekt hat noch keinen Test-Runner. Die Fälle sind deshalb manuell im Browser prüfbar formuliert (Produktion und `localhost:3000`):
- [ ] Happy Path: Klick auf „Satellit“ zeigt Luftbilder. Zoom auf Stufe 12 über einem Gebirge, einem Wald und dem Meer macht die Geländeformen und Farben (Gebirge, Grün, Blau) erkennbar.
- [ ] Zurück auf „Karte“ erscheint wieder die OSM-Straßenkarte, Ausschnitt und Zoom bleiben gleich.
- [ ] Neuladen der Seite: die zuletzt gewählte Ansicht ist aktiv.
- [ ] Dark Mode an: Straßenkarte ist abgedunkelt, Satellitenbild ist unverändert (nicht invertiert).
- [ ] Marker und Spur sind auf dem Satellitenbild sichtbar, der Marker bewegt sich weiter alle ca. 5 s.
- [ ] „Karte folgt der ISS“ eingeschaltet: Der Wechsel der Ansicht unterbricht das Folgen nicht.
- [ ] Maximaler Zoom (19 auf Straßenkarte, ≥ 17 auf Satellit): keine grauen Kacheln, das Bild wird höchstens hochskaliert.
- [ ] Fehlerfall: Kachelserver in den Entwicklerwerkzeugen blockieren. Die Seite bleibt benutzbar und der Hinweis erscheint.
- [ ] Browser-Konsole zeigt weder CSP- noch Hydration-Fehler.
- [ ] Schalter ist per Tabulator erreichbar und mit Enter/Leertaste bedienbar.
- [ ] Regression: Theme-Umschalter, Astronautenliste und Messwerte funktionieren unverändert.

## Umsetzungsideen / Hinweise
- Leaflet-Ebenenschalter (`L.control.layers`) liefert Oberfläche, Zugänglichkeit und Zustand fertig. Ein eigener Button erlaubt dagegen den Stil der App (Emoji/Icon wie beim Theme-Umschalter). Entscheidung bei der Umsetzung.
- Optional später: Beschriftungsebene (Ländernamen, Ozeane) über dem Satellitenbild als „Hybrid“-Ansicht.

## Offene Fragen / Abhängigkeiten
- Esri World Imagery: Sind die Nutzungsbedingungen für ein öffentliches, nicht kommerzielles Projekt ohne Schlüssel in Ordnung? Alternativen sind NASA GIBS (geringere Auflösung, schlechter für Details beim Zoomen) oder ein Anbieter mit eigenem Schlüssel (Mapbox, MapTiler, Schlüssel dürfte nicht im Code stehen).
- Wie hoch ist die tatsächliche Zoomgrenze von Esri in abgelegenen Meeres- und Waldgebieten? Dort liegen teils nur niedrig aufgelöste Bilder vor, „Meere erkennen“ ist davon nicht betroffen, „Wälder erkennen“ schon.
- Soll die Hybrid-Ansicht (Satellit mit Beschriftung) gleich mit rein oder bleibt sie ein eigenes Feature?
- Soll es einen Test-Runner geben (z. B. Vitest), damit Schalterlogik und gespeicherte Wahl automatisiert geprüft werden?

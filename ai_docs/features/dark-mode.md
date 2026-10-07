# Spec: Umschalten zwischen Light und Dark Mode

## 1. Ziel

Nutzer können in der App zwischen hellem (Light) und dunklem (Dark) Erscheinungsbild wechseln. Die Wahl bleibt beim nächsten Besuch erhalten.

## 2. Ausgangslage

- Die App ist heute ausschließlich dunkel. Die Farben stehen als feste Hex-Werte in `app/globals.css` (z. B. `#0f172a` Hintergrund, `#1e293b` Karten, `#e2e8f0` Text, `#94a3b8` Zweittext).
- Fehlermeldung (`.error`) und Spurlinie der Karte (`#38bdf8` in `app/IssMap.js`) haben eigene Farben.
- Die Karte nutzt die hellen OpenStreetMap-Kacheln.
- Es gibt keine Theme-Logik und keinen Umschalter.

## 3. Funktionale Anforderungen

| ID | Anforderung | Priorität |
|---|---|---|
| D1 | Es gibt ein Light-Theme und ein Dark-Theme. Das Dark-Theme entspricht dem heutigen Aussehen. | Muss |
| D2 | Ein Umschalter im Seitenkopf wechselt per Klick zwischen Light und Dark. Der Wechsel wirkt sofort, ohne Neuladen. | Muss |
| D3 | Beim ersten Besuch (keine gespeicherte Wahl) gilt die Systemeinstellung des Nutzers (`prefers-color-scheme`). Ist sie nicht ermittelbar, gilt Dark. | Muss |
| D4 | Die manuelle Wahl wird im Browser gespeichert (`localStorage`, Schlüssel `theme`, Werte `light` / `dark`) und hat danach Vorrang vor der Systemeinstellung. | Muss |
| D5 | Beim Laden der Seite blitzt kein falsches Theme auf. Das Theme wird vor dem ersten Rendern gesetzt. | Muss |
| D6 | Alle Elemente sind in beiden Themes gut lesbar: Überschrift, Zweittext, Messwerte, Fehlermeldung, Besatzungsliste, Kartenplatzhalter, Checkbox-Beschriftung. | Muss |
| D7 | Die Karte passt sich dem Theme an: Im Dark Mode werden die Kacheln abgedunkelt (CSS-Filter auf `.leaflet-tile-pane`), im Light Mode bleiben sie unverändert. Marker und Spur bleiben in beiden Themes gut sichtbar. | Soll |
| D8 | Folgt der Nutzer der Systemeinstellung nicht (hat also manuell gewählt), ändert sich das Theme nicht mehr, wenn das System wechselt. Ohne manuelle Wahl folgt die App dem Systemwechsel live. | Kann |

## 4. Umschalter (UI)

- Platzierung: rechts im Seitenkopf neben der Überschrift (`<header>` in `app/page.js`).
- Darstellung: ein Button mit Icon, das das **Ziel-Theme** zeigt (im Dark Mode ☀️, im Light Mode 🌙).
- Beschriftung für Screenreader: `aria-label` „Zum hellen Design wechseln“ bzw. „Zum dunklen Design wechseln“. Der Button hat zusätzlich ein `title` mit demselben Text.
- Bedienbar per Tastatur (nativer `<button>`), sichtbarer Fokusrahmen.
- Mindestgröße der Klickfläche 40 × 40 px.

## 5. Technischer Ansatz

- **Theme-Quelle:** Attribut `data-theme="light|dark"` am `<html>`-Element.
- **Farben als CSS-Variablen:** In `app/globals.css` werden alle festen Farben durch Variablen ersetzt (z. B. `--bg`, `--surface`, `--text`, `--text-muted`, `--accent`, `--error-bg`, `--error-border`, `--error-text`). Die Werte werden unter `:root[data-theme='dark']` und `:root[data-theme='light']` definiert. Dark-Werte = heutige Werte.
- **Kein Aufblitzen (D5):** In `app/layout.js` wird ein kleines Inline-Skript im `<head>` eingebunden, das `localStorage` bzw. `prefers-color-scheme` liest und `data-theme` setzt, bevor der Body gerendert wird. Das `<html>`-Element erhält `suppressHydrationWarning`, da sich das Attribut vor der Hydration ändert.
- **Umschalter:** Eigene Client-Komponente `app/ThemeToggle.js`. Sie liest das aktuelle Theme aus `document.documentElement.dataset.theme`, schaltet es um und schreibt die Wahl in `localStorage`. Zugriffe auf `localStorage` sind mit `try/catch` abgesichert (z. B. privater Modus). Bei Fehler funktioniert der Wechsel trotzdem, nur ohne Speicherung.
- **Spurfarbe:** Die Linienfarbe in `IssMap.js` bleibt `#38bdf8`, wenn sie in beiden Themes ausreichend Kontrast zur Karte hat (siehe Abnahme). Sonst wird sie per CSS-Klasse (`.leaflet-overlay-pane path`) themenabhängig gesetzt.
- **Browser-UI:** `color-scheme: light|dark` wird je Theme gesetzt, damit Checkbox, Scrollbalken und Formularelemente passend dargestellt werden.
- **Keine neuen Abhängigkeiten.**

## 6. Nicht-funktionale Anforderungen

- Kontrast mindestens 4,5 : 1 für normalen Text in beiden Themes (WCAG AA).
- Der Umschalter löst kein erneutes Laden der Karte oder der API-Daten aus. Polling und Kartenposition bleiben unverändert.
- Funktioniert im Next.js App Router ohne Server-Side-Rendering-Fehler und ohne Hydration-Warnung in der Konsole.
- Bestehende Funktionen (F1–F4, B1–B4 aus dem PRD) bleiben unverändert.

## 7. Außerhalb des Umfangs

- Drittes Theme „System“ als eigener Schalter-Zustand.
- Weitere Farbschemata oder Akzentfarben.
- Synchronisation der Wahl zwischen Geräten (kein Backend).
- Dunkle Kartenkacheln eines anderen Anbieters.

## 8. Abnahmekriterien

- [ ] Klick auf den Umschalter wechselt sofort zwischen hellem und dunklem Design.
- [ ] Nach Neuladen bleibt das gewählte Theme erhalten.
- [ ] Ohne gespeicherte Wahl entspricht das Theme der Systemeinstellung (im Browser über die Entwicklerwerkzeuge prüfbar).
- [ ] Beim Neuladen ist kein Aufblitzen des anderen Themes zu sehen.
- [ ] Kein Text ist in einem der beiden Themes schwer lesbar (inkl. Fehlermeldung, die sich durch Blockieren der API in den Entwicklerwerkzeugen auslösen lässt).
- [ ] Im Dark Mode ist die Karte abgedunkelt, Marker und Spur sind erkennbar. Im Light Mode sieht die Karte aus wie bisher.
- [ ] Der Umschalter ist per Tastatur erreichbar und bedienbar, Screenreader-Beschriftung passt zum Zustand.
- [ ] Browser-Konsole zeigt keine Fehler oder Hydration-Warnungen.
- [ ] ISS-Marker bewegt sich weiterhin alle ca. 5 Sekunden, auch direkt nach einem Themewechsel.

## 9. Umsetzungsschritte (Vorschlag)

1. Farben in `globals.css` auf CSS-Variablen umstellen (Dark = Ist-Zustand, Aussehen unverändert prüfen).
2. Light-Werte ergänzen und Kontrast prüfen.
3. Inline-Skript in `layout.js` und `suppressHydrationWarning` ergänzen.
4. `ThemeToggle.js` bauen und im Header einbinden.
5. Kartenanpassung (Kachel-Filter, Spurfarbe) für Dark/Light.
6. Manuell testen anhand der Abnahmekriterien, danach ein Commit pro Schritt.

## 10. Offene Punkte

- Reicht der CSS-Filter für die Kacheln optisch aus, oder soll später ein eigener dunkler Kachel-Anbieter geprüft werden?
- Sollen die Emoji-Icons des Umschalters durch SVG-Icons ersetzt werden, damit sie auf allen Systemen gleich aussehen?

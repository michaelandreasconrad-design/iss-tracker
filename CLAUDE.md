# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Befehle

- `npm run dev` startet den Dev-Server (http://localhost:3000, bei belegtem Port weicht Next.js auf 3001 aus). `npm run build` / `npm start` für den Produktions-Build.
- Es gibt weder Linter noch Test-Runner (kein `pytest`, kein Vitest). Specs formulieren ihre Tests deshalb als manuelle Browser-Prüfungen (Produktion und `localhost`).
- Sprache der App, Kommentare und Specs ist Deutsch; Code-Bezeichner sind teils englisch. Das Projekt ist JavaScript (kein TypeScript), Next.js 15 App Router, React 19, Leaflet.
- Deployment: Vercel (https://iss-tracker-tau.vercel.app), Projektordner `.vercel/` ist lokal verknüpft. Das Repo liegt bei `michaelandreasconrad-design/iss-tracker`.
- StackHawk-Scan über `stackhawk.yml` (`hawk scan` / `hawk rescan`), Host per `APP_HOST` (Standard `http://localhost:3000`). Neue API-Routen müssen unter `hawk.spider.seedPaths` eingetragen werden, weil es keine OpenAPI-Spezifikation gibt.

## Architektur

Reine Client-Anwendung mit genau einer eigenen API-Route. Die Datenabrufe laufen direkt aus dem Browser:

- `app/page.js` (Client-Komponente) hält den gesamten Zustand: ISS-Daten (Polling alle 5 s von `api.wheretheiss.at`), Besatzung, die Schalter „Karte folgt der ISS“ und „Schiffe anzeigen“. Die Karte wird per `next/dynamic` mit `ssr: false` geladen, weil Leaflet `window` braucht.
- `app/IssMap.js` besitzt die Leaflet-Karte. Alle Leaflet-Objekte (Karte, ISS-Marker, Spur, Kachel-Layer, Schiffs-Layer) liegen in `useRef`s und werden in getrennten `useEffect`s verwaltet. Die Ansicht (Straße/Satellit) steht in `localStorage` (`VIEW_STORAGE_KEY`).
- `app/ships.js` ist die Datenschicht des Schifftrackers (Digitraffic Marine, nur Ostsee). Der Browser holt einmal pro Minute **alle** Positionen (Digitraffic kennt keine Bounding-Box) und `IssMap.js` filtert bei `moveend` auf den sichtbaren Ausschnitt (Mindestzoom 5, höchstens 500 Marker). Namen und Typen werden erst beim Klick per `loadVessel` nachgeladen und gecacht.
- `app/api/astros/route.js` ist ein Server-Proxy für Open Notify, weil die Quelle nur HTTP anbietet (Mixed Content im Browser). Mit `revalidate = 300` gecacht.
- Theme: `app/layout.js` setzt `data-theme` per Inline-Skript vor dem ersten Rendern (Nonce aus `headers()`); `app/ThemeToggle.js` und `globals.css` übernehmen den Rest. `localStorage`-Schlüssel: `theme`, `showShips`, Kartenansicht.

### Content Security Policy (wichtig)

`middleware.js` erzeugt pro Anfrage ein Nonce und setzt die CSP (`script-src` mit `'nonce-…'` und `'strict-dynamic'`, kein `'unsafe-inline'` für Skripte). Das hat Folgen:

- Jede neue externe Quelle muss in `buildCsp` freigegeben werden: Daten unter `connect-src`, Kacheln/Bilder unter `img-src` (derzeit `api.wheretheiss.at`, `meri.digitraffic.fi`, `tile.openstreetmap.org`, `server.arcgisonline.com`). Sonst scheitert sie nur zur Laufzeit im Browser mit einem CSP-Fehler.
- Inline-Skripte brauchen das Nonce. `style-src 'unsafe-inline'` ist nur wegen Leaflets Inline-Styles erlaubt.
- Die CSP hängt am Request, nicht am Build, daher funktioniert sie nur mit dem Layout, das `headers()` liest (macht die Seite dynamisch).

### Sicherheitsregel für Fremddaten

Schiffsnamen, Ziele und Typen kommen von Dritten. In `ships.js` werden sie ausschließlich per `textContent` eingesetzt; ins `divIcon`-HTML fließen nur geprüfte Zahlen. Das beibehalten.

## Specs und Arbeitsweise

- Feature-Specs liegen in `ai_docs/features/NNN_<slug>.md` (001 Dark Mode, 002 Satellitenansicht, 003 Schifftracker); das Anforderungsdokument ist `ai_docs/PRD.md`. Neue Specs entstehen mit dem Skill `create-feature` (`.claude/skills/create-feature`), der Abschnitte wie „Definition of Done“ und „Tests“ vorgibt und keinen Code schreibt.
- Eine Spec gilt erst als erledigt, wenn ihre Checkboxen abgehakt sind, der StackHawk-Neuscan keine neuen Befunde zeigt und die Änderung auf Vercel geprüft wurde.
- Keine API-Schlüssel oder Secrets im Repo; alle Anfragen der App laufen über HTTPS.
- `git` meldet beim Arbeiten LF/CRLF-Warnungen (Windows). Das ist erwartet.

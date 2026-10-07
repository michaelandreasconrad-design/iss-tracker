# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Befehle

- `npm run dev` startet den Dev-Server (http://localhost:3000, bei belegtem Port weicht Next.js auf 3001 aus). `npm run build` / `npm start` für den Produktions-Build.
- Es gibt keinen Linter; nur der eingebaute Node-Runner für reine Logik: `npm test` (`node --test tests/*.js`) prüft `app/aisCore.js` und die Route `/api/ships` (mit gestubbtem WebSocket). Die UI wird weiterhin manuell im Browser geprüft (Produktion und `localhost`); Specs formulieren ihre Tests deshalb als manuelle Browser-Prüfungen.
- Umgebungsvariable `AISSTREAM_API_KEY` (AISStream): lokal in `.env.local` (git-ignoriert), auf Vercel als Projektvariable. Neue Keys oder Secrets nie committen.
- Sprache der App, Kommentare und Specs ist Deutsch; Code-Bezeichner sind teils englisch. Das Projekt ist JavaScript (kein TypeScript), Next.js 15 App Router, React 19, Leaflet.
- Deployment: Vercel (https://iss-tracker-tau.vercel.app), Projektordner `.vercel/` ist lokal verknüpft. Das Repo liegt bei `michaelandreasconrad-design/iss-tracker`.
- StackHawk-Scan über `stackhawk.yml` (`hawk scan` / `hawk rescan`), Host per `APP_HOST` (Standard `http://localhost:3000`). Neue API-Routen müssen unter `hawk.spider.seedPaths` eingetragen werden, weil es keine OpenAPI-Spezifikation gibt (`/api/ships` ist bereits eingetragen).

## Architektur

Überwiegend Client-Anwendung mit zwei eigenen API-Routen (`/api/astros`, `/api/ships`). Die meisten Datenabrufe laufen direkt aus dem Browser:

- `app/page.js` (Client-Komponente) hält den gesamten Zustand: ISS-Daten (Polling alle 5 s von `api.wheretheiss.at`), Besatzung, die Schalter „Karte folgt der ISS“ und „Schiffe anzeigen“. Die Karte wird per `next/dynamic` mit `ssr: false` geladen, weil Leaflet `window` braucht.
- `app/IssMap.js` besitzt die Leaflet-Karte. Alle Leaflet-Objekte (Karte, ISS-Marker, Spur, Kachel-Layer, Schiffs-Layer) liegen in `useRef`s und werden in getrennten `useEffect`s verwaltet. Die Ansicht (Straße/Satellit) steht in `localStorage` (`VIEW_STORAGE_KEY`).
- `app/ships.js` ist die Datenschicht des Schifftrackers (Digitraffic Marine, nur Ostsee). Der Browser holt einmal pro Minute **alle** Positionen (Digitraffic kennt keine Bounding-Box) und `IssMap.js` filtert bei `moveend` auf den sichtbaren Ausschnitt (Mindestzoom 5, höchstens 500 Marker). Namen und Typen werden erst beim Klick per `loadVessel` nachgeladen und gecacht.
- `app/aisCore.js` ist reine Logik (Bounding-Box-Prüfung, Normalisierung von AISStream-Nachrichten, Zusammenführen nach MMSI) ohne Browser-/Next-Abhängigkeiten, daher mit `node --test` testbar.
- `app/api/ships/route.js` ist der Server-Proxy zu AISStream (weltweit, Key aus `AISSTREAM_API_KEY`). Pro Anfrage ein WebSocket-Sammelfenster von 4 s, 30 s Cache, Rate Limit 30 Anfragen/min je Client. `IssMap.js` ruft sie nur auf, wenn der Ausschnitt nicht ganz in der Ostsee (`BALTIC_BOUNDS`) liegt, fragt den Bereich um 50 % größer ab und lädt erst neu, wenn die Ansicht ihn verlässt oder das 60-s-Intervall greift; bei gleicher MMSI gewinnt Digitraffic.
- `app/api/astros/route.js` ist ein Server-Proxy für Open Notify, weil die Quelle nur HTTP anbietet (Mixed Content im Browser). Mit `revalidate = 300` gecacht.
- Theme: `app/layout.js` setzt `data-theme` per Inline-Skript vor dem ersten Rendern (Nonce aus `headers()`); `app/ThemeToggle.js` und `globals.css` übernehmen den Rest. `localStorage`-Schlüssel: `theme`, `showShips`, Kartenansicht.

### Content Security Policy (wichtig)

`middleware.js` erzeugt pro Anfrage ein Nonce und setzt die CSP (`script-src` mit `'nonce-…'` und `'strict-dynamic'`, kein `'unsafe-inline'` für Skripte). Das hat Folgen:

- Jede neue externe Quelle muss in `buildCsp` freigegeben werden: Daten unter `connect-src`, Kacheln/Bilder unter `img-src` (derzeit `api.wheretheiss.at`, `meri.digitraffic.fi`, `tile.openstreetmap.org`, `server.arcgisonline.com`; AISStream braucht keinen Eintrag, der Browser ruft nur `/api/ships` same-origin auf). Sonst scheitert sie nur zur Laufzeit im Browser mit einem CSP-Fehler.
- Inline-Skripte brauchen das Nonce. `style-src 'unsafe-inline'` ist nur wegen Leaflets Inline-Styles erlaubt.
- Die CSP hängt am Request, nicht am Build, daher funktioniert sie nur mit dem Layout, das `headers()` liest (macht die Seite dynamisch).

### Sicherheitsregel für Fremddaten

Schiffsnamen, Ziele und Typen kommen von Dritten (Digitraffic und AISStream). In `ships.js` werden sie ausschließlich per `textContent` eingesetzt; ins `divIcon`-HTML fließen nur geprüfte Zahlen. Bei AISStream kürzt `sanitizeText` zusätzlich und entfernt Steuerzeichen. Das beibehalten. Der AISStream-Key darf nie in Client-Code, Antworten oder Logs gelangen.

## Specs und Arbeitsweise

- Feature-Specs liegen in `ai_docs/features/NNN_<slug>.md` (001 Dark Mode, 002 Satellitenansicht, 003 Schifftracker, 004 AISStream weltweit); das Anforderungsdokument ist `ai_docs/PRD.md`. Neue Specs entstehen mit dem Skill `create-feature` (`.claude/skills/create-feature`), der Abschnitte wie „Definition of Done“ und „Tests“ vorgibt und keinen Code schreibt.
- Eine Spec gilt erst als erledigt, wenn ihre Checkboxen abgehakt sind, der StackHawk-Neuscan keine neuen Befunde zeigt und die Änderung auf Vercel geprüft wurde.
- Keine API-Schlüssel oder Secrets im Repo; alle Anfragen der App laufen über HTTPS.
- `git` meldet beim Arbeiten LF/CRLF-Warnungen (Windows). Das ist erwartet.

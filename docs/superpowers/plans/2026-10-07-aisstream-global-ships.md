# AISStream: weltweiter Schifftracker – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Schiff-Layer zeigt auch außerhalb der Ostsee Schiffe, über eine serverseitige AISStream-Anbindung, ohne dass der API-Key den Server verlässt.

**Architecture:** Eine neue Route `GET /api/ships?south&west&north&east` öffnet pro Anfrage kurz ein WebSocket zu AISStream (Node 24, globales `WebSocket`), sammelt ca. 4 s lang Positionsmeldungen im angefragten Ausschnitt und liefert sie im selben Feature-Format wie Digitraffic. Reine Logik (Validierung, Normalisierung, Zusammenführen) liegt in `app/aisCore.js` ohne Browser-/Next-Abhängigkeiten und wird mit dem eingebauten `node --test` geprüft. `IssMap.js` ruft die Route nur auf, wenn der Ausschnitt nicht vollständig in der Ostsee liegt; bei doppelter MMSI gewinnt Digitraffic.

**Tech Stack:** Next.js 15 (App Router, JavaScript), Leaflet, Node 24 (`node:test`, globales `WebSocket`/`Response`), keine neuen Abhängigkeiten.

**Spec:** `ai_docs/features/004_aisstream_global_ships.md`

## Global Constraints

- Sprache von UI-Texten, Kommentaren und Specs ist Deutsch; Code-Bezeichner dürfen englisch sein. Reines JavaScript, kein TypeScript.
- Keine neuen npm-Abhängigkeiten.
- `AISSTREAM_API_KEY` nur serverseitig lesen (`process.env`), nie im Client-Code, nie in Antworten, nie in Logs, nie im Repo.
- Alle Anfragen der App laufen über HTTPS/WSS.
- Fremddaten (Schiffsname, Ziel, Typ) nur per `textContent` einsetzen; ins `divIcon`-HTML fließen nur geprüfte Zahlen.
- Höchstens 500 Schiffe (`MAX_SHIPS`), Mindestzoom 5 (`SHIP_MIN_ZOOM`).
- CSP (`middleware.js`) bleibt unverändert, solange der Browser nur `'self'` anspricht.
- Neue API-Routen gehören in `stackhawk.yml` unter `hawk.spider.seedPaths`.
- Commits enden mit der Zeile `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Kartenausschnitt über den Datumswechsel (Länge < −180 oder > 180, Leaflet `worldCopyJump`): wird geklemmt, kein 500er, kein Absturz.
- Leere oder doppelte/fehlende Query-Parameter (`south=`, nur drei Parameter, `south=abc`, `Infinity`): 400, keine AISStream-Anfrage.
- AISStream antwortet mit Fehler-JSON (falscher Key), schließt sofort oder liefert Binärframes: Route antwortet 502 bzw. liefert Daten, hängt nie länger als das Sammelfenster.
- Ruhiges Seegebiet ohne Meldungen im Sammelfenster: `200 {"ships": []}`, kein Fehler; die Karte zeigt „keine Schiffsdaten“.
- Schiffsname/Ziel mit HTML, Steuerzeichen oder extremer Länge: wird bereinigt und gekürzt, im Popup nur als Text.

---

## Task 1: Reine Kernlogik `app/aisCore.js` mit Unit-Tests

**Files:**
- Create: `app/aisCore.js`
- Create: `tests/aisCore.test.js`
- Modify: `package.json` (Skript `test`)

**Interfaces:**
- Produces (alle `export`):
  - `MAX_SHIPS = 500`, `MAX_SPAN_LAT = 80`, `MAX_SPAN_LON = 120`, `BBOX_GRID = 0.5`, `BALTIC_BOUNDS = { south: 53.5, west: 9, north: 66, east: 30.5 }`
  - `parseBbox(params: URLSearchParams) → {south,west,north,east} | null`
  - `snapBbox(b) → bbox` (Raster 0,5°, nach außen gerundet), `bboxKey(b) → string`
  - `limitBbox(b) → bbox` (schrumpft um die Mitte auf die Maximalspanne)
  - `isInsideBaltic(b) → boolean`
  - `sanitizeText(value, max = 40) → string | null`
  - `hasValidPosition(feature) → boolean`
  - `normalizeMessage(msg) → {kind:'position', feature} | {kind:'static', mmsi, name, shipType, destination} | null`
  - `createCollector(limit = MAX_SHIPS) → { add(msg), size(), result() }`
  - `mergeShips(primary, secondary) → feature[]` (MMSI-Deduplizierung, `primary` gewinnt)
  - `vesselFromProps(props) → { name, shipType, destination }`
- Feature-Format (identisch zu Digitraffic): `{ geometry: { coordinates: [lon, lat] }, properties: { mmsi, sog, cog, heading, source: 'ais', name?, shipType?, destination? } }`

- [ ] **Step 1: Skript `test` ergänzen**

In `package.json` unter `scripts` einfügen (nach `"start": "next start"`, Komma ergänzen):

```json
    "start": "next start",
    "test": "node --test tests/"
```

- [ ] **Step 2: Failing Tests schreiben**

`tests/aisCore.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SHIPS,
  bboxKey,
  createCollector,
  hasValidPosition,
  isInsideBaltic,
  limitBbox,
  mergeShips,
  normalizeMessage,
  parseBbox,
  sanitizeText,
  snapBbox,
  vesselFromProps,
} from '../app/aisCore.js';

const q = (obj) => new URLSearchParams(obj);

test('parseBbox: gültiger Ausschnitt', () => {
  assert.deepEqual(parseBbox(q({ south: '50', west: '0', north: '60', east: '10' })), {
    south: 50, west: 0, north: 60, east: 10,
  });
});

test('parseBbox: ungültige Eingaben ergeben null', () => {
  assert.equal(parseBbox(q({ south: '50', west: '0', north: '60' })), null); // east fehlt
  assert.equal(parseBbox(q({ south: '', west: '0', north: '60', east: '10' })), null);
  assert.equal(parseBbox(q({ south: 'abc', west: '0', north: '60', east: '10' })), null);
  assert.equal(parseBbox(q({ south: 'Infinity', west: '0', north: '60', east: '10' })), null);
  assert.equal(parseBbox(q({ south: '60', west: '0', north: '50', east: '10' })), null); // vertauscht
  assert.equal(parseBbox(q({ south: '-85', west: '-180', north: '85', east: '180' })), null); // zu groß
});

test('parseBbox: Länge außerhalb ±180 wird geklemmt statt abgelehnt', () => {
  assert.deepEqual(parseBbox(q({ south: '10', west: '-200', north: '20', east: '-150' })), {
    south: 10, west: -180, north: 20, east: -150,
  });
  assert.equal(parseBbox(q({ south: '10', west: '190', north: '20', east: '200' })), null); // nach Klemmen leer
});

test('snapBbox rundet nach außen auf das Raster, bboxKey ist stabil', () => {
  const snapped = snapBbox({ south: 50.1, west: 0.3, north: 59.9, east: 9.7 });
  assert.deepEqual(snapped, { south: 50, west: 0, north: 60, east: 10 });
  assert.equal(bboxKey(snapped), '50:0:60:10');
});

test('limitBbox schrumpft zu große Ausschnitte um die Mitte', () => {
  const limited = limitBbox({ south: -40, west: -100, north: 40, east: 100 });
  assert.ok(limited.north - limited.south <= 80);
  assert.ok(limited.east - limited.west <= 120);
  assert.equal((limited.west + limited.east) / 2, 0);
  const small = { south: 1, west: 2, north: 3, east: 4 };
  assert.deepEqual(limitBbox(small), small);
});

test('isInsideBaltic', () => {
  assert.equal(isInsideBaltic({ south: 55, west: 12, north: 60, east: 25 }), true);
  assert.equal(isInsideBaltic({ south: 50, west: 0, north: 60, east: 10 }), false);
});

test('sanitizeText entfernt Steuerzeichen, kürzt und liefert null bei leer', () => {
  assert.equal(sanitizeText('  HELSINKI  \u0000\n'), 'HELSINKI');
  assert.equal(sanitizeText('x'.repeat(100)).length, 40);
  assert.equal(sanitizeText('   '), null);
  assert.equal(sanitizeText(42), null);
  assert.equal(sanitizeText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>'); // bleibt Text, wird nur per textContent gezeigt
});

const position = (over = {}) => ({
  MessageType: 'PositionReport',
  MetaData: { MMSI: 211000000, ShipName: 'TESTSHIP  ' },
  Message: {
    PositionReport: { UserID: 211000000, Latitude: 54.1, Longitude: 7.9, Sog: 12.3, Cog: 87, TrueHeading: 85, ...over },
  },
});

test('normalizeMessage: Positionsmeldung', () => {
  const r = normalizeMessage(position());
  assert.equal(r.kind, 'position');
  assert.deepEqual(r.feature.geometry.coordinates, [7.9, 54.1]);
  assert.equal(r.feature.properties.mmsi, 211000000);
  assert.equal(r.feature.properties.source, 'ais');
  assert.equal(r.feature.properties.name, 'TESTSHIP');
  assert.equal(r.feature.properties.sog, 12.3);
});

test('normalizeMessage: Sog „nicht verfügbar“ (102.3) wird null, ungültige Koordinaten werden verworfen', () => {
  assert.equal(normalizeMessage(position({ Sog: 102.3 })).feature.properties.sog, null);
  assert.equal(normalizeMessage(position({ Latitude: 91 })), null);
  assert.equal(normalizeMessage(position({ Longitude: 181 })), null);
  assert.equal(normalizeMessage(position({ UserID: 0 })), null);
});

test('normalizeMessage: Klasse-B-Meldung und Stammdaten', () => {
  const b = {
    MessageType: 'StandardClassBPositionReport',
    MetaData: { MMSI: 5 },
    Message: { StandardClassBPositionReport: { UserID: 5, Latitude: 1, Longitude: 2, Sog: 0, Cog: 360, TrueHeading: 511 } },
  };
  assert.equal(normalizeMessage(b).kind, 'position');
  const s = normalizeMessage({
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: 5 },
    Message: { ShipStaticData: { UserID: 5, Name: 'BOAT ', Type: 70, Destination: 'HAMBURG' } },
  });
  assert.deepEqual(s, { kind: 'static', mmsi: 5, name: 'BOAT', shipType: 70, destination: 'HAMBURG' });
});

test('normalizeMessage: Müll ergibt null', () => {
  for (const bad of [null, undefined, 'x', 5, {}, { Message: null }, { MessageType: 'Unknown', Message: {} }, { error: 'Api Key Is Not Valid' }]) {
    assert.equal(normalizeMessage(bad), null);
  }
});

test('createCollector: letzte Position je MMSI, Stammdaten werden angehängt, Obergrenze gilt', () => {
  const c = createCollector(2);
  c.add(position());
  c.add(position({ Latitude: 55 })); // gleiche MMSI überschreibt
  c.add({ MessageType: 'ShipStaticData', MetaData: { MMSI: 211000000 }, Message: { ShipStaticData: { UserID: 211000000, Name: 'NEU', Type: 80, Destination: 'KIEL' } } });
  const other = (id) => ({ MessageType: 'PositionReport', MetaData: { MMSI: id }, Message: { PositionReport: { UserID: id, Latitude: 1, Longitude: 1 } } });
  c.add(other(2));
  c.add(other(3)); // über der Obergrenze
  const result = c.result();
  assert.equal(c.size(), 2);
  assert.equal(result.length, 2);
  const first = result.find((f) => f.properties.mmsi === 211000000);
  assert.equal(first.geometry.coordinates[1], 55);
  assert.equal(first.properties.name, 'NEU');
  assert.equal(first.properties.shipType, 80);
  assert.equal(first.properties.destination, 'KIEL');
  assert.equal(MAX_SHIPS, 500);
});

test('mergeShips: primary gewinnt bei gleicher MMSI', () => {
  const f = (mmsi, tag) => ({ geometry: { coordinates: [1, 2] }, properties: { mmsi, tag } });
  const merged = mergeShips([f(1, 'a'), f(2, 'a')], [f(2, 'b'), f(3, 'b')]);
  assert.deepEqual(merged.map((x) => [x.properties.mmsi, x.properties.tag]), [[1, 'a'], [2, 'a'], [3, 'b']]);
});

test('hasValidPosition und vesselFromProps', () => {
  assert.equal(hasValidPosition({ geometry: { coordinates: [1, 2] }, properties: { mmsi: 1 } }), true);
  assert.equal(hasValidPosition({ geometry: { coordinates: [1, 200] }, properties: { mmsi: 1 } }), false);
  assert.equal(hasValidPosition({ geometry: { coordinates: [1, 2] }, properties: { mmsi: 1.5 } }), false);
  assert.equal(hasValidPosition({}), false);
  assert.deepEqual(vesselFromProps({ name: 'A', shipType: 70, destination: 'B' }), { name: 'A', shipType: 70, destination: 'B' });
  assert.deepEqual(vesselFromProps({}), { name: null, shipType: null, destination: null });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag prüfen**

Run: `npm test`
Expected: FAIL mit `Cannot find module .../app/aisCore.js` (ERR_MODULE_NOT_FOUND).

- [ ] **Step 4: `app/aisCore.js` implementieren**

```js
// Reine Hilfsfunktionen für den weltweiten Schiff-Layer (AISStream). Bewusst ohne Browser-, Leaflet- oder
// Next-Abhängigkeiten, damit Server-Route, Karte und `node --test` dasselbe Modul nutzen können.

export const MAX_SHIPS = 500;
export const MAX_SPAN_LAT = 80; // Grad; bei Zoom 5 auf großen Bildschirmen deutlich weniger
export const MAX_SPAN_LON = 120;
export const BBOX_GRID = 0.5; // Raster, auf das Ausschnitte für den Cache gerundet werden
const SPAN_TOLERANCE = 0.01; // Rundungsspielraum, wenn der Browser Koordinaten auf 4 Stellen kürzt
const LAT_LIMIT = 85;
const LON_LIMIT = 180;
const SOG_NOT_AVAILABLE = 102.3; // AIS-Wert für „Geschwindigkeit unbekannt“

// Grobe Abdeckung von Digitraffic. Liegt der Ausschnitt ganz darin, braucht es kein AISStream.
export const BALTIC_BOUNDS = { south: 53.5, west: 9, north: 66, east: 30.5 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Liest und prüft den Kartenausschnitt aus den Query-Parametern. Gibt null zurück, wenn er unbrauchbar ist.
export function parseBbox(params) {
  const read = (key) => {
    const raw = params.get(key);
    return raw === null || raw.trim() === '' ? NaN : Number(raw);
  };
  const [south, west, north, east] = ['south', 'west', 'north', 'east'].map(read);
  if (![south, west, north, east].every(Number.isFinite)) return null;
  const bbox = {
    south: clamp(south, -LAT_LIMIT, LAT_LIMIT),
    west: clamp(west, -LON_LIMIT, LON_LIMIT),
    north: clamp(north, -LAT_LIMIT, LAT_LIMIT),
    east: clamp(east, -LON_LIMIT, LON_LIMIT),
  };
  if (bbox.south >= bbox.north || bbox.west >= bbox.east) return null;
  if (bbox.north - bbox.south > MAX_SPAN_LAT + SPAN_TOLERANCE) return null;
  if (bbox.east - bbox.west > MAX_SPAN_LON + SPAN_TOLERANCE) return null;
  return bbox;
}

export function snapBbox(b) {
  return {
    south: clamp(Math.floor(b.south / BBOX_GRID) * BBOX_GRID, -LAT_LIMIT, LAT_LIMIT),
    west: clamp(Math.floor(b.west / BBOX_GRID) * BBOX_GRID, -LON_LIMIT, LON_LIMIT),
    north: clamp(Math.ceil(b.north / BBOX_GRID) * BBOX_GRID, -LAT_LIMIT, LAT_LIMIT),
    east: clamp(Math.ceil(b.east / BBOX_GRID) * BBOX_GRID, -LON_LIMIT, LON_LIMIT),
  };
}

export const bboxKey = (b) => `${b.south}:${b.west}:${b.north}:${b.east}`;

// Schrumpft einen zu großen Ausschnitt um seine Mitte auf die erlaubte Spanne (für den Browser).
export function limitBbox(b) {
  const centerLat = (b.south + b.north) / 2;
  const centerLon = (b.west + b.east) / 2;
  const halfLat = Math.min((b.north - b.south) / 2, MAX_SPAN_LAT / 2);
  const halfLon = Math.min((b.east - b.west) / 2, MAX_SPAN_LON / 2);
  return {
    south: centerLat - halfLat,
    north: centerLat + halfLat,
    west: centerLon - halfLon,
    east: centerLon + halfLon,
  };
}

export function isInsideBaltic(b) {
  return (
    b.south >= BALTIC_BOUNDS.south &&
    b.north <= BALTIC_BOUNDS.north &&
    b.west >= BALTIC_BOUNDS.west &&
    b.east <= BALTIC_BOUNDS.east
  );
}

// Texte von Schiffen sind Fremddaten: Steuerzeichen raus, Länge begrenzen. Als HTML wird nie etwas eingesetzt.
export function sanitizeText(value, max = 40) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max).trim();
  return text === '' ? null : text;
}

export function hasValidPosition(feature) {
  const [lon, lat] = feature?.geometry?.coordinates ?? [];
  const mmsi = feature?.properties?.mmsi;
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    Math.abs(lon) <= LON_LIMIT &&
    Math.abs(lat) <= 90 &&
    Number.isInteger(mmsi) &&
    mmsi > 0
  );
}

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const POSITION_TYPES = ['PositionReport', 'StandardClassBPositionReport'];

// Wandelt eine AISStream-Nachricht in das Digitraffic-Feature-Format (Position) bzw. Stammdaten um.
export function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'object' || !msg.Message || typeof msg.Message !== 'object') return null;
  const meta = msg.MetaData ?? {};
  const type = msg.MessageType;

  if (POSITION_TYPES.includes(type)) {
    const body = msg.Message[type];
    if (!body || typeof body !== 'object') return null;
    const sog = numberOrNull(body.Sog);
    const feature = {
      geometry: { coordinates: [Number(body.Longitude), Number(body.Latitude)] },
      properties: {
        mmsi: Number(body.UserID ?? meta.MMSI),
        sog: sog !== null && sog >= SOG_NOT_AVAILABLE ? null : sog,
        cog: numberOrNull(body.Cog),
        heading: numberOrNull(body.TrueHeading),
        source: 'ais',
        name: sanitizeText(meta.ShipName),
      },
    };
    return hasValidPosition(feature) ? { kind: 'position', feature } : null;
  }

  if (type === 'ShipStaticData') {
    const body = msg.Message.ShipStaticData;
    if (!body || typeof body !== 'object') return null;
    const mmsi = Number(body.UserID ?? meta.MMSI);
    if (!Number.isInteger(mmsi) || mmsi <= 0) return null;
    return {
      kind: 'static',
      mmsi,
      name: sanitizeText(body.Name),
      shipType: Number.isInteger(body.Type) ? body.Type : null,
      destination: sanitizeText(body.Destination),
    };
  }

  return null;
}

// Sammelt Nachrichten: je MMSI zählt die letzte Position, Stammdaten werden beim Ergebnis angehängt.
export function createCollector(limit = MAX_SHIPS) {
  const positions = new Map();
  const statics = new Map();
  return {
    add(raw) {
      const parsed = normalizeMessage(raw);
      if (!parsed) return;
      if (parsed.kind === 'position') {
        const { mmsi } = parsed.feature.properties;
        if (positions.size < limit || positions.has(mmsi)) positions.set(mmsi, parsed.feature);
      } else if (statics.size < limit * 4 || statics.has(parsed.mmsi)) {
        statics.set(parsed.mmsi, parsed);
      }
    },
    size: () => positions.size,
    result() {
      return [...positions.values()].map((feature) => {
        const info = statics.get(feature.properties.mmsi);
        if (!info) return feature;
        return {
          ...feature,
          properties: {
            ...feature.properties,
            name: info.name ?? feature.properties.name,
            shipType: info.shipType,
            destination: info.destination,
          },
        };
      });
    },
  };
}

// Zwei Quellen zusammenführen; bei gleicher MMSI gewinnt `primary`.
export function mergeShips(primary, secondary) {
  const byMmsi = new Map();
  for (const feature of primary) byMmsi.set(feature.properties.mmsi, feature);
  for (const feature of secondary) {
    if (!byMmsi.has(feature.properties.mmsi)) byMmsi.set(feature.properties.mmsi, feature);
  }
  return [...byMmsi.values()];
}

// Stammdaten, die AISStream schon mitliefert (kein Nachladen wie bei Digitraffic nötig).
export function vesselFromProps(props) {
  return {
    name: props.name ?? null,
    shipType: Number.isInteger(props.shipType) ? props.shipType : null,
    destination: props.destination ?? null,
  };
}
```

- [ ] **Step 5: Tests ausführen, Erfolg prüfen**

Run: `npm test`
Expected: alle Tests PASS (ein Hinweis zu `MODULE_TYPELESS_PACKAGE_JSON` auf stderr ist harmlos).

- [ ] **Step 6: Commit**

```bash
git add app/aisCore.js tests/aisCore.test.js package.json
git commit -m "AISStream: reine Kernlogik (Validierung, Normalisierung, Zusammenführen) mit Tests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 2: API-Route `/api/ships`, Env-Schutz, StackHawk

**Files:**
- Create: `app/api/ships/route.js`
- Create: `tests/route.test.js`
- Modify: `.gitignore` (Env-Dateien ausschließen)
- Modify: `stackhawk.yml` (seedPaths)

**Interfaces:**
- Consumes: `parseBbox`, `snapBbox`, `bboxKey`, `createCollector`, `MAX_SHIPS` aus `app/aisCore.js` (Task 1).
- Produces: `GET /api/ships?south&west&north&east` → `200 {"ships": Feature[]}` | `400` | `429` (mit `Retry-After`) | `502` | `503`; Fehlerantworten haben die Form `{"error": "<deutscher Text>"}`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/route.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/ships/route.js';

const url = (query) => `http://localhost/api/ships?${query}`;
const call = (query, ip) =>
  GET(new Request(url(query), { headers: { 'x-forwarded-for': ip } }));
const VALID = 'south=50&west=0&north=60&east=10';

test('400 bei ungültigem Ausschnitt, ohne AISStream anzusprechen', async () => {
  for (const [i, query] of [
    '',
    'south=50&west=0&north=60',
    'south=abc&west=0&north=60&east=10',
    'south=60&west=0&north=50&east=10',
    'south=-80&west=-170&north=80&east=170',
  ].entries()) {
    const res = await call(query, `10.0.0.${i}`);
    assert.equal(res.status, 400, query);
    assert.match((await res.json()).error, /Ausschnitt/);
  }
});

test('503 ohne API-Key, Antwort verrät nichts', async () => {
  delete process.env.AISSTREAM_API_KEY;
  const res = await call(VALID, '10.0.1.1');
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.doesNotMatch(body, /APIKey|AISSTREAM_API_KEY/i);
});

test('429 nach zu vielen Anfragen, mit Retry-After', async () => {
  let limitedAt = null;
  for (let i = 1; i <= 40; i++) {
    const res = await call('', '10.0.2.1'); // 400er zählen mit
    if (res.status === 429) {
      limitedAt = i;
      assert.equal(res.headers.get('retry-after'), '60');
      break;
    }
  }
  assert.ok(limitedAt !== null && limitedAt > 1, 'Rate Limit greift');
  const other = await call('', '10.0.2.2');
  assert.equal(other.status, 400); // anderer Client ist nicht betroffen
});

test('fehlender x-forwarded-for-Header bricht nichts', async () => {
  const res = await GET(new Request(url('')));
  assert.ok([400, 429].includes(res.status));
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `npm test`
Expected: `tests/route.test.js` FAIL mit `Cannot find module .../app/api/ships/route.js`.

- [ ] **Step 3: Route implementieren**

`app/api/ships/route.js`:

```js
// Proxy für AISStream (weltweite AIS-Daten). Der API-Key bleibt auf dem Server. Der Browser fragt einen
// Kartenausschnitt an; die Route sammelt kurz Positionsmeldungen über ein WebSocket und antwortet mit einer
// Momentaufnahme im selben Feature-Format wie Digitraffic.
import { MAX_SHIPS, bboxKey, createCollector, parseBbox, snapBbox } from '../../aisCore.js';

export const dynamic = 'force-dynamic';

const STREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const MESSAGE_TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData'];
const COLLECT_MS = 4000; // Sammelfenster pro Anfrage
const CACHE_TTL_MS = 30000;
const CACHE_MAX_ENTRIES = 50;
const RATE_LIMIT = 30; // Anfragen je Client und Minute
const RATE_WINDOW_MS = 60000;

// Kurzlebige Zwischenspeicher je Serverinstanz (bei mehreren Instanzen nur eine Näherung).
const cache = new Map(); // Ausschnitt -> { at, promise }
const hits = new Map(); // Client -> Zeitstempel der letzten Anfragen

function clientId(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || 'unknown';
}

function rateLimited(id, now) {
  const recent = (hits.get(id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = recent.length >= RATE_LIMIT;
  if (!limited) recent.push(now);
  hits.set(id, recent);
  if (hits.size > 1000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key);
    }
  }
  return limited;
}

function collect(bbox, apiKey) {
  return new Promise((resolve, reject) => {
    const collector = createCollector(MAX_SHIPS);
    let settled = false;
    let received = false;
    let timer = null;
    const ws = new WebSocket(STREAM_URL);
    ws.binaryType = 'arraybuffer';

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // schon geschlossen
      }
      if (error) reject(error);
      else resolve(collector.result());
    };

    timer = setTimeout(() => finish(null), COLLECT_MS);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [[[bbox.south, bbox.west], [bbox.north, bbox.east]]],
          FilterMessageTypes: MESSAGE_TYPES,
        })
      );
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        msg = JSON.parse(text);
      } catch {
        return;
      }
      received = true;
      if (msg && typeof msg.error === 'string') return finish(new Error('AISStream hat die Anfrage abgelehnt'));
      collector.add(msg);
      if (collector.size() >= MAX_SHIPS) finish(null);
    };
    ws.onerror = () => finish(new Error('Verbindung zu AISStream fehlgeschlagen'));
    ws.onclose = () => finish(received ? null : new Error('AISStream hat die Verbindung geschlossen'));
  });
}

export async function GET(request) {
  const now = Date.now();
  if (rateLimited(clientId(request), now)) {
    return Response.json({ error: 'Zu viele Anfragen' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const bbox = parseBbox(new URL(request.url).searchParams);
  if (!bbox) return Response.json({ error: 'Ungültiger Kartenausschnitt' }, { status: 400 });

  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) return Response.json({ error: 'Schiffsdaten nicht konfiguriert' }, { status: 503 });

  const snapped = snapBbox(bbox);
  const key = bboxKey(snapped);
  let entry = cache.get(key);
  if (!entry || now - entry.at > CACHE_TTL_MS) {
    const current = { at: now, promise: collect(snapped, apiKey) };
    entry = current;
    cache.set(key, current);
    // Fehlschläge nicht zwischenspeichern.
    current.promise.catch(() => {
      if (cache.get(key) === current) cache.delete(key);
    });
    if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }

  try {
    const ships = await entry.promise;
    return Response.json(
      { ships },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' } }
    );
  } catch (error) {
    console.error('AISStream:', error.message); // nie den Key oder Rohdaten loggen
    return Response.json({ error: 'Schiffsdaten nicht verfügbar' }, { status: 502 });
  }
}
```

- [ ] **Step 4: Tests ausführen, Erfolg prüfen**

Run: `npm test`
Expected: alle Tests PASS (Kern- und Route-Tests).

- [ ] **Step 5: `.gitignore` ergänzen**

Am Ende von `.gitignore` anfügen:

```
.env
.env*.local
```

Prüfen: `git check-ignore -v .env.local` gibt die Regel aus.

- [ ] **Step 6: StackHawk-Seed ergänzen**

In `stackhawk.yml` unter `seedPaths`:

```yaml
    seedPaths:
      - /api/astros
      - /api/ships?south=50&west=0&north=60&east=10
```

- [ ] **Step 7: Live-Rauchtest (nur mit Key; sonst in Task 6 nachholen)**

`AISSTREAM_API_KEY=<Key>` in `.env.local` eintragen, Dev-Server neu starten, dann
`curl "http://localhost:3001/api/ships?south=50&west=0&north=60&east=10"`.
Expected: `{"ships":[...]}` mit Einträgen in der Nordsee; jeder Eintrag hat `properties.source = "ais"`. Außerdem das Rohformat prüfen: Wenn `ships` leer bleibt, obwohl dort Verkehr herrscht, in `collect` kurzzeitig `console.log(Object.keys(msg), msg.MessageType)` einfügen (danach wieder entfernen) und die Feldnamen gegen `normalizeMessage` abgleichen.

- [ ] **Step 8: Commit**

```bash
git add app/api/ships/route.js tests/route.test.js .gitignore stackhawk.yml
git commit -m "API-Route /api/ships: AISStream-Proxy mit Validierung, Cache und Rate Limit

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Datenschicht im Browser (`app/ships.js`)

**Files:**
- Modify: `app/ships.js:12` (`MAX_SHIPS` aus dem Kernmodul), `app/ships.js:13-14` (Attribution), Ende der Datei (`loadAisShips`), `app/ships.js:128-132` (Filter)

**Interfaces:**
- Consumes: `MAX_SHIPS`, `hasValidPosition`, `limitBbox` aus `app/aisCore.js`.
- Produces: `loadAisShips(bounds, signal) → Promise<Feature[]>` (wirft bei HTTP-Fehler/ungültiger Antwort), `AIS_ATTRIBUTION: string`; `MAX_SHIPS` bleibt aus `./ships` importierbar.

- [ ] **Step 1: Importe und Konstanten ändern**

Oben in `app/ships.js` nach `import L from 'leaflet';` einfügen:

```js
import { MAX_SHIPS, hasValidPosition, limitBbox } from './aisCore';
```

Zeile `export const MAX_SHIPS = 500;` ersetzen durch:

```js
export { MAX_SHIPS };
```

Nach `SHIP_ATTRIBUTION` ergänzen:

```js
export const AIS_URL = '/api/ships';
export const AIS_ATTRIBUTION = 'Weltweit: <a href="https://aisstream.io/">AISStream.io</a>';
```

- [ ] **Step 2: `loadShips` auf gemeinsamen Prüfer umstellen**

Den Filter in `loadShips`

```js
  return data.features.filter((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    return Number.isFinite(lon) && Number.isFinite(lat) && Number.isInteger(f.properties?.mmsi);
  });
```

ersetzen durch:

```js
  return data.features.filter(hasValidPosition);
```

- [ ] **Step 3: `loadAisShips` am Dateiende ergänzen**

```js
// Schiffe eines Kartenausschnitts über den eigenen Server (AISStream). `bounds` = { south, west, north, east }.
export async function loadAisShips(bounds, signal) {
  const limited = limitBbox(bounds);
  const query = new URLSearchParams(
    Object.entries(limited).map(([key, value]) => [key, value.toFixed(4)])
  );
  const res = await fetch(`${AIS_URL}?${query}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.ships)) throw new Error('Unerwartetes Format');
  return data.ships.filter(hasValidPosition);
}
```

- [ ] **Step 4: Build prüfen**

Run: `npm run build`
Expected: Build erfolgreich, `/api/ships` erscheint als dynamische Route (`ƒ`). (Kein Dev-Server-Konflikt: bei laufendem `next dev` den Build in einem Kopierverzeichnis oder nach Stopp des Servers ausführen, weil beide `.next` nutzen.)

- [ ] **Step 5: Commit**

```bash
git add app/ships.js
git commit -m "Schiffs-Datenschicht: AISStream-Abruf über /api/ships

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Karten-Integration (`app/IssMap.js`)

**Files:**
- Modify: `app/IssMap.js:6-15` (Importe), `:70-72` (State), `:158-242` (Schiffs-Effekt), `:282-295` (Hinweise)

**Interfaces:**
- Consumes: `loadAisShips`, `AIS_ATTRIBUTION` (Task 3); `isInsideBaltic`, `mergeShips`, `vesselFromProps`, `hasValidPosition` aus `app/aisCore.js` (Task 1).
- Produces: sichtbares Verhalten laut Spec (siehe Tests in Task 6).

- [ ] **Step 1: Importe anpassen**

```js
import {
  AIS_ATTRIBUTION,
  MAX_SHIPS,
  SHIP_ATTRIBUTION,
  SHIP_MIN_ZOOM,
  SHIP_REFRESH_MS,
  buildPopupContent,
  loadAisShips,
  loadShips,
  loadVessel,
  shipIcon,
} from './ships';
import { isInsideBaltic, mergeShips, vesselFromProps } from './aisCore';
```

- [ ] **Step 2: State ergänzen**

Unter `const [shipError, setShipError] = useState(false);`:

```js
  const [aisError, setAisError] = useState(false);
```

- [ ] **Step 3: Schiffs-Effekt ersetzen (Zeilen 158–242)**

```js
  // Schiffe: Digitraffic liefert einmal pro Minute alle Ostsee-Positionen (keine Bounding-Box-Abfrage möglich),
  // der Browser begrenzt auf den sichtbaren Ausschnitt. Liegt der Ausschnitt nicht ganz in der Ostsee, holt
  // /api/ships (AISStream) zusätzlich genau diesen Ausschnitt. Bei gleicher MMSI gewinnt Digitraffic.
  useEffect(() => {
    const map = mapRef.current;
    const layer = shipsLayerRef.current;
    if (!showShips || !map || !layer) return;

    const AIS_DEBOUNCE_MS = 800; // nach dem Verschieben kurz warten, bevor der Server gefragt wird

    let active = true;
    let baltic = null; // Digitraffic-Schiffe; null = noch nicht geladen
    let ais = null; // AISStream-Schiffe; null = noch nicht geladen oder nicht nötig
    let aisController = null;
    let aisTimer = null;
    const markers = new Map(); // MMSI -> Marker, damit offene Popups beim Verschieben bestehen bleiben

    function viewBounds() {
      const b = map.getBounds().pad(0.1);
      return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
    }

    function render() {
      if (!active || (baltic === null && ais === null)) return;
      const zoomedOut = map.getZoom() < SHIP_MIN_ZOOM;
      const bounds = map.getBounds().pad(0.1);
      const inView = zoomedOut
        ? []
        : mergeShips(baltic ?? [], ais ?? []).filter((f) => {
            const [lon, lat] = f.geometry.coordinates;
            return bounds.contains([lat, lon]);
          });
      const shown = new Map(inView.slice(0, MAX_SHIPS).map((f) => [f.properties.mmsi, f]));

      for (const [mmsi, marker] of markers) {
        if (!shown.has(mmsi)) {
          layer.removeLayer(marker);
          markers.delete(mmsi);
        }
      }
      for (const [mmsi, feature] of shown) {
        const [lon, lat] = feature.geometry.coordinates;
        const props = feature.properties;
        const existing = markers.get(mmsi);
        if (!existing) {
          const marker = L.marker([lat, lon], { icon: shipIcon(props), keyboard: false });
          marker.shipProps = props;
          marker.on('click', async () => {
            const p = marker.shipProps;
            // AISStream liefert Name, Typ und Ziel schon mit; bei Digitraffic werden sie erst beim Klick geholt.
            const vessel = p.source === 'ais' ? vesselFromProps(p) : await loadVessel(p.mmsi);
            if (active) marker.bindPopup(buildPopupContent(p, vessel)).openPopup();
          });
          layer.addLayer(marker);
          markers.set(mmsi, marker);
        } else if (existing.shipProps !== props) {
          existing.shipProps = props;
          existing.setLatLng([lat, lon]);
          existing.setIcon(shipIcon(props));
        }
      }

      // Solange die AISStream-Antwort für diesen Ausschnitt aussteht, keine „leer“-Meldung zeigen.
      const awaitingAis = !zoomedOut && ais === null && !isInsideBaltic(viewBounds());
      if (zoomedOut) setShipNotice({ kind: 'zoom' });
      else if (inView.length === 0) setShipNotice(awaitingAis ? null : { kind: 'empty' });
      else if (inView.length > MAX_SHIPS) setShipNotice({ kind: 'limit', total: inView.length });
      else setShipNotice(null);
    }

    async function load() {
      try {
        const data = await loadShips();
        if (!active) return;
        baltic = data;
        setShipError(false);
        render();
      } catch {
        if (active) setShipError(true);
      }
    }

    async function loadAis() {
      aisController?.abort();
      const bounds = viewBounds();
      if (map.getZoom() < SHIP_MIN_ZOOM || isInsideBaltic(bounds)) {
        ais = null;
        setAisError(false);
        render();
        return;
      }
      const controller = new AbortController();
      aisController = controller;
      try {
        const data = await loadAisShips(bounds, controller.signal);
        if (!active || controller.signal.aborted) return;
        ais = data;
        setAisError(false);
        render();
      } catch {
        if (active && !controller.signal.aborted) setAisError(true);
      }
    }

    function scheduleAis() {
      clearTimeout(aisTimer);
      aisTimer = setTimeout(loadAis, AIS_DEBOUNCE_MS);
    }

    function onMoveEnd() {
      render();
      scheduleAis();
    }

    map.attributionControl.addAttribution(SHIP_ATTRIBUTION);
    map.attributionControl.addAttribution(AIS_ATTRIBUTION);
    map.on('moveend', onMoveEnd);
    load();
    loadAis();
    const id = setInterval(() => {
      load();
      loadAis();
    }, SHIP_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(id);
      clearTimeout(aisTimer);
      aisController?.abort();
      layer.clearLayers();
      // Wurde die Karte schon entfernt (Unmount), gibt es nichts mehr abzumelden.
      if (mapRef.current === map) {
        map.off('moveend', onMoveEnd);
        map.attributionControl.removeAttribution(SHIP_ATTRIBUTION);
        map.attributionControl.removeAttribution(AIS_ATTRIBUTION);
      }
      setShipNotice(null);
      setShipError(false);
      setAisError(false);
    };
  }, [showShips]);
```

- [ ] **Step 4: Hinweise im JSX anpassen**

Nach dem Block `{showShips && shipError && (...)}` einfügen:

```jsx
        {showShips && aisError && (
          <div className="map-hint" role="status">
            Die weltweiten Schiffsdaten (AISStream) sind gerade nicht erreichbar. Die Ostsee-Daten bleiben verfügbar.
          </div>
        )}
```

Den Text bei `kind === 'empty'` ändern:

```jsx
            {shipNotice.kind === 'empty' && 'In diesem Gebiet liegen keine Schiffsdaten vor.'}
```

- [ ] **Step 5: Build und Smoke-Test ohne Key**

Run: `npm run build`
Expected: erfolgreich. Dann (ohne `AISSTREAM_API_KEY`) im Browser auf `localhost` Schalter „Schiffe anzeigen“ an, Nordsee in Zoom ≥ 5: Fehlerhinweis „weltweite Schiffsdaten … nicht erreichbar“ erscheint, Ostsee zeigt weiterhin Schiffe, keine Konsolenfehler außer dem erwarteten 503.

- [ ] **Step 6: Commit**

```bash
git add app/IssMap.js
git commit -m "Karte: Schiffe außerhalb der Ostsee über AISStream, Digitraffic hat Vorrang

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Dokumentation (`CLAUDE.md`, Spec-Hinweise)

**Files:**
- Modify: `CLAUDE.md` (Befehle, Architektur, Sicherheitsregel)
- Modify: `README.md` falls dort Umgebungsvariablen oder Schiffstracker erwähnt sind (vorher mit Grep prüfen)

- [ ] **Step 1: `CLAUDE.md` ergänzen**

Im Abschnitt „Befehle“ eine Zeile: „`npm test` führt die Unit-Tests (`node --test tests/`) für `app/aisCore.js` und die Route `/api/ships` aus; mehr Tests gibt es nicht, die UI wird weiterhin manuell im Browser geprüft.“ Den Satz „Es gibt weder Linter noch Test-Runner“ entsprechend anpassen („keinen Linter; nur der eingebaute Node-Runner für reine Logik“).

Im Abschnitt „Architektur“ nach `app/ships.js` einfügen:

```
- `app/aisCore.js` ist reine Logik (Bounding-Box-Prüfung, Normalisierung von AISStream-Nachrichten, Zusammenführen nach MMSI) ohne Browser-/Next-Abhängigkeiten, daher mit `node --test` testbar.
- `app/api/ships/route.js` ist der Server-Proxy zu AISStream (weltweit). Der Key steht in `AISSTREAM_API_KEY` (lokal `.env.local`, auf Vercel als Projektvariable). Pro Anfrage kurzes WebSocket-Sammelfenster (4 s), 30 s Cache, Rate Limit 30/min je Client. `IssMap.js` ruft sie nur auf, wenn der Ausschnitt nicht ganz in der Ostsee liegt (`BALTIC_BOUNDS`); bei gleicher MMSI gewinnt Digitraffic.
```

Bei „Sicherheitsregel für Fremddaten“ ergänzen, dass dies auch für AISStream-Namen/-Ziele gilt (`sanitizeText` kürzt und entfernt Steuerzeichen, Anzeige weiterhin nur per `textContent`), und dass der AISStream-Key nie in Client-Code, Antworten oder Logs gelangen darf.

- [ ] **Step 2: Prüfen**

Run: `git diff --stat`
Expected: nur Dokumentationsdateien.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Dokumentation: AISStream-Anbindung, Env-Variable und Tests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Verifikation, Deployment, Sicherheitsscan

**Voraussetzung (Nutzeraktion):** AISStream-API-Key auf https://aisstream.io erzeugen, lokal in `.env.local` als `AISSTREAM_API_KEY=...` eintragen und im Vercel-Projekt als Umgebungsvariable (Production und Preview) setzen. Die Vercel-CLI ist nicht installiert; das geht auch im Vercel-Dashboard.

**Files:**
- Modify: `ai_docs/features/004_aisstream_global_ships.md` (Checkboxen abhaken, offene Fragen beantworten)

- [ ] **Step 1: Lokale manuelle Tests aus der Spec (Abschnitt „Tests“)**

Dev-Server mit Key neu starten und jeden Punkt prüfen: Nordsee/Mittelmeer Zoom ≥ 5; Ostsee ohne doppelte MMSI; Zoom < 5 ohne `/api/ships`-Anfragen (Netzwerk-Tab); Schalter aus; Popup-Text (gemockte Antwort mit `<img src=x onerror=alert(1)>` als Name); ungültige Parameter → 400; Rate Limit → 429; falscher Key → Fehlerhinweis; CSP-Konsole sauber; Regression ISS, Spur, Dark Mode, Satellit.

- [ ] **Step 2: Key-Schutz prüfen**

Run: `npm run build` und danach in Git Bash `grep -rl "<Key-Anfang>" .next/ app/ || echo "kein Treffer"`
Expected: `kein Treffer`.

- [ ] **Step 3: Vercel-Machbarkeit klären (offene Frage der Spec)**

Nach dem Deployment auf Vercel (Push auf `main`) `/api/ships?south=50&west=0&north=60&east=10` aufrufen: Antwortzeit ≈ 4–5 s, Schiffe vorhanden, Folgeaufruf innerhalb 30 s schnell. Ergebnis (Dichte, Laufzeit, Kaltstart) in der Spec unter „Offene Fragen“ festhalten. Reicht die Dichte nicht, Entscheidung über einen dauerhaften Dienst an den Nutzer zurückgeben, nicht eigenmächtig umbauen.

- [ ] **Step 4: StackHawk-Neuscan**

Skill `hawkscan:hawkscan` ausführen (nach Code-Änderung vorgesehen), Befunde beheben, erneut scannen. Erwartet: keine neuen Befunde gegenüber dem letzten Scan.

- [ ] **Step 5: Spec abschließen und committen**

Alle Checkboxen in `ai_docs/features/004_aisstream_global_ships.md` abhaken, die beantworteten offenen Fragen eintragen (Rate-Limit-Speicher: In-Memory je Instanz, dokumentierte Näherung; Test-Runner: `node --test`).

```bash
git add ai_docs/features/004_aisstream_global_ships.md
git commit -m "Spec 004: geprüfte Anforderungen und Testfälle abgehakt

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec-Abdeckung:** Schalter steuert beide Quellen (Task 4, kein neuer Schalter); Deduplizierung (Task 1 `mergeShips`, Task 4); Key nur serverseitig (Task 2, Task 6 Step 2, `.gitignore`); Route mit Bounding-Box, Momentaufnahme, Validierung, Limit 500 (Task 1/2); Rate Limit + Cache (Task 2); `textContent`-Regel (Task 1 `sanitizeText`, bestehendes `buildPopupContent`); Ausfall/fehlender Key → Digitraffic läuft weiter, Hinweis (Task 4 `aisError`, Task 2 503); Attribution (Task 3/4); StackHawk (Task 2/6); CLAUDE.md (Task 5); Tests der Spec (Task 6 Step 1); offene Fragen (Task 6 Step 3, Step 5).
- **Platzhalter-Scan:** keine „TBD/TODO“; alle Codeschritte enthalten vollständigen Code.
- **Typkonsistenz:** `parseBbox`/`snapBbox`/`bboxKey`/`limitBbox`/`createCollector`/`mergeShips`/`vesselFromProps`/`isInsideBaltic`/`hasValidPosition` heißen in Kernmodul, Route, `ships.js` und `IssMap.js` gleich; Feature-Format `{geometry.coordinates:[lon,lat], properties.{mmsi,sog,cog,heading,source,name,shipType,destination}}` ist überall identisch zu Digitraffic (`shipIcon`/`buildPopupContent` bleiben unverändert).
- **Bekanntes Restrisiko:** Die Feldnamen der AISStream-Nachrichten (`PositionReport.UserID/Latitude/Longitude/Sog/Cog/TrueHeading`, `ShipStaticData.Name/Type/Destination`, `MetaData.ShipName`) stammen aus der öffentlichen Dokumentation, nicht aus einem Live-Test; Task 2 Step 7 gleicht sie mit echten Nachrichten ab.

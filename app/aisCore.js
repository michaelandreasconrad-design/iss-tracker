// Reine Hilfsfunktionen für den weltweiten Schiff-Layer (AISStream). Bewusst ohne Browser-, Leaflet- oder
// Next-Abhängigkeiten, damit Server-Route, Karte und `node --test` dasselbe Modul nutzen können.

export const MAX_SHIPS = 500;
export const MAX_SPAN_LAT = 80; // Grad; bei Zoom 5 auf großen Bildschirmen deutlich weniger
export const MAX_SPAN_LON = 120;
export const BBOX_GRID = 0.5; // Raster, auf das Ausschnitte für den Cache gerundet werden
const SPAN_TOLERANCE = 0.01; // Rundungsspielraum, wenn der Browser Koordinaten auf 4 Stellen kürzt
const LAT_LIMIT = 85;
const LON_LIMIT = 180;
const SOG_NOT_AVAILABLE = 102.3; // AIS-Wert für „Geschwindigkeit unbekannt"

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
    // Nur echte Zahlen akzeptieren: Number(null) wäre 0 und würde als gültige Position durchgehen.
    const lon = numberOrNull(body.Longitude);
    const lat = numberOrNull(body.Latitude);
    if (lon === null || lat === null) return null;
    const feature = {
      geometry: { coordinates: [lon, lat] },
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

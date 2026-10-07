import L from 'leaflet';
import { MAX_SHIPS, hasValidPosition, limitBbox } from './aisCore';

// Schiffsdaten: Digitraffic Marine (Fintraffic), offene AIS-Daten für Ostsee und finnische Gewässer.
// Kein API-Schlüssel nötig. Die API verlangt gzip (Browser senden das automatisch) und bittet um
// einen `Digitraffic-User`-Header, der per CORS erlaubt ist.
const BASE_URL = 'https://meri.digitraffic.fi/api/ais/v1';
export const SHIPS_URL = `${BASE_URL}/locations`;
export const DIGITRAFFIC_HEADERS = { 'Digitraffic-User': 'iss-tracker' };

export const SHIP_REFRESH_MS = 60000; // AIS-Daten ändern sich langsamer als die ISS; die API cacht 60 s
export const SHIP_MIN_ZOOM = 5; // darunter wären zu viele Marker im Bild
export { MAX_SHIPS };
export const SHIP_ATTRIBUTION =
  'Schiffsdaten: <a href="https://www.digitraffic.fi/">Fintraffic / digitraffic.fi</a> (CC BY 4.0)';
export const AIS_URL = '/api/ships';
export const AIS_ATTRIBUTION = 'Weltweit: <a href="https://aisstream.io/">AISStream.io</a>';

const MOVING_KNOTS = 0.5; // darunter gilt ein Schiff als stehend
const COURSE_NOT_AVAILABLE = 360; // AIS-Wert für „Kurs unbekannt“
const HEADING_NOT_AVAILABLE = 511; // AIS-Wert für „Ausrichtung unbekannt“

const nf = (value, digits) =>
  value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

// AIS-Schiffstyp-Codes (Auswahl, grob nach Gruppen).
export function shipTypeLabel(code) {
  if (!Number.isFinite(code)) return null;
  if (code === 30) return 'Fischerei';
  if (code === 31 || code === 32) return 'Schlepper';
  if (code === 35) return 'Militär';
  if (code === 36) return 'Segelboot';
  if (code === 37) return 'Sportboot';
  if (code >= 40 && code <= 49) return 'Schnellfahrzeug';
  if (code === 52) return 'Schlepper';
  if (code >= 50 && code <= 59) return 'Spezialschiff';
  if (code >= 60 && code <= 69) return 'Passagierschiff';
  if (code >= 70 && code <= 79) return 'Frachtschiff';
  if (code >= 80 && code <= 89) return 'Tanker';
  return `Typ ${code}`;
}

function isMoving(props) {
  return Number.isFinite(props.sog) && props.sog >= MOVING_KNOTS;
}

// Ausrichtung des Symbols: Heading, sonst Kurs über Grund, sonst nach oben.
function bearing(props) {
  if (Number.isFinite(props.heading) && props.heading < HEADING_NOT_AVAILABLE) return props.heading;
  if (Number.isFinite(props.cog) && props.cog < COURSE_NOT_AVAILABLE) return props.cog;
  return 0;
}

// Fahrende Schiffe: Pfeil in Fahrtrichtung. Stehende Schiffe: Punkt ohne Richtung.
// Es fließen nur geprüfte Zahlen in das Markup ein, keine Texte aus der API.
// Die Drehung wird per DOM gesetzt, nicht als style-Attribut im Markup: Die CSP erlaubt kein Inline-Style
// im HTML (style-src ohne 'unsafe-inline'), Zuweisungen über element.style sind dagegen erlaubt.
export function shipIcon(props) {
  const root = document.createElement('div');
  if (isMoving(props)) {
    root.innerHTML =
      '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M10 1 L17 18 L10 14 L3 18 Z"/></svg>';
    root.firstChild.style.transform = `rotate(${Math.round(bearing(props))}deg)`;
  } else {
    root.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14"><circle cx="10" cy="10" r="6"/></svg>';
  }
  return L.divIcon({
    className: 'ship-marker',
    html: root.firstChild,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

// Schiffsname, Typ und Ziel stammen von Dritten (von Schiffen gesendet): nur als Text einsetzen, nie als HTML.
export function buildPopupContent(props, vessel) {
  const root = document.createElement('div');
  root.className = 'ship-popup';

  const title = document.createElement('strong');
  title.textContent = vessel?.name?.trim() || 'Unbekanntes Schiff';
  root.appendChild(title);

  const rows = [
    ['MMSI', String(props.mmsi)],
    ['Typ', shipTypeLabel(vessel?.shipType)],
    ['Geschwindigkeit', Number.isFinite(props.sog) ? `${nf(props.sog, 1)} kn` : null],
    [
      'Kurs',
      Number.isFinite(props.cog) && props.cog < COURSE_NOT_AVAILABLE
        ? `${Math.round(props.cog)}°`
        : null,
    ],
    ['Ziel', vessel?.destination?.trim() || null],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const row = document.createElement('div');
    row.textContent = `${label}: ${value}`;
    root.appendChild(row);
  }
  return root;
}

const vesselCache = new Map();

// Stammdaten (Name, Typ, Ziel) erst beim Klick laden und merken. Bei Fehlern: null, nichts wird gemerkt.
export async function loadVessel(mmsi) {
  if (vesselCache.has(mmsi)) return vesselCache.get(mmsi);
  try {
    const res = await fetch(`${BASE_URL}/vessels/${encodeURIComponent(mmsi)}`, {
      headers: DIGITRAFFIC_HEADERS,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const vessel = await res.json();
    vesselCache.set(mmsi, vessel);
    return vessel;
  } catch {
    return null;
  }
}

// Alle Schiffspositionen mit gültigen Koordinaten und MMSI.
export async function loadShips() {
  const res = await fetch(SHIPS_URL, { headers: DIGITRAFFIC_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.features)) throw new Error('Unerwartetes Format');
  return data.features.filter(hasValidPosition);
}

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

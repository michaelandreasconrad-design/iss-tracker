'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';

const issIcon = L.divIcon({
  className: 'iss-marker',
  html: '🛰️',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const MAX_TRAIL_POINTS = 120; // ca. 10 Minuten bei 5 s Intervall
const VIEW_STORAGE_KEY = 'mapView';

// Satellitenbilder: Esri World Imagery (ohne API-Schlüssel, Quellenangabe Pflicht).
// Echte Bilddaten gibt es bis Zoomstufe 17, darüber werden sie hochskaliert statt grau angezeigt.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

// Teilt die Spur am Datumswechsel (±180° Länge), damit keine Linie quer über die Karte läuft.
function splitAtAntimeridian(points) {
  const segments = [];
  let current = [];
  for (const point of points) {
    const prev = current[current.length - 1];
    if (prev && Math.abs(point[1] - prev[1]) > 180) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

function readStoredView() {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'satellite' ? 'satellite' : 'map';
  } catch {
    return 'map';
  }
}

export default function IssMap({ position, follow }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const trailRef = useRef(null);
  const trailCasingRef = useRef(null);
  const trailPointsRef = useRef([]);
  const streetLayerRef = useRef(null);
  const satelliteLayerRef = useRef(null);

  // Die Karte lädt nur im Browser (ssr: false), daher ist localStorage hier direkt lesbar.
  const [view, setView] = useState(readStoredView);
  const [satelliteError, setSatelliteError] = useState(false);

  useEffect(() => {
    const map = L.map(containerRef.current, { worldCopyJump: true }).setView([0, 0], 2);

    // Eigene Klasse an den Straßenkarten-Kacheln: Nur sie werden im Dark Mode abgedunkelt.
    streetLayerRef.current = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'tiles-street',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    });

    const satellite = L.tileLayer(SATELLITE_URL, {
      maxZoom: 19,
      maxNativeZoom: 17,
      attribution: SATELLITE_ATTRIBUTION,
    });
    satellite.on('tileerror', () => setSatelliteError(true));
    satellite.on('tileload', () => setSatelliteError(false));
    satelliteLayerRef.current = satellite;

    // Helle Kontur unter der Spur, damit sie auf Wasser und Wald sichtbar bleibt.
    trailCasingRef.current = L.polyline([], { color: '#ffffff', weight: 6, opacity: 0.7 }).addTo(map);
    trailRef.current = L.polyline([], { color: '#38bdf8', weight: 3, opacity: 0.9 }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      trailRef.current = null;
      trailCasingRef.current = null;
      streetLayerRef.current = null;
      satelliteLayerRef.current = null;
      trailPointsRef.current = [];
    };
  }, []);

  // Ansicht wechseln: Ausschnitt, Zoom, Marker und Spur bleiben, nur die Kachelebene wird getauscht.
  useEffect(() => {
    const map = mapRef.current;
    const street = streetLayerRef.current;
    const satellite = satelliteLayerRef.current;
    if (!map || !street || !satellite) return;

    const [show, hide] = view === 'satellite' ? [satellite, street] : [street, satellite];
    if (map.hasLayer(hide)) map.removeLayer(hide);
    if (!map.hasLayer(show)) show.addTo(map).bringToBack();
    setSatelliteError(false);
  }, [view]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    if (!markerRef.current) {
      markerRef.current = L.marker(position, { icon: issIcon }).addTo(map);
      map.setView(position, 3);
    } else {
      markerRef.current.setLatLng(position);
    }

    const points = trailPointsRef.current;
    points.push(position);
    if (points.length > MAX_TRAIL_POINTS) points.shift();
    const segments = splitAtAntimeridian(points);
    trailCasingRef.current.setLatLngs(segments);
    trailRef.current.setLatLngs(segments);
  }, [position]);

  // Folgen: bei jeder neuen Position und sofort beim Einschalten zur ISS schwenken.
  useEffect(() => {
    if (follow && position && mapRef.current) {
      mapRef.current.panTo(position, { animate: true, duration: 1 });
    }
  }, [follow, position]);

  function toggleView() {
    const next = view === 'satellite' ? 'map' : 'satellite';
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Speichern nicht möglich (z. B. privater Modus): Wechsel gilt nur für diese Sitzung.
    }
  }

  const label =
    view === 'satellite' ? 'Zur Kartenansicht wechseln' : 'Zur Satellitenansicht wechseln';

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <button
        type="button"
        className="view-toggle"
        onClick={toggleView}
        aria-label={label}
        title={label}
      >
        {view === 'satellite' ? '🗺️' : '🌍'}
      </button>
      {view === 'satellite' && satelliteError && (
        <div className="map-hint" role="status">
          Das Satellitenbild konnte nicht vollständig geladen werden.
        </div>
      )}
    </div>
  );
}

'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import {
  MAX_SHIPS,
  SHIP_ATTRIBUTION,
  SHIP_MIN_ZOOM,
  SHIP_REFRESH_MS,
  buildPopupContent,
  loadShips,
  loadVessel,
  shipIcon,
} from './ships';

const issIcon = L.divIcon({
  className: 'iss-marker',
  html: '🛰️',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const MAX_TRAIL_POINTS = 120; // ca. 10 Minuten bei 5 s Intervall
const VIEW_STORAGE_KEY = 'mapView';
const INITIAL_VIEW = { center: [0, 0], zoom: 2 }; // Startansicht, bis die erste ISS-Position da ist

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

export default function IssMap({ position, follow, showShips }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const trailRef = useRef(null);
  const trailCasingRef = useRef(null);
  const trailPointsRef = useRef([]);
  const streetLayerRef = useRef(null);
  const satelliteLayerRef = useRef(null);
  const shipsLayerRef = useRef(null);

  // Hinweise zum Schiffs-Layer: { kind: 'zoom' | 'empty' | 'limit', total? } bzw. Abruffehler.
  const [shipNotice, setShipNotice] = useState(null);
  const [shipError, setShipError] = useState(false);

  // Die Karte lädt nur im Browser (ssr: false), daher ist localStorage hier direkt lesbar.
  const [view, setView] = useState(readStoredView);
  const [satelliteError, setSatelliteError] = useState(false);

  useEffect(() => {
    const map = L.map(containerRef.current, { worldCopyJump: true }).setView(
      INITIAL_VIEW.center,
      INITIAL_VIEW.zoom
    );

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

    shipsLayerRef.current = L.layerGroup().addTo(map);

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
      shipsLayerRef.current = null;
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
      markerRef.current = L.marker(position, { icon: issIcon, zIndexOffset: 1000 }).addTo(map);
      // Nur zentrieren, solange die Karte unberührt auf der Startansicht steht. Trifft die erste Position
      // spät ein, darf sie einen bereits gewählten Ausschnitt nicht überschreiben.
      const center = map.getCenter();
      const untouched =
        map.getZoom() === INITIAL_VIEW.zoom &&
        Math.abs(center.lat - INITIAL_VIEW.center[0]) < 1e-6 &&
        Math.abs(center.lng - INITIAL_VIEW.center[1]) < 1e-6;
      if (untouched) map.setView(position, 3);
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

  // Schiffe: einmal pro Minute alle Positionen holen (die API kennt nur einen Radius, keinen
  // Kartenausschnitt) und im Browser auf den sichtbaren Ausschnitt begrenzen.
  useEffect(() => {
    const map = mapRef.current;
    const layer = shipsLayerRef.current;
    if (!showShips || !map || !layer) return;

    let active = true;
    let ships = null;
    const markers = new Map(); // MMSI -> Marker, damit offene Popups beim Verschieben bestehen bleiben

    function render() {
      if (!active || !ships) return;
      const zoomedOut = map.getZoom() < SHIP_MIN_ZOOM;
      const bounds = map.getBounds().pad(0.1);
      const inView = zoomedOut
        ? []
        : ships.filter((f) => {
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
            const vessel = await loadVessel(marker.shipProps.mmsi);
            if (active) marker.bindPopup(buildPopupContent(marker.shipProps, vessel)).openPopup();
          });
          layer.addLayer(marker);
          markers.set(mmsi, marker);
        } else if (existing.shipProps !== props) {
          existing.shipProps = props;
          existing.setLatLng([lat, lon]);
          existing.setIcon(shipIcon(props));
        }
      }

      if (zoomedOut) setShipNotice({ kind: 'zoom' });
      else if (inView.length === 0) setShipNotice({ kind: 'empty' });
      else if (inView.length > MAX_SHIPS) setShipNotice({ kind: 'limit', total: inView.length });
      else setShipNotice(null);
    }

    async function load() {
      try {
        const data = await loadShips();
        if (!active) return;
        ships = data;
        setShipError(false);
        render();
      } catch {
        if (active) setShipError(true);
      }
    }

    map.attributionControl.addAttribution(SHIP_ATTRIBUTION);
    map.on('moveend', render);
    load();
    const id = setInterval(load, SHIP_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(id);
      layer.clearLayers();
      // Wurde die Karte schon entfernt (Unmount), gibt es nichts mehr abzumelden.
      if (mapRef.current === map) {
        map.off('moveend', render);
        map.attributionControl.removeAttribution(SHIP_ATTRIBUTION);
      }
      setShipNotice(null);
      setShipError(false);
    };
  }, [showShips]);

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
      <div className="map-hints">
        {view === 'satellite' && satelliteError && (
          <div className="map-hint" role="status">
            Das Satellitenbild konnte nicht vollständig geladen werden.
          </div>
        )}
        {showShips && shipError && (
          <div className="map-hint" role="status">
            Die Schiffsdaten sind gerade nicht erreichbar. Wir versuchen es in einer Minute erneut.
          </div>
        )}
        {showShips && shipNotice && (
          <div className="map-hint map-hint--info" role="status">
            {shipNotice.kind === 'zoom' && 'Zum Anzeigen der Schiffe weiter hineinzoomen.'}
            {shipNotice.kind === 'empty' &&
              'In diesem Gebiet liegen keine Schiffsdaten vor (Abdeckung: Ostsee).'}
            {shipNotice.kind === 'limit' &&
              `Der Ausschnitt enthält ${shipNotice.total} Schiffe, angezeigt werden ${MAX_SHIPS}.`}
          </div>
        )}
      </div>
    </div>
  );
}

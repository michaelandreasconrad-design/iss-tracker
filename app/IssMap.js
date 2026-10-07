'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

const issIcon = L.divIcon({
  className: 'iss-marker',
  html: '🛰️',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const MAX_TRAIL_POINTS = 120; // ca. 10 Minuten bei 5 s Intervall

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

export default function IssMap({ position, follow }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const trailRef = useRef(null);
  const trailPointsRef = useRef([]);

  useEffect(() => {
    const map = L.map(containerRef.current, { worldCopyJump: true }).setView([0, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    }).addTo(map);
    trailRef.current = L.polyline([], { color: '#38bdf8', weight: 3, opacity: 0.8 }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      trailRef.current = null;
      trailPointsRef.current = [];
    };
  }, []);

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
    trailRef.current.setLatLngs(splitAtAntimeridian(points));
  }, [position]);

  // Folgen: bei jeder neuen Position und sofort beim Einschalten zur ISS schwenken.
  useEffect(() => {
    if (follow && position && mapRef.current) {
      mapRef.current.panTo(position, { animate: true, duration: 1 });
    }
  }, [follow, position]);

  return <div ref={containerRef} className="map" />;
}

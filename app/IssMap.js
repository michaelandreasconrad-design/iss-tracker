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

export default function IssMap({ position }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    const map = L.map(containerRef.current, { worldCopyJump: true }).setView([0, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
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
  }, [position]);

  return <div ref={containerRef} className="map" />;
}

'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import ThemeToggle from './ThemeToggle';

// Leaflet greift auf `window` zu und darf nur im Browser geladen werden.
const IssMap = dynamic(() => import('./IssMap'), {
  ssr: false,
  loading: () => <div className="map-placeholder">Karte wird geladen …</div>,
});

const API_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const POLL_INTERVAL_MS = 5000;
const SHIPS_STORAGE_KEY = 'showShips';

// Werte des API-Felds `visibility`: daylight, visible (Dämmerung), eclipsed.
const DAYLIGHT = {
  daylight: { label: 'Tag', icon: '☀️' },
  visible: { label: 'Dämmerung', icon: '🌅' },
  eclipsed: { label: 'Nacht', icon: '🌙' },
};

const nf = (value, digits) =>
  value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export default function Home() {
  const [iss, setIss] = useState(null);
  const [error, setError] = useState(false);
  const [follow, setFollow] = useState(false);
  const [showShips, setShowShips] = useState(false);
  const [crew, setCrew] = useState(null);
  const [crewError, setCrewError] = useState(false);

  // Gespeicherte Wahl erst nach dem Laden lesen, damit Server- und Client-Markup übereinstimmen.
  useEffect(() => {
    try {
      setShowShips(localStorage.getItem(SHIPS_STORAGE_KEY) === 'true');
    } catch {
      // localStorage nicht verfügbar: Standard (aus) bleibt.
    }
  }, []);

  function changeShowShips(checked) {
    setShowShips(checked);
    try {
      localStorage.setItem(SHIPS_STORAGE_KEY, String(checked));
    } catch {
      // Speichern nicht möglich (z. B. privater Modus): Wahl gilt nur für diese Sitzung.
    }
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch(API_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!active) return;
        setIss({
          lat: data.latitude,
          lon: data.longitude,
          altitude: data.altitude,
          velocity: data.velocity,
          visibility: data.visibility,
        });
        setError(false);
      } catch {
        if (active) setError(true);
      }
    }

    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/astros')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => active && setCrew(data.people))
      .catch(() => active && setCrewError(true));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <header className="page-header">
        <div>
          <h1>ISS-Live-Tracker</h1>
          <p>Aktuelle Position der Internationalen Raumstation</p>
        </div>
        <ThemeToggle />
      </header>

      {error && (
        <div className="error" role="alert">
          Die ISS-Daten sind gerade nicht erreichbar. Wir versuchen es automatisch
          alle 5 Sekunden erneut.
        </div>
      )}

      <section className="stats" aria-label="Messwerte">
        <Stat label="Breite" value={iss ? `${nf(iss.lat, 4)}°` : '–'} />
        <Stat label="Länge" value={iss ? `${nf(iss.lon, 4)}°` : '–'} />
        <Stat label="Höhe" value={iss ? `${nf(iss.altitude, 1)} km` : '–'} />
        <Stat label="Geschwindigkeit" value={iss ? `${nf(iss.velocity, 0)} km/h` : '–'} />
        <Stat
          label="Tageszeit"
          value={
            iss && DAYLIGHT[iss.visibility]
              ? `${DAYLIGHT[iss.visibility].icon} ${DAYLIGHT[iss.visibility].label}`
              : '–'
          }
        />
      </section>

      <div className="map-options">
        <label className="follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Karte folgt der ISS
        </label>
        <label className="follow">
          <input
            type="checkbox"
            checked={showShips}
            onChange={(e) => changeShowShips(e.target.checked)}
          />
          Schiffe anzeigen
        </label>
      </div>

      <IssMap position={iss ? [iss.lat, iss.lon] : null} follow={follow} showShips={showShips} />

      <section className="crew" aria-label="Besatzung">
        <h2>Aktuell an Bord{crew ? ` (${crew.length})` : ''}</h2>
        {crewError ? (
          <p className="crew-note">Die Besatzungsliste ist gerade nicht verfügbar.</p>
        ) : !crew ? (
          <p className="crew-note">Wird geladen …</p>
        ) : crew.length === 0 ? (
          <p className="crew-note">Keine Daten zur Besatzung vorhanden.</p>
        ) : (
          <ul>
            {crew.map((name) => (
              <li key={name}>👨‍🚀 {name}</li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

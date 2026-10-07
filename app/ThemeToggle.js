'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'theme';

export default function ThemeToggle() {
  // Bis zur Hydration unbekannt, damit Server- und Client-Markup übereinstimmen.
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Speichern nicht möglich (z. B. privater Modus): Wechsel gilt nur für diese Sitzung.
    }
  }

  const label = theme === 'light' ? 'Zum dunklen Design wechseln' : 'Zum hellen Design wechseln';

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={label} title={label}>
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}

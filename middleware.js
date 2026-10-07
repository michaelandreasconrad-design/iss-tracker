import { NextResponse } from 'next/server';

const isDev = process.env.NODE_ENV !== 'production';

// Content Security Policy mit Nonce pro Anfrage: Skripte laufen nur, wenn sie das Nonce tragen
// (Next.js-Hydration und das Theme-Skript im Layout). Dadurch ist kein 'unsafe-inline' für Skripte nötig.
// - style-src 'self': Kein 'unsafe-inline'. Leaflet setzt Styles per JavaScript über element.style, das die CSP
//   nicht blockiert. Im HTML-Markup (z. B. innerHTML) darf deshalb kein style-Attribut stehen.
// - img-src: OpenStreetMap-Kacheln und Esri-Satellitenbilder.
// - connect-src: ISS-Positions-API und Schiffsdaten (Digitraffic); im Dev-Modus zusätzlich WebSocket für Hot Reload.
function buildCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com",
    `connect-src 'self' https://api.wheretheiss.at https://meri.digitraffic.fi${isDev ? ' ws: wss:' : ''}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function middleware(request) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Statische Build-Dateien brauchen kein Nonce; alle Seiten, API-Routen und Dateien wie robots.txt schon.
  matcher: ['/((?!_next/static|_next/image).*)'],
};

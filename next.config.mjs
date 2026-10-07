const isDev = process.env.NODE_ENV !== 'production';

// Content Security Policy: erlaubt nur, was die App tatsächlich braucht.
// - script/style 'unsafe-inline': Inline-Theme-Skript, Next.js-Hydration und Leaflet-Inline-Styles.
// - img-src: OpenStreetMap-Kacheln.
// - connect-src: ISS-Positions-API; im Dev-Modus zusätzlich WebSocket für Hot Reload.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  `connect-src 'self' https://api.wheretheiss.at${isDev ? ' ws: wss:' : ''}`,
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;

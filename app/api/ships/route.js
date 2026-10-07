// Proxy für AISStream (weltweite AIS-Daten). Der API-Key bleibt auf dem Server. Der Browser fragt einen
// Kartenausschnitt an; die Route sammelt kurz Positionsmeldungen über ein WebSocket und antwortet mit einer
// Momentaufnahme im selben Feature-Format wie Digitraffic.
import { MAX_SHIPS, bboxKey, createCollector, parseBbox, snapBbox } from '../../aisCore.js';

export const dynamic = 'force-dynamic';

const STREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const MESSAGE_TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData'];
const COLLECT_MS = 4000; // Sammelfenster pro Anfrage
const CACHE_TTL_MS = 30000;
const CACHE_MAX_ENTRIES = 50;
const RATE_LIMIT = 30; // Anfragen je Client und Minute
const RATE_WINDOW_MS = 60000;

// Kurzlebige Zwischenspeicher je Serverinstanz (bei mehreren Instanzen nur eine Näherung).
const cache = new Map(); // Ausschnitt -> { at, promise }
const hits = new Map(); // Client -> Zeitstempel der letzten Anfragen

// Ohne x-forwarded-for teilen sich alle Anfragen einen Bucket 'unknown' (Vercel setzt den Header immer; ohne Proxy gilt ein gemeinsames, strengeres Limit).
function clientId(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || 'unknown';
}

function rateLimited(id, now) {
  const recent = (hits.get(id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = recent.length >= RATE_LIMIT;
  if (!limited) recent.push(now);
  hits.set(id, recent);
  if (hits.size > 1000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key);
    }
  }
  return limited;
}

function collect(bbox, apiKey) {
  return new Promise((resolve, reject) => {
    const collector = createCollector(MAX_SHIPS);
    let settled = false;
    let received = false;
    let opened = false;
    let timer = null;
    const ws = new WebSocket(STREAM_URL);
    ws.binaryType = 'arraybuffer';

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // schon geschlossen
      }
      if (error) reject(error);
      else resolve(collector.result());
    };

    timer = setTimeout(() => finish(opened ? null : new Error('Zeitüberschreitung beim Verbindungsaufbau')), COLLECT_MS);

    ws.onopen = () => {
      opened = true;
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [[[bbox.south, bbox.west], [bbox.north, bbox.east]]],
          FilterMessageTypes: MESSAGE_TYPES,
        })
      );
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        msg = JSON.parse(text);
      } catch {
        return;
      }
      received = true;
      if (msg && typeof msg.error === 'string') return finish(new Error('AISStream hat die Anfrage abgelehnt'));
      collector.add(msg);
      if (collector.size() >= MAX_SHIPS) finish(null);
    };
    ws.onerror = () => finish(new Error('Verbindung zu AISStream fehlgeschlagen'));
    ws.onclose = () => finish(received ? null : new Error('AISStream hat die Verbindung geschlossen'));
  });
}

export async function GET(request) {
  const now = Date.now();
  if (rateLimited(clientId(request), now)) {
    return Response.json({ error: 'Zu viele Anfragen' }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const bbox = parseBbox(new URL(request.url).searchParams);
  if (!bbox) return Response.json({ error: 'Ungültiger Ausschnitt' }, { status: 400 });

  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) return Response.json({ error: 'Schiffsdaten nicht konfiguriert' }, { status: 503 });

  const snapped = snapBbox(bbox);
  const key = bboxKey(snapped);
  let entry = cache.get(key);
  if (!entry || now - entry.at > CACHE_TTL_MS) {
    const current = { at: now, promise: collect(snapped, apiKey) };
    entry = current;
    cache.delete(key); // abgelaufenen Eintrag ans Ende der Einfügereihenfolge verschieben
    cache.set(key, current);
    // Fehlschläge nicht zwischenspeichern.
    current.promise.catch(() => {
      if (cache.get(key) === current) cache.delete(key);
    });
    if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }

  try {
    const ships = await entry.promise;
    return Response.json(
      { ships },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=30' } }
    );
  } catch (error) {
    console.error('AISStream:', error.message); // nie den Key oder Rohdaten loggen
    return Response.json({ error: 'Schiffsdaten nicht verfügbar' }, { status: 502 });
  }
}

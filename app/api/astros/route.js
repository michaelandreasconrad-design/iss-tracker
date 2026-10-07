// Proxy für Open Notify: Die Quelle bietet nur HTTP, der Browser blockiert sie
// von einer HTTPS-Seite aus (Mixed Content). Der Server darf sie abrufen.
const SOURCE_URL = 'http://api.open-notify.org/astros.json';

export const revalidate = 300; // Besatzung ändert sich selten: 5 Minuten cachen

export async function GET() {
  try {
    const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const people = (data.people ?? [])
      .filter((p) => p.craft === 'ISS')
      .map((p) => p.name);
    return Response.json({ people });
  } catch {
    return Response.json({ error: 'Astronauten-Daten nicht verfügbar' }, { status: 502 });
  }
}

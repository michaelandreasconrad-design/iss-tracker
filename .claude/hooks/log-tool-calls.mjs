// Claude-Code-Hook: protokolliert jeden Tool-Aufruf als eine JSON-Zeile in logs/tool-calls.log.
// Wird als PreToolUse-Hook aufgerufen und bekommt die Hook-Daten als JSON auf stdin.
// Der Hook darf nie den Aufruf stören: Fehler werden verschluckt, der Exit-Code ist immer 0.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_STRING = 500; // längere Texte (z. B. Dateiinhalte) werden gekürzt
const LOG_FILE = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'logs', 'tool-calls.log');

// Geheimnisse nicht im Klartext ins Log schreiben (Schlüssel, Tokens, Passwörter in KEY=wert-Form).
const SECRET_PATTERN = /((?:api[_-]?key|token|secret|passwort|password|authorization)\w*["']?\s*[:=]\s*["']?)[^\s"',;]+/gi;

function clean(value) {
  if (typeof value === 'string') {
    const masked = value.replace(SECRET_PATTERN, '$1***');
    return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}… (+${masked.length - MAX_STRING} Zeichen)` : masked;
  }
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  const input = JSON.parse(await readStdin());
  const entry = {
    time: new Date().toISOString(),
    event: input.hook_event_name,
    session: input.session_id,
    agent: input.agent_id, // nur gesetzt, wenn ein Subagent den Aufruf macht
    tool: input.tool_name,
    input: clean(input.tool_input),
  };
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`);
} catch {
  // Logging ist optional: nie den eigentlichen Tool-Aufruf blockieren.
}
process.exit(0);

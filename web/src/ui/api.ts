// Thin client for the Pathfinder API (/api/*: Vite proxy → uvicorn locally, Python function on Vercel).
// Errors are thrown as a bare "request failed" so no status code or server text can reach the UI.

export async function post<T>(url: string, body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('request failed');
  }
  if (!r.ok) throw new Error('request failed');
  return r.json();
}

export interface Health {
  gemini: boolean;
  tts: boolean;
}

let health: Promise<Health> | null = null;

/** Cached for the page's lifetime; resolves to "nothing available" if the API is unreachable. */
export function getHealth(): Promise<Health> {
  health ??= fetch('/api/health')
    .then((r) => (r.ok ? r.json() : null))
    .then((h) => ({ gemini: !!h?.gemini, tts: !!h?.tts }))
    .catch(() => ({ gemini: false, tts: false }));
  return health;
}

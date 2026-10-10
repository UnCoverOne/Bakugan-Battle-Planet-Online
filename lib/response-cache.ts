/** Short-lived, memory-only responses. Viewer keys isolate personalized results. */
type Entry = { value?: unknown; expires: number; pending?: Promise<unknown> };
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 24;
export function invalidateResponse(prefix: string) {
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}
export function peekResponse<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}
export function cachedResponse<T>(key: string, url: string, ttl = 60_000): Promise<T> {
  const existing = entries.get(key);
  if (existing?.pending) return existing.pending as Promise<T>;
  if (existing?.value !== undefined && existing.expires > Date.now()) return Promise.resolve(existing.value as T);
  const entry: Entry = { value: existing?.value, expires: 0 };
  const pending = fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) }).then(async response => {
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "The requested data is unavailable.");
    // An invalidated in-flight request must never populate a newer cache generation.
    if (entries.get(key) === entry) { entry.value = result; entry.expires = Date.now() + ttl; }
    return result as T;
  }).finally(() => { if (entries.get(key) === entry) entry.pending = undefined; });
  entry.pending = pending;
  if (!entries.has(key) && entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(key, entry);
  return pending;
}
export const publicDeckResponseKey = (viewer?: string) => `public-decks:${viewer || "guest"}`;

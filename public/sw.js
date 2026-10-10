const BUILD_ID = (
  new URL(self.location.href).searchParams.get("build") || "development"
)
  .replace(/[^a-z0-9._-]/gi, "")
  .slice(0, 48) || "development";
const CACHE_PREFIX = "bbp-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const OFFLINE_URL = "/offline";
const ART_CACHE_NAME = "bbp-art-v1";
const ART_ENTRY_LIMIT = 600;
const ART_BYTE_LIMIT = 64 * 1024 * 1024;
let artWrites = 0;
let trimming = null;
async function trimArtworkCache(cache) {
  if (trimming) return trimming;
  trimming = (async () => {
    const keys = await cache.keys();
    let bytes = 0;
    const sizes = [];
    for (const key of keys) {
      const response = await cache.match(key);
      const size = Number(response?.headers.get("x-bbp-size") || response?.headers.get("content-length") || 0);
      sizes.push(size); bytes += size;
    }
    let remaining = keys.length;
    for (let i = 0; i < keys.length && (remaining > ART_ENTRY_LIMIT || bytes > ART_BYTE_LIMIT); i++) {
      await cache.delete(keys[i]); bytes -= sizes[i]; remaining--;
    }
  })().finally(() => { trimming = null; });
  return trimming;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL, "/favicon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? caches.match(OFFLINE_URL)),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/_next/") || url.pathname === "/favicon.svg") {
    event.respondWith((async () => {
      const artwork = url.pathname.startsWith("/assets/") && !/\.(?:js|css|map)$/.test(url.pathname);
      const persistentArt = artwork && (/^[a-f0-9]{16}$/i.test(url.searchParams.get("v") || "") || /[.-][a-f0-9]{8,}\./i.test(url.pathname));
      const cache = await caches.open(persistentArt ? ART_CACHE_NAME : CACHE_NAME);
      const cached = await cache.match(request);
      const immutable = /^\/_next\/static\//.test(url.pathname)
        || /[.-][a-f0-9]{8,}\./i.test(url.pathname)
        || url.searchParams.has("v");
      const savedAt = cached ? Number(cached.headers.get("x-bbp-cached-at") || 0) : 0;
      const maxAge = /\/assets\/(cards|cores)\//.test(url.pathname) ? 7 * 86400_000 : 86400_000;
      if (cached && (immutable || Date.now() - savedAt < maxAge)) return cached;
      const update = fetch(request).then(async (response) => {
        if (response.ok) {
          const copy = response.clone();
          const headers = new Headers(copy.headers);
          headers.set("x-bbp-cached-at", String(Date.now()));
          const bytes = await copy.arrayBuffer();
          // Audio and unusually large source art should not displace the browsing cache.
          if (!artwork || bytes.byteLength <= 2 * 1024 * 1024) {
            headers.set("x-bbp-size", String(bytes.byteLength));
            await cache.put(request, new Response(bytes, {
              status: copy.status, statusText: copy.statusText, headers,
            }));
            if (persistentArt && (++artWrites % 32 === 1)) await trimArtworkCache(cache);
          }
        }
        return response;
      });
      if (cached) {
        event.waitUntil(update.then(() => undefined).catch(() => undefined));
        return cached;
      }
      event.waitUntil(update.then(() => undefined).catch(() => undefined));
      return update;
    })());
  }
});

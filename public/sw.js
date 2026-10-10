const BUILD_ID = (
  new URL(self.location.href).searchParams.get("build") || "development"
)
  .replace(/[^a-z0-9._-]/gi, "")
  .slice(0, 48) || "development";
const CACHE_PREFIX = "bbp-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const OFFLINE_URL = "/offline";

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
      const cache = await caches.open(CACHE_NAME);
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
          await cache.put(request, new Response(await copy.arrayBuffer(), {
            status: copy.status, statusText: copy.statusText, headers,
          }));
        }
        return response;
      });
      if (cached) {
        event.waitUntil(update.then(() => undefined).catch(() => undefined));
        return cached;
      }
      return update;
    })());
  }
});

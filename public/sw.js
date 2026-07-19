self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const mutableAsset = url.origin === self.location.origin && (
    url.pathname.startsWith("/assets/")
    || url.pathname === "/favicon.svg"
  );
  if (!mutableAsset) return;

  event.respondWith(
    fetch(new Request(request, { cache: "reload" }))
      .catch(() => fetch(request)),
  );
});

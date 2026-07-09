const CACHE_NAME = "maktabah-prayoga-v1";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Strategi: coba jaringan dulu (agar data & CDN selalu terbaru saat online),
// kalau gagal (offline) baru pakai cache sebagai fallback.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          // hanya cache request yang berasal dari origin sendiri
          if (event.request.url.startsWith(self.location.origin)) {
            cache.put(event.request, clone);
          }
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

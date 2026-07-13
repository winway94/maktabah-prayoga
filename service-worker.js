const CACHE_NAME = "maktabah-prayoga-v1-45-1";
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
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
  event.respondWith(fetchWithRetry(event.request));
});

// v1.45.1: saat HP baru dibuka pagi hari, koneksi jaringan kadang belum
// benar-benar siap sepersekian detik pertama, membuat fetch() gagal padahal
// sebenarnya bukan offline. Sebelumnya kegagalan ini langsung jatuh ke cache
// lama (app shell terasa "nyangkut" versi kemarin sampai di-refresh berkali-kali).
// Sekarang: retry sekali setelah jeda singkat sebelum benar-benar fallback ke cache.
async function fetchWithRetry(request, retriesLeft = 1) {
  try {
    const response = await fetch(request);
    const clone = response.clone();
    if (request.url.startsWith(self.location.origin)) {
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  } catch (err) {
    if (retriesLeft > 0) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return fetchWithRetry(request, retriesLeft - 1);
    }
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

/* ============================================================
   Service Worker — Hafalan & Murajaah
   Cache app-shell dasar supaya bisa dibuka offline / lebih cepat.
   MODE: paksa update — begitu ada versi baru terdeteksi, service worker
   baru langsung aktif dan halaman otomatis reload sendiri (lihat
   controllerchange di index.html), tanpa perlu klik apa pun.
   OTOMATIS IKUT TERUPDATE (sejak v117): halaman (index.html, "./") dan
   manifest.json sekarang diambil dari INTERNET DULU (network-first) —
   simpanan HP hanya dipakai kalau offline / internet lambat (> 4 detik).
   Jadi setiap index.html baru diunggah, aplikasi langsung tampil versi
   terbaru tanpa perlu menaikkan CACHE_VERSION lagi.
   CACHE_VERSION cukup dinaikkan kalau IKON diganti, atau kalau file
   service worker ini sendiri diubah.
   ============================================================ */
const CACHE_VERSION = "v117";
// Batas tunggu internet utk halaman: lewat dari ini pakai simpanan HP dulu
// (halaman baru tetap diunduh di latar belakang utk pembukaan berikutnya).
const BATAS_TUNGGU_HALAMAN_MS = 4000;
const CACHE_NAME = "hafalan-" + CACHE_VERSION;
// Cache TERPISAH untuk aset statis pihak ketiga (SVG halaman mushaf +
// audio murottal per-ayat). SENGAJA tidak ikut prefix "hafalan-"/
// CACHE_VERSION di atas, supaya TIDAK ikut terhapus tiap kali app
// update (lihat ACTIVATE di bawah) — isinya memang permanen (halaman N
// & ayat X:Y selalu sama persis), jadi sekali diambil disimpan
// selamanya, tidak perlu di-invalidate ulang tiap rilis versi baru.
const MUSHAF_CACHE_NAME = "mushaf-assets-v1";
// Cache aset statis pihak ketiga: gambar mushaf PNG (mode alternatif),
// audio murottal, dan font Google "Amiri Quran" (dipakai render halaman
// mode teks). Semua permanen/tidak pernah berubah, jadi aman di-cache
// selamanya begitu pernah diakses sekali saat online.
const MUSHAF_CACHEABLE_HOSTS = ["cdn.jsdelivr.net", "everyayah.com", "fonts.googleapis.com", "fonts.gstatic.com", "raw.githubusercontent.com"];

// File same-origin yang wajib ada supaya app bisa dibuka offline.
// Catatan: data hafalan sendiri TIDAK di-cache di sini — itu selalu
// diambil langsung dari Worker (lihat fetchData() di index.html),
// supaya progres yang tampil selalu yang terbaru saat online.
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192x192.png",
  "./icon-512x512.png",
  "./icon-192x192-maskable.png",
  "./icon-512x512-maskable.png",
  "./icon-180x180.png",
  "./icon-32x32.png",
  "./icon-16x16.png"
];

/* ---------- INSTALL: simpan app-shell ke cache ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll akan gagal total kalau salah satu URL 404 —
      // jadi ditambahkan satu per satu dan diabaikan kalau gagal,
      // supaya instalasi tidak batal hanya karena 1 file hilang.
      return Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.log("SW: gagal cache", url, err);
          })
        )
      );
    })
  );
  // DIPAKSA update: worker baru langsung aktif begitu selesai di-install,
  // tidak menunggu tab lama ditutup atau tombol "Perbarui Sekarang" diklik.
  self.skipWaiting();
});

/* ---------- MESSAGE: terima sinyal "SKIP_WAITING" dari halaman ---------- */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* ---------- ACTIVATE: bersihkan cache versi lama ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("hafalan-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* ---------- FETCH: cache-first untuk app-shell same-origin, ----------
   fallback ke network. Request ke Worker API (/data, /telegram-webhook)
   dan ke domain lain (font Google, dll) sengaja DILEWATKAN dari cache,
   supaya data hafalan yang tampil selalu terbaru dan tidak ada masalah
   CORS/opaque response. */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Aset statis mushaf (SVG halaman + audio ayat) dari CDN pihak ketiga —
  // cache-first PERMANEN (bukan stale-while-revalidate seperti app-shell
  // di bawah), karena isinya memang tidak pernah berubah. Sekali halaman/
  // ayat dibuka sekali saat online, seterusnya bisa diakses offline tanpa
  // makan kuota data lagi.
  if (!isSameOrigin && MUSHAF_CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(MUSHAF_CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached); // offline & belum pernah dibuka -> gagal senyap
        })
      )
    );
    return;
  }

  if (!isSameOrigin) return; // domain lain (Worker API, dst) biarkan lewat apa adanya

  // ---------- HALAMAN & MANIFEST: network-first (v117) ----------
  // Selalu coba ambil versi terbaru dari internet dulu, supaya setiap
  // index.html yang baru diunggah LANGSUNG dipakai — tanpa perlu menaikkan
  // CACHE_VERSION manual. Simpanan HP hanya jadi cadangan saat offline /
  // internet lambat.
  const jalur = url.pathname;
  const isHalaman = req.mode === "navigate" || req.destination === "document" ||
    /\/$|\/index\.html$|\/manifest\.json$/.test(jalur);
  if (isHalaman) {
    event.respondWith(ambilHalamanTerbaru(event, req));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached); // offline & tidak ada di cache -> gagal senyap
      return cached || networkFetch;
    })
  );
});

/* Network-first dgn batas waktu: internet menang kalau menjawab < 4 detik;
   kalau lambat/offline pakai simpanan HP. Hasil dari internet selalu
   disimpan utk cadangan berikutnya. */
function ambilHalamanTerbaru(event, req) {
  const dariInternet = fetch(req, { cache: "no-store" }).then((res) => {
    if (res && res.status === 200) {
      const salinan = res.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(req, salinan)));
    }
    return res;
  });
  const dariSimpanan = () =>
    caches.match(req).then((c) => c || caches.match("./index.html")).then((c) => c || caches.match("./"));

  return new Promise((resolve) => {
    let selesai = false;
    const pakai = (res) => { if (!selesai && res) { selesai = true; resolve(res); } };
    // internet lambat -> tampilkan simpanan dulu (kalau ada)
    const timer = setTimeout(() => dariSimpanan().then(pakai), BATAS_TUNGGU_HALAMAN_MS);
    dariInternet
      .then((res) => { clearTimeout(timer); pakai(res); })
      .catch(() => {
        clearTimeout(timer);
        dariSimpanan().then((c) => pakai(c || new Response("Offline — halaman belum pernah tersimpan.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })));
      });
  });
}
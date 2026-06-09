/* 엘리베이터 속도 측정기 - 오프라인 서비스워커
   앱 셸을 캐시에 저장해 최초 1회 로드 후 오프라인(승강로 안)에서도 동작하게 한다.
   앱을 수정하면 아래 CACHE 버전을 올려라 (예: v23 -> v24). */
const CACHE_PREFIX = "elevspeed-";
const CACHE = `${CACHE_PREFIX}v24`;
const APP_SHELL = "./index.html";
const ASSETS = [
  "./",
  APP_SHELL,
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (
        k.startsWith(CACHE_PREFIX) && k !== CACHE ? caches.delete(k) : null
      ))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(APP_SHELL, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(APP_SHELL))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(APP_SHELL))
    )
  );
});

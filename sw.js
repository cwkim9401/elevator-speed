/* 엘리베이터 속도 측정기 - 오프라인 서비스워커
   앱 셸을 캐시에 저장해 최초 1회 로드 후 오프라인(승강로 안)에서도 동작하게 한다.
   앱을 수정하면 아래 CACHE 버전을 올려라 (예: v26 -> v27). */
const CACHE_PREFIX = "elevspeed-";
const CACHE = `${CACHE_PREFIX}v26`;
const NAV_TIMEOUT_MS = 2500; // 시작 시 네트워크 대기 상한(ms) — 약한 신호(승강로·지하)에서도 캐시로 빠른 기동
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
    // 네트워크 우선 + 타임아웃: 신호가 '약하게 살아있는' 곳에서 fetch가 오래 매달리지 않도록,
    // 캐시가 있으면 NAV_TIMEOUT_MS 안에 응답이 없을 때 즉시 캐시로 시작한다.
    // 네트워크 응답은 백그라운드에서 끝까지 받아 캐시를 갱신(다음 실행에 반영).
    const net = fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(APP_SHELL, copy)).catch(() => {});
      return resp;
    });
    e.waitUntil(net.then(() => {}, () => {}));
    e.respondWith(
      caches.match(APP_SHELL).then((cached) => {
        if (!cached) return net;  // 최초 방문은 네트워크에서 받아야 함
        const timeout = new Promise((res) => { setTimeout(() => res(null), NAV_TIMEOUT_MS); });
        return Promise.race([net.catch(() => null), timeout]).then((r) => r || cached);
      })
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

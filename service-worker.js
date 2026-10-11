const IMAGE_CACHE_PREFIX = "da-fei-yu-images-";
// Bump this version when replacing image files without changing their URLs.
const IMAGE_CACHE_NAME = `${IMAGE_CACHE_PREFIX}v4`;
const GAME_ASSET_PATH = /\/(?:Assets\/(?:processed|illustrations)\/[^/]+\.webp|vendor\/html2canvas\.min\.js)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(IMAGE_CACHE_PREFIX) && name !== IMAGE_CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !GAME_ASSET_PATH.test(url.pathname)) return;

  const bypassCache = url.searchParams.has("reload");
  url.searchParams.delete("reload");
  const cacheKey = new Request(url.href, { method: "GET" });

  event.respondWith((async () => {
    let cache;
    let cachedResponse;
    try {
      cache = await caches.open(IMAGE_CACHE_NAME);
      cachedResponse = await cache.match(cacheKey);
    } catch (_) {
      return fetch(request, bypassCache ? { cache: "reload" } : undefined);
    }
    if (cachedResponse && !bypassCache) return cachedResponse;

    let response;
    try {
      response = await fetch(request, bypassCache ? { cache: "reload" } : undefined);
    } catch (error) {
      if (cachedResponse) return cachedResponse;
      throw error;
    }
    if (cachedResponse && (!response.ok || response.type !== "basic")) {
      return cachedResponse;
    }
    if (response.ok && response.type === "basic") {
      await cache.put(cacheKey, response.clone()).catch(() => {});
    }
    return response;
  })());
});

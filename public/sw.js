/*
 * NextOn service worker (Harness §7.9/§15 — caching for fast repeat opens + offline launch).
 *
 * Strategy:
 *   • /_next/static/** and fonts/icons/css/js → CACHE-FIRST. These are content-hashed/immutable,
 *     so serving from cache is correct and makes repeat opens instant (no re-download).
 *   • Navigations (HTML) → NETWORK-FIRST, falling back to the cached shell so the app still LAUNCHES
 *     offline (its data is already offline-first in IndexedDB). Online always gets fresh HTML.
 *   • /api/** → never touched (the KV sync API is fail-closed; must always hit the network).
 *
 * Bump VERSION to invalidate old caches on a breaking change.
 */
const VERSION = "v2";
const STATIC_CACHE = `nexton-static-${VERSION}`;
const PAGE_CACHE = `nexton-pages-${VERSION}`;

/**
 * How long a navigation waits for the network before falling back to the cached shell.
 *
 * The failure this exists to prevent is the app's whole reason for being offline-first: a touchline
 * signal that is PRESENT but hopeless. A dead connection rejects fast and the fallback fires; a
 * one-bar connection just hangs, and `fetch` will sit there for the browser's own timeout — tens of
 * seconds — while a perfectly good shell sits in the cache. The coach gets a blank screen at kickoff.
 *
 * Three seconds is the trade: long enough that a merely slow-but-working connection still delivers
 * fresh HTML, short enough that nobody stares at nothing. Losing the race is not an error — the
 * request carries on in the background and refreshes the cache for next time.
 */
const NAVIGATION_TIMEOUT_MS = 3000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin alone
  if (url.pathname.startsWith("/api/")) return; // never cache the sync API

  const isStatic =
    url.pathname.startsWith("/_next/static/") || /\.(?:woff2?|png|svg|ico|css|js)$/i.test(url.pathname);

  if (isStatic) {
    event.respondWith(cacheFirst(event, req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(event, req));
  }
});

/**
 * Store a response without letting the write become a silent failure. `cache.put` rejects when the
 * origin's storage quota is full — left unawaited that surfaces as an unhandled rejection and
 * offline launch quietly degrades, which is exactly the class of failure the app forbids
 * (CLAUDE.md invariant #6). `waitUntil` keeps the worker alive long enough to finish the write.
 */
function cachePut(event, cacheName, req, res) {
  const write = caches
    .open(cacheName)
    .then((cache) => cache.put(req, res))
    .catch((err) => {
      console.warn("[sw] could not cache", req.url, err);
    });
  try {
    event.waitUntil(write);
  } catch {
    // The event has already settled — a slow network response arriving after we served the cached
    // shell. `waitUntil` throws once that happens, but it is only a worker-lifetime hint: the write
    // above is already in flight and completes on its own.
  }
}

async function cacheFirst(event, req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) cachePut(event, STATIC_CACHE, req, res.clone());
  return res;
}

/**
 * Navigations: the network wins if it answers in time, otherwise the cached shell does.
 *
 * Deliberately NOT a plain `try/fetch/catch` — that only falls back when the request REJECTS, and a
 * hanging connection never rejects. The race is the fix. When the timer wins we serve the shell
 * immediately and let the real request finish in the background so the cache is fresh next time;
 * when there is no shell to serve we keep waiting, because a slow page still beats no page.
 */
async function networkFirst(event, req) {
  const cache = await caches.open(PAGE_CACHE);
  const cached = (await cache.match(req)) || (await cache.match("/"));

  const network = fetch(req).then((res) => {
    if (res && res.ok) cachePut(event, PAGE_CACHE, req, res.clone());
    return res;
  });

  if (cached) {
    // Keep the request alive past the response so a late arrival still refreshes the cache, and
    // swallow its failure — we have already answered, so a rejection here is not the user's problem.
    event.waitUntil(network.catch(() => undefined));
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS));
    const winner = await Promise.race([network.catch(() => null), timeout]);
    return winner || cached;
  }

  // Nothing cached yet (first launch): the network is the only source, so wait for it properly.
  try {
    return await network;
  } catch {
    throw new Error("offline and no cached shell");
  }
}

// App shell cache: bump the version whenever index.html, player.js or other CORE files change.
// (library.js is fetched network-first, so editing it does NOT require a bump.)
const CACHE_NAME = "aquarium-ambient-v3";
// Media cache name is permanent: versioning is per file (`?v=N` from library.js), so this
// cache is never wiped by app updates. Only the user's actions in the player panel add or
// remove media from it. Do not rename.
const MEDIA_CACHE = "aquarium-media-v1";
const CORE = ["./", "./index.html", "./library.js", "./player.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png"];
const SCOPE = new URL("./", self.location).href;
const LIBRARY_URL = SCOPE + "library.js";
// Anything in these folders is media: served from the media cache when downloaded, otherwise
// passed straight to the network (never cached automatically).
const isMedia = url => url.startsWith(SCOPE + "media/") || url.startsWith(SCOPE + "sound/");

function matchMedia(url) {
  return caches.open(MEDIA_CACHE).then(cache => cache.match(url));
}
// Safari plays <video>/<audio> only via byte-range (206) responses, so cached media
// must be sliced to the requested range. Blob.slice avoids loading the file into memory.
async function mediaResponse(request) {
  const cached = await matchMedia(request.url);
  if (!cached) return fetch(request);           // network handles Range itself
  const range = request.headers.get("range");
  if (!range) return cached;
  const blob = await cached.blob();
  const size = blob.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start, end;
  if (m && m[1] !== "") { start = +m[1]; end = m[2] !== "" ? Math.min(+m[2], size - 1) : size - 1; }
  else if (m && m[2] !== "") { start = Math.max(size - +m[2], 0); end = size - 1; }  // suffix: bytes=-N
  if (!m || start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || blob.type || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes"
    }
  });
}

// library.js: network-first (3 s timeout) so new entries appear without an app-cache bump;
// falls back to the cached copy offline.
function libraryResponse(request) {
  const network = fetch(request, { cache: "no-store" }).then(res => {
    if (res.ok && res.status === 200) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(LIBRARY_URL, copy));
    }
    return res;
  });
  const timeout = new Promise((_, reject) => setTimeout(reject, 3000));
  return Promise.race([network, timeout]).catch(() =>
    caches.match(LIBRARY_URL).then(cached => cached || network));
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  const keep = [CACHE_NAME, MEDIA_CACHE];
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = event.request.url;
  if (isMedia(url)) { event.respondWith(mediaResponse(event.request)); return; }
  if (url.split("?")[0] === LIBRARY_URL) { event.respondWith(libraryResponse(event.request)); return; }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    // Only full 200 responses can be stored (206/opaque errors would reject cache.put).
    if (response.ok && response.status === 200) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match("./index.html"))));
});

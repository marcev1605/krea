/* Krea · Service Worker
 *
 * CÓMO PUBLICAR UNA VERSIÓN NUEVA
 *   1. Cambiá VERSION acá abajo (por ejemplo "1.1.1").
 *   2. Cambiá el mismo número en los ?v= de index.html (3 lugares) y de SHELL_FILES (3 lugares).
 *   3. Publicá. Al abrir Krea aparece "Hay una versión nueva → Actualizar".
 *   Aunque te olvides del paso 2, con internet la app siempre baja los archivos nuevos (red primero).
 *
 * ESTRATEGIAS
 *  - Archivos propios (HTML, CSS, JS, manifest, íconos): red primero (revalidando con el servidor).
 *    Si no hay conexión, o la red tarda más de 4 s, usa la copia guardada.
 *  - Librerías de CDN con versión fija (React, htm, SheetJS): copia guardada primero (nunca cambian).
 *  - Tipografías de Google: se guardan al instalar y se refrescan en segundo plano.
 *
 * Este archivo NO toca tus datos: localStorage / IndexedDB no son cachés del service worker.
 */
const VERSION = "1.1.0";
const PREFIX = "krea-";
const SHELL = `${PREFIX}shell-${VERSION}`;
const LIBS = `${PREFIX}libs-v1`;       // librerías con versión fija: se conservan entre versiones
const FONTS = `${PREFIX}fonts-v1`;
const NETWORK_TIMEOUT_MS = 4000;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/styles.css?v=1.1.0",
  "./js/app.js?v=1.1.0",
  "./js/pwa.js?v=1.1.0",
  "./manifest.webmanifest",
  "./icons/logo.jpg",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/favicon-32.png"
];

const LIB_FILES = [
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js",
  "https://unpkg.com/htm@3.1.1/dist/htm.umd.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
];
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Figtree:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";
const LIB_HOSTS = ["cdnjs.cloudflare.com", "unpkg.com"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// ---------- Instalación: guardar todo lo necesario para abrir sin conexión ----------
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Archivos propios: obligatorios. "reload" evita copias viejas de la caché HTTP del navegador.
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES.map((u) => new Request(u, { cache: "reload" })));

    // Librerías: si alguna falla, la app igual se instala y se guardan en la próxima apertura.
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_FILES.map(async (u) => {
      try {
        if (await libs.match(u)) return;
        const res = await fetch(new Request(u, { mode: "cors", credentials: "omit" }));
        if (res.ok) await libs.put(u, res);
      } catch (e) { /* sin conexión */ }
    }));

    // Tipografías: la hoja de estilos de Google y los archivos .woff2 que menciona.
    try {
      const fonts = await caches.open(FONTS);
      const cssRes = await fetch(new Request(FONT_CSS, { mode: "cors", credentials: "omit" }));
      if (cssRes.ok) {
        const css = await cssRes.clone().text();
        await fonts.put(FONT_CSS, cssRes);
        const urls = Array.from(new Set((css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g) || [])
          .map((m) => m.slice(4, -1))));
        await Promise.all(urls.map(async (u) => {
          try {
            if (await fonts.match(u)) return;
            const r = await fetch(new Request(u, { mode: "cors", credentials: "omit" }));
            if (r.ok) await fonts.put(u, r);
          } catch (e) {}
        }));
      }
    } catch (e) { /* sin conexión: se usan las fuentes del sistema hasta la próxima apertura */ }
  })());
  // No se activa solo cuando ya hay una versión anterior: la página avisa y el usuario decide.
});

// ---------- Activación: borrar cachés de versiones anteriores ----------
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, LIBS, FONTS];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith(PREFIX) && !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_VERSION" && event.ports && event.ports[0]) event.ports[0].postMessage(VERSION);
});

// ---------- Peticiones ----------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Abrir la app: red primero; sin conexión, la copia guardada de index.html
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(event, SHELL, "./index.html"));
    return;
  }
  if (url.origin === self.location.origin) {
    // Las pantallas de inicio de iOS las toma Safari al instalar; no hace falta guardarlas (pesan ~2 MB)
    if (url.pathname.includes("/icons/splash/")) return;
    event.respondWith(networkFirst(event, SHELL));
    return;
  }
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, LIBS));
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, FONTS));
    return;
  }
  // Cualquier otra cosa: comportamiento normal del navegador
});

async function fromCache(cache, req, fallbackUrl) {
  const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
  if (hit) return hit;
  if (fallbackUrl) return (await cache.match(fallbackUrl)) || (await cache.match("./"));
  return undefined;
}

async function networkFirst(event, cacheName, fallbackUrl) {
  const req = event.request;
  const cache = await caches.open(cacheName);
  // "no-cache" revalida con el servidor: evita versiones viejas guardadas por el navegador o el hosting
  const fresh = req.mode === "navigate"
    ? new Request(req.url, { cache: "no-cache", credentials: "same-origin" })
    : new Request(req, { cache: "no-cache" });

  const network = (async () => {
    let res = await fetch(fresh);
    // Safari rechaza respuestas con redirecciones en navegaciones: se entrega una copia limpia
    if (res.redirected) {
      res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    if (res.ok) await cache.put(req, res.clone());
    return res;
  })();
  event.waitUntil(network.catch(() => {}));

  // Si la red tarda demasiado (señal débil), mostrar la copia guardada y actualizar en segundo plano
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, "timeout"));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== "timeout") return first;
    const cached = await fromCache(cache, req, fallbackUrl);
    return cached || (await network);
  } catch (e) {
    const cached = await fromCache(cache, req, fallbackUrl);
    if (cached) return cached;
    return new Response("Krea necesita conexión para abrir por primera vez.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) await cache.put(req.url, res.clone());
  return res;
}

async function staleWhileRevalidate(event, cacheName) {
  const req = event.request;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req.url);
  const net = fetch(req).then(async (res) => {
    if (res && (res.ok || res.type === "opaque")) await cache.put(req.url, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(net.catch(() => {}));
    return hit;
  }
  return net;
}

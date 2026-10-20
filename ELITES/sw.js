/* sw.js — Service Worker de By Elites
 * - HTML de la app: Network First (si la red tarda más de 3 s o no hay conexión, abre la copia guardada)
 * - Fuentes, íconos, Firebase SDK y librería de Excel: Stale-While-Revalidate
 *   (responden al instante desde la caché y se actualizan por detrás)
 * - Firestore (datos) y cualquier otra API: no se tocan. Los datos offline los maneja
 *   la persistencia propia de Firestore, no este archivo.
 * Cada vez que subas cambios a la app, cambiá VERSION (v5 → v6) para limpiar las cachés viejas.
 */
const VERSION = 'v5';
const PRECACHE = `barras-precache-${VERSION}`;
const RUNTIME = `barras-runtime-${VERSION}`;
const SHELL = './index.html';
const FIREBASE = 'https://www.gstatic.com/firebasejs/12.19.0';

const APP_SHELL = [
  SHELL,
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  `${FIREBASE}/firebase-app-compat.js`,
  `${FIREBASE}/firebase-firestore-compat.js`,
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap'
];

/* Hosts de archivos estáticos que conviene cachear (nunca agregar firestore.googleapis.com) */
const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com', 'cdnjs.cloudflare.com'];

/* Instalación: guarda la app, Firebase y las fuentes. Si un archivo falla (ej. falta un ícono), no frena la instalación. */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    await Promise.all(APP_SHELL.map(url =>
      cache.add(new Request(url, { cache: 'reload' }))
        .catch(err => console.warn('[SW] No se pudo precachear', url, err))
    ));
    await self.skipWaiting();
  })());
});

/* Activación: borra cachés de versiones anteriores y toma control de las pestañas abiertas */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('barras-') && k !== PRECACHE && k !== RUNTIME)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // escrituras: nunca se cachean

  const url = new URL(req.url);
  const esMismoOrigen = url.origin === self.location.origin;

  // 1) Abrir la app (navegación) o pedir un .html propio → Network First
  if (req.mode === 'navigate' || (esMismoOrigen && url.pathname.endsWith('.html'))) {
    event.respondWith(networkFirst(event));
    return;
  }

  // 2) Archivos estáticos propios, fuentes, Firebase SDK y librerías → Stale-While-Revalidate
  if (esMismoOrigen || STATIC_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  // 3) Todo lo demás (Firestore, APIs): sin intervenir
});

async function networkFirst(event) {
  const cache = await caches.open(PRECACHE);
  const network = fetch(event.request).then(res => {
    if (res && res.ok) cache.put(SHELL, res.clone());     // guarda siempre la última versión de la app
    return res;
  });
  event.waitUntil(network.catch(() => {}));                // deja terminar la actualización aunque respondamos desde caché

  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
    ]);
  } catch (e) {
    const cached = await cache.match(SHELL) || await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try { return await network; }
    catch (err) {
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<body style="background:#131419;color:#f2efe8;font-family:system-ui;padding:24px">' +
        '<h1 style="color:#f0b84a">Sin conexión</h1><p>Abrí la app una vez con internet para poder usarla sin conexión.</p></body>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
  }
}

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(RUNTIME);
  const cached = await caches.match(req);                  // busca en precache y runtime
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  if (cached) {
    event.waitUntil(network);                              // actualiza por detrás
    return cached;
  }
  const res = await network;
  return res || new Response('', { status: 504, statusText: 'Sin conexión' });
}

/* Toolisto: caché local de recursos públicos. Nunca intercepta ni transmite archivos del usuario. */
/* El build (generate-seo-pages.mjs) inyecta aquí las rutas públicas de APLUNO
   que este Service Worker NUNCA intercepta: portada, legal, contactos, productos
   (Ordía, Workspace landing en /workspace-about/) y sus assets bajo /apluno-assets/.
   La aplicación funcional en /workspace/ también queda excluida. */
const APLUNO_PUBLIC_ROUTES = [];

function isAplunoPublicRoute(pathname) {
  if (APLUNO_PUBLIC_ROUTES.includes(pathname)) return true;
  return APLUNO_PUBLIC_ROUTES.some((route) => route.length > 1 && route.endsWith('/') && pathname.startsWith(route));
}

const CACHE_NAME = 'toolisto-static-v4';
const APP_SHELL = [
  '/toolisto',
  '/toolisto.html',
  '/offline.html',
  '/styles.css',
  '/app.js',
  '/js/app.js',
  '/js/pwa-register.js',
  '/assets/manifest.webmanifest',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async (url) => {
      try { await cache.add(url); } catch (_) { /* Un asset opcional no bloquea la instalación. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('toolisto-static-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Nunca interceptar rutas públicas de APLUNO (/, /about/, /contact/, /privacy/,
  // /terms/, /ordia/, /workspace-about/, /workspace/ y /apluno-assets/*): pasan por la red sin caché.
  if (isAplunoPublicRoute(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
        return response;
      } catch (_) {
        const cached = await cache.match(request);
        if (cached) return cached;
        return (await cache.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      }).catch(() => {});
      return cached;
    }
    const response = await fetch(request).catch(() => null);
    if (response) {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    }
    return Response.error();
  })());
});

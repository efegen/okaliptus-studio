/* Web Push handler'ları.
 *
 * Bu dosya vite-plugin-pwa'nın ürettiği (generateSW) Workbox service worker'ına
 * `workbox.importScripts: ['push-sw.js']` ile dahil edilir (vite.config.js).
 * Böylece mevcut precache/runtimeCaching kurulumu hiç değişmeden push yeteneği
 * eklenir. `public/` altında olduğu için dist köküne hash'siz kopyalanır ve
 * service worker ile aynı scope'tan (/) servis edilir.
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || 'Okaliptus';
  const body = data.body || '';
  const url = data.url || '/';

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body,
        icon: '/pwa-192.png',
        badge: '/pwa-192.png',
        data: { url },
      });

      // iOS, PWA önplandayken banner'ı genelde göstermez. Açık (focused)
      // sayfalara mesaj göndererek in-app onay (toast) gösterilebilmesini sağlar.
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        client.postMessage({ type: 'push:received', title, body });
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Okaliptus Yoga Studio',
        short_name: 'Okaliptus',
        description: 'Okaliptus Yoga stüdyo yönetim paneli',
        theme_color: '#a64b2a',
        background_color: '#f5efe6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'tr',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              /^\/(kpi|lessons|students|packages|product-sales|settings|instructors|lesson-types|audit-logs)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 300 },
              networkTimeoutSeconds: 5,
              plugins: [{
                fetchDidSucceed: async ({ response }) => {
                  if (response.status === 401) {
                    const cache = await caches.open('api-cache');
                    const keys = await cache.keys();
                    await Promise.all(keys.map(k => cache.delete(k)));
                    const clients = await self.clients.matchAll();
                    clients.forEach(c => c.postMessage({ type: 'auth:unauthorized' }));
                  }
                  return response;
                },
              }],
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|woff2)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'asset-cache' },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '^/(auth|kpi|lessons|students|payments|packages|product-sales|settings|instructors|lesson-types|health|audit-logs)': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '^/(auth|kpi|lessons|students|payments|packages|product-sales|settings|instructors|lesson-types|health|audit-logs)': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    globals: true,
    css: false,
  },
})

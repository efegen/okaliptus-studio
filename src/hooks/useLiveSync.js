// Canlı senkron (adım 3): sunucunun GET /live akışını dinler ve başka bir
// kullanıcı (ya da bu kullanıcının başka cihazı) bir şeyi değiştirdiğinde
// etkilenen ekranları yeniler. Sinyal veri taşımaz — { method, path } —
// hangi sorguların tazeleneceğine hooks/writeInvalidation.js karar verir;
// veri her zamanki yetkili GET'lerle gelir. Bildirim gösterilmez, ekran
// sessizce güncellenir.
//
// iOS PWA kuralları:
//   - Ekran gizlenince (arka plan, kilit) bağlantı KAPATILIR; görünür olunca
//     son görülen sinyalden (?since=) devam edilir. Sunucu kaçırılanları tekrar
//     oynatır; edemezse (deploy, taşan tampon) hello.resumed=false → senkron
//     edilen her şey bir kez tazelenir.
//   - Ölü bağlantı: sunucu 25 sn'de bir "ping" atar; 60 sn hiçbir şey gelmezse
//     bağlantı kapatılıp yeniden kurulur.
//   - Kendi yazmalarımızın sinyali yutulur (api.js istek atarken not eder),
//     böylece aynı veri iki kez çekilmez.
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { liveStreamUrl } from '../api';
import { SYNCED_QUERY_KEYS, consumeOwnWrite, queryKeysForWrite } from './writeInvalidation';

const WATCHDOG_INTERVAL_MS = 15_000;
const STALE_AFTER_MS = 60_000;
const FLUSH_DELAY_MS = 300;
const RETRY_DELAYS_MS = [3_000, 6_000, 15_000, 30_000, 60_000];
const ES_CLOSED = 2;

function parseData(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return null;
  }
}

/**
 * Bağımlılıkları dışarıdan alınabilen çekirdek (testler sahte EventSource,
 * belge ve saatle çalıştırır). start()/stop() döner.
 */
export function createLiveSync({
  queryClient,
  createEventSource = (url) => new EventSource(url, { withCredentials: true }),
  streamUrl = liveStreamUrl,
  doc = document,
  win = window,
  now = () => Date.now(),
}) {
  let es = null;
  let lastId = null;
  let connectedBefore = false;
  let lastSeenAt = 0;
  let failures = 0;
  let stopped = true;
  let retryTimer = null;
  let watchdogTimer = null;
  let flushTimer = null;
  const pending = new Map();

  function queue(keys) {
    for (const key of keys) pending.set(JSON.stringify(key), key);
    if (pending.size > 0 && !flushTimer) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  }

  function flush() {
    flushTimer = null;
    const keys = [...pending.values()];
    pending.clear();
    // Başkasının yazması: süren bir istek yazmadan ÖNCE başlamış olabilir, bu
    // yüzden varsayılan davranış (sürmekte olanı iptal edip yeniden çek) doğru.
    for (const queryKey of keys) queryClient.invalidateQueries({ queryKey });
  }

  function touch(event) {
    lastSeenAt = now();
    if (event?.lastEventId) lastId = event.lastEventId;
  }

  function onHello(event) {
    touch(event);
    failures = 0;
    const data = parseData(event);
    const isReconnect = connectedBefore;
    connectedBefore = true;
    // İlk bağlantıda ekran zaten yeni yüklendi; sonraki bağlantılarda sunucu
    // aradakileri tekrar oynatamadıysa her şeyi bir kez tazele.
    if (isReconnect && data && data.resumed === false) queue(SYNCED_QUERY_KEYS);
  }

  function onChange(event) {
    touch(event);
    const data = parseData(event);
    if (!data || typeof data.path !== 'string') return;
    if (consumeOwnWrite(data.method, data.path)) return;
    queue(queryKeysForWrite(data.method, data.path));
  }

  function onPing(event) {
    touch(event);
  }

  function onError() {
    // CONNECTING: tarayıcı kendisi yeniden dener (Last-Event-ID ile).
    // CLOSED: 401/503 gibi kalıcı ret — artan beklemeyle biz deneriz.
    if (es && es.readyState === ES_CLOSED) {
      es = null;
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (stopped || retryTimer) return;
    const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
    failures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (stopped || es || doc.visibilityState === 'hidden') return;
    lastSeenAt = now();
    const source = createEventSource(streamUrl(lastId));
    es = source;
    source.addEventListener('hello', onHello);
    source.addEventListener('change', onChange);
    source.addEventListener('ping', onPing);
    source.onerror = onError;
  }

  function disconnect() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (es) {
      es.onerror = null;
      es.close();
      es = null;
    }
  }

  function onVisibilityChange() {
    if (doc.visibilityState === 'hidden') {
      disconnect();
    } else {
      failures = 0;
      connect();
    }
  }

  function onOnline() {
    if (!es) {
      failures = 0;
      disconnect();
      connect();
    }
  }

  function watchdog() {
    if (es && now() - lastSeenAt > STALE_AFTER_MS) {
      disconnect();
      connect();
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      doc.addEventListener('visibilitychange', onVisibilityChange);
      win.addEventListener('online', onOnline);
      watchdogTimer = setInterval(watchdog, WATCHDOG_INTERVAL_MS);
      connect();
    },
    stop() {
      stopped = true;
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      win.removeEventListener('online', onOnline);
      if (watchdogTimer) clearInterval(watchdogTimer);
      watchdogTimer = null;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      pending.clear();
      disconnect();
    },
  };
}

/** Girişli uygulama kabuğunda bir kez çağrılır (main.jsx → App). */
export function useLiveSync() {
  const queryClient = useQueryClient();
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return undefined;
    const sync = createLiveSync({ queryClient });
    sync.start();
    return () => sync.stop();
  }, [queryClient]);
}

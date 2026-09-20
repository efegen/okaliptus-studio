import React from 'react';
import { pingActivityApi } from '../api';

// "Aktif" = kullanıcı uygulamada gerçekten bir şey yapıyor (dokunma, kaydırma,
// yazma) VE ekran görünür. Arka planda açık kalan uygulama ping atmaz.
// Etkileşim başına değil, en fazla dakikada bir sunucuya küçük bir sinyal gider.
const MIN_INTERVAL_MS = 60_000;
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'];

export function useActivityPing() {
  React.useEffect(() => {
    let lastSent = 0;

    function onInteraction() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastSent < MIN_INTERVAL_MS) return;
      lastSent = now;
      pingActivityApi().catch(() => {});
    }

    EVENTS.forEach((e) => window.addEventListener(e, onInteraction, { passive: true, capture: true }));
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onInteraction, { capture: true }));
    };
  }, []);
}

import React from 'react';
import { getPushConfig } from '../api';
import { getCurrentSubscription, pushSupported } from '../push';

// Bu cihazın Web Push durumu (menü satırı + açılış ekranı ortak kullanır).
// available: null=kontrol ediliyor, false=sunucuda push yok (VAPID → 503),
// true=kullanılabilir. subscribed: tarayıcıda bu cihaz için abonelik var mı —
// "bildirimler açık" kararının tek kaynağı (ayrı bir depolama bayrağı yok).
// ready: available + abonelik kontrolü bitti (açılış ekranı yanlışlıkla
// bir kare görünüp kaybolmasın diye).
export function usePushDevice() {
  const supported = pushSupported();
  const [available, setAvailable] = React.useState(null);
  const [subscribed, setSubscribed] = React.useState(false);
  const [checked, setChecked] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    getPushConfig()
      .then(() => { if (!cancelled) setAvailable(true); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (available !== true) return undefined;
    if (!supported) { setChecked(true); return undefined; }
    let cancelled = false;
    getCurrentSubscription()
      .then(s => { if (!cancelled) { setSubscribed(!!s); setChecked(true); } })
      .catch(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [available, supported]);

  const denied = supported && Notification.permission === 'denied';

  return {
    available,
    supported,
    subscribed,
    setSubscribed,
    denied,
    ready: available === true && checked,
  };
}

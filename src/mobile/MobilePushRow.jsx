import React from 'react';
import { Icon } from '../layout';
import { Toggle } from '../settings';
import { enablePush, disablePush } from '../push';
import { usePushDevice } from './usePushDevice';

// Mobil Menü → "Bildirimler" satırı: Ayarlar'ı göremeyen roller (asistan) için
// bu cihazda Web Push izni aç/kapa. Yalnız cihaz aboneliği — hangi türlerin
// kime gideceğini owner Ayarlar → Bildirimler'den yönetir (alıcı listeleri).
// getPushConfig() başarısızsa (VAPID yok → 503) satır hiç gösterilmez.
export function MobilePushRow() {
  const { available, supported, subscribed, setSubscribed, denied, ready } = usePushDevice();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  if (available !== true) return null;

  async function handleChange(next) {
    setBusy(true); setError(null);
    try {
      if (next) {
        await enablePush();
        setSubscribed(true);
      } else {
        await disablePush();
        setSubscribed(false);
      }
    } catch (err) {
      setError(err.message || (next ? 'Bildirim açılamadı.' : 'Kapatılamadı.'));
    } finally { setBusy(false); }
  }

  let sub;
  if (error) sub = error;
  else if (!ready) sub = 'Kontrol ediliyor…';
  else if (!supported) sub = 'Bu cihaz desteklemiyor (iOS\'ta ana ekrana ekleyip oradan aç).';
  else if (denied) sub = 'İzin reddedilmiş — telefon ayarlarından bu uygulamaya bildirim izni ver.';
  else sub = subscribed ? 'Bu cihazda açık' : 'Bu cihazda kapalı';

  return (
    <div className="mobile-menu-group">
      <p className="mobile-menu-group-lbl">Bildirimler</p>
      <div className="mobile-menu-card">
        <div className="mobile-menu-row is-static">
          <span className="mobile-menu-tile tone-amber" aria-hidden="true">
            <Icon.Bell width="19" height="19" />
          </span>
          <span className="mobile-menu-row-tx">
            <span className="mobile-menu-row-label">Bildirimlere izin ver</span>
            <span className={'mobile-menu-row-sub' + (error || denied ? ' is-err' : '')}>{sub}</span>
          </span>
          <Toggle
            checked={subscribed}
            onChange={handleChange}
            label="Bu cihazda bildirimler"
            // Abonelik kontrolü bitmeden kilitli: yoksa arada açılan bildirimi
            // geç gelen "abonelik yok" cevabı kapalıya çevirirdi.
            disabled={!ready || busy || !supported || (denied && !subscribed)}
          />
        </div>
      </div>
    </div>
  );
}

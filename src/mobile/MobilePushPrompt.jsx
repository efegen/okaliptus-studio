import React from 'react';
import { Icon } from '../layout';
import { enablePush } from '../push';
import { usePushDevice } from './usePushDevice';

// Açılışta tam sayfa "Bildirimleri aç" ekranı — Ayarlar'ı göremeyen roller
// (asistan) izni unutmasın diye. Bu cihazda abonelik oluşana kadar her
// açılışta gelir; abonelik varsa bir daha hiç görünmez (karar tarayıcı
// aboneliğinden okunur, ayrı bayrak yok). "Şimdi değil" yalnız bu açılış
// için kapatır. Push desteklenmiyorsa (iOS'ta ana ekran PWA değil) ya da
// sunucuda yapılandırılmamışsa hiç çıkmaz — menüdeki satır durumu anlatır.
export function MobilePushPrompt({ onEnabled }) {
  const { supported, subscribed, setSubscribed, denied, ready } = usePushDevice();
  const [dismissed, setDismissed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  if (!ready || !supported || subscribed || dismissed) return null;

  async function handleEnable() {
    setBusy(true); setError(null);
    try {
      await enablePush();
      setSubscribed(true);
      onEnabled?.();
    } catch (err) {
      setError(err.message || 'Bildirim açılamadı.');
    } finally { setBusy(false); }
  }

  return (
    <div className="mpp-root" role="dialog" aria-modal="true" aria-labelledby="mpp-title">
      <div className="mpp-body">
        <span className="mpp-icon" aria-hidden="true">
          <Icon.Bell width="38" height="38" />
        </span>
        <h1 id="mpp-title" className="mpp-title">
          {denied ? 'Bildirim izni kapalı' : 'Bildirimleri aç'}
        </h1>
        <p className="mpp-text">
          {denied
            ? 'Bu telefonda bildirim izni daha önce reddedilmiş. Telefonun Ayarlar → Bildirimler bölümünden bu uygulamaya izin ver, sonra tekrar dene.'
            : 'Ders hatırlatmaları, notlar ve seni ilgilendiren gelişmeler bu telefona anında gelsin.'}
        </p>
        {error && <p className="mpp-error" role="alert">{error}</p>}
      </div>
      <div className="mpp-actions">
        <button type="button" className="mpp-btn-primary" disabled={busy} onClick={handleEnable}>
          {busy ? 'Açılıyor…' : denied ? 'Tekrar dene' : 'Bildirimlere izin ver'}
        </button>
        <button type="button" className="mpp-btn-ghost" disabled={busy} onClick={() => setDismissed(true)}>
          Şimdi değil
        </button>
      </div>
    </div>
  );
}

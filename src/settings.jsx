import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, getPushConfig } from './api';
import { queryKeys } from './hooks/queryKeys';
import { ActivityPanel } from './settings-activity';
import { enablePush, disablePush, sendTest, getCurrentSubscription } from './push';

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, i) => i);

function HourSelect({ value, onChange, min = 0, max = 24 }) {
  return (
    <select
      className="stg-select"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
    >
      {HOUR_OPTIONS.filter(h => h >= min && h <= max).map(h => (
        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
      ))}
    </select>
  );
}

function NumInput({ value, onChange, min = 0, max, unit }) {
  return (
    <div className="stg-num-wrap">
      <input
        type="number"
        className="stg-num"
        value={value}
        min={min}
        max={max}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
      {unit && <span className="stg-unit">{unit}</span>}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={'stg-toggle' + (checked ? ' is-on' : '') + (disabled ? ' is-disabled' : '')}
      onClick={() => { if (!disabled) onChange(!checked); }}
    >
      <span className="stg-toggle-knob" aria-hidden="true" />
    </button>
  );
}

function SettingRow({ label, children, info, top }) {
  return (
    <div className={'stg-row' + (top ? ' stg-row-top' : '')}>
      <div className="stg-row-label">{label}</div>
      <div className="stg-row-control">
        {children}
        {info && <span className="stg-row-info">{info}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="stg-section">
      <div className="stg-section-head">{title}</div>
      {children}
    </div>
  );
}

const PREVIEW_BLOCKS = [
  { cls: 'wk-sess-planned',  label: 'Planlandı', time: '09:00' },
  { cls: 'wk-sess-unpaid',   label: 'Ödenmedi',  time: '10:00' },
  { cls: 'wk-sess-partial',  label: 'Kısmi',     time: '11:00' },
  { cls: 'wk-sess-paid',     label: 'Ödendi',    time: '12:00' },
];

function LessonColorPreview() {
  return (
    <div className="stg-lesson-preview">
      {PREVIEW_BLOCKS.map(({ cls, label, time }) => (
        <div key={cls} className={`stg-prev-block ${cls}`}>
          <div className="wk-sess-top">{time}</div>
          <div className="wk-sess-name">{label}</div>
        </div>
      ))}
    </div>
  );
}

function SatSlider({ value, onChange, onReset }) {
  return (
    <div className="stg-sat-row">
      <div className="stg-slider-wrap">
        <input
          type="range"
          className="stg-slider"
          min={0.2}
          max={2.0}
          step={0.05}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
        />
        <span className="stg-slider-val">{value.toFixed(2)}×</span>
        {value !== 1 && (
          <button type="button" className="stg-sat-reset" onClick={onReset}>
            sıfırla
          </button>
        )}
      </div>
      <LessonColorPreview />
    </div>
  );
}

// Web Push test kartı — yalnız PUSH_TEST_USERNAME hesabına render edilir.
// getPushConfig() 403 dönerse (yetkisiz hesap) kart hiç gösterilmez.
function PushTestCard() {
  const [allowed, setAllowed] = React.useState(null); // null=kontrol ediliyor, false=gizli, true=görünür
  const [subscribed, setSubscribed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState(null);   // { ok, msg }
  const [received, setReceived] = React.useState(null);

  // Gate: config çağrısı 200 → yetkili; 403/diğer → gizle.
  React.useEffect(() => {
    let cancelled = false;
    getPushConfig()
      .then(() => { if (!cancelled) setAllowed(true); })
      .catch(() => { if (!cancelled) setAllowed(false); });
    return () => { cancelled = true; };
  }, []);

  // Bu cihazda zaten abonelik var mı?
  React.useEffect(() => {
    if (allowed !== true) return;
    getCurrentSubscription().then(s => setSubscribed(!!s)).catch(() => {});
  }, [allowed]);

  // SW'den gelen "push:received" → önplan onayı (iOS önplanda banner göstermez).
  React.useEffect(() => {
    if (allowed !== true || !('serviceWorker' in navigator)) return;
    function onMsg(e) {
      if (e.data?.type === 'push:received') {
        setReceived('Bildirim alındı ✓ · ' + new Date().toLocaleTimeString('tr-TR'));
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [allowed]);

  if (allowed !== true) return null;

  async function handleEnable() {
    setBusy(true); setStatus(null);
    try {
      await enablePush();
      setSubscribed(true);
      setStatus({ ok: true, msg: 'Bu cihazda bildirimler açıldı.' });
    } catch (err) {
      setStatus({ ok: false, msg: err.message || 'Bildirim açılamadı.' });
    } finally { setBusy(false); }
  }

  async function handleDisable() {
    setBusy(true); setStatus(null);
    try {
      await disablePush();
      setSubscribed(false);
      setStatus({ ok: true, msg: 'Bildirimler kapatıldı.' });
    } catch (err) {
      setStatus({ ok: false, msg: err.message || 'Kapatılamadı.' });
    } finally { setBusy(false); }
  }

  async function handleSend(delaySeconds) {
    setBusy(true); setStatus(null); setReceived(null);
    try {
      const res = await sendTest(delaySeconds);
      const sent = res?.data?.sent;
      if (delaySeconds > 0) {
        setStatus({ ok: true, msg: delaySeconds + ' sn sonra gönderilecek — şimdi uygulamayı tamamen kapat.' });
      } else if (sent === 0) {
        setStatus({ ok: false, msg: 'Kayıtlı cihaz yok. Önce "bildirimleri aç" demelisin.' });
      } else {
        setStatus({ ok: true, msg: 'Gönderildi. Önplandaysan banner çıkmayabilir; alttaki onaya bak.' });
      }
    } catch (err) {
      setStatus({ ok: false, msg: err.message || 'Gönderilemedi.' });
    } finally { setBusy(false); }
  }

  return (
    <Section title="Bildirim Testi">
      <div className="stg-push">
        <p className="stg-push-note">
          Bu test bildirimi yalnızca <strong>bu hesaba ait bu cihaza</strong> gönderilir;
          diğer kullanıcılara gitmez.
        </p>
        <div className="stg-push-btns">
          {!subscribed ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleEnable}>
              Bu cihazda bildirimleri aç
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => handleSend(0)}>
                Hemen test bildirimi gönder
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => handleSend(10)}>
                10 sn sonra gönder (uygulamayı kapat)
              </button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={handleDisable}>
                Bildirimleri kapat
              </button>
            </>
          )}
        </div>
        {received && <div className="stg-feedback stg-feedback-ok">{received}</div>}
        {status && (
          <div className={'stg-feedback' + (status.ok ? ' stg-feedback-ok' : ' stg-feedback-err')}>
            {status.msg}
          </div>
        )}
      </div>
    </Section>
  );
}

// (TrendyolOrderPreview kaldırıldı 2026-06-20 — tam "Pazaryeri Siparişleri" ekranı
//  (orders.jsx) gerçek veriyle bunun işini görüyor; ayarlardaki önizleme butonu gereksizdi.
//  api.js previewTrendyolOrders export'u + backend /trendyol/orders/preview ucu uykuda kaldı.)

export function SettingsPage() {
  const [tab, setTab] = React.useState('general');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(null);
  const [saved, setSaved] = React.useState(null); // baseline from server
  const [form, setForm] = React.useState(null);   // current form state
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null); // { ok: bool, msg: string }
  const savedSatRef = React.useRef(1);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    getSettings()
      .then(data => {
        if (cancelled) return;
        savedSatRef.current = data.lessonColorSaturation ?? 1;
        setSaved(data);
        setForm(data);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setLoadError(err.message || 'Ayarlar yüklenemedi.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Restore CSS var when navigating away without saving
  React.useEffect(() => {
    return () => {
      document.documentElement.style.setProperty('--ls-sat', String(savedSatRef.current));
    };
  }, []);

  const isDirty = React.useMemo(() => {
    if (!saved || !form) return false;
    return (
      form.weeklyCapacity !== saved.weeklyCapacity ||
      form.calendarStartHour !== saved.calendarStartHour ||
      form.calendarEndHour !== saved.calendarEndHour ||
      form.lessonColorSaturation !== saved.lessonColorSaturation ||
      form.stockTrackingEnabled !== saved.stockTrackingEnabled ||
      form.marketplaceSyncEnabled !== saved.marketplaceSyncEnabled ||
      form.marketplaceOrdersEnabled !== saved.marketplaceOrdersEnabled ||
      form.marketplaceStockPushEnabled !== saved.marketplaceStockPushEnabled ||
      form.marketplaceStockPushDryRun !== saved.marketplaceStockPushDryRun ||
      form.marketplaceFulfillmentEnabled !== saved.marketplaceFulfillmentEnabled
    );
  }, [saved, form]);

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
    if (key === 'lessonColorSaturation') {
      document.documentElement.style.setProperty('--ls-sat', String(value));
    }
    setFeedback(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!isDirty || saving) return;

    setSaving(true);
    setFeedback(null);

    try {
      const updated = await updateSettings({
        weeklyCapacity: form.weeklyCapacity,
        calendarStartHour: form.calendarStartHour,
        calendarEndHour: form.calendarEndHour,
        lessonColorSaturation: form.lessonColorSaturation,
        stockTrackingEnabled: !!form.stockTrackingEnabled,
        marketplaceSyncEnabled: !!form.marketplaceSyncEnabled,
        marketplaceOrdersEnabled: !!form.marketplaceOrdersEnabled,
        marketplaceStockPushEnabled: !!form.marketplaceStockPushEnabled,
        marketplaceStockPushDryRun: !!form.marketplaceStockPushDryRun,
        marketplaceFulfillmentEnabled: !!form.marketplaceFulfillmentEnabled,
      });
      savedSatRef.current = updated.lessonColorSaturation ?? 1;
      setSaved(updated);
      setForm(updated);
      // Sidebar (pazaryeri nav) ve Siparişler ekranı (kargo etiketi flag'i) ortak
      // 'settings' query'sini okur → kaydedince tazele ki flag değişiklikleri anında
      // yansısın (yoksa staleTime dolana kadar eski flag görünür).
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
      setFeedback({ ok: true, msg: 'Ayarlar kaydedildi.' });
    } catch (err) {
      setFeedback({ ok: false, msg: err.message || 'Ayarlar kaydedilemedi.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page settings-page">
        <div className="page-head page-head-solo">
          <h1 className="page-title">Ayarlar</h1>
        </div>
        <div className="stg-loading">Yükleniyor…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page settings-page">
        <div className="page-head page-head-solo">
          <h1 className="page-title">Ayarlar</h1>
        </div>
        <div className="stg-feedback stg-feedback-err">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <div className="page-head page-head-solo">
        <div>
          <h1 className="page-title">Ayarlar</h1>
        </div>
      </div>

      <div className="stg-tabs">
        <button
          type="button"
          className={'stg-tab' + (tab === 'general' ? ' is-active' : '')}
          onClick={() => setTab('general')}
        >
          Genel
        </button>
        <button
          type="button"
          className={'stg-tab' + (tab === 'activity' ? ' is-active' : '')}
          onClick={() => setTab('activity')}
        >
          Aktivite
        </button>
      </div>

      {tab === 'activity' && <ActivityPanel />}

      {tab === 'general' && <form onSubmit={handleSave} className="stg-form">

        <Section title="Takvim">
          <SettingRow label="Haftalık kapasite">
            <NumInput
              value={form.weeklyCapacity}
              onChange={v => set('weeklyCapacity', v)}
              min={1}
              max={200}
              unit="ders"
            />
          </SettingRow>

          <SettingRow label="Haftanın başlangıcı" info="Pazartesi · v1 sabit">
          </SettingRow>

          <SettingRow label="Görünür saat aralığı">
            <div className="stg-time-range">
              <HourSelect
                value={form.calendarStartHour}
                onChange={v => set('calendarStartHour', v)}
                min={0}
                max={23}
              />
              <span className="stg-range-sep">→</span>
              <HourSelect
                value={form.calendarEndHour}
                onChange={v => set('calendarEndHour', v)}
                min={1}
                max={24}
              />
            </div>
          </SettingRow>
        </Section>

        {/* "Stok" bölümü (Stok takibi toggle'ı) UI'dan GİZLENDİ (2026-06-20, kullanıcı kararı:
            stok fazı ilk yayında devre dışı). Backend + flag DOKUNULMADI —
            stock_tracking_enabled (DEFAULT false) kapalı kalır → elden satış stok düşmeden
            çalışır (product-sales recordSaleStockMovements'ı atlar). handleSave/isDirty hâlâ
            stockTrackingEnabled + marketplaceOrdersEnabled değerlerini round-trip eder.
            GERİ EKLEME: stok fazı başlayınca bu Section + aşağıdaki "Sipariş senkronu"
            SettingRow geri konacak (eski hâli git geçmişinde). */}

        <Section title="Pazaryeri">
          {/* Pazaryeri ANA ŞALTERİ (marketplaceSyncEnabled): açıkken "Siparişler" +
              "Eşleştirme" nav'ları, mobil sipariş ekranı, kargo barkodu ve ürün
              düzenlemedeki kanal eşleştirme alanları görünür. Salt-okunur: stoğa da
              Trendyol'a da YAZMAZ. Kapatmak hepsini tek tıkta gizler (kill-switch). */}
          <SettingRow
            label="Trendyol entegrasyonu"
            info="Açıkken Trendyol sipariş listesi, ürün eşleştirme ve kargo barkodu ekranlarını açar (sol menüde 'Siparişler' + 'Eşleştirme' sekmeleri). Salt-okunur — stoğa ve Trendyol'a hiçbir şey yazmaz. Kapatınca tüm pazaryeri ekranları gizlenir."
          >
            <Toggle
              checked={!!form.marketplaceSyncEnabled}
              onChange={v => {
                set('marketplaceSyncEnabled', v);
                // Kapanınca uykudaki yazma flag'lerini de defansif kapat.
                if (!v) { set('marketplaceStockPushEnabled', false); set('marketplaceFulfillmentEnabled', false); }
              }}
              label="Trendyol entegrasyonunu aç/kapat"
            />
          </SettingRow>
          {/* "Sipariş senkronu" toggle'ı GİZLENDİ (2026-06-20) — stok fazının parçası
              (marketplaceOrdersEnabled iç stoğa yazar, stok takibi kapalıyken anlamsız).
              Flag DOKUNULMADI (DEFAULT false); poller kapalıyken sessizce atlar. Stok fazı
              geri gelince "Stok" Section'ıyla birlikte eklenecek. */}
          {/* "Stok gönderimi (TY'ye yaz)" + "Deneme modu (dry-run)" toggle'ları UI'dan
              GİZLENDİ (2026-06-20, kullanıcı kararı). Backend + flag'ler sağlam:
              marketplaceStockPushEnabled (DEFAULT false) ve marketplaceStockPushDryRun
              (DEFAULT true) kapalı/prova varsayılanlarında kaldıkları için poller TY'ye
              ASLA canlı yazmaz. handleSave/isDirty hâlâ iki değeri de round-trip eder →
              gizlemek veriyi bozmaz. GERİ EKLEME ŞARTI: stok push'u gerçek TY hesabında
              baseline + tek-ürün deneme yazmasıyla doğruladıktan sonra bu iki SettingRow
              (eski hâli git geçmişinde) geri konacak. */}
          {/* "Pazaryeri sipariş işleme" (marketplaceFulfillmentEnabled): Siparişler
              ekranındaki "Kargo Firması Değiştir" gibi CANLI TY yazmalarını açar. KAPALI
              varsayılan + her işlemde ayrıca onay diyalogu (kazara yazmaya karşı kademeli
              kilit). Kargo barkodu (Code128) bundan BAĞIMSIZ — hep istemci tarafı basılır.
              Not (2026-06-20): bu toggle eskiden yalnız bloklu Ortak Etiket'i (Common Label,
              COMMON_LABEL_NOT_ALLOWED) kapsadığı için gizlenmişti; artık TY'nin İZİN VERDİĞİ
              kargo-firması-değiştirmeyi de kapsadığı için geri eklendi. */}
          <SettingRow
            label="Pazaryeri sipariş işleme"
            info="Açıkken Siparişler ekranındaki 'Kargo Firması Değiştir' işlemi Trendyol'a CANLI yazar (gerçek müşteri paketinin kargo firmasını değiştirir). Her işlemde ayrıca onay istenir. Kapalıyken işlem engellenir. Kargo barkodu basımı bu ayardan bağımsızdır."
          >
            <Toggle
              checked={!!form.marketplaceFulfillmentEnabled}
              disabled={!form.marketplaceSyncEnabled}
              onChange={v => set('marketplaceFulfillmentEnabled', v)}
              label="Pazaryeri sipariş işlemeyi aç/kapat"
            />
          </SettingRow>
        </Section>

        <Section title="Görünüm">
          <SettingRow label="Ders rengi doygunluğu" top>
            <SatSlider
              value={form.lessonColorSaturation ?? 1}
              onChange={v => set('lessonColorSaturation', v)}
              onReset={() => set('lessonColorSaturation', 1)}
            />
          </SettingRow>
        </Section>

        {feedback && (
          <div className={'stg-feedback' + (feedback.ok ? ' stg-feedback-ok' : ' stg-feedback-err')}>
            {feedback.ok && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {feedback.msg}
          </div>
        )}

        <div className="stg-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!isDirty || saving}
          >
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>

      </form>}

      {tab === 'general' && <PushTestCard />}

    </div>
  );
}

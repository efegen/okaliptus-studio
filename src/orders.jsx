// Pazaryeri Siparişleri — birleşik operasyon ekranı (yalnız web).
// Düzen Trendyol'un sipariş ekranından; kimlik/renk Okaliptus paletinden.
// Editöryel serif YOK — yoğun bir operasyon ekranı için temiz Geist sans + mono.
// Tüm görsel sınıflar `oo-*` ad alanında.
//
// Faz 1 (SALT-OKUNUR): gerçek Trendyol siparişlerini GET /trendyol/orders/list ucundan
// çeker (TY fotoğrafı + iç ürün eşleşmesiyle zenginleştirilmiş). Trendyol'a HİÇ yazma
// yok; iç STOĞA dokunmaz (order-sync defterinden bağımsız, `marketplaceSyncEnabled`
// flag'iyle açılır). HB API'si yok → kanal yapısı durur ama yalnız Trendyol akar.
//
// İşlemler menüsü (Durum kolonu): "Kargo Firması Değiştir" İŞLEVSEL — CANLI TY
// yazması (PUT cargo-providers), marketplaceFulfillmentEnabled flag + onay diyaloğu
// arkasında (CargoProviderModal). "İşleme Al" hâlâ "Yakında". Etiket (A4/Sticker) ve
// "Trendyol'da Aç" butonları kaldırıldı; kargo barkodu (Code128) tarafı "Barkod"
// butonunda korunuyor (tamamen istemci tarafı, flag'den bağımsız).

import React from 'react';
import ReactDOM from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import JsBarcode from 'jsbarcode';
import { getTrendyolOrdersList, changeOrderCargoProvider, getSettings } from './api';
import { queryKeys } from './hooks/queryKeys';

// ─── Biçimlendiriciler ───────────────────────────────────────────────────────
function fmtTL(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateTime(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Hedef zamana kalan süreyi "X gün Y saat Z dakika" olarak verir (geçmişse null).
function fmtRemaining(targetMs) {
  if (!targetMs) return null;
  const diff = targetMs - Date.now();
  if (diff <= 0) return null;
  const dk = Math.floor(diff / 60000);
  const gun = Math.floor(dk / 1440);
  const saat = Math.floor((dk % 1440) / 60);
  const dakika = dk % 60;
  const parts = [];
  if (gun) parts.push(`${gun} gün`);
  if (saat) parts.push(`${saat} saat`);
  if (dakika > 0 || parts.length === 0) parts.push(`${dakika} dakika`);
  return parts.join(' ');
}

function cargoCode(provider) {
  if (!provider) return '?';
  return provider.trim().split(/\s+/)[0].slice(0, 3).toLocaleUpperCase('tr-TR');
}

const CARGO_LOGOS = {
  ptt: 'https://cdn.dsmcdn.com/seller-center/oms/nexus/cargo-provider/19.png',
  aras: 'https://cdn.dsmcdn.com/seller-center/oms/nexus/cargo-provider/7.png',
};

function getCargoLogo(provider) {
  if (!provider) return null;
  const lower = provider.toLocaleLowerCase('tr-TR');
  if (lower.includes('ptt')) return CARGO_LOGOS.ptt;
  if (lower.includes('aras')) return CARGO_LOGOS.aras;
  return null;
}

// Trendyol pazaryeri kargo firma KODLARI ("Kargo Firması Değiştir" seçenekleri).
// `code` TY'ye gönderilir; `name` kullanıcı etiketi. Backend
// (order-cargo.service.ts TRENDYOL_CARGO_PROVIDERS) ile SENKRON tutulmalı —
// backend güvenlik sınırıdır, tanımsız kodu 422 ile reddeder.
const CARGO_PROVIDERS = [
  { code: 'YKMP', name: 'Yurtiçi Kargo' },
  { code: 'ARASMP', name: 'Aras Kargo' },
  { code: 'SURATMP', name: 'Sürat Kargo' },
  { code: 'HOROZMP', name: 'Horoz Kargo' },
  { code: 'MNGMP', name: 'MNG Kargo' },
  { code: 'PTTMP', name: 'PTT Kargo' },
  { code: 'CEVAMP', name: 'CEVA Kargo' },
  { code: 'TEXMP', name: 'Trendyol Express' },
  { code: 'DHLECOMMP', name: 'DHL eCommerce' },
  { code: 'SENDEOMP', name: 'Sendeo' },
];

// TY'den gelen firma adından ("PTT Kargo Marketplace") whitelist kodunu tahmin eder
// (yalnız "mevcut firma"yı işaretlemek için; eşleşmezse null). İlk kelimeyle eşler.
function guessProviderCode(providerName) {
  if (!providerName) return null;
  const lower = providerName.toLocaleLowerCase('tr-TR');
  const hit = CARGO_PROVIDERS.find(p =>
    lower.includes(p.name.toLocaleLowerCase('tr-TR').split(' ')[0]),
  );
  return hit ? hit.code : null;
}

// ─── Satır içi ikonlar ───────────────────────────────────────────────────────
const I = {
  info: (s = 13) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>),
  chevDown: (s = 13) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>),
  chevL: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 6-6 6 6 6" /></svg>),
  chevR: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>),
  calendar: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>),
  excel: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18M15 3v18" strokeWidth="1.25" /></svg>),
  bulk: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M7 12h10M11 18h6" /></svg>),
  printer: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>),
  sticker: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>),
  barcode: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 5v14M7 5v14M11 5v14M13 5v14M17 5v14M21 5v14" /></svg>),
  close: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M5 5l14 14M19 5 5 19" /></svg>),
  download: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>),
  statusUpdate: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>),
  funnel: (s = 12) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>),
  gear: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>),
  bag: (s = 16) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>),
  copy: (s = 12) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>),
  truck: (s = 12) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 4h13v11H1z" /><path d="M14 8h4l3 3v4h-7z" /><circle cx="5.5" cy="17.5" r="1.8" /><circle cx="17.5" cy="17.5" r="1.8" /></svg>),
  clock: (s = 13) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  link: (s = 13) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>),
  check: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>),
  warn: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>),
  imagePh: (s = 20) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>),
};

// ─── Kargo barkodu (Code128) — tamamen istemci tarafı ────────────────────────
// cargoTrackingNumber'ı JsBarcode ile bir <canvas>'a Code128 olarak çizer. Dış
// servis/yazma yok. Niimbot gibi etiket yazıcılarına aktarmak için PNG indirilir;
// barkod okunabilirliği için ZORUNLU siyah/beyaz (tema rengi UYGULANMAZ).
function BarcodeModal({ order, onClose }) {
  const canvasRef = React.useRef(null);
  const [error, setError] = React.useState(false);
  const ctn = order?.cargoTrackingNumber || '';

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  React.useEffect(() => {
    if (!canvasRef.current || !ctn) return;
    try {
      JsBarcode(canvasRef.current, ctn, {
        format: 'CODE128',
        displayValue: true,   // numara çubukların altında
        fontSize: 18,
        font: 'monospace',
        textMargin: 6,
        height: 90,
        width: 3,             // modül genişliği — yüksek çözünürlük (net baskı)
        margin: 12,
        background: '#ffffff',
        lineColor: '#000000',
      });
      setError(false);
    } catch {
      setError(true);
    }
  }, [ctn]);

  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas || error) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `kargo-${ctn}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function handlePrint() {
    const canvas = canvasRef.current;
    if (!canvas || error) return;
    const url = canvas.toDataURL('image/png');
    const w = window.open('', '_blank', 'noopener,width=560,height=420');
    if (!w) return;
    w.document.write(
      `<!doctype html><title>Kargo ${ctn}</title>` +
      `<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">` +
      `<img src="${url}" style="max-width:100%" onload="window.focus();window.print()" alt="Kargo barkodu ${ctn}">` +
      `</body>`,
    );
    w.document.close();
  }

  if (!order) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal oo-barcode-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="oo-barcode-title"
      >
        <header className="oo-barcode-head">
          <div>
            <h3 id="oo-barcode-title" className="oo-barcode-title">Kargo Barkodu</h3>
            <div className="oo-barcode-sub">#{order.orderNumber}{order.cargoProvider ? ` · ${order.cargoProvider}` : ''}</div>
          </div>
          <button type="button" className="oo-barcode-close" onClick={onClose} aria-label="Kapat">{I.close(16)}</button>
        </header>

        <div className="oo-barcode-body">
          {error ? (
            <div className="oo-barcode-error">Bu kargo numarası barkoda çevrilemedi: <span className="oo-mono">{ctn}</span></div>
          ) : (
            <div className="oo-barcode-card">
              <canvas ref={canvasRef} className="oo-barcode-canvas" />
            </div>
          )}
        </div>

        <footer className="oo-barcode-actions">
          <button type="button" className="oo-btn oo-btn-ghost" onClick={handlePrint} disabled={error}>{I.printer(13)} Yazdır</button>
          <button type="button" className="oo-btn oo-btn-primary" onClick={handleDownload} disabled={error}>{I.download(14)} PNG indir</button>
        </footer>
      </div>
    </div>
  );
}

// "Kargo Firması Değiştir" modalı — CANLI TY yazması (paketin kargo firmasını
// değiştirir). Operatör yeni firmayı seçer → onaylar → POST /trendyol/orders/cargo-provider.
// TY paket başına 5 dk'da yalnız 1 değişikliğe izin verir (uyarı gösterilir).
// marketplaceFulfillmentEnabled kapalıysa gönderim engellenir + Ayarlar'a yönlendirir.
function CargoProviderModal({ order, fulfillmentEnabled, onClose, onChanged }) {
  const currentCode = guessProviderCode(order ? order.cargoProvider : null);
  const [selected, setSelected] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !submitting) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  if (!order) return null;

  const hasPackage = !!order.packageId;
  const canSubmit =
    fulfillmentEnabled && hasPackage && !!selected && selected !== currentCode && !submitting && !done;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await changeOrderCargoProvider({ packageId: order.packageId, cargoProvider: selected });
      setDone(true);
      // Kısa "başarılı" gösterimi → kapan + listeyi tazele (TY değişikliği async uygular).
      setTimeout(() => { if (onChanged) onChanged(); }, 1100);
    } catch (err) {
      setError(err && err.message ? err.message : 'Kargo firması değiştirilemedi.');
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => { if (!submitting) onClose(); }}>
      <div
        className="modal oo-cargo-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="oo-cargo-title"
      >
        <header className="oo-cargo-head">
          <div>
            <h3 id="oo-cargo-title" className="oo-cargo-title">Kargo Firması Değiştir</h3>
            <div className="oo-cargo-sub">
              #{order.orderNumber}
              {order.cargoProvider ? <> · Mevcut: <b>{order.cargoProvider}</b></> : null}
            </div>
          </div>
          <button type="button" className="oo-cargo-close" onClick={onClose} aria-label="Kapat" disabled={submitting}>{I.close(16)}</button>
        </header>

        <div className="oo-cargo-body">
          {!fulfillmentEnabled && (
            <div className="oo-cargo-note oo-cargo-note-warn">
              {I.warn(15)}
              <span>Pazaryeri sipariş işleme <b>kapalı</b>. Bu özelliği kullanmak için <b>Ayarlar › Pazaryeri › "Pazaryeri sipariş işleme"</b> seçeneğini açın.</span>
            </div>
          )}
          {fulfillmentEnabled && !hasPackage && (
            <div className="oo-cargo-note oo-cargo-note-warn">
              {I.warn(15)}
              <span>Bu sipariş için paket numarası bulunamadı; kargo firması değiştirilemez.</span>
            </div>
          )}
          {fulfillmentEnabled && hasPackage && (
            <div className="oo-cargo-note">
              {I.info(14)}
              <span>Trendyol her paket için <b>5 dakikada yalnız 1</b> firma değişikliğine izin verir. Değişiklik birkaç dakikada yansıyabilir.</span>
            </div>
          )}

          <div className="oo-cargo-list" role="radiogroup" aria-label="Kargo firması seç">
            {CARGO_PROVIDERS.map(p => {
              const isCurrent = p.code === currentCode;
              const isSel = p.code === selected;
              return (
                <button
                  key={p.code}
                  type="button"
                  role="radio"
                  aria-checked={isSel}
                  className={'oo-cargo-opt' + (isSel ? ' is-sel' : '') + (isCurrent ? ' is-current' : '')}
                  disabled={!fulfillmentEnabled || !hasPackage || isCurrent || submitting || done}
                  onClick={() => { setSelected(p.code); setError(null); }}
                >
                  <span className="oo-cargo-opt-radio" aria-hidden="true" />
                  <span className="oo-cargo-opt-name">{p.name}</span>
                  <span className="oo-cargo-opt-code">{p.code}</span>
                  {isCurrent && <span className="oo-cargo-opt-cur">Mevcut</span>}
                </button>
              );
            })}
          </div>

          {error && <div className="oo-cargo-err">{I.warn(14)} {error}</div>}
        </div>

        <footer className="oo-cargo-actions">
          {done ? (
            <span className="oo-cargo-success">{I.check(15)} Kargo firması güncellendi</span>
          ) : (
            <>
              <button type="button" className="oo-btn oo-btn-ghost" onClick={onClose} disabled={submitting}>Vazgeç</button>
              <button type="button" className="oo-btn oo-btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
                {submitting ? 'Değiştiriliyor…' : 'Değiştir'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

const TABS = [
  { key: 'tum', label: 'Tüm Siparişler' },
  { key: 'yeni', label: 'Yeni' },
  { key: 'isleme', label: 'İşleme Alınanlar' },
  { key: 'tasima', label: 'Taşıma Durumunda' },
  { key: 'teslim', label: 'Teslim Edilen' },
  { key: 'yeniden', label: 'Yeniden Gönderimler' },
  { key: 'aski', label: 'Askıdaki Siparişler', info: 'Müşteri adres/onay bekleyen, henüz işleme alınamayan paketler' },
];

const EMPTY_LABELS = {
  tum: 'Henüz sipariş yok',
  yeni: 'Yeni sipariş yok',
  isleme: 'İşleme alınan paket yok',
  tasima: 'Taşıma durumunda paket yok',
  teslim: 'Teslim edilen paket yok',
  yeniden: 'Yeniden gönderim yok',
  aski: 'Askıda bekleyen sipariş yok',
};

const EMPTY_FILTERS = {
  musteri: '', siparisNo: '', paket: '', barkod: '', kargoKodu: '',
  tedarik: '', baslangic: '', bitis: '', urun: '',
};

const PAGE_SIZE = 100;

// ─── Ürün görseli (TY fotoğrafı / placeholder) ───────────────────────────────
function PhotoSlot({ qty, src, alt }) {
  const [broken, setBroken] = React.useState(false);
  return (
    <div className="oo-prod-photo">
      <span className="oo-qty">{qty}</span>
      <div className="oo-slot">
        {src && !broken
          ? <img src={src} alt={alt || ''} loading="lazy" onError={() => setBroken(true)} />
          : <span className="oo-slot-ph" aria-hidden="true">{I.imagePh(28)}</span>}
      </div>
    </div>
  );
}

// Tarih alanı: önce yer tutucu metni, odaklanınca tarih seçici.
function DateField({ value, onChange, placeholder }) {
  const [type, setType] = React.useState('text');
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onFocus={() => setType('date')}
      onBlur={(e) => { if (!e.target.value) setType('text'); }}
      onChange={onChange}
    />
  );
}

function Field({ children, icon, iconTitle }) {
  return (
    <div className="oo-field">
      <div className="oo-field-input">
        {children}
        {icon && <span className="oo-field-icon" title={iconTitle}>{icon}</span>}
      </div>
    </div>
  );
}

// Bir siparişin ürün (Bilgiler) hücresi.
function ItemInfoCell({ item, onMatch }) {
  return (
    <td className="oo-cell-info">
      <div className="oo-prod">
        <PhotoSlot qty={item.quantity} src={item.imageUrl} alt={item.productName} />
        <div className="oo-prod-body">
          <span className="oo-prod-name">
            <span className="oo-prod-name-text">{item.productName || item.channelTitle || item.barcode || '—'}</span>
          </span>
          <div className="oo-prod-attrs">
            {item.merchantSku && <div className="oo-attr">Stok Kodu: <span className="oo-mono">{item.merchantSku}</span></div>}
            {item.color && <div className="oo-attr">Renk: <b>{item.color}</b></div>}
            {item.barcode && <div className="oo-attr">Barkod: <span className="oo-mono">{item.barcode}</span></div>}
            {item.size && <div className="oo-attr">Beden: <b>{item.size}</b></div>}
            {item.matched ? (
              item.internalName && <div className="oo-attr oo-attr-match">İç ürün: <b>{item.internalName}</b></div>
            ) : (
              <button type="button" className="oo-matchbtn" onClick={() => onMatch && onMatch()} title="İç ürünle eşleştir">
                {I.link(11)} Eşleştir
              </button>
            )}
          </div>
        </div>
      </div>
    </td>
  );
}

// İşlemler menüsü (Durum kolonu). "Kargo Firması Değiştir" işlevsel (CANLI TY
// yazması, onChangeCargo → CargoProviderModal); "İşleme Al" hâlâ "Yakında". Açılır
// panel, tabloyu YENİDEN ŞEKİLLENDİRMEMESİ için body'ye portal'lanmış `position: fixed`
// bir kayan katman olarak butona hizalanır (tablo akışına HİÇ girmez).
function ActionsMenu({ order, onChangeCargo }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const btnRef = React.useRef(null);
  const menuRef = React.useRef(null);

  // Butonun ekran konumundan menü koordinatını hesapla (sağ kenara hizalı).
  const place = React.useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  function toggle() {
    if (!open) place();
    setOpen(o => !o);
  }

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    function onReflow() { setOpen(false); } // scroll/resize'da konum kaymasın → kapat
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open]);

  return (
    <div className="oo-actions">
      <button
        ref={btnRef}
        type="button"
        className={'oo-label-btn oo-actions-toggle' + (open ? ' is-open' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`#${order.orderNumber} işlemleri`}
        onClick={toggle}
      >
        {I.bulk(13)} İşlemler {I.chevDown(11)}
      </button>
      {open && pos && ReactDOM.createPortal(
        <div
          ref={menuRef}
          className="oo-actions-menu oo-actions-menu-float"
          role="menu"
          style={{ top: pos.top, right: pos.right }}
        >
          {order.tab !== 'teslim' ? (
            <button
              type="button"
              className="oo-actions-item"
              role="menuitem"
              onClick={() => { setOpen(false); if (onChangeCargo) onChangeCargo(order); }}
            >
              {I.truck(13)} Kargo Firması Değiştir
            </button>
          ) : null}
          <button type="button" className="oo-actions-item" role="menuitem" disabled title="Yakında">
            {I.statusUpdate(13)} İşleme Al <span className="oo-soon">Yakında</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Tek sipariş = bir <tbody>; paylaşılan hücreler rowspan'lı, her kalem ayrı satır.
function OrderGroup({ order, checked, onToggle, onMatch, onBarcode, onChangeCargo }) {
  const items = order.lines.length ? order.lines : [{ lineId: '_', quantity: 1, productName: '—' }];
  const rows = items.length;
  const [first, ...rest] = items;
  const remaining = fmtRemaining(order.agreedDeliveryDate);
  const saleStrike = order.discount != null && Number(order.discount) > 0;
  const chanCls = order.channel === 'hepsiburada' ? 'oo-chan-hb' : 'oo-chan-ty';
  const chanLabel = order.channel === 'hepsiburada' ? 'Hepsiburada' : 'Trendyol';

  return (
    <tbody className={'oo-ord' + (checked ? ' is-selected' : '')} data-channel={order.channel}>
      <tr>
        <td className="oo-col-check" rowSpan={rows}>
          <input type="checkbox" className="oo-ck oo-row-ck" checked={checked} onChange={onToggle} aria-label="Siparişi seç" />
        </td>
        <td className="oo-col-order" rowSpan={rows}>
          <span className={'oo-chan ' + chanCls}><span className="oo-chan-dot" />{chanLabel}</span>
          <div className="oo-ord-id">
            <span className="oo-bag">{I.bag(15)}</span>
            <span className="oo-ord-no">#{order.orderNumber}</span>
          </div>
          <div className="oo-ord-meta">
            {fmtDateTime(order.orderDate) && <div className="oo-ord-meta-row"><b>Sipariş Tarihi:</b> {fmtDateTime(order.orderDate)}</div>}
            {order.packageId && <div className="oo-ord-meta-row">Paket No: <span className="oo-mono">{order.packageId}</span></div>}
          </div>
          {remaining && (
            <>
              <span className="oo-kalan-label">Kalan Süre</span>
              <span className="oo-kalan">{I.clock(13)}{remaining}</span>
            </>
          )}
        </td>
        <td className="oo-col-buyer" rowSpan={rows}>
          <div className="oo-buyer"><span className="oo-buyer-name">{order.buyerName || '—'}</span></div>
          {order.city && (
            <div className="oo-buyer-sub">{order.city}</div>
          )}
        </td>
        <ItemInfoCell item={first} onMatch={onMatch} />
        <td className="oo-cell-price"><span className="oo-unit-price">{fmtTL(first.unitPrice) || '—'}</span></td>
        <td className="oo-col-cargo" rowSpan={rows}>
          {order.cargoProvider ? (
            <>
              {getCargoLogo(order.cargoProvider) ? (
                <span className="oo-cargo-carrier">
                  <img src={getCargoLogo(order.cargoProvider)} alt={order.cargoProvider} className="oo-cargo-logo-img" />
                </span>
              ) : (
                <span className="oo-cargo-carrier"><span className="oo-cargo-logo">{cargoCode(order.cargoProvider)}</span>{order.cargoProvider}</span>
              )}
              {order.cargoTrackingNumber && <div className="oo-cargo-track">{order.cargoTrackingNumber}</div>}
            </>
          ) : <span className="oo-muted">—</span>}
        </td>
        <td className="oo-col-invoice" rowSpan={rows}>
          {order.saleAmount != null && (
            <div className="oo-inv-row"><span>Satış Tutarı</span><span className={'oo-inv-val' + (saleStrike ? ' oo-strike' : '')}>{fmtTL(order.saleAmount)}</span></div>
          )}
          {saleStrike && (
            <div className="oo-inv-row"><span className="oo-inv-label-ic">Satıcı İndirim Tutarı {I.info(12)}</span><span className="oo-inv-val">{fmtTL(order.discount)}</span></div>
          )}
          {order.billable != null && (
            <div className="oo-inv-total"><span className="oo-inv-total-label">Faturalanacak Tutar</span><span className="oo-inv-total-val">{fmtTL(order.billable)}</span></div>
          )}
          <span className={'oo-inv-status ' + (order.invoiced ? 'oo-inv-done' : 'oo-inv-pending')}>
            <span className="oo-dot" />{order.invoiced ? 'Faturalandı' : 'Fatura Bekleniyor'}
          </span>
        </td>
        <td className="oo-col-status" rowSpan={rows}>
          <div className="oo-status-actions">
            <button
              type="button"
              className="oo-label-btn"
              disabled={!order.cargoTrackingNumber}
              title={order.cargoTrackingNumber ? 'Kargo barkodunu göster / indir' : 'Kargo no yok'}
              onClick={() => order.cargoTrackingNumber && onBarcode(order)}
            >
              {I.barcode(13)} Barkod
            </button>
            <ActionsMenu order={order} onChangeCargo={onChangeCargo} />
          </div>
        </td>
      </tr>
      {rest.map((item, i) => (
        <tr key={item.lineId || i}>
          <ItemInfoCell item={item} onMatch={onMatch} />
          <td className="oo-cell-price"><span className="oo-unit-price">{fmtTL(item.unitPrice) || '—'}</span></td>
        </tr>
      ))}
    </tbody>
  );
}

function orderMatchesFilters(o, f) {
  const has = (val, q) => !q || (val ?? '').toString().toLocaleLowerCase('tr-TR').includes(q.toLocaleLowerCase('tr-TR'));
  if (!has(o.buyerName, f.musteri)) return false;
  if (!has(o.orderNumber, f.siparisNo)) return false;
  if (!has(o.packageId, f.paket)) return false;
  if (!has(o.cargoTrackingNumber, f.kargoKodu)) return false;
  if (f.barkod && !o.lines.some(l => has(l.barcode, f.barkod))) return false;
  if (f.urun && !o.lines.some(l => has(l.productName, f.urun) || has(l.merchantSku, f.urun) || has(l.internalName, f.urun))) return false;
  return true;
}

export function OrdersPage({ onNavigate }) {
  const [tab, setTab] = React.useState('yeni');
  const [channel, setChannel] = React.useState('all');
  const [selected, setSelected] = React.useState(() => new Set());
  const [filters, setFilters] = React.useState(EMPTY_FILTERS);
  const [applied, setApplied] = React.useState(EMPTY_FILTERS);
  const [page, setPage] = React.useState(1);
  const [barcodeOrder, setBarcodeOrder] = React.useState(null);
  const [cargoOrder, setCargoOrder] = React.useState(null); // "Kargo Firması Değiştir" modalı için sipariş
  const [periodDays, setPeriodDays] = React.useState(90); // varsayılan dönem; tarih filtresi yokken geçerli
  const selectAllRef = React.useRef(null);

  // Sidebar/Ayarlar ile ortak 'settings' query'si — kargo firması değiştirme CANLI
  // TY yazması olduğu için marketplaceFulfillmentEnabled flag'ine bakar (kapalıysa
  // modal Ayarlar'a yönlendirir, gönderim engellenir).
  const settingsQuery = useQuery({ queryKey: queryKeys.settings(), queryFn: getSettings });
  const fulfillmentEnabled = settingsQuery.data?.marketplaceFulfillmentEnabled === true;

  // Tarih aralığı yalnız "Filtrele" ile uygulanır → sorgu anahtarı applied'a bağlı.
  // Tarih filtresi yoksa "dönem" (periodDays) penceresi kullanılır (backend ≤80g parça çeker).
  const startDate = applied.baslangic ? Date.parse(applied.baslangic) : undefined;
  const endDate = applied.bitis ? Date.parse(applied.bitis) + 86_399_999 : undefined;
  const hasDates = startDate !== undefined || endDate !== undefined;

  // "Yenile" tıklanınca bir sonraki sorgu sunucu anlık önbelleğini baypas edip canlı
  // çeksin diye işaretlenir (normal açılışlar snapshot'tan ANINDA gelir, force=false).
  const forceRef = React.useRef(false);
  const ordersQuery = useQuery({
    queryKey: ['trendyolOrders', startDate ?? null, endDate ?? null, hasDates ? null : periodDays],
    queryFn: () => {
      const force = forceRef.current;
      forceRef.current = false;
      return getTrendyolOrdersList(hasDates ? { startDate, endDate, force } : { windowDays: periodDays, force });
    },
    staleTime: 30 * 1000,
  });
  function refreshNow() {
    forceRef.current = true;
    ordersQuery.refetch();
  }

  const data = ordersQuery.data;
  const allOrders = data?.orders ?? [];
  const tabCounts = data?.tabCounts ?? {};

  // Sekme + kanal + metin filtreleri (istemci tarafı, anında).
  const filtered = React.useMemo(() => {
    return allOrders.filter(o => {
      if (channel === 'hb' && o.channel !== 'hepsiburada') return false;
      if (channel === 'ty' && o.channel !== 'trendyol') return false;
      if (tab !== 'tum' && o.tab !== tab) return false;
      return orderMatchesFilters(o, applied);
    });
  }, [allOrders, channel, tab, applied]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageOrders = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const visibleIds = pageOrders.map(o => o.id);
  const selCount = visibleIds.filter(id => selected.has(id)).length;
  const allChecked = visibleIds.length > 0 && selCount === visibleIds.length;
  const someChecked = selCount > 0 && !allChecked;
  const currentTab = TABS.find(t => t.key === tab);

  React.useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someChecked;
  }, [someChecked]);

  // Filtre/sekme/kanal değişince sayfayı başa al.
  React.useEffect(() => { setPage(1); }, [tab, channel, applied, periodDays]);

  function changeTab(key) { setTab(key); setSelected(new Set()); }
  function changeChannel(ch) { setChannel(ch); setSelected(new Set()); }

  function toggleRow(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allChecked) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  }
  function clearSelection() {
    setSelected(prev => { const next = new Set(prev); visibleIds.forEach(id => next.delete(id)); return next; });
  }

  const set = (key) => (e) => setFilters(f => ({ ...f, [key]: e.target.value }));
  function applyFilters() { setApplied(filters); }
  function clearFilters() { setFilters(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); }
  function goMatch() { if (onNavigate) onNavigate('mapping'); }

  const tabCount = (key) => key === 'tum' ? (tabCounts.tum ?? 0) : (tabCounts[key] ?? 0);
  const lastUpdated = fmtDateTime(ordersQuery.dataUpdatedAt);

  return (
    <div className="page oo-page">
      {/* ── Durum sekmeleri ──────────────────────────────────────────── */}
      <nav className="oo-tabs" role="tablist" aria-label="Sipariş durumu">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={'oo-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => changeTab(t.key)}
          >
            <span className="oo-tab-label">
              {t.label}
              {t.info && <span className="oo-tab-info" title={t.info}>{I.info(13)}</span>}
            </span>
            <span className="oo-tab-sub">{tabCount(t.key)} Paket</span>
          </button>
        ))}
      </nav>

      {/* ── Filtre kartı ─────────────────────────────────────────────── */}
      <section className="oo-filter">
        <div className="oo-filter-grid">
          <Field><input value={filters.musteri} onChange={set('musteri')} placeholder="Müşteri Adı" /></Field>
          <Field icon={I.info(14)} iconTitle="Pazaryeri sipariş numarası"><input value={filters.siparisNo} onChange={set('siparisNo')} placeholder="Sipariş No" /></Field>
          <Field><input value={filters.paket} onChange={set('paket')} placeholder="Paket No" /></Field>
          <Field><input value={filters.barkod} onChange={set('barkod')} placeholder="Barkod" /></Field>
          <Field><input value={filters.kargoKodu} onChange={set('kargoKodu')} placeholder="Kargo Kodu" /></Field>

          <Field icon={I.calendar(14)}><DateField value={filters.baslangic} onChange={set('baslangic')} placeholder="Sipariş Başlangıç Tarihi" /></Field>
          <Field icon={I.calendar(14)}><DateField value={filters.bitis} onChange={set('bitis')} placeholder="Sipariş Bitiş Tarihi" /></Field>
          <Field icon={I.info(14)} iconTitle="Ürün adı, iç model kodu veya iç ürün adı"><input value={filters.urun} onChange={set('urun')} placeholder="Ürün Adı / Model Kodu" /></Field>
          <div className="oo-field oo-filter-actions">
            <button type="button" className="oo-btn oo-btn-ghost" onClick={clearFilters}>Temizle</button>
            <button type="button" className="oo-btn oo-btn-primary" onClick={applyFilters}>Filtrele</button>
          </div>
        </div>
      </section>

      {/* ── Sonuç kartı ──────────────────────────────────────────────── */}
      <section className="oo-results">
        <div className="oo-results-head">
          <div className="oo-results-title">{currentTab?.label}</div>
          <div className="oo-results-head-right">
            <div className="oo-meta">
              <div className="oo-meta-main">Filtreleme Sonuçları: Toplam <b>{filtered.length}</b> sipariş bilgisi</div>
              <div className="oo-meta-sub">Son Güncelleme: {lastUpdated || '—'}</div>
            </div>
            <div className="oo-excel-split">
              <button type="button" className="oo-excel-btn" disabled title="Yakında">{I.excel(15)}Excel ile İndir</button>
              <button type="button" className="oo-excel-caret" disabled>{I.chevDown(13)}</button>
            </div>
          </div>
        </div>

        <div className="oo-toolbar">
          <button type="button" className="oo-btn oo-btn-accent" disabled={selCount === 0} title="Toplu işlemler yakında (Faz 2)">
            {I.bulk(14)}Toplu İşlemler{I.chevDown(13)}
          </button>

          <div className="oo-seg" role="tablist" aria-label="Kanal filtresi">
            <button type="button" className={'oo-seg-btn' + (channel === 'all' ? ' on' : '')} onClick={() => changeChannel('all')}>Tümü</button>
            <button type="button" className={'oo-seg-btn' + (channel === 'ty' ? ' on' : '')} onClick={() => changeChannel('ty')}><span className="oo-seg-dot ty" />Trendyol</button>
            <button type="button" className={'oo-seg-btn' + (channel === 'hb' ? ' on' : '')} onClick={() => changeChannel('hb')} title="Hepsiburada entegrasyonu yakında"><span className="oo-seg-dot hb" />Hepsiburada</button>
          </div>

          <button type="button" className="oo-sortsel" onClick={refreshNow} disabled={ordersQuery.isFetching} title="Yenile">
            {I.clock(13)} {ordersQuery.isFetching ? 'Yenileniyor…' : 'Yenile'}
          </button>

          <select className="oo-sortsel oo-periodsel" value={periodDays} disabled={hasDates}
            onChange={e => setPeriodDays(Number(e.target.value))}
            title={hasDates ? 'Tarih filtresi aktif — Temizle ile kaldır' : 'Gösterilecek dönem — Trendyol API yalnız son ~3 ayı döndürür'}>
            <option value={30}>Son 30 gün</option>
            <option value={90}>Son 90 gün</option>
            <option value={180}>Son 6 ay</option>
          </select>

          <div className="oo-toolbar-right">
            <span className="oo-perpage-label">Her Sayfada</span>
            <button type="button" className="oo-perpage">{PAGE_SIZE} Ürün</button>
            <div className="oo-pager">
              <button type="button" className="oo-pager-btn" aria-label="Önceki sayfa" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{I.chevL(14)}</button>
              <span className="oo-pager-num">{safePage}/{totalPages}</span>
              <button type="button" className="oo-pager-btn" aria-label="Sonraki sayfa" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>{I.chevR(14)}</button>
            </div>
          </div>
        </div>

        {selCount > 0 && (
          <div className="oo-bulk">
            <span className="oo-bulk-count"><b>{selCount}</b> sipariş seçildi</span>
            <div className="oo-bulk-actions">
              <button type="button" className="oo-bulk-link" onClick={clearSelection}>Seçimi Temizle</button>
            </div>
          </div>
        )}

        {ordersQuery.isLoading ? (
          <div className="oo-empty">
            <div className="oo-empty-med">{I.bag(28)}</div>
            <div className="oo-empty-title">Siparişler yükleniyor…</div>
          </div>
        ) : ordersQuery.isError && !data ? (
          <div className="oo-empty">
            <div className="oo-empty-med">{I.bag(28)}</div>
            <div className="oo-empty-title">Siparişler alınamadı</div>
            <div className="oo-empty-sub">{ordersQuery.error?.message || 'Bilinmeyen hata.'} Trendyol kimliği ve "Pazaryeri senkronu" ayarını kontrol edin.</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="oo-empty">
            <div className="oo-empty-med">{I.bag(28)}</div>
            <div className="oo-empty-title">{EMPTY_LABELS[tab] || 'Bu durumda paket bulunmuyor'}</div>
            <div className="oo-empty-sub">Seçtiğiniz durum/filtre için gösterilecek sipariş yok.</div>
          </div>
        ) : (
          <div className="oo-tablewrap">
            <table className="oo-table">
              <thead>
                <tr>
                  <th className="oo-col-check"><input ref={selectAllRef} type="checkbox" className="oo-ck" checked={allChecked} onChange={toggleAll} aria-label="Tümünü seç" /></th>
                  <th className="oo-col-order"><span className="oo-th-flex">Sipariş Bilgileri <span className="oo-th-funnel">{I.funnel(12)}</span></span></th>
                  <th className="oo-col-buyer">Alıcı</th>
                  <th>Bilgiler</th>
                  <th className="oo-col-price">Birim Fiyat</th>
                  <th className="oo-col-cargo"><span className="oo-th-flex">Kargo <span className="oo-th-funnel">{I.funnel(12)}</span></span></th>
                  <th className="oo-col-invoice"><span className="oo-th-flex">Fatura <span className="oo-th-funnel">{I.funnel(12)}</span></span></th>
                  <th className="oo-col-status">
                    <span className="oo-th-gear" title="Kolonları düzenle">{I.gear(14)}</span>
                    <span className="oo-th-flex">Durum <span className="oo-th-funnel">{I.funnel(12)}</span></span>
                  </th>
                </tr>
              </thead>
              {pageOrders.map(o => (
                <OrderGroup key={o.id} order={o} checked={selected.has(o.id)} onToggle={() => toggleRow(o.id)} onMatch={goMatch}
                  onBarcode={setBarcodeOrder} onChangeCargo={setCargoOrder} />
              ))}
            </table>
          </div>
        )}
      </section>

      {barcodeOrder && <BarcodeModal order={barcodeOrder} onClose={() => setBarcodeOrder(null)} />}
      {cargoOrder && (
        <CargoProviderModal
          order={cargoOrder}
          fulfillmentEnabled={fulfillmentEnabled}
          onClose={() => setCargoOrder(null)}
          onChanged={() => { setCargoOrder(null); refreshNow(); }}
        />
      )}
    </div>
  );
}

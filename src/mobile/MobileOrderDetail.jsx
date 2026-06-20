// Mobil · Pazaryeri Sipariş Detayı — sipariş listesindeki (src/mobile/MobileOrders.jsx)
// bir karta "Sipariş detayını görüntüle" denince açılan tam ekran detay.
// Tasarım kaynağı: Claude Design "Mobil Pazaryeri Sipariş Detayı" (chat26).
//
// SALT-OKUNUR: veriyi liste ekranının çektiği sipariş nesnesinden alır (ayrı
// istek yok). Trendyol'a/iç stoğa hiç yazma yok. Bloklar: Sipariş Bilgileri,
// Ürünler, Kargo Bilgileri, Fatura Bilgileri; altta yapışkan aksiyon çubuğu.
// Kopyala düğmeleri (sipariş no, barkod) tamamen istemci tarafı çalışır.
// "Kargo Etiketini Yazdır" → web ekranındaki (src/orders.jsx) BarcodeModal'ın
// mobil eşi: cargoTrackingNumber'dan istemci tarafı Code128 barkod (Trendyol'a
// yazma YOK, hâlâ salt-okunur). İşlemler / İşleme Al butonları henüz pasif (TY'ye
// yazma = Faz 2). Tüm görsel sınıflar `od-*`.

import React from 'react';
import JsBarcode from 'jsbarcode';

// ─── Biçimlendiriciler (liste ekranıyla aynı davranış) ───────────────────────
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

function fmtDateLong(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

// Hedef zamana kalan süre "G gün HH:MM:SS" (geçmişse/yoksa null) — saniye saniye
// işleyen geri sayım, tasarımdaki gibi.
function fmtCountdown(targetMs, nowMs) {
  if (!targetMs) return null;
  const diff = targetMs - nowMs;
  if (diff <= 0) return null;
  const totalSec = Math.floor(diff / 1000);
  const gun = Math.floor(totalSec / 86400);
  const saat = Math.floor((totalSec % 86400) / 3600);
  const dakika = Math.floor((totalSec % 3600) / 60);
  const saniye = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${gun} gün ${pad(saat)}:${pad(dakika)}:${pad(saniye)}`;
}

function isUrgent(targetMs) {
  if (!targetMs) return false;
  const diff = targetMs - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

// ─── İkonlar (tasarımın inline SVG'leriyle aynı) ─────────────────────────────
const I = {
  back: (s = 20) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg>),
  copy: (s = 13) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>),
  check: (s = 13) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>),
  clock: (s = 16) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  truck: (s = 16) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13h13V6H3zM16 9h3.5L22 12v4h-6z" /><circle cx="7" cy="18" r="1.7" /><circle cx="18" cy="18" r="1.7" /></svg>),
  warn: (s = 14) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" strokeLinecap="round" /></svg>),
  printer: (s = 19) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></svg>),
  download: (s = 16) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>),
  close: (s = 18) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round"><path d="M5 5l14 14M19 5 5 19" /></svg>),
  photo: (s = 24) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>),
  bag: (s = 26) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>),
};

// ─── Kargo firması logoları ──────────────────────────────────────────────────
// TY sipariş yanıtında yalnız firma adı (cargoProviderName) geliyor; logo kodu
// yok. Bu yüzden ad → TY CDN logo URL'i eşleştirilir (web "Pazaryeri Siparişleri"
// ekranı src/orders.jsx ile birebir aynı). Logosu eşleşmeyen firmalar kısa koda
// düşer.
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

function cargoCode(provider) {
  if (!provider) return '?';
  return provider.trim().split(/\s+/)[0].slice(0, 3).toLocaleUpperCase('tr-TR');
}

// Kargo firması gösterimi: logo eşleşiyorsa firma adı yerine logoyu basar; logo
// yoksa (ya da yüklenemezse) kısa kod rozeti + firma adına düşer.
function CargoBrand({ provider }) {
  const logo = getCargoLogo(provider);
  const [broken, setBroken] = React.useState(false);
  if (logo && !broken) {
    return <img src={logo} alt={provider} className="od-cargo-logo-img" loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <>
      <span className="od-cargo-mark od-cargo-mark-code">{cargoCode(provider)}</span>
      <span className="od-cargo-brand">{provider}</span>
    </>
  );
}

// Sekme → durum rozeti etiketi + renk anahtarı.
const STATUS_PILL = {
  yeni: { label: 'Yeni', kind: 'info' },
  isleme: { label: 'İşleme Alındı', kind: 'amber' },
  tasima: { label: 'Kargoda', kind: 'info' },
  teslim: { label: 'Teslim Edildi', kind: 'ok' },
  yeniden: { label: 'Yeniden Gönderim', kind: 'warn' },
  aski: { label: 'Askıda', kind: 'neutral' },
};

// "Stok Kodu" yalnız bilgilendiriciyse: TY çoğu satırda merchantSku'yu boş
// bırakıp "merchantSku" sabitini ya da barkodun aynısını döndürüyor → gizle.
function meaningfulSku(line) {
  return line.merchantSku
    && line.merchantSku !== line.barcode
    && line.merchantSku.trim().toLocaleLowerCase('tr-TR') !== 'merchantsku'
    ? line.merchantSku : null;
}

// ─── Ürün görseli (TY fotoğrafı / placeholder) ───────────────────────────────
function PhotoSlot({ qty, src, alt }) {
  const [broken, setBroken] = React.useState(false);
  return (
    <div className="od-photo">
      <span className="od-qty">{qty}</span>
      <div className="od-slot">
        {src && !broken
          ? <img src={src} alt={alt || ''} loading="lazy" onError={() => setBroken(true)} />
          : <span className="od-slot-ph" aria-hidden="true">{I.photo(24)}</span>}
      </div>
    </div>
  );
}

// ─── Kargo barkodu (Code128) — tamamen istemci tarafı ────────────────────────
// Web "Pazaryeri Siparişleri" ekranındaki (src/orders.jsx) BarcodeModal'ın mobil
// karşılığı: cargoTrackingNumber'ı JsBarcode ile bir <canvas>'a Code128 olarak
// çizer. Dış servis / Trendyol'a yazma YOK. Niimbot gibi etiket yazıcılarına
// aktarmak için PNG indirilir; barkod okunabilirliği için ZORUNLU siyah/beyaz
// (tema rengi UYGULANMAZ). Yazdırma, kurulu PWA (standalone) modunda window.open
// çoğu zaman engellendiği için gizli bir <iframe> üzerinden tetiklenir.
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

  // Gizli iframe üzerinden yazdır: kurulu PWA'da window.open çoğu zaman engellenir,
  // bu yüzden barkod görselini iframe'in kendi belgesine yazıp contentWindow'dan
  // print() çağırırız (yeni sekme açmadan, in-app tarayıcıda da çalışır).
  function handlePrint() {
    const canvas = canvasRef.current;
    if (!canvas || error) return;
    const url = canvas.toDataURL('image/png');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    const doc = win.document;
    doc.open();
    doc.write(
      `<!doctype html><title>Kargo ${ctn}</title>` +
      `<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">` +
      `<img src="${url}" style="max-width:100%" alt="Kargo barkodu ${ctn}">` +
      `</body>`,
    );
    doc.close();
    const img = doc.querySelector('img');
    const fire = () => {
      win.focus();
      win.print();
      setTimeout(() => iframe.remove(), 1000);
    };
    if (img && !img.complete) { img.onload = fire; img.onerror = fire; }
    else fire();
  }

  if (!order) return null;

  return (
    <div className="od-barcode-backdrop" onClick={onClose}>
      <div
        className="od-barcode-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="od-barcode-title"
      >
        <header className="od-barcode-head">
          <div className="od-barcode-head-txt">
            <h3 id="od-barcode-title" className="od-barcode-title">Kargo Barkodu</h3>
            <div className="od-barcode-sub">#{order.orderNumber}{order.cargoProvider ? ` · ${order.cargoProvider}` : ''}</div>
          </div>
          <button type="button" className="od-barcode-close" onClick={onClose} aria-label="Kapat">{I.close(18)}</button>
        </header>

        <div className="od-barcode-body">
          {error ? (
            <div className="od-barcode-error">Bu kargo numarası barkoda çevrilemedi: <span className="od-mono">{ctn}</span></div>
          ) : (
            <div className="od-barcode-card">
              <canvas ref={canvasRef} className="od-barcode-canvas" />
            </div>
          )}
        </div>

        <footer className="od-barcode-actions">
          <button type="button" className="od-barcode-btn od-barcode-btn-ghost" onClick={handlePrint} disabled={error}>{I.printer(16)} Yazdır</button>
          <button type="button" className="od-barcode-btn od-barcode-btn-primary" onClick={handleDownload} disabled={error}>{I.download(16)} PNG indir</button>
        </footer>
      </div>
    </div>
  );
}

export function MobileOrderDetail({ order, onBack }) {
  const [copied, setCopied] = React.useState(null);
  const [barcodeOpen, setBarcodeOpen] = React.useState(false);
  // Geri sayım saniye saniye işlesin diye tik state'i (yalnız kalan süre varsa).
  const [now, setNow] = React.useState(() => Date.now());

  const remaining = order ? fmtCountdown(order.agreedDeliveryDate, now) : null;
  const showCountdown = !!remaining && (order?.tab === 'yeni' || order?.tab === 'isleme');

  React.useEffect(() => {
    if (!showCountdown) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showCountdown]);

  function copy(key, text) {
    if (!text || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(String(text))
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied(c => (c === key ? null : c)), 1400);
      })
      .catch(() => {});
  }

  if (!order) {
    return (
      <div className="od-page">
        <header className="od-top">
          <button type="button" className="od-top-back" aria-label="Geri" onClick={onBack}>{I.back(20)}</button>
          <div className="od-top-title"><h1>Sipariş Detayı</h1></div>
          <span className="od-top-spacer" />
        </header>
        <div className="od-scroll">
          <div className="od-empty">
            <div className="od-empty-med">{I.bag(26)}</div>
            <div className="od-empty-t">Sipariş bulunamadı</div>
            <div className="od-empty-d">Listeye dönüp tekrar açmayı deneyin.</div>
          </div>
        </div>
      </div>
    );
  }

  const pill = STATUS_PILL[order.tab] || { label: 'Sipariş', kind: 'neutral' };
  const lines = order.lines && order.lines.length ? order.lines : [{ lineId: '_', quantity: 1, productName: '—' }];
  const totalQty = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0) || lines.length;
  const loc = [order.city, order.district].filter(Boolean).join(' · ');
  const hasDiscount = order.discount != null && Number(order.discount) > 0;
  const hasCargo = !!(order.cargoProvider || order.cargoTrackingNumber);

  // Geri sayım yoksa duruma göre uyarlanan bilgi şeridi (teslim → tarih, kargoda → firma).
  let band = null;
  if (showCountdown) {
    band = { kind: isUrgent(order.agreedDeliveryDate) ? 'warn' : 'info', icon: 'clock', label: 'Kalan Süre', value: remaining };
  } else if (order.tab === 'teslim') {
    band = { kind: 'ok', icon: 'check', label: 'Teslim Edildi', value: fmtDateLong(order.lastModifiedDate) };
  } else if (order.tab === 'tasima') {
    band = { kind: 'info', icon: 'truck', label: 'Kargoda', value: order.cargoProvider || null };
  }
  const bandIcon = band
    ? (band.icon === 'check' ? I.check(16) : band.icon === 'truck' ? I.truck(16) : I.clock(16))
    : null;

  return (
    <div className="od-page">
      {/* ── Koyu üst başlık (sabit) ── */}
      <header className="od-top">
        <button type="button" className="od-top-back" aria-label="Geri" onClick={onBack}>{I.back(20)}</button>
        <div className="od-top-title"><h1>Sipariş Detayı</h1></div>
        <span className="od-top-spacer" />
      </header>

      {/* ── Kayan gövde ── */}
      <div className="od-scroll">

        {/* ── Sipariş Bilgileri ── */}
        <section className="od-sect">
          <div className="od-sect-head">
            <span className="od-sect-title">Sipariş Bilgileri</span>
            <span className={'od-pill od-pill-' + pill.kind}><span className="od-pill-dot" />{pill.label}</span>
          </div>

          {band && (
            <div className={'od-band od-band-' + band.kind}>
              {bandIcon}
              <span className="od-band-txt">{band.label}{band.value ? <>: <b>{band.value}</b></> : null}</span>
            </div>
          )}

          <div className="od-info-rows">
            <div className="od-info-row">
              <span className="od-info-k">Sipariş Numarası</span>
              <span className="od-info-v">
                <button type="button" className="od-copy-ic" aria-label="Sipariş no kopyala" onClick={() => copy('ord', order.orderNumber)}>
                  {copied === 'ord' ? I.check(13) : I.copy(13)}
                </button>
                #{order.orderNumber}
              </span>
            </div>
            {fmtDateTime(order.orderDate) && (
              <div className="od-info-row">
                <span className="od-info-k">Sipariş Tarihi</span>
                <span className="od-info-v">{fmtDateTime(order.orderDate)}</span>
              </div>
            )}
            {order.packageId && (
              <div className="od-info-row">
                <span className="od-info-k">Paket No</span>
                <span className="od-info-v od-mono">{order.packageId}</span>
              </div>
            )}
            {order.buyerName && (
              <div className="od-info-row">
                <span className="od-info-k">Alıcı</span>
                <span className="od-info-v od-buyer-v">
                  <span className="od-buyer-name">{order.buyerName}</span>
                  {loc && <span className="od-buyer-tag">{loc}</span>}
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ── Ürünler ── */}
        <section className="od-sect">
          <div className="od-sect-head">
            <span className="od-sect-title">Ürünler</span>
            <span className="od-sect-count">{totalQty} Adet</span>
          </div>

          <div className="od-items">
            {lines.map((l, i) => {
              const sku = meaningfulSku(l);
              return (
                <div className="od-item" key={l.lineId || i}>
                  <PhotoSlot qty={l.quantity} src={l.imageUrl} alt={l.productName} />
                  <div className="od-item-body">
                    <div className="od-item-name">{l.productName || l.channelTitle || l.barcode || '—'}</div>
                    <div className="od-attrs">
                      {sku && <div className="od-attr">Stok Kodu: <span className="od-mono">{sku}</span></div>}
                      {l.color && <div className="od-attr">Renk: <b>{l.color}</b></div>}
                      {l.barcode && <div className="od-attr">Barkod: <span className="od-mono">{l.barcode}</span></div>}
                      {l.size && <div className="od-attr">Beden: <b>{l.size}</b></div>}
                    </div>
                    {l.unitPrice != null && <div className="od-price">Birim Fiyatı: <b>{fmtTL(l.unitPrice)}</b></div>}
                  </div>
                  {l.barcode && (
                    <button type="button" className="od-item-copy" aria-label="Barkod kopyala" onClick={() => copy('bc-' + (l.lineId || i), l.barcode)}>
                      {copied === 'bc-' + (l.lineId || i) ? I.check(13) : I.copy(13)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Kargo Bilgileri ── */}
        {hasCargo && (
          <section className="od-sect">
            <div className="od-sect-head"><span className="od-sect-title">Kargo Bilgileri</span></div>
            {order.cargoProvider && (
              <div className="od-cargo-row">
                <span className="od-info-k">Kargo Firması</span>
                <span className="od-cargo-logo">
                  <CargoBrand provider={order.cargoProvider} />
                </span>
              </div>
            )}
            {order.cargoTrackingNumber && (
              <div className="od-cargo-row">
                <span className="od-info-k">Kargo Kodu</span>
                <span className="od-cargo-code">
                  <span className="od-cargo-code-v">{order.cargoTrackingNumber}</span>
                  <span className="od-cargo-code-s">Trendyol Anlaşmalı Kargo</span>
                </span>
              </div>
            )}
          </section>
        )}

        {/* ── Fatura Bilgileri ── */}
        {(order.saleAmount != null || order.billable != null) && (
          <section className="od-sect">
            <div className="od-sect-head">
              <span className="od-sect-title">Fatura Bilgileri</span>
              <span className={'od-inv-status ' + (order.invoiced ? 'od-inv-done' : 'od-inv-pending')}>
                {order.invoiced ? <>{I.check(13)}Faturalandı</> : <>{I.warn(14)}Fatura Bekleniyor</>}
              </span>
            </div>

            <div className="od-inv-rows">
              {order.saleAmount != null && (
                <div className="od-inv-row"><span className="od-inv-k">Satış Tutarı</span><span className={'od-inv-v' + (hasDiscount ? ' od-strike' : '')}>{fmtTL(order.saleAmount)}</span></div>
              )}
              {hasDiscount && (
                <div className="od-inv-row"><span className="od-inv-k">Satıcı İndirim Tutarı</span><span className="od-inv-v">−{fmtTL(order.discount)}</span></div>
              )}
            </div>

            {order.billable != null && (
              <div className="od-inv-total">
                <span className="od-inv-total-k">Faturalanacak Tutar</span>
                <span className="od-inv-total-v">{fmtTL(order.billable)}</span>
              </div>
            )}
          </section>
        )}
      </div>

      {/* ── Alt sabit aksiyon çubuğu ──
          "Kargo Etiketini Yazdır" istemci tarafı barkod modalını açar (web ile
          aynı, Trendyol'a yazma yok). İşlemler / İşleme Al hâlâ pasif (TY'ye
          yazma = Faz 2). */}
      <div className="od-actionbar">
        <button
          type="button"
          className="od-ab-print"
          disabled={!order.cargoTrackingNumber}
          title={order.cargoTrackingNumber ? 'Kargo barkodunu göster / yazdır' : 'Kargo numarası yok'}
          onClick={() => order.cargoTrackingNumber && setBarcodeOpen(true)}
        >
          {I.printer(19)} Kargo Etiketini Yazdır
        </button>
        <div className="od-ab-pair">
          <button type="button" className="od-ab-ghost" disabled title="Yakında (Faz 2)">İşlemler</button>
          <button type="button" className="od-ab-primary" disabled title="Yakında (Faz 2)">
            {I.check(17)} İşleme Al
          </button>
        </div>
      </div>

      {barcodeOpen && <BarcodeModal order={order} onClose={() => setBarcodeOpen(false)} />}
    </div>
  );
}

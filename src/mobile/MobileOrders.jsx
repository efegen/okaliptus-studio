// Mobil · Pazaryeri Siparişleri — web operasyon ekranının (src/orders.jsx) mobil
// karşılığı. Tasarım kaynağı: Claude Design "Mobil Pazaryeri Siparişleri" (chat24).
//
// SALT-OKUNUR: gerçek Trendyol siparişlerini GET /trendyol/orders/list ucundan
// çeker (TY fotoğrafı + iç ürün eşleşmesiyle zenginleştirilmiş). Trendyol'a/iç
// STOĞA hiç yazma yok; `marketplaceSyncEnabled` flag'iyle açılır. HB parke —
// kanal segmenti durur ama yalnız Trendyol akar. Ana sayfadaki "Siparişler"
// (V3·B) butonundan açılır; geri tuşu → ana sayfa.
//
// Yapı, mobil öğrenci profiliyle (.mobile-msp-page) aynı kalıpta: sabit koyu
// başlık + sabit durum sekmeleri + yalnızca gövde kayar. Tüm görsel sınıflar
// `mo-*` ad alanında (mobil app global CSS'iyle çakışmasın).

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrendyolOrdersList } from '../api';

// ─── Biçimlendiriciler (web orders.jsx ile aynı davranış) ────────────────────
function fmtTL(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return `₺${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtTime(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Hedef zamana kalan süre "X gün Y saat Z dakika" (geçmişse null).
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
  if (saat || gun) parts.push(`${saat} saat`);
  parts.push(`${dakika} dakika`);
  return parts.join(' ');
}

// agreedDeliveryDate 24 saatten yakınsa "acil" (kırmızı) — bugün/yarın kargo.
function isUrgent(targetMs) {
  if (!targetMs) return false;
  const diff = targetMs - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

// ─── İkonlar (tasarımın inline SVG'leriyle aynı) ─────────────────────────────
const I = {
  back: (s = 20) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 6-6 6 6 6" /></svg>),
  search: (s = 17) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>),
  filter: (s = 18) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18M6 12h12M10 19h4" /></svg>),
  refresh: (s = 18) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v4h-4" /></svg>),
  check: (s = 12) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>),
  info: (s = 12) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>),
  clock: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
  photo: (s = 24) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>),
  bag: (s = 26) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>),
  truck: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13h13V6H3zM16 9h3.5L22 12v4h-6z" /><circle cx="7" cy="18" r="1.7" /><circle cx="18" cy="18" r="1.7" /></svg>),
  chevR: (s = 15) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>),
};

const TABS = [
  { key: 'tum', label: 'Tümü' },
  { key: 'yeni', label: 'Yeni' },
  { key: 'isleme', label: 'İşleme Alınanlar' },
  { key: 'tasima', label: 'Taşıma Durumunda' },
  { key: 'teslim', label: 'Teslim Edilen' },
  { key: 'yeniden', label: 'Yeniden Gönderim' },
  { key: 'aski', label: 'Askıdaki' },
];

// Kanal filtre seçenekleri (arama kutusunun sağındaki filtre butonu menüsü).
const CHANNELS = [
  { key: 'all', label: 'Tümü', dot: null },
  { key: 'ty', label: 'Trendyol', dot: 'ty' },
  { key: 'hb', label: 'Hepsiburada', dot: 'hb', title: 'Hepsiburada entegrasyonu yakında' },
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

// Trendyol API yalnız son ~3 ayı döndürür; web ekranıyla aynı varsayılan pencere.
const WINDOW_DAYS = 90;

// ─── Ürün görseli (TY fotoğrafı / placeholder) ───────────────────────────────
function PhotoSlot({ qty, src, alt }) {
  const [broken, setBroken] = React.useState(false);
  return (
    <div className="mo-item-photo">
      <span className="mo-qty">{qty}</span>
      <div className="mo-slot">
        {src && !broken
          ? <img src={src} alt={alt || ''} loading="lazy" onError={() => setBroken(true)} />
          : <span className="mo-slot-ph" aria-hidden="true">{I.photo(30)}</span>}
      </div>
    </div>
  );
}

// "22 Aralık 2025 10:39" — uzun Türkçe tarih (teslim/durum şeridi için).
function fmtDateLong(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

// Duruma göre uyarlanan durum şeridi: teslim → yeşil, kargoda → mavi,
// yeni/işlemde → kalan süre (acilse kırmızı), askıda → nötr. Yalnız mevcut
// veriden türetilir; teslim zamanı TY orders'tan ayrı bir alanla gelmediği için
// lastModifiedDate (son durum değişimi) en iyi yaklaşım olarak kullanılır.
function statusBand(order) {
  const tab = order.tab;
  if (tab === 'teslim') {
    return { kind: 'ok', icon: 'check', label: 'Teslim Edildi', value: fmtDateLong(order.lastModifiedDate) };
  }
  if (tab === 'tasima') {
    return { kind: 'amber', icon: 'truck', label: 'Kargoda', value: order.cargoProvider || null };
  }
  if (tab === 'yeni' || tab === 'isleme') {
    const rem = fmtRemaining(order.agreedDeliveryDate);
    if (rem) return { kind: isUrgent(order.agreedDeliveryDate) ? 'warn' : 'info', icon: 'clock', label: 'Kalan Süre', value: rem };
    return { kind: 'amber', icon: 'clock', label: tab === 'yeni' ? 'Yeni sipariş' : 'İşleme alındı', value: null };
  }
  if (tab === 'yeniden') return { kind: 'warn', icon: 'clock', label: 'Yeniden gönderim', value: null };
  if (tab === 'aski') return { kind: 'neutral', icon: 'clock', label: 'Askıda bekliyor', value: null };
  const rem = fmtRemaining(order.agreedDeliveryDate);
  if (rem) return { kind: 'info', icon: 'clock', label: 'Kalan Süre', value: rem };
  return null;
}

// ─── Tek sipariş kartı ───────────────────────────────────────────────────────
function OrderCard({ order, onOpenDetail }) {
  const hasDiscount = order.discount != null && Number(order.discount) > 0;
  const dateStr = [fmtDate(order.orderDate), fmtTime(order.orderDate)].filter(Boolean).join(' ');
  const loc = order.city || '';
  const chanCls = order.channel === 'hepsiburada' ? 'mo-chan-hb' : 'mo-chan-ty';
  const chanLabel = order.channel === 'hepsiburada' ? 'Hepsiburada' : 'Trendyol';
  const band = statusBand(order);
  const bandIcon = band
    ? (band.icon === 'check' ? I.check(15) : band.icon === 'truck' ? I.truck(15) : I.clock(15))
    : null;
  const lines = order.lines.length ? order.lines : [{ lineId: '_', quantity: 1, productName: '—' }];

  return (
    <article className="mo-card">
      {/* satır 1: sipariş no + kopyala (sol) · tarih (sağ) */}
      <div className="mo-chead">
        <div className="mo-chead-id">
          <span className="mo-ordno">#{order.orderNumber}</span>
        </div>
        {dateStr && <span className="mo-chead-date"><span className="mo-chead-date-l">Sipariş Tarihi:</span> {dateStr}</span>}
      </div>
      {/* satır 2: alıcı (sol, belirgin) · kanal rozeti (sağ, ikincil) */}
      <div className="mo-subhead">
        {order.buyerName && (
          <span className="mo-cust">{order.buyerName}{loc && <span className="mo-cust-loc"> · {loc}</span>}</span>
        )}
        <span className={'mo-chan ' + chanCls}><span className="mo-chan-dot" />{chanLabel}</span>
      </div>

      {band && (
        <div className={'mo-band mo-band-' + band.kind}>
          {bandIcon}
          <span className="mo-band-txt">{band.label}{band.value ? <>: <b>{band.value}</b></> : null}</span>
        </div>
      )}

      <div
        className="mo-items-row"
        role={onOpenDetail ? 'button' : undefined}
        tabIndex={onOpenDetail ? 0 : undefined}
        onClick={onOpenDetail ? () => onOpenDetail(order) : undefined}
        onKeyDown={onOpenDetail ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(order); } } : undefined}
      >
        <div className="mo-items">
          {lines.map((l, i) => {
            const sku = l.merchantSku
              && l.merchantSku !== l.barcode
              && l.merchantSku.trim().toLocaleLowerCase('tr-TR') !== 'merchantsku'
              ? l.merchantSku : null;
            return (
              <div className="mo-item" key={l.lineId || i}>
                <PhotoSlot qty={l.quantity} src={l.imageUrl} alt={l.productName} />
                <div className="mo-item-body">
                  <div className="mo-item-name">{l.productName || l.channelTitle || l.barcode || '—'}</div>
                  <div className="mo-attrs">
                    {l.unitPrice != null && <div className="mo-attr mo-attr-price">Birim Fiyatı: <b>{fmtTL(l.unitPrice)}</b></div>}
                    {l.barcode && <div className="mo-attr">Barkod: <b>{l.barcode}</b></div>}
                    {sku && <div className="mo-attr">Stok Kodu: <b>{sku}</b></div>}
                    {l.color && <div className="mo-attr">Renk: <b>{l.color}</b></div>}
                    {l.size && <div className="mo-attr">Beden: <b>{l.size}</b></div>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {onOpenDetail && <span className="mo-items-chev" aria-hidden="true">{I.chevR(18)}</span>}
      </div>
    </article>
  );
}

export function MobileOrders({ onBack, onOpenDetail }) {
  const [tab, setTab] = React.useState('yeni');
  const [channel, setChannel] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [filterOpen, setFilterOpen] = React.useState(false);

  // Web orders ekranıyla AYNI sorgu anahtarı → önbellek paylaşılır (viewport
  // değişince yeniden çekmez), salt-okunur 90 günlük pencere.
  // "Yenile" bir sonraki sorguda sunucu anlık önbelleğini baypas etsin diye işaretler;
  // normal açılışlar snapshot'tan ANINDA gelir (force=false).
  const forceRef = React.useRef(false);
  const ordersQuery = useQuery({
    queryKey: ['trendyolOrders', null, null, WINDOW_DAYS],
    queryFn: () => {
      const force = forceRef.current;
      forceRef.current = false;
      return getTrendyolOrdersList({ windowDays: WINDOW_DAYS, force });
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

  const filtered = React.useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return allOrders.filter(o => {
      if (channel === 'ty' && o.channel !== 'trendyol') return false;
      if (channel === 'hb' && o.channel !== 'hepsiburada') return false;
      if (tab !== 'tum' && o.tab !== tab) return false;
      if (q && !(o.buyerName ?? '').toLocaleLowerCase('tr-TR').includes(q)) return false;
      return true;
    });
  }, [allOrders, channel, tab, search]);

  const tabCount = (key) => key === 'tum' ? (tabCounts.tum ?? 0) : (tabCounts[key] ?? 0);
  const currentTab = TABS.find(t => t.key === tab);
  const lastUpdated = fmtDateTime(ordersQuery.dataUpdatedAt);

  return (
    <div className="mo-page">
      {/* ── Koyu üst başlık ── */}
      <header className="mo-top">
        <button type="button" className="mo-top-back" aria-label="Geri" onClick={onBack}>{I.back(20)}</button>
        <div className="mo-top-title">
          <h1>Pazaryeri Siparişleri</h1>
          <p>Trendyol · Hepsiburada</p>
        </div>
      </header>

      {/* ── Durum sekmeleri (sabit) ── */}
      <nav className="mo-tabs" role="tablist" aria-label="Sipariş durumu">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={'mo-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            <span className="mo-tab-l">{t.label}</span>
            <span className="mo-tab-c">{tabCount(t.key)} paket</span>
          </button>
        ))}
      </nav>

      {/* ── Kayan gövde ── */}
      <div className="mo-scroll">
        {/* arama + kanal filtresi + yenile */}
        <div className="mo-tools">
          <label className="mo-search">
            {I.search(17)}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Müşteri adı ile ara"
              aria-label="Müşteri adı ile ara"
            />
          </label>
          <div className="mo-filter-wrap">
            <button
              type="button"
              className={'mo-toolbtn mo-filter-btn' + (channel !== 'all' ? ' on' : '')}
              aria-label="Kanal filtresi"
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen(o => !o)}
            >
              {I.filter(18)}
              {channel !== 'all' && <span className={'mo-filter-dot ' + channel} />}
            </button>
            {filterOpen && (
              <>
                <div className="mo-filter-backdrop" onClick={() => setFilterOpen(false)} />
                <div className="mo-filter-menu" role="menu" aria-label="Kanal filtresi">
                  {CHANNELS.map(c => (
                    <button
                      key={c.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={channel === c.key}
                      className={'mo-filter-item' + (channel === c.key ? ' on' : '')}
                      title={c.title}
                      onClick={() => { setChannel(c.key); setFilterOpen(false); }}
                    >
                      {c.dot ? <span className={'mo-fdot ' + c.dot} /> : <span className="mo-fdot mo-fdot-all" />}
                      <span className="mo-filter-item-l">{c.label}</span>
                      {channel === c.key && <span className="mo-filter-check">{I.check(13)}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            className={'mo-toolbtn' + (ordersQuery.isFetching ? ' is-busy' : '')}
            aria-label="Yenile"
            onClick={refreshNow}
            disabled={ordersQuery.isFetching}
          >
            {I.refresh(18)}
          </button>
        </div>

        {/* meta */}
        <div className="mo-meta">
          <div className="mo-meta-main">Toplam <b>{filtered.length}</b> sipariş · {currentTab?.label}</div>
          <div className="mo-meta-sub">Son güncelleme: {lastUpdated || '—'}</div>
        </div>

        {/* liste / durumlar */}
        {ordersQuery.isLoading ? (
          <div className="mo-empty">
            <div className="mo-empty-med">{I.bag(26)}</div>
            <div className="mo-empty-t">Siparişler yükleniyor…</div>
          </div>
        ) : ordersQuery.isError && !data ? (
          <div className="mo-empty">
            <div className="mo-empty-med">{I.bag(26)}</div>
            <div className="mo-empty-t">Siparişler alınamadı</div>
            <div className="mo-empty-d">{ordersQuery.error?.message || 'Bilinmeyen hata.'} Trendyol kimliği ve "Pazaryeri senkronu" ayarını kontrol edin.</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mo-empty">
            <div className="mo-empty-med">{I.bag(26)}</div>
            <div className="mo-empty-t">{EMPTY_LABELS[tab] || 'Bu durumda paket bulunmuyor'}</div>
            <div className="mo-empty-d">Seçtiğiniz durum/filtre için gösterilecek sipariş yok.</div>
          </div>
        ) : (
          <div className="mo-list">
            {filtered.map(o => (
              <OrderCard key={o.id} order={o} onOpenDetail={onOpenDetail} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

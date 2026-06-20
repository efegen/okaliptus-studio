// Ürün Eşleştirme — "Bağlantı Hattı" (Tasarım B): iç katalog ↔ Trendyol.
// Ortadaki koyu hub'dan seçili iç ürün, yandaki bağlı Trendyol ilanına canlı
// kabloyla (SVG bezier) bağlanır. Karşılığı (barkod eşi) olmayan TY ilanları
// vurgulanır → tek tıkla iç ürün olarak eklenir. Hepsiburada sütunu şimdilik
// boş durur (entegrasyon sonra eklenecek).
//
// Tasarım B claude.ai/design projesinden taşındı (pencere-b.jsx / pencere.css);
// localStorage taslağı yerine GERÇEK /mapping verisine ve adopt / auto-match /
// sync uçlarına bağlandı. Görsel sınıflar: pc-* (üst bar + aksiyonlar) ve
// wb-* (kablo tahtası). Backend HB ilanı çekmediği için sağ sütun salt görsel.

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMappingOverview,
  syncTrendyolProducts,
  autoMatchByBarcode,
  adoptChannelProduct,
  deleteChannelListing,
} from './api';
import { Icon } from './layout';

function fmtPrice(raw) {
  if (raw === null || raw === undefined || raw === '') return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  return '₺' + n.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}

function fmtWhen(iso) {
  if (!iso) return 'hiç';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ─── /mapping verisini kablo tahtası modeline çevir ──────────────────────────
// İç katalog (hub) + Trendyol ilanları (eşleşmeyen orphan'lar + bağlı listing'ler).
function buildModel(data) {
  const products = data?.products ?? [];
  const orphans = data?.orphanTrendyol ?? [];
  const summary = data?.summary;

  const internal = products.map(p => ({
    id: String(p.id),
    name: p.name,
    barcode: p.barcode,
    price: p.price,
    image: p.imageUrl || null,
    ty: p.trendyol || null,
    hb: p.hepsiburada || null,
  }));

  // Eşleşmeyen TY ilanları → bağlanabilir / önerili / karşılıksız adaylar.
  const tyOrphans = orphans.map(o => ({
    id: 'cp-' + o.channelProductId,
    kind: 'orphan',
    channelProductId: o.channelProductId,
    title: o.title || o.externalId,
    ext: o.externalId,
    qty: o.quantity,
    price: o.salePrice,
    image: o.imageUrl || null,
    linkedPid: null,
    suggestPid: o.suggestProductId != null ? String(o.suggestProductId) : null,
    suggestName: o.suggestProductName,
    archived: !!o.archived,
    productUrl: o.productUrl,
  }));

  // Bağlı TY listing'leri (iç üründen türetilir) → kablo bu kartlara çekilir.
  const tyLinked = products
    .filter(p => p.trendyol)
    .map(p => ({
      id: 'cl-' + p.trendyol.listingId,
      kind: 'listing',
      listingId: p.trendyol.listingId,
      title: p.trendyol.snapshot?.title || p.name,
      ext: p.trendyol.externalId,
      qty: p.trendyol.snapshot?.quantity ?? null,
      price: p.trendyol.snapshot?.sale_price ?? p.trendyol.channelPrice,
      image: p.imageUrl || null,
      linkedPid: String(p.id),
      suggestPid: null,
      isListed: p.trendyol.isListed,
      productUrl: p.trendyol.snapshot?.product_url,
    }));

  const tyItems = [...tyOrphans, ...tyLinked];
  const noMatch = orphans.filter(o => !o.suggestProductId).length;

  return {
    internal,
    tyItems,
    counts: {
      orphan: orphans.length,
      noMatch,
      anyLink: summary?.trendyolMapped ?? internal.filter(p => p.ty).length,
      internal: summary?.internalProducts ?? internal.length,
    },
    syncedAt: summary?.snapshotSyncedAt ?? null,
  };
}

function makeNameOf(internal) {
  const m = new Map(internal.map(p => [p.id, p.name]));
  return (pid) => m.get(String(pid)) || pid;
}

function matchTy(i, nq) {
  return (i.title || '').toLocaleLowerCase('tr-TR').includes(nq)
      || (i.ext || '').toLocaleLowerCase('tr-TR').includes(nq);
}

// Görsel + bozuk/yok düşersek ikon yedeği.
function Thumb({ src, alt, className, fallback }) {
  const [err, setErr] = React.useState(false);
  React.useEffect(() => { setErr(false); }, [src]);
  if (src && !err) {
    return (
      <span className={className}>
        <img src={src} alt={alt || ''} loading="lazy" onError={() => setErr(true)} />
      </span>
    );
  }
  return <span className={className}>{fallback}</span>;
}

// ─── Sütun içi arama ─────────────────────────────────────────────────────────
function WbSearch({ q, setQ, dark, placeholder }) {
  return (
    <div className={'wb-search' + (dark ? ' dark' : '')}>
      <Icon.Search width={14} height={14} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {q && (
        <button className="wb-search-x" onClick={() => setQ('')} aria-label="Temizle">
          <Icon.Plus width={13} height={13} style={{ transform: 'rotate(45deg)' }} />
        </button>
      )}
    </div>
  );
}

// ─── Trendyol ilan kartı (yan sütun) ─────────────────────────────────────────
function SideItem({ item, active, nameOf, busy, onBind, onUnbind, onGoto, onCreate }) {
  const linkedPid = item.linkedPid;
  const noMatch = item.kind === 'orphan' && !item.suggestPid;
  let state, onClick = null;
  if (linkedPid && linkedPid === active) state = 'linked-active';
  else if (linkedPid) { state = 'linked-other'; onClick = () => onGoto(linkedPid); }
  else if (noMatch) state = 'nomatch';
  else if (active) { state = item.suggestPid === active ? 'suggested' : 'bindable'; onClick = () => onBind(item, active); }
  else state = 'free';

  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const suggestLabel = item.suggestName || (item.suggestPid ? nameOf(item.suggestPid) : '');

  return (
    <div className={'wb-item ' + state + (busy ? ' busy' : '')} onClick={busy ? undefined : onClick} role={onClick ? 'button' : undefined}>
      {state === 'linked-active' && <span className="wb-port" />}
      {state === 'nomatch' && <span className="wb-newtag"><Icon.Bell width={11} height={11} /> karşılığı yok</span>}
      <div className="wb-item-main">
        <Thumb src={item.image} alt={item.title} className="wb-item-thumb" fallback={<Icon.Tag width={16} height={16} />} />
        <div className="wb-item-text">
          <div className="wb-item-tt">{item.title}</div>
          <div className="wb-item-meta">
            <span className="wb-mini-meta">{item.ext}</span>
            {item.qty != null && <span className="wb-mini-meta">· stok {item.qty}</span>}
            <span className="wb-mini-meta">· {fmtPrice(item.price)}</span>
            {item.archived && <span className="wb-mini-meta">· arşivli</span>}
          </div>
        </div>
      </div>

      {state === 'linked-active' && (
        <div className="pc-link-row">
          <span className="pc-link-name"><Icon.Link width={12} height={12} /> <b>{nameOf(linkedPid)}</b></span>
          <button className="pc-act unbind" disabled={busy} onClick={stop(() => onUnbind(item))}>Kaldır</button>
        </div>
      )}
      {state === 'suggested' && (
        <div className="pc-link-row">
          <span className="pc-tag sug"><Icon.Check width={11} height={11} /> önerilen</span>
          <button className="pc-act bind" disabled={busy} onClick={stop(() => onBind(item, active))}><Icon.Plus width={12} height={12} /> Bağla</button>
        </div>
      )}
      {state === 'bindable' && (
        <div className="pc-link-row">
          <span className="pc-tag bind">≈ {suggestLabel}</span>
          <button className="pc-act bind" disabled={busy} onClick={stop(() => onBind(item, active))}><Icon.Plus width={12} height={12} /> Aktife bağla</button>
        </div>
      )}
      {state === 'linked-other' && (
        <div className="pc-link-row"><span className="pc-link-name">→ {nameOf(linkedPid)}</span></div>
      )}
      {state === 'free' && (
        <div className="pc-link-row">
          <span className="pc-tag free">eşleşmemiş</span>
          <span className="pc-link-name">≈ <b>{suggestLabel}</b></span>
          <button className="pc-act bind" disabled={busy} onClick={stop(() => onBind(item, item.suggestPid))}><Icon.Plus width={12} height={12} /> Bağla</button>
        </div>
      )}
      {state === 'nomatch' && (
        <div className="pc-nm-row">
          <button className="pc-act mk-new" disabled={busy} onClick={stop(() => onCreate(item))}>
            <Icon.Plus width={12} height={12} /> İç ürün olarak ekle
          </button>
          {active && <button className="pc-act bind ghosty" disabled={busy} onClick={stop(() => onBind(item, active))}>Aktife bağla</button>}
        </div>
      )}
    </div>
  );
}

// ─── Trendyol sütunu ─────────────────────────────────────────────────────────
function TyColumn({ items, active, nameOf, busyId, onBind, onUnbind, onGoto, onCreate, q, setQ, showMatched, onToggleMatched }) {
  const nq = q.trim().toLocaleLowerCase('tr-TR');
  const orphanCount = items.filter(i => !i.linkedPid).length;
  const noMatch = items.filter(i => !i.linkedPid && !i.suggestPid).length;
  const rank = (i) => {
    if (!i.suggestPid) return 0;                       // karşılıksız → üstte
    if (i.suggestPid === active && active) return 1;   // aktif ürünün önerisi
    return 2;
  };
  const filtered = nq ? items.filter(i => matchTy(i, nq)) : items;
  const unmatched = filtered.filter(i => !i.linkedPid).sort((a, b) => rank(a) - rank(b));
  const linked = filtered.filter(i => i.linkedPid);

  const renderItem = (item) => (
    <SideItem key={item.id} item={item} active={active} nameOf={nameOf}
      busy={busyId != null && (busyId === item.channelProductId || busyId === item.listingId)}
      onBind={onBind} onUnbind={onUnbind} onGoto={onGoto} onCreate={onCreate} />
  );

  return (
    <div className="wb-col side ty">
      <div className="wb-colhd">
        <div className="wb-hd-row">
          <span className="wb-hd-badge">TY</span>
          <span className="wb-hd-tt">Trendyol</span>
          <span className="wb-hd-n">{orphanCount} eşleşmemiş</span>
        </div>
        <div className="wb-hd-sub">
          Kanaldan çekilen ilanlar · salt-okunur{noMatch ? ' · ' : ''}
          {noMatch ? <b className="wb-hd-nm">{noMatch} karşılıksız</b> : null}
        </div>
        <WbSearch q={q} setQ={setQ} placeholder="İlan, barkod ara…" />
      </div>
      <div className="wb-list" data-wb-list="ty">
        {unmatched.map(renderItem)}
        {linked.length > 0 && (
          <>
            <button className="wb-divider" onClick={onToggleMatched} aria-expanded={showMatched}>
              <Icon.ChevronDown width={13} height={13} style={{ transform: showMatched ? 'none' : 'rotate(-90deg)' }} />
              Eşleşmiş ilanlar <span className="wb-divider-n">{linked.length}</span>
            </button>
            {showMatched && linked.map(renderItem)}
          </>
        )}
        {filtered.length === 0 && (
          nq ? <div className="wb-empty">“{q}” için sonuç yok</div>
             : <div className="wb-empty">Henüz Trendyol ilanı çekilmedi.</div>
        )}
      </div>
    </div>
  );
}

// ─── İç ürün (hub) kartı ─────────────────────────────────────────────────────
function HubCard({ p, active, setActive, isNew, matched }) {
  const isActive = active === p.id;
  const ty = p.ty;
  return (
    <div className={'wb-hub' + (isActive ? ' active' : '') + (isNew ? ' isnew' : '') + (matched ? ' matched' : '')}
      role="button" onClick={() => setActive(isActive ? null : p.id)}>
      <span className={'wb-hub-port l' + (ty ? ' on' : '')} />
      <span className="wb-hub-port r" />
      <Thumb src={p.image} alt={p.name} className="wb-hub-thumb" fallback={<Icon.Box width={16} height={16} />} />
      <div className="wb-hub-body">
        <div className="wb-hub-tt">{p.name}{isNew && <span className="wb-hub-new">yeni</span>}</div>
        <div className="wb-hub-meta">{p.barcode || '—'} · {fmtPrice(p.price)}</div>
        <div className="wb-hub-dots">
          <span className={'wb-cdot' + (ty ? ' on' : '')}><i />TY {ty ? ty.externalId : '—'}</span>
          <span className="wb-cdot"><i />HB —</span>
        </div>
      </div>
    </div>
  );
}

// ─── İç katalog (hub) sütunu — koyu zemin ────────────────────────────────────
function HubColumn({ internal, active, setActive, createdSet, q, setQ, showMatched, onToggleMatched }) {
  const nq = q.trim().toLocaleLowerCase('tr-TR');
  const rows = nq
    ? internal.filter(p => (p.name || '').toLocaleLowerCase('tr-TR').includes(nq) || (p.barcode || '').includes(nq))
    : internal;
  const unmatched = rows.filter(p => !p.ty);
  const matched = rows.filter(p => p.ty);

  return (
    <div className="wb-col center">
      <div className="wb-colhd">
        <div className="wb-hd-row">
          <span className="wb-hd-badge">İÇ</span>
          <span className="wb-hd-tt">İç Katalog</span>
          <span className="wb-hd-n">{unmatched.length} eşleşmemiş</span>
        </div>
        <div className="wb-hd-sub">Bir ürün seç, kabloyu Trendyol ilanına çek</div>
        <WbSearch q={q} setQ={setQ} dark placeholder="İç ürün, barkod ara…" />
      </div>
      <div className="wb-list" data-wb-list="center">
        {unmatched.map(p => (
          <HubCard key={p.id} p={p} active={active} setActive={setActive} isNew={createdSet.has(p.id)} />
        ))}
        {matched.length > 0 && (
          <>
            <button className="wb-divider" onClick={onToggleMatched} aria-expanded={showMatched}>
              <Icon.ChevronDown width={13} height={13} style={{ transform: showMatched ? 'none' : 'rotate(-90deg)' }} />
              Eşleşmiş <span className="wb-divider-n">{matched.length}</span>
            </button>
            {showMatched && matched.map(p => (
              <HubCard key={p.id} p={p} active={active} setActive={setActive} isNew={createdSet.has(p.id)} matched />
            ))}
          </>
        )}
        {rows.length === 0 && (
          nq ? <div className="wb-empty dark">“{q}” için sonuç yok</div>
             : <div className="wb-empty dark">Henüz iç ürün yok.</div>
        )}
      </div>
    </div>
  );
}

// ─── Hepsiburada sütunu — şimdilik boş (entegrasyon sonra) ───────────────────
function HbColumn() {
  return (
    <div className="wb-col side hb">
      <div className="wb-colhd">
        <div className="wb-hd-row">
          <span className="wb-hd-badge">HB</span>
          <span className="wb-hd-tt">Hepsiburada</span>
          <span className="wb-hd-n">—</span>
        </div>
        <div className="wb-hd-sub">Entegrasyon yakında</div>
      </div>
      <div className="wb-list">
        <div className="wb-empty wb-hb-soon">
          <span className="wb-hb-soon-ico"><Icon.Box width={20} height={20} /></span>
          <div>Hepsiburada eşleştirmesi<br />yakında eklenecek.</div>
        </div>
      </div>
    </div>
  );
}

// ─── Eşleştirme onayı — bağlamadan önce iç ürün ↔ TY ilanı önizlemesi ────────
function BindConfirm({ item, product, busy, onCancel, onConfirm }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  return (
    <div className="pc-confirm-ov" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="pc-confirm" role="dialog" aria-modal="true" aria-label="Eşleştirmeyi onayla">
        <div className="pc-confirm-hd">
          <Icon.Link width={16} height={16} />
          <h3>Eşleştirmeyi onayla</h3>
        </div>
        <div className="pc-confirm-bd">
          <div className="pc-confirm-pair">
            <div className="pc-confirm-side">
              <span className="pc-confirm-k">İç ürün</span>
              <Thumb src={product?.image} alt={product?.name} className="pc-confirm-thumb" fallback={<Icon.Box width={20} height={20} />} />
              <div className="pc-confirm-name">{product ? product.name : '—'}</div>
              <div className="pc-confirm-meta">{product?.barcode || '—'} · {fmtPrice(product?.price)}</div>
            </div>
            <div className="pc-confirm-link"><Icon.Link width={15} height={15} /></div>
            <div className="pc-confirm-side">
              <span className="pc-confirm-k ty">Trendyol ilanı</span>
              <Thumb src={item.image} alt={item.title} className="pc-confirm-thumb" fallback={<Icon.Tag width={20} height={20} />} />
              <div className="pc-confirm-name">{item.title}</div>
              <div className="pc-confirm-meta">{item.ext}{item.qty != null ? ` · stok ${item.qty}` : ''} · {fmtPrice(item.price)}</div>
            </div>
          </div>
          <div className="pc-confirm-note">
            <Icon.Bell width={13} height={13} />
            <span>Bu Trendyol ilanı seçilen iç ürüne bağlanacak. Sipariş geldikçe iç stok bu üründen düşer; bağı sonra “Kaldır” ile çözebilirsin.</span>
          </div>
        </div>
        <div className="pc-confirm-foot">
          <button className="pc-confirm-btn ghost" onClick={onCancel} disabled={busy}>Vazgeç</button>
          <button className="pc-confirm-btn primary" onClick={onConfirm} disabled={busy}>
            <Icon.Link width={14} height={14} /> {busy ? 'Bağlanıyor…' : 'Bağla'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Yeni iç ürün oluştur — ad + fiyat girilir (snapshot'tan ön doldurulur) ──
// Snapshot fiyatı yoksa kullanıcı elle girer; böylece fiyatsız TY ilanları da
// iç kataloğa benimseyebilir. Barkod = ilanın external_id'si (değiştirilemez).
function CreateProductModal({ item, busy, onCancel, onConfirm }) {
  const [name, setName] = React.useState(item.title || item.ext || '');
  const [price, setPrice] = React.useState(item.price != null ? String(item.price) : '');
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  function submit() {
    const nm = name.trim();
    if (!nm) { setErr('Ürün adı zorunlu.'); return; }
    const priceNum = Number(price);
    if (price.trim() === '' || !Number.isFinite(priceNum) || priceNum <= 0) {
      setErr('Geçerli bir fiyat gir (sıfırdan büyük).');
      return;
    }
    onConfirm({ name: nm, price: priceNum });
  }

  return (
    <div className="pc-confirm-ov" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="pc-confirm" role="dialog" aria-modal="true" aria-label="İç ürün oluştur">
        <div className="pc-confirm-hd">
          <Icon.Box width={16} height={16} />
          <h3>İç ürün oluştur</h3>
        </div>
        <div className="pc-confirm-bd">
          <div className="pc-newp-top">
            <Thumb src={item.image} alt={item.title} className="pc-confirm-thumb" fallback={<Icon.Tag width={20} height={20} />} />
            <div className="pc-newp-top-meta">
              <span className="pc-confirm-k ty">Trendyol ilanı</span>
              <div className="pc-confirm-meta">Barkod {item.ext}{item.qty != null ? ` · stok ${item.qty}` : ''}</div>
            </div>
          </div>

          <label className="pc-newp-field">
            <span className="pc-newp-lbl">Ürün adı</span>
            <input
              className="pc-newp-input"
              value={name}
              onChange={e => { setName(e.target.value); setErr(null); }}
              autoFocus
              placeholder="İç katalog adı"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
          </label>
          <label className="pc-newp-field">
            <span className="pc-newp-lbl">Fiyat (₺)</span>
            <input
              className="pc-newp-input"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={e => { setPrice(e.target.value); setErr(null); }}
              placeholder="0,00"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
          </label>

          {err && <div className="pc-newp-err">{err}</div>}

          <div className="pc-confirm-note">
            <Icon.Bell width={13} height={13} />
            <span>Barkod {item.ext} ile yeni iç ürün oluşturulup bu ilana bağlanır. Ad ve fiyatı sonra Ürünler ekranından da düzenleyebilirsin.</span>
          </div>
        </div>
        <div className="pc-confirm-foot">
          <button className="pc-confirm-btn ghost" onClick={onCancel} disabled={busy}>Vazgeç</button>
          <button className="pc-confirm-btn primary" onClick={submit} disabled={busy}>
            <Icon.Plus width={14} height={14} /> {busy ? 'Oluşturuluyor…' : 'Oluştur ve bağla'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MappingPage({ onNavigate }) {
  const queryClient = useQueryClient();
  const [active, setActive] = React.useState(null);
  const [segs, setSegs] = React.useState([]);
  const [flash, setFlash] = React.useState(null);          // { tone: 'ok' | 'err', msg }
  const [busyId, setBusyId] = React.useState(null);        // channelProductId | listingId
  const [syncing, setSyncing] = React.useState(false);
  const [automatching, setAutomatching] = React.useState(false);
  const [createdSet, setCreatedSet] = React.useState(() => new Set());
  const [tyQ, setTyQ] = React.useState('');
  const [hubQ, setHubQ] = React.useState('');
  const [showMatched, setShowMatched] = React.useState(false);  // çoktan eşleşenler gizli (ayrı bölümde)
  const [pendingBind, setPendingBind] = React.useState(null);   // { item, pid } → onay modalı
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  const [pendingCreate, setPendingCreate] = React.useState(null); // orphan item → ad/fiyat modalı
  const [createBusy, setCreateBusy] = React.useState(false);
  const boardRef = React.useRef(null);
  const flashTimer = React.useRef(null);

  const overviewQuery = useQuery({ queryKey: ['mapping'], queryFn: getMappingOverview, staleTime: 30 * 1000 });
  const data = overviewQuery.data;
  const model = React.useMemo(() => buildModel(data), [data]);
  const nameOf = React.useMemo(() => makeNameOf(model.internal), [model.internal]);
  const activeP = active ? model.internal.find(p => p.id === active) : null;

  const showFlash = React.useCallback((tone, msg, ms = 3400) => {
    setFlash({ tone, msg });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), ms);
  }, []);
  React.useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['mapping'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await syncTrendyolProducts();
      showFlash('ok', `Senkron tamam: ${r.synced} ürün${r.pruned ? `, ${r.pruned} eski kayıt temizlendi` : ''}.`);
      queryClient.invalidateQueries({ queryKey: ['mapping'] });
    } catch (e) {
      showFlash('err', e.message || 'Senkron başarısız.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleAutoMatch() {
    setAutomatching(true);
    try {
      const r = await autoMatchByBarcode();
      showFlash('ok', r.matched > 0
        ? `Barkodla ${r.matched} ürün otomatik eşlendi.`
        : 'Barkodla eşleşen yeni ürün bulunamadı.');
      invalidateAll();
    } catch (e) {
      showFlash('err', e.message || 'Otomatik eşleme başarısız.');
    } finally {
      setAutomatching(false);
    }
  }

  // Bağlama tek tıkta değil: önce önizleme/onay modalı açılır.
  function requestBind(item, pid) {
    if (!pid || item.kind !== 'orphan') return;
    setPendingBind({ item, pid });
  }

  async function confirmBind() {
    if (!pendingBind) return;
    const { item, pid } = pendingBind;
    setConfirmBusy(true);
    try {
      await adoptChannelProduct({ channelProductId: item.channelProductId, mode: 'link', productId: pid });
      showFlash('ok', `${nameOf(pid)} · ilan bağlandı.`);
      setPendingBind(null);
      setActive(showMatched ? pid : null);  // eşleşti → odak listesinden çıkar (gizliyse seçimi temizle)
      invalidateAll();
    } catch (e) {
      showFlash('err', e.message || 'Bağlama başarısız.');
      setPendingBind(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  // "Yeni iç ürün" → önce ad/fiyat modalını aç (snapshot fiyatı boş olabilir).
  function handleCreate(item) {
    setPendingCreate(item);
  }

  async function confirmCreate({ name, price }) {
    if (!pendingCreate) return;
    const item = pendingCreate;
    setCreateBusy(true);
    try {
      const r = await adoptChannelProduct({
        channelProductId: item.channelProductId, mode: 'create', name, price,
      });
      if (r?.productId != null) {
        const pid = String(r.productId);
        setCreatedSet(prev => new Set(prev).add(pid));
        setActive(showMatched ? pid : null);
      }
      showFlash('ok', `“${name}” iç kataloğa eklendi · ilan bağlandı.`);
      setPendingCreate(null);
      invalidateAll();
    } catch (e) {
      showFlash('err', e.message || 'İç ürün oluşturulamadı.');
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleUnbind(item) {
    setBusyId(item.listingId);
    try {
      await deleteChannelListing(item.listingId);
      showFlash('ok', 'Bağ kaldırıldı.');
      invalidateAll();
    } catch (e) {
      showFlash('err', e.message || 'Bağ kaldırılamadı.');
    } finally {
      setBusyId(null);
    }
  }

  // ─── Canlı kablolar: aktif hub portu ↔ bağlı TY ilan portu ─────────────────
  const recompute = React.useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const br = board.getBoundingClientRect();
    const scale = br.width / board.offsetWidth || 1;
    const toXY = (el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - br.left) / scale, y: (r.top + r.height / 2 - br.top) / scale };
    };
    const out = [];
    const hubL = board.querySelector('.wb-hub.active .wb-hub-port.l');
    const tyP = board.querySelector('.wb-col.ty .wb-item.linked-active .wb-port');
    if (hubL && tyP) out.push([toXY(tyP), toXY(hubL)]);
    setSegs(out);
  }, []);

  React.useLayoutEffect(() => {
    recompute();
    const board = boardRef.current;
    if (!board) return;
    const lists = board.querySelectorAll('[data-wb-list]');
    const onScroll = () => recompute();
    lists.forEach(l => l.addEventListener('scroll', onScroll, { passive: true }));
    window.addEventListener('resize', onScroll);
    const ro = new ResizeObserver(onScroll);
    ro.observe(board);
    const t = window.setTimeout(recompute, 250);
    return () => {
      lists.forEach(l => l.removeEventListener('scroll', onScroll));
      window.removeEventListener('resize', onScroll);
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [active, model, recompute]);

  // Eşleşmiş bir iç ürün seçilince, kablonun ucundaki TY ilanını (uzakta/altlarda
  // olabilir) ve seçili hub kartını görünüme ortala → kablo bulunur, kısa ve yatay.
  React.useEffect(() => {
    if (!active) return;
    const board = boardRef.current;
    if (!board) return;
    const t = window.setTimeout(() => {
      const listing = board.querySelector('.wb-col.ty .wb-item.linked-active');
      if (!listing) return;  // eşleşmemiş ürün seçildi → kablo yok, kaydırma
      listing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const hub = board.querySelector('.wb-hub.active');
      if (hub) hub.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 70);
    return () => window.clearTimeout(t);
  }, [active, showMatched]);

  function path([a, b]) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  }

  return (
    <div className="pc-pg">
      <div className="pc-bar">
        <button className="pc-backbtn" onClick={() => onNavigate?.('products')} title="Ürünlere dön">
          <Icon.ChevronL width={16} height={16} />
          <span>Ürünler</span>
        </button>
        <div className="pc-bar-tt">
          <h1 className="pc-h1">Eşleştirme</h1>
          <div className="pc-h1-sub">
            Bağlantı hattı · iç ürünü seç, Trendyol ilanına bağla · {model.counts.anyLink}/{model.counts.internal} eşleşik · son senkron {fmtWhen(model.syncedAt)}
          </div>
        </div>
        <div className="pc-bar-spacer" />
        {model.counts.noMatch > 0 && (
          <div className="pc-nmpill" title="İç katalogda eşi olmayan Trendyol ilanları">
            <Icon.Bell width={13} height={13} />
            <span className="pc-nmpill-n">{model.counts.noMatch}</span>
            <span className="pc-nmpill-t">karşılıksız ilan</span>
          </div>
        )}
        <div className={'pc-active' + (activeP ? '' : ' empty')}>
          <span className="pc-active-k">{activeP ? 'Hat aktif' : 'Hat boş'}</span>
          <span className="pc-active-name">{activeP ? activeP.name : 'Ortadan bir iç ürün seçin'}</span>
          {activeP && (
            <button className="pc-active-x" onClick={() => setActive(null)} title="Seçimi temizle">
              <Icon.Plus width={13} height={13} style={{ transform: 'rotate(45deg)' }} />
            </button>
          )}
        </div>
        <button className={'pc-resetbtn' + (showMatched ? ' on' : '')} onClick={() => setShowMatched(v => !v)}
          title="Çoktan eşleşmiş ürün ve ilanları göster/gizle">
          <Icon.ChevronDown width={13} height={13} style={{ transform: showMatched ? 'none' : 'rotate(-90deg)' }} />
          {showMatched ? 'Eşleşenleri gizle' : 'Eşleşenleri göster'}
        </button>
        <button className="pc-resetbtn" onClick={handleAutoMatch} disabled={automatching || syncing}>
          <Icon.Link width={13} height={13} /> {automatching ? 'Eşleniyor…' : 'Otomatik eşle'}
        </button>
        <button className="pc-resetbtn primary" onClick={handleSync} disabled={syncing}>
          <Icon.Repeat width={13} height={13} /> {syncing ? 'Çekiliyor…' : 'Ürünleri çek'}
        </button>
      </div>

      <div className="wb-board" ref={boardRef}>
        <svg className="wb-wires">
          {segs.map((s, i) => (
            <g key={i}>
              <path d={path(s)} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
              <path d={path(s)} fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" opacity="0.12" />
            </g>
          ))}
        </svg>
        <TyColumn items={model.tyItems} active={active} nameOf={nameOf} busyId={busyId}
          onBind={requestBind} onUnbind={handleUnbind} onGoto={setActive} onCreate={handleCreate} q={tyQ} setQ={setTyQ}
          showMatched={showMatched} onToggleMatched={() => setShowMatched(v => !v)} />
        <HubColumn internal={model.internal} active={active} setActive={setActive} createdSet={createdSet} q={hubQ} setQ={setHubQ}
          showMatched={showMatched} onToggleMatched={() => setShowMatched(v => !v)} />
        <HbColumn />

        {overviewQuery.isLoading && <div className="pc-loadlayer">Yükleniyor…</div>}
        {overviewQuery.isError && (
          <div className="pc-loadlayer err">
            <Icon.Bell width={16} height={16} /> {overviewQuery.error?.message || 'Veri alınamadı.'}
          </div>
        )}
      </div>

      {flash && (
        <div className={'pc-toast' + (flash.tone === 'err' ? ' err' : '')}>
          {flash.tone === 'err' ? <Icon.Bell width={14} height={14} /> : <Icon.Check width={14} height={14} />} {flash.msg}
        </div>
      )}

      {pendingBind && (
        <BindConfirm
          item={pendingBind.item}
          product={model.internal.find(p => p.id === pendingBind.pid) || null}
          busy={confirmBusy}
          onCancel={() => { if (!confirmBusy) setPendingBind(null); }}
          onConfirm={confirmBind}
        />
      )}

      {pendingCreate && (
        <CreateProductModal
          item={pendingCreate}
          busy={createBusy}
          onCancel={() => { if (!createBusy) setPendingCreate(null); }}
          onConfirm={confirmCreate}
        />
      )}
    </div>
  );
}

// Ürün Eşleştirme kokpiti: iç katalog ↔ Trendyol ↔ Hepsiburada.
// Trendyol ürünleri "Senkronize et" ile yerel snapshot'a çekilir; eşleşmeyenler
// tek tıkla iç ürün olarak oluşturulur ya da mevcut iç ürüne bağlanır. HB elle.
// Yalnız pazaryeri senkronu açıkken erişilir (sidebar sekmesi flag arkasında).

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMappingOverview,
  syncTrendyolProducts,
  adoptChannelProduct,
  autoMatchByBarcode,
  createProductChannel,
  deleteChannelListing,
} from './api';
import { Icon } from './layout';

function fmtTL(raw) {
  if (raw === null || raw === undefined || raw === '') return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  return `₺${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
}

function fmtWhen(iso) {
  if (!iso) return 'hiç';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ─── Mevcut iç ürüne bağla: küçük arama açılır kutusu ───────────────────────
function LinkPicker({ products, onPick, onCancel, busy }) {
  const [q, setQ] = React.useState('');
  const nq = q.trim().toLocaleLowerCase('tr-TR');
  const list = nq
    ? products.filter(p =>
        (p.name || '').toLocaleLowerCase('tr-TR').includes(nq) ||
        (p.barcode || '').toLocaleLowerCase('tr-TR').includes(nq))
    : products;

  return (
    <div className="map-linkpicker" onClick={e => e.stopPropagation()}>
      <input
        autoFocus
        className="prod-modal-input"
        placeholder="İç ürün ara (ad/barkod)…"
        value={q}
        onChange={e => setQ(e.target.value)}
      />
      <div className="map-linkpicker-list">
        {list.length === 0 && <div className="map-muted">Eşleşen iç ürün yok.</div>}
        {list.slice(0, 30).map(p => (
          <button key={p.id} type="button" className="map-linkpicker-item" disabled={busy} onClick={() => onPick(p.id)}>
            <span className="map-lp-name">{p.name}</span>
            <span className="map-lp-sub">{p.barcode || '—'} · {fmtTL(p.price)}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-ghost btn-xs" onClick={onCancel} disabled={busy}>Vazgeç</button>
    </div>
  );
}

// ─── Eşleşmeyen Trendyol ürünü kartı ────────────────────────────────────────
function OrphanCard({ orphan, products, onAdopt, busyId }) {
  const [picking, setPicking] = React.useState(false);
  const busy = busyId === orphan.channelProductId;

  return (
    <div className="map-orphan">
      <div className="map-orphan-img">
        {orphan.imageUrl
          ? <img src={orphan.imageUrl} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />
          : <span aria-hidden="true"><Icon.Tag width="18" height="18" /></span>}
      </div>
      <div className="map-orphan-body">
        <div className="map-orphan-title">{orphan.title || orphan.externalId}</div>
        <div className="map-orphan-meta">
          <span className="prod-td-mono">{orphan.externalId}</span>
          {orphan.productMainId && <span className="map-chip">{orphan.productMainId}</span>}
          <span>stok {orphan.quantity ?? '—'}</span>
          <span>{fmtTL(orphan.salePrice)}</span>
          {orphan.archived && <span className="map-chip is-warn">arşivli</span>}
          {orphan.productUrl && (
            <a href={orphan.productUrl} target="_blank" rel="noopener noreferrer" className="map-link">TY'de aç</a>
          )}
        </div>
      </div>
      <div className="map-orphan-actions">
        {orphan.suggestProductId && !picking && (
          <button
            type="button"
            className="btn btn-ghost btn-xs map-suggest"
            disabled={busy}
            onClick={() => onAdopt(orphan, { mode: 'link', productId: orphan.suggestProductId })}
            title="Barkod eşleşmesi"
          >
            <Icon.Link width="12" height="12" /> Öneri: {orphan.suggestProductName}
          </button>
        )}
        {!picking ? (
          <>
            <button type="button" className="btn btn-primary btn-xs" disabled={busy}
              onClick={() => onAdopt(orphan, { mode: 'create' })}>
              {busy ? '…' : 'Yeni iç ürün'}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => setPicking(true)}>
              Bağla…
            </button>
          </>
        ) : (
          <LinkPicker
            products={products}
            busy={busy}
            onCancel={() => setPicking(false)}
            onPick={(productId) => { setPicking(false); onAdopt(orphan, { mode: 'link', productId }); }}
          />
        )}
      </div>
    </div>
  );
}

// ─── İç ürün satırı (kanal durumu) ──────────────────────────────────────────
function InternalRow({ row, onAddHb, onUnlink, busyKey }) {
  const [addingHb, setAddingHb] = React.useState(false);
  const [sku, setSku] = React.useState('');
  const [price, setPrice] = React.useState('');

  function submitHb() {
    if (!sku.trim()) return;
    onAddHb(row.id, sku.trim(), price.trim() === '' ? null : Number(price));
    setAddingHb(false); setSku(''); setPrice('');
  }

  return (
    <tr>
      <td className="prod-td">
        <div className="map-prodname">{row.name}</div>
        <div className="map-sub prod-td-mono">{row.barcode || '—'} · {fmtTL(row.price)}</div>
      </td>
      <td className="prod-td">
        {row.trendyol ? (
          <div className="map-cell">
            <span className="prod-td-mono">{row.trendyol.externalId}</span>
            <span className={'map-badge ' + (row.trendyol.isListed ? 'is-on' : 'is-off')}>
              {row.trendyol.isListed ? 'listeli' : 'pasif'}
            </span>
            {row.trendyol.snapshot && <span className="map-sub">stok {row.trendyol.snapshot.quantity ?? '—'} · {fmtTL(row.trendyol.snapshot.sale_price)}</span>}
            <button type="button" className="iconbtn" title="Bağı kaldır" disabled={busyKey === `ty-${row.id}`}
              onClick={() => onUnlink(row.trendyol.listingId, `ty-${row.id}`)}>
              <Icon.Trash width="12" height="12" />
            </button>
          </div>
        ) : <span className="map-muted">—</span>}
      </td>
      <td className="prod-td">
        {row.hepsiburada ? (
          <div className="map-cell">
            <span className="prod-td-mono">{row.hepsiburada.externalId}</span>
            {row.hepsiburada.channelPrice && <span className="map-sub">{fmtTL(row.hepsiburada.channelPrice)}</span>}
            <button type="button" className="iconbtn" title="Bağı kaldır" disabled={busyKey === `hb-${row.id}`}
              onClick={() => onUnlink(row.hepsiburada.listingId, `hb-${row.id}`)}>
              <Icon.Trash width="12" height="12" />
            </button>
          </div>
        ) : addingHb ? (
          <div className="map-hb-add" onClick={e => e.stopPropagation()}>
            <input className="prod-modal-input" placeholder="merchantSku" value={sku} onChange={e => setSku(e.target.value)} />
            <input className="prod-modal-input map-hb-price" type="number" step="0.01" placeholder="₺" value={price} onChange={e => setPrice(e.target.value)} />
            <button type="button" className="btn btn-ghost btn-xs" onClick={submitHb} disabled={busyKey === `hb-${row.id}`}>Ekle</button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAddingHb(false)}>×</button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAddingHb(true)}>+ HB ekle</button>
        )}
      </td>
    </tr>
  );
}

export function MappingPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState('orphans');
  const [q, setQ] = React.useState('');
  const [syncing, setSyncing] = React.useState(false);
  const [automatching, setAutomatching] = React.useState(false);
  const [busyId, setBusyId] = React.useState(null);  // orphan adopt
  const [busyKey, setBusyKey] = React.useState(null); // listing unlink/hb add
  const [feedback, setFeedback] = React.useState(null);

  const overviewQuery = useQuery({
    queryKey: ['mapping'],
    queryFn: getMappingOverview,
    staleTime: 30 * 1000,
  });

  const data = overviewQuery.data;
  const products = data?.products ?? [];
  const orphans = data?.orphanTrendyol ?? [];
  const summary = data?.summary;

  function refetch() { queryClient.invalidateQueries({ queryKey: ['mapping'] }); }

  async function handleSync() {
    setSyncing(true); setFeedback(null);
    try {
      const r = await syncTrendyolProducts();
      setFeedback({ ok: true, msg: `Senkron tamam: ${r.synced} ürün${r.pruned ? `, ${r.pruned} eski kayıt temizlendi` : ''}.` });
      refetch();
    } catch (e) {
      setFeedback({ ok: false, msg: e.message || 'Senkron başarısız.' });
    } finally {
      setSyncing(false);
    }
  }

  async function handleAutoMatch() {
    setAutomatching(true); setFeedback(null);
    try {
      const r = await autoMatchByBarcode();
      setFeedback({
        ok: true,
        msg: r.matched > 0
          ? `Barkodla ${r.matched} ürün otomatik eşlendi.`
          : 'Barkodla eşleşen yeni ürün bulunamadı (eşleşme = iç ürünün barkodu = TY barkodu).',
      });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (e) {
      setFeedback({ ok: false, msg: e.message || 'Otomatik eşleme başarısız.' });
    } finally {
      setAutomatching(false);
    }
  }

  async function handleAdopt(orphan, opts) {
    setBusyId(orphan.channelProductId); setFeedback(null);
    try {
      const r = await adoptChannelProduct({ channelProductId: orphan.channelProductId, mode: opts.mode, productId: opts.productId });
      setFeedback({ ok: true, msg: r.created ? `Yeni iç ürün oluşturuldu ve bağlandı.` : `Mevcut ürüne bağlandı.` });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (e) {
      setFeedback({ ok: false, msg: e.message || 'Eşleştirme yapılamadı.' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddHb(productId, sku, price) {
    setBusyKey(`hb-${productId}`); setFeedback(null);
    try {
      await createProductChannel(productId, { channel: 'hepsiburada', externalId: sku, channelPrice: price, isListed: true });
      refetch();
    } catch (e) {
      setFeedback({ ok: false, msg: e.message || 'HB eklenemedi.' });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUnlink(listingId, key) {
    setBusyKey(key); setFeedback(null);
    try {
      await deleteChannelListing(listingId);
      refetch();
    } catch (e) {
      setFeedback({ ok: false, msg: e.message || 'Bağ kaldırılamadı.' });
    } finally {
      setBusyKey(null);
    }
  }

  const nq = q.trim().toLocaleLowerCase('tr-TR');
  const filteredOrphans = nq
    ? orphans.filter(o => (o.title || '').toLocaleLowerCase('tr-TR').includes(nq) || (o.externalId || '').toLocaleLowerCase('tr-TR').includes(nq))
    : orphans;
  const filteredProducts = nq
    ? products.filter(p => (p.name || '').toLocaleLowerCase('tr-TR').includes(nq) || (p.barcode || '').toLocaleLowerCase('tr-TR').includes(nq))
    : products;

  return (
    <div className="page map-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Eşleştirme</h1>
          <p className="page-sub">
            Trendyol / Hepsiburada ürünlerini iç katalogla eşleştir. Senkron salt-okunurdur; kanala hiçbir şey yazılmaz.
          </p>
        </div>
        <div className="map-head-actions">
          <span className="map-synced">Son senkron: {fmtWhen(summary?.snapshotSyncedAt)}</span>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
            <Icon.Repeat width="14" height="14" /> {syncing ? 'Senkronlanıyor…' : 'Trendyol senkronla'}
          </button>
        </div>
      </div>

      {summary && (
        <div className="map-summary">
          <span><strong>{summary.internalProducts}</strong> iç ürün</span>
          <span><strong>{summary.trendyolMapped}</strong> TY eşleşik</span>
          <span><strong>{summary.hepsiburadaMapped}</strong> HB eşleşik</span>
          <span className={summary.orphanTrendyol ? 'is-warn' : ''}><strong>{summary.orphanTrendyol}</strong> eşleşmeyen TY</span>
        </div>
      )}

      {feedback && (
        <div className={'stg-feedback ' + (feedback.ok ? 'stg-feedback-ok' : 'stg-feedback-err')} style={{ marginBottom: 12 }}>
          {feedback.msg}
        </div>
      )}

      <div className="map-tabs">
        <button className={'map-tab' + (tab === 'orphans' ? ' is-active' : '')} onClick={() => setTab('orphans')}>
          Eşleşmeyen Trendyol ({orphans.length})
        </button>
        <button className={'map-tab' + (tab === 'internal' ? ' is-active' : '')} onClick={() => setTab('internal')}>
          İç ürünler ({products.length})
        </button>
      </div>

      <div className="map-toolbar">
        <div className="map-search">
          <Icon.Search width="15" height="15" />
          <input placeholder="Ara (ad / barkod)…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={handleAutoMatch} disabled={automatching || syncing}>
          <Icon.Link width="14" height="14" /> {automatching ? 'Eşleniyor…' : 'Barkodla otomatik eşle'}
        </button>
      </div>

      {overviewQuery.isLoading && <div className="stu-state-msg">Yükleniyor…</div>}
      {overviewQuery.isError && <div className="stg-feedback stg-feedback-err">{overviewQuery.error?.message || 'Veri alınamadı.'}</div>}

      {!overviewQuery.isLoading && tab === 'orphans' && (
        orphans.length === 0 ? (
          <div className="stu-state-msg">
            Eşleşmeyen Trendyol ürünü yok. {summary?.snapshotSyncedAt ? 'Hepsi eşleşik 🎉' : 'Önce "Trendyol senkronla" ile ürünleri çek.'}
          </div>
        ) : (
          <div className="map-orphan-list">
            {filteredOrphans.map(o => (
              <OrphanCard key={o.channelProductId} orphan={o} products={products} onAdopt={handleAdopt} busyId={busyId} />
            ))}
            {filteredOrphans.length === 0 && <div className="stu-state-msg">Aramayla eşleşen ürün yok.</div>}
          </div>
        )
      )}

      {!overviewQuery.isLoading && tab === 'internal' && (
        <table className="prod-table map-internal-table">
          <thead className="stu-thead">
            <tr>
              <th className="stu-th">İç ürün</th>
              <th className="stu-th">Trendyol</th>
              <th className="stu-th">Hepsiburada</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(row => (
              <InternalRow key={row.id} row={row} onAddHb={handleAddHb} onUnlink={handleUnlink} busyKey={busyKey} />
            ))}
            {filteredProducts.length === 0 && (
              <tr><td className="prod-td" colSpan={3}><div className="map-muted">İç ürün yok.</div></td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

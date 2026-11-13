// Site mağazası — okaliptusyoga.com/magaza'da hangi Trendyol ürünlerinin,
// hangi köşede ve hangi adla görüneceği.
//
// Liste panelin Trendyol snapshot'ından gelir (Eşleştirme'deki "Senkronize et"
// ile aynı veri). Fiyat ve görsel Trendyol'daki ilandır; burada yalnız sitenin
// ayarları değişir: sitede göster/gizle, köşe, sitede görünen ad. Site bu
// listeyi build sırasında okur (bkz. backend site.router.ts).

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSiteProducts, updateSiteProduct, syncTrendyolProducts } from './api';
import { queryKeys } from './hooks/queryKeys';
import { Icon } from './layout';
import './siteStore.css';

export const SITE_CORNERS = [
  { id: 'arinma', label: 'Arınma' },
  { id: 'meditasyon', label: 'Meditasyon köşesi' },
  { id: 'taslar', label: 'Doğal taşlar' },
  { id: 'pratik', label: 'Pratiğiniz için' },
];
const cornerLabel = (id) => SITE_CORNERS.find((c) => c.id === id)?.label ?? 'Köşesiz';

function fmtPrice(n) {
  if (n === null || n === undefined) return '—';
  return '₺' + Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}

function fmtWhen(iso) {
  if (!iso) return 'hiç';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Türkçe harf farkını gözetmeyen arama: "tutsu" → "Tütsü".
function fold(s) {
  return String(s ?? '').toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c');
}

export function siteStatus(p) {
  if (!p.sellable) return { onSite: false, note: "Trendyol'da satışta değil" };
  if (p.hidden) return { onSite: false, note: 'Gizli' };
  if (!p.productUrl) return { onSite: false, note: 'İlan linki yok' };
  return { onSite: true, note: p.inStock ? null : 'Stokta yok' };
}

function NameField({ product, disabled, onSave }) {
  const [value, setValue] = React.useState(product.displayName ?? '');
  React.useEffect(() => { setValue(product.displayName ?? ''); }, [product.displayName]);
  function commit() {
    const next = value.trim();
    if (next === (product.displayName ?? '')) return;
    onSave(next);
  }
  return (
    <input
      className="site-name-input"
      value={value}
      maxLength={120}
      disabled={disabled}
      placeholder={product.title}
      aria-label={`${product.title} için sitede görünen ad`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setValue(product.displayName ?? ''); e.currentTarget.blur(); }
      }}
    />
  );
}

function ProductRow({ product, saving, onPatch }) {
  const status = siteStatus(product);
  return (
    <div className={'site-row' + (status.onSite ? '' : ' is-off')}>
      <div className="site-thumb">
        {product.imageUrl
          ? <img src={product.imageUrl} alt="" loading="lazy" />
          : <Icon.Box width="20" height="20" />}
      </div>
      <div className="site-main">
        <NameField product={product} disabled={saving} onSave={(displayName) => onPatch({ displayName })} />
        <div className="site-meta">
          {product.displayName && <span className="site-ty-title">Trendyol: {product.title}</span>}
          {product.variantCount > 1 && <span>{product.variantCount} seçenek</span>}
          {status.note && <span className="site-note">{status.note}</span>}
        </div>
      </div>
      <div className="site-price">
        <span>{fmtPrice(product.price)}{product.fromPrice ? "'den" : ''}</span>
        {product.listPrice && <s>{fmtPrice(product.listPrice)}</s>}
      </div>
      <select
        className="site-corner"
        value={product.corner ?? ''}
        disabled={saving}
        aria-label={`${product.title} köşesi`}
        onChange={(e) => onPatch({ corner: e.target.value || null })}
      >
        <option value="">Otomatik: {cornerLabel(product.autoCorner)}</option>
        {SITE_CORNERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <label className="site-toggle">
        <input
          type="checkbox"
          checked={!product.hidden}
          disabled={saving}
          onChange={(e) => onPatch({ hidden: !e.target.checked })}
        />
        <span>Sitede</span>
      </label>
      {product.productUrl
        ? <a className="iconbtn" href={product.productUrl} target="_blank" rel="noopener noreferrer" aria-label="Trendyol ilanını aç"><Icon.Link width="14" height="14" /></a>
        : <span />}
    </div>
  );
}

export function SiteStorePage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.siteProducts(), queryFn: getSiteProducts, staleTime: 30 * 1000 });
  const [search, setSearch] = React.useState('');
  const [corner, setCorner] = React.useState('all');
  const [saving, setSaving] = React.useState(null);
  const [syncing, setSyncing] = React.useState(false);
  const [error, setError] = React.useState(null);

  const products = query.data?.products ?? [];
  const onSite = products.filter((p) => siteStatus(p).onSite).length;
  const hidden = products.filter((p) => p.hidden).length;
  const notSelling = products.filter((p) => !p.sellable).length;

  const words = fold(search).split(/\s+/).filter(Boolean);
  const shown = products.filter((p) => {
    if (corner === 'none' ? p.effectiveCorner !== null : corner !== 'all' && p.effectiveCorner !== corner) return false;
    const hay = fold(`${p.name} ${p.title}`);
    return words.every((w) => hay.includes(w));
  });

  async function patch(product, change) {
    setSaving(product.key);
    setError(null);
    try {
      const updated = await updateSiteProduct(product.key, change);
      queryClient.setQueryData(queryKeys.siteProducts(), (old) => old && {
        ...old,
        products: old.products.map((p) => (p.key === updated.key ? updated : p)),
      });
    } catch (e) {
      setError(e.message || 'Kaydedilemedi.');
    } finally {
      setSaving(null);
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      await syncTrendyolProducts();
      await queryClient.invalidateQueries({ queryKey: queryKeys.siteProducts() });
    } catch (e) {
      setError(e.message || "Trendyol'dan yenilenemedi.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="page site-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Site mağazası</h1>
          <div className="page-subtitle">
            okaliptusyoga.com/magaza'da görünen ürünler. Fiyat ve görsel Trendyol'daki ilandan gelir;
            burada hangi ürünün sitede, hangi köşede ve hangi adla görüneceğini seçersiniz.
          </div>
        </div>
        <div className="head-actions">
          <span className="site-synced">Son yenileme: {fmtWhen(query.data?.syncedAt)}</span>
          <button className="btn btn-ghost" onClick={sync} disabled={syncing}>
            <Icon.Repeat width="14" height="14" />
            {syncing ? 'Yenileniyor…' : "Trendyol'dan yenile"}
          </button>
        </div>
      </div>

      <div className="site-summary">
        <span><b>{onSite}</b> ürün sitede</span>
        <span><b>{hidden}</b> gizli</span>
        <span><b>{notSelling}</b> Trendyol'da satışta değil</span>
      </div>

      {error && <div className="site-error" role="alert">{error}</div>}

      <div className="card site-card">
        <div className="site-toolbar">
          <input
            className="site-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ürün ara"
            aria-label="Ürün ara"
          />
          <select className="site-corner" value={corner} onChange={(e) => setCorner(e.target.value)} aria-label="Köşeye göre süz">
            <option value="all">Tüm köşeler</option>
            {SITE_CORNERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            <option value="none">Köşesiz</option>
          </select>
          <span className="site-count">{shown.length} ürün</span>
        </div>

        {query.isLoading && <div className="site-empty">Yükleniyor…</div>}
        {query.isError && <div className="site-empty">{query.error?.message || 'Liste alınamadı.'}</div>}
        {query.isSuccess && products.length === 0 && (
          <div className="site-empty">
            Henüz Trendyol ürünü yok. "Trendyol'dan yenile" ile listeyi çekin.
          </div>
        )}
        {query.isSuccess && products.length > 0 && shown.length === 0 && (
          <div className="site-empty">Aramaya uyan ürün yok.</div>
        )}
        <div className="site-list">
          {shown.map((p) => (
            <ProductRow key={p.key} product={p} saving={saving === p.key} onPatch={(change) => patch(p, change)} />
          ))}
        </div>
      </div>
    </div>
  );
}

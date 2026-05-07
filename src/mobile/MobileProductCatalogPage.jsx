import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  unarchiveProduct,
} from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { Icon } from '../layout';

function ProductThumb({ product, size = 44 }) {
  const fallback = (product.name || '?').trim().charAt(0).toUpperCase();
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt=""
        className="mobile-qsell-thumb"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return (
    <span
      className="mobile-qsell-thumb mobile-qsell-thumb-fallback"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {fallback}
    </span>
  );
}

function ProductEditor({ product, onClose, onSaved }) {
  const isNew = !product;
  const [form, setForm] = React.useState(() => ({
    name: product?.name ?? '',
    price: product ? String(product.price) : '',
    barcode: product?.barcode ?? '',
    imageUrl: product?.image_url ?? '',
    tyListingUrl: product?.ty_listing_url ?? '',
    hbListingUrl: product?.hb_listing_url ?? '',
    notes: product?.notes ?? '',
    parentProductCode: product?.parent_product_code ?? '',
    variantLabel: product?.variant_label ?? '',
    category: product?.category ?? '',
  }));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    const name = form.name.trim();
    const priceNum = parseFloat(form.price);
    if (!name) { setError('Ürün adı zorunlu.'); return; }
    if (!Number.isFinite(priceNum) || priceNum <= 0) { setError('Fiyat sıfırdan büyük olmalı.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name,
        price: priceNum,
        barcode: form.barcode.trim() || null,
        imageUrl: form.imageUrl.trim() || null,
        tyListingUrl: form.tyListingUrl.trim() || null,
        hbListingUrl: form.hbListingUrl.trim() || null,
        notes: form.notes.trim() || null,
        parentProductCode: form.parentProductCode.trim() || null,
        variantLabel: form.variantLabel.trim() || null,
        category: form.category.trim() || null,
      };
      if (isNew) {
        await createProduct(payload);
      } else {
        await updateProduct(product.id, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Kaydedilemedi.');
      setSubmitting(false);
    }
  }

  async function handleArchive() {
    if (!product) return;
    setSubmitting(true);
    setError(null);
    try {
      if (product.archived_at) {
        await unarchiveProduct(product.id);
      } else {
        await archiveProduct(product.id);
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'İşlem yapılamadı.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mobile-csheet-overlay" onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}>
      <div className="mobile-csheet-content" style={{ position: 'relative', maxWidth: 480, margin: '40px auto' }}>
        <div className="mobile-csheet-form">
          <header className="mobile-csheet-header">
            <h2 className="mobile-csheet-title">{isNew ? 'Yeni ürün' : 'Ürünü düzenle'}</h2>
          </header>
          <div className="mobile-csheet-body">
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Ad</label>
              <input className="mobile-csheet-input" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Fiyat (₺)</label>
              <input
                className="mobile-csheet-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={form.price}
                onChange={e => set('price', e.target.value)}
              />
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Barkod (opsiyonel)</label>
              <input className="mobile-csheet-input" value={form.barcode} onChange={e => set('barcode', e.target.value)} />
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Görsel URL</label>
              <input
                className="mobile-csheet-input"
                value={form.imageUrl}
                onChange={e => set('imageUrl', e.target.value)}
                placeholder="https://cdn.dsmcdn.com/..."
              />
              {form.imageUrl && (
                <img src={form.imageUrl} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, marginTop: 6 }} />
              )}
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Trendyol linki (opsiyonel)</label>
              <input className="mobile-csheet-input" value={form.tyListingUrl} onChange={e => set('tyListingUrl', e.target.value)} />
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Hepsiburada linki (opsiyonel)</label>
              <input className="mobile-csheet-input" value={form.hbListingUrl} onChange={e => set('hbListingUrl', e.target.value)} />
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Kategori (opsiyonel)</label>
              <input
                className="mobile-csheet-input"
                value={form.category}
                onChange={e => set('category', e.target.value)}
                placeholder="ör. Tütsü ve Buhurdanlık"
              />
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Model Kodu (opsiyonel)</label>
              <input
                className="mobile-csheet-input"
                value={form.parentProductCode}
                onChange={e => set('parentProductCode', e.target.value)}
                placeholder="ör. OKY-BUH"
              />
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Varyant etiketi (opsiyonel)</label>
              <input
                className="mobile-csheet-input"
                value={form.variantLabel}
                onChange={e => set('variantLabel', e.target.value)}
                placeholder="ör. Mavi, 80x28"
              />
            </div>
            <div className="mobile-csheet-form-row">
              <label className="mobile-csheet-label">Not (opsiyonel)</label>
              <input className="mobile-csheet-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="İç açıklama" />
            </div>
            {error && <div className="mobile-csheet-error" role="alert">{error}</div>}
          </div>
          <footer className="mobile-csheet-actions">
            <button type="button" className="mobile-csheet-btn-ghost" onClick={onClose} disabled={submitting}>Vazgeç</button>
            {!isNew && (
              <button type="button" className="mobile-csheet-btn-ghost" onClick={handleArchive} disabled={submitting}>
                {product.archived_at ? 'Arşivden çıkar' : 'Arşivle'}
              </button>
            )}
            <button type="button" className="mobile-csheet-btn-primary" onClick={handleSave} disabled={submitting}>
              {submitting ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

export function MobileProductCatalogPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [editing, setEditing] = React.useState(null); // null | 'new' | productObject

  const queryParams = { search: search.trim() || undefined, includeArchived };
  const productsQuery = useQuery({
    queryKey: queryKeys.products(queryParams),
    queryFn: () => getProducts(queryParams),
    staleTime: 30 * 1000,
  });

  const products = productsQuery.data ?? [];

  function handleSaved() {
    setEditing(null);
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  return (
    <div className="mobile-products-page">
      <div className="mobile-products-toolbar">
        <input
          type="search"
          className="mobile-csheet-input mobile-products-search"
          placeholder="Ad veya barkod ara"
          value={search}
          onChange={e => setSearch(e.target.value)}
          inputMode="search"
          autoComplete="off"
        />
        <button
          type="button"
          className="mobile-csheet-btn-primary"
          onClick={() => setEditing('new')}
          aria-label="Yeni ürün"
        >
          <Icon.Plus width="18" height="18" />
        </button>
      </div>

      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--text-muted, #666)' }}>
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={e => setIncludeArchived(e.target.checked)}
        />
        Arşivlenenleri göster
      </label>

      {productsQuery.isLoading && (
        <div className="mobile-products-empty">Yükleniyor…</div>
      )}
      {productsQuery.error && (
        <div className="mobile-csheet-error" role="alert">
          {productsQuery.error.message || 'Ürünler alınamadı.'}
        </div>
      )}
      {!productsQuery.isLoading && !productsQuery.error && products.length === 0 && (
        <div className="mobile-products-empty">
          Henüz ürün yok. Sağ üstten yeni ürün ekleyebilirsin.
        </div>
      )}

      <div className="mobile-products-list" role="list">
        {products.map(p => (
          <button
            key={p.id}
            type="button"
            role="listitem"
            className={'mobile-products-row' + (p.archived_at ? ' is-archived' : '')}
            onClick={() => setEditing(p)}
          >
            <ProductThumb product={p} />
            <div className="mobile-products-row-main">
              <span className="mobile-products-row-name">{p.name}</span>
              <span className="mobile-products-row-meta">
                {fmtTL(p.price)}
                {p.variant_label ? ` · ${p.variant_label}` : ''}
                {p.archived_at ? ' · Arşivli' : ''}
              </span>
              {(p.category || p.parent_product_code) && (
                <span className="mobile-products-row-tags">
                  {p.category && <span className="mobile-products-cat">{p.category}</span>}
                  {p.parent_product_code && (
                    <span className="mobile-products-mc">{p.parent_product_code}</span>
                  )}
                </span>
              )}
            </div>
            <Icon.ChevronR width="16" height="16" />
          </button>
        ))}
      </div>

      {editing !== null && (
        <ProductEditor
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

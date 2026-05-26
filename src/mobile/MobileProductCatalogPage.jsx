import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  unarchiveProduct,
  uploadProductImage,
  removeProductImage,
} from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { Icon } from '../layout';
import { compressToSquareWebp } from '../imageCompress';

function ProductThumb({ product, size = 44 }) {
  const fallback = (product.name || '?').trim().charAt(0).toUpperCase();
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt=""
        className="mobile-psale-thumb"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return (
    <span
      className="mobile-psale-thumb mobile-psale-thumb-fallback"
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

  // Görsel: çekilen foto kaydedilene kadar staging'de bekler. cleared = mevcut
  // görseli kaldırma niyeti (kaydet'te uygulanır).
  const [stagedBlob, setStagedBlob] = React.useState(null);
  const [stagedPreview, setStagedPreview] = React.useState(null);
  const [cleared, setCleared] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const fileInputRef = React.useRef(null);

  React.useEffect(() => {
    // Object URL bellek temizliği.
    return () => { if (stagedPreview) URL.revokeObjectURL(stagedPreview); };
  }, [stagedPreview]);

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handlePickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // aynı dosya tekrar seçilebilsin
    if (!file) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const blob = await compressToSquareWebp(file, { size: 800, quality: 0.75 });
      setStagedPreview(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
      setStagedBlob(blob);
      setCleared(false);
    } catch (err) {
      setError(err.message || 'Görsel işlenemedi.');
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleRemovePhoto() {
    if (stagedBlob) {
      // Yeni çekilen fotoğrafı geri al → mevcut görsele dön.
      setStagedPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      setStagedBlob(null);
      return;
    }
    // Mevcut (kayıtlı) görseli kaldır.
    setCleared(true);
    set('imageUrl', '');
  }

  const shownImage = stagedPreview
    ? stagedPreview
    : (!cleared && form.imageUrl ? form.imageUrl : null);
  const hasRemovable = !!stagedBlob || (!cleared && !!form.imageUrl);

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
        imageUrl: cleared ? null : (form.imageUrl.trim() || null),
        tyListingUrl: form.tyListingUrl.trim() || null,
        hbListingUrl: form.hbListingUrl.trim() || null,
        notes: form.notes.trim() || null,
        parentProductCode: form.parentProductCode.trim() || null,
        variantLabel: form.variantLabel.trim() || null,
        category: form.category.trim() || null,
      };
      const saved = isNew ? await createProduct(payload) : await updateProduct(product.id, payload);
      const savedId = saved?.id ?? product?.id;

      // Görsel işlemleri ürün kaydedildikten sonra (yeni üründe id gerekli).
      if (stagedBlob && savedId) {
        await uploadProductImage(savedId, stagedBlob);
      } else if (cleared && !isNew && savedId) {
        // Yüklenmiş foto (bizim endpoint'imize işaret eden) varsa bytes'ı da sil.
        const wasOurUpload = (product?.image_url || '').includes(`/products/${savedId}/image`);
        if (wasOurUpload) await removeProductImage(savedId);
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
              <label className="mobile-csheet-label">Görsel</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 96, height: 96, borderRadius: 12, flexShrink: 0, overflow: 'hidden',
                    background: 'var(--bg-2, #f2f2f2)', border: '1px solid var(--line, #e5e5e5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {shownImage ? (
                    <img
                      src={shownImage}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <Icon.Tag width="24" height="24" />
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePickPhoto}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="mobile-csheet-btn-primary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={photoBusy || submitting}
                  >
                    {photoBusy ? 'İşleniyor…' : (shownImage ? '📷 Fotoğrafı değiştir' : '📷 Fotoğraf çek')}
                  </button>
                  {hasRemovable && (
                    <button
                      type="button"
                      className="mobile-csheet-btn-ghost"
                      onClick={handleRemovePhoto}
                      disabled={photoBusy || submitting}
                    >
                      Kaldır
                    </button>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>
                    Telefonla çek; otomatik küçültülüp kaydedilir.
                  </span>
                </div>
              </div>
            </div>

            <details className="mobile-csheet-form-row">
              <summary style={{ fontSize: 13, color: 'var(--text-muted, #888)', cursor: 'pointer' }}>
                veya görsel URL'i yapıştır
              </summary>
              <input
                className="mobile-csheet-input"
                style={{ marginTop: 6 }}
                value={form.imageUrl}
                onChange={e => { set('imageUrl', e.target.value); setCleared(false); }}
                placeholder="https://cdn.dsmcdn.com/..."
              />
            </details>
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

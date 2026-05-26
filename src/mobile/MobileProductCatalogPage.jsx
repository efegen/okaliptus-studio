import React from 'react';
import { Drawer } from 'vaul';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProducts,
  createProduct,
  updateProduct,
  archiveProduct,
  unarchiveProduct,
  deleteProduct,
  uploadProductImage,
  removeProductImage,
} from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { Icon } from '../layout';
import { compressToSquareWebp } from '../imageCompress';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function emptyProductForm(product) {
  return {
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
  };
}

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

function ProductEditor({ open, product, onClose, onSaved }) {
  const isNew = !product;
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);

  const [form, setForm] = React.useState(() => emptyProductForm(product));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // Görsel: seçilen/çekilen foto kaydedilene kadar staging'de bekler. cleared =
  // mevcut görseli kaldırma niyeti (kaydet'te uygulanır).
  const [stagedBlob, setStagedBlob] = React.useState(null);
  const [stagedPreview, setStagedPreview] = React.useState(null);
  const [cleared, setCleared] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const cameraInputRef = React.useRef(null);
  const galleryInputRef = React.useRef(null);

  // Sheet her açılışında forma/görsele yeni kaydı yükle (vaul Drawer mount kalır).
  React.useEffect(() => {
    if (!open) return;
    setForm(emptyProductForm(product));
    setStagedBlob(null);
    setStagedPreview(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setCleared(false);
    setError(null);
    setSubmitting(false);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

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
      // Yeni seçilen fotoğrafı geri al → mevcut görsele dön.
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

  async function handleDelete() {
    if (!product) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteProduct(product.id);
      onSaved();
    } catch (err) {
      setError(err.message || 'Ürün silinemedi.');
      setSubmitting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o && !submitting) onClose(); }}
      dismissible={!submitting}
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-csheet-overlay" />
        <Drawer.Content className="mobile-csheet-content">
          <Drawer.Handle className="mobile-csheet-handle" />
          {open && (
            <div className="mobile-csheet-form">
              <header className="mobile-csheet-header">
                <Drawer.Title className="mobile-csheet-title">{isNew ? 'Yeni ürün' : 'Ürünü düzenle'}</Drawer.Title>
              </header>
              <div className="mobile-csheet-body">
                <div className="mobile-csheet-form-row">
                  <label className="mobile-csheet-label">Ad</label>
                  <input className="mobile-csheet-input" value={form.name} onChange={e => set('name', e.target.value)} />
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
                  <div className="mobile-prod-img-row">
                    <div className="mobile-prod-img-box">
                      {shownImage ? (
                        <img
                          src={shownImage}
                          alt=""
                          onError={e => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <Icon.Tag width="24" height="24" />
                      )}
                    </div>
                    <div className="mobile-prod-img-actions">
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handlePickPhoto}
                        style={{ display: 'none' }}
                      />
                      <input
                        ref={galleryInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePickPhoto}
                        style={{ display: 'none' }}
                      />
                      <button
                        type="button"
                        className="mobile-csheet-btn-primary"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={photoBusy || submitting}
                      >
                        {photoBusy ? 'İşleniyor…' : '📷 Fotoğraf çek'}
                      </button>
                      <button
                        type="button"
                        className="mobile-csheet-btn-ghost"
                        onClick={() => galleryInputRef.current?.click()}
                        disabled={photoBusy || submitting}
                      >
                        🖼 Galeriden seç
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
                    </div>
                  </div>
                </div>

                <details className="mobile-csheet-form-row">
                  <summary className="mobile-prod-url-summary">
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

                {!isNew && (
                  <div className="mobile-prod-manage">
                    <button
                      type="button"
                      className="mobile-csheet-btn-ghost mobile-prod-manage-btn"
                      onClick={handleArchive}
                      disabled={submitting}
                    >
                      {product.archived_at ? 'Arşivden çıkar' : 'Arşivle'}
                    </button>
                    {product.archived_at ? (
                      confirmDelete ? (
                        <div className="mobile-prod-delete-confirm">
                          <span>Bu ürün kalıcı olarak silinsin mi?</span>
                          <div className="mobile-prod-delete-confirm-row">
                            <button type="button" className="mobile-prod-delete-yes" onClick={handleDelete} disabled={submitting}>
                              {submitting ? 'Siliniyor…' : 'Evet, sil'}
                            </button>
                            <button type="button" className="mobile-csheet-btn-ghost mobile-prod-manage-btn" onClick={() => setConfirmDelete(false)} disabled={submitting}>
                              Vazgeç
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mobile-prod-delete-trigger"
                          onClick={() => setConfirmDelete(true)}
                          disabled={submitting}
                        >
                          🗑 Ürünü kalıcı sil
                        </button>
                      )
                    ) : (
                      <span className="mobile-prod-manage-hint">Silmek için önce ürünü arşivleyin.</span>
                    )}
                  </div>
                )}

                {error && <div className="mobile-csheet-error" role="alert">{error}</div>}
              </div>
              <footer className="mobile-csheet-actions">
                <button type="button" className="mobile-csheet-btn-ghost" onClick={onClose} disabled={submitting}>Vazgeç</button>
                <button type="button" className="mobile-csheet-btn-primary" onClick={handleSave} disabled={submitting}>
                  {submitting ? 'Kaydediliyor…' : 'Kaydet'}
                </button>
              </footer>
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

const STATUS_FILTERS = [
  { key: 'active', label: 'Aktif' },
  { key: 'archived', label: 'Arşivli' },
  { key: 'all', label: 'Tümü' },
];

function statusMatch(product, status) {
  if (status === 'active') return !product.archived_at;
  if (status === 'archived') return !!product.archived_at;
  return true;
}

export function MobileProductCatalogPage({ createNonce = 0 }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('active');
  const [category, setCategory] = React.useState(''); // '' = tüm kategoriler
  const [editing, setEditing] = React.useState(null); // null | 'new' | productObject

  // Tek seferde tüm katalog (arşiv dahil) çekilir; arama/durum/kategori filtresi
  // istemci tarafında uygulanır → filtre değişiminde anında, ağ turu yok. Web
  // products.jsx ile aynı yaklaşım.
  const productsQuery = useQuery({
    queryKey: queryKeys.products({ includeArchived: true }),
    queryFn: () => getProducts({ includeArchived: true }),
    staleTime: 30 * 1000,
  });

  const allProducts = productsQuery.data ?? [];

  // Header'daki "+" basıldığında yeni-ürün editörünü aç. Yalnız nonce gerçekten
  // ARTTIĞINDA tetiklenir; mount'ta (örn. sayfaya geri dönünce) açılmaz.
  const prevNonceRef = React.useRef(createNonce);
  React.useEffect(() => {
    if (createNonce !== prevNonceRef.current) {
      prevNonceRef.current = createNonce;
      if (createNonce > 0) setEditing('new');
    }
  }, [createNonce]);

  const counts = React.useMemo(() => ({
    active: allProducts.filter(p => !p.archived_at).length,
    archived: allProducts.filter(p => !!p.archived_at).length,
    all: allProducts.length,
  }), [allProducts]);

  // Kategoriler aktif durum filtresine göre türetilir (sayımlar görünenle uyumlu).
  const statusFiltered = React.useMemo(
    () => allProducts.filter(p => statusMatch(p, status)),
    [allProducts, status],
  );

  const categories = React.useMemo(() => {
    const map = new Map();
    for (const p of statusFiltered) {
      if (!p.category) continue;
      map.set(p.category, (map.get(p.category) || 0) + 1);
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'));
  }, [statusFiltered]);

  const products = React.useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return statusFiltered.filter(p => {
      if (category && p.category !== category) return false;
      if (!q) return true;
      const hay = [p.name, p.barcode, p.variant_label, p.parent_product_code, p.category]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR');
      return hay.includes(q);
    });
  }, [statusFiltered, category, search]);

  function handleSaved() {
    setEditing(null);
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  const isEmpty = !productsQuery.isLoading && !productsQuery.error && products.length === 0;

  return (
    <div className="mobile-products-page">
      <div className="mobile-prodbar-search">
        <Icon.Search width="18" height="18" />
        <input
          type="search"
          placeholder="Ürün veya barkod ara"
          value={search}
          onChange={e => setSearch(e.target.value)}
          inputMode="search"
          autoComplete="off"
        />
        {search && (
          <button
            type="button"
            className="mobile-prodbar-clear"
            onClick={() => setSearch('')}
            aria-label="Aramayı temizle"
          >
            <Icon.Plus width="16" height="16" style={{ transform: 'rotate(45deg)' }} />
          </button>
        )}
      </div>

      <div className="mobile-prod-segment" role="tablist" aria-label="Durum filtresi">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={status === f.key}
            className={'mobile-prod-segment-btn' + (status === f.key ? ' is-on' : '')}
            onClick={() => setStatus(f.key)}
          >
            <span>{f.label}</span>
            <span className="mobile-prod-segment-count">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="mobile-prod-cats" role="group" aria-label="Kategori filtresi">
          <button
            type="button"
            className={'mobile-prod-cat-chip' + (!category ? ' is-on' : '')}
            onClick={() => setCategory('')}
          >
            Tümü
          </button>
          {categories.map(c => (
            <button
              key={c.name}
              type="button"
              className={'mobile-prod-cat-chip' + (category === c.name ? ' is-on' : '')}
              onClick={() => setCategory(prev => (prev === c.name ? '' : c.name))}
            >
              {c.name}
              <span className="mobile-prod-cat-count">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {productsQuery.isLoading && (
        <div className="mobile-products-empty">Yükleniyor…</div>
      )}
      {productsQuery.error && (
        <div className="mobile-csheet-error" role="alert">
          {productsQuery.error.message || 'Ürünler alınamadı.'}
        </div>
      )}
      {isEmpty && (
        <div className="mobile-products-empty">
          {allProducts.length === 0
            ? 'Henüz ürün yok. Sağ üstteki + ile ekleyebilirsin.'
            : 'Bu filtreyle eşleşen ürün yok.'}
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

      <ProductEditor
        open={editing !== null}
        product={editing && editing !== 'new' ? editing : null}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
    </div>
  );
}

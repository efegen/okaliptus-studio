import React from 'react';
import { Drawer } from 'vaul';
import { useQuery } from '@tanstack/react-query';
import { getStudents, getProducts, createProductSaleApi } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { MobileStudentCombobox } from './shared/MobileStudentCombobox';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function FormRow({ label, children, hint }) {
  return (
    <div className="mobile-csheet-form-row">
      <label className="mobile-csheet-label">{label}</label>
      {children}
      {hint && <span className="mobile-qadd-hint">{hint}</span>}
    </div>
  );
}

function ProductThumb({ product, size = 56 }) {
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

export function MobileQuickSellSheet({ open, onClose, onCompleted, preselectedStudent = null }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);

  const studentsQuery = useQuery({
    queryKey: queryKeys.students(),
    queryFn: getStudents,
    staleTime: 2 * 60 * 1000,
    enabled: open && !preselectedStudent,
  });

  const productsQuery = useQuery({
    queryKey: queryKeys.products(),
    queryFn: () => getProducts(),
    staleTime: 60 * 1000,
    enabled: open,
  });

  const [phase, setPhase] = React.useState(preselectedStudent ? 'pickProducts' : 'pickStudent');
  const [selectedStudent, setSelectedStudent] = React.useState(preselectedStudent);
  // cart: Map<productId, { product, quantity }>
  const [cart, setCart] = React.useState(() => new Map());
  const [search, setSearch] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  function reset() {
    setPhase(preselectedStudent ? 'pickProducts' : 'pickStudent');
    setSelectedStudent(preselectedStudent);
    setCart(new Map());
    setSearch('');
    setActiveCategory(null);
    setNote('');
    setSubmitting(false);
    setError(null);
  }

  React.useEffect(() => {
    if (!open) reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedStudent]);

  const products = productsQuery.data ?? [];

  // Aktif ürünlerden kategori chip listesi türet (ürün sayımıyla).
  const categoryChips = React.useMemo(() => {
    const counts = new Map();
    for (const p of products) {
      if (!p.category) continue;
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category, 'tr-TR'));
  }, [products]);

  const filteredProducts = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p => {
      if (activeCategory && p.category !== activeCategory) return false;
      if (!q) return true;
      const name = (p.name || '').toLowerCase();
      const barcode = (p.barcode || '').toLowerCase();
      const variant = (p.variant_label || '').toLowerCase();
      const parent = (p.parent_product_code || '').toLowerCase();
      return (
        name.includes(q) ||
        barcode.includes(q) ||
        variant.includes(q) ||
        parent.includes(q)
      );
    });
  }, [products, search, activeCategory]);

  const cartItems = React.useMemo(() => Array.from(cart.values()), [cart]);
  const cartCount = cartItems.reduce((acc, it) => acc + it.quantity, 0);
  const cartTotal = cartItems.reduce(
    (acc, it) => acc + Number(it.product.price) * it.quantity,
    0,
  );

  function addToCart(product) {
    setCart(prev => {
      const next = new Map(prev);
      const existing = next.get(product.id);
      if (existing) {
        next.set(product.id, { product, quantity: existing.quantity + 1 });
      } else {
        next.set(product.id, { product, quantity: 1 });
      }
      return next;
    });
  }

  function setCartQuantity(productId, quantity) {
    setCart(prev => {
      const next = new Map(prev);
      if (quantity <= 0) {
        next.delete(productId);
      } else {
        const existing = next.get(productId);
        if (existing) next.set(productId, { ...existing, quantity });
      }
      return next;
    });
  }

  function handleSelectStudent(s) {
    setSelectedStudent(s);
    setPhase('pickProducts');
  }

  function handleClearStudent() {
    if (preselectedStudent) {
      onClose();
      return;
    }
    setSelectedStudent(null);
    setPhase('pickStudent');
  }

  async function handleSubmit() {
    if (cartItems.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const items = cartItems.map(it => ({
        productId: Number(it.product.id),
        quantity: it.quantity,
      }));
      await createProductSaleApi({
        studentId: Number(selectedStudent.id),
        soldAt: new Date().toISOString(),
        items,
        note: note.trim() || null,
        lessonId: null,
      });

      const summary = `${cartCount} ürün · ${fmtTL(cartTotal)}`;
      onCompleted(`${summary} kaydedildi`);
    } catch (err) {
      setError(err.message || 'Ürün satışı kaydedilemedi.');
      setSubmitting(false);
    }
  }

  const students = studentsQuery.data ?? [];
  const productsLoading = productsQuery.isLoading;

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
        <Drawer.Content className="mobile-csheet-content mobile-qsell-sheet">
          <Drawer.Handle className="mobile-csheet-handle" />
          <div className="mobile-csheet-form">
            <header className="mobile-csheet-header">
              <Drawer.Title className="mobile-csheet-title">Ürün satışı</Drawer.Title>
              <div className="mobile-csheet-meta">
                {phase === 'pickStudent' && 'Önce öğrenciyi seç'}
                {phase === 'pickProducts' && (selectedStudent?.full_name || '')}
                {phase === 'review' && (selectedStudent?.full_name || '')}
              </div>
            </header>

            <div className="mobile-csheet-body">
              {phase === 'pickStudent' && (
                <FormRow label="Öğrenci">
                  <MobileStudentCombobox
                    students={students}
                    selected={null}
                    onSelect={handleSelectStudent}
                    onClear={() => {}}
                    loading={studentsQuery.isLoading}
                    autoFocus
                  />
                </FormRow>
              )}

              {phase === 'pickProducts' && selectedStudent && (
                <>
                  <FormRow label="Öğrenci">
                    <MobileStudentCombobox
                      students={students}
                      selected={selectedStudent}
                      onSelect={() => {}}
                      onClear={handleClearStudent}
                      loading={false}
                    />
                  </FormRow>

                  <FormRow label="Ürün ara">
                    <input
                      type="search"
                      className="mobile-csheet-input"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Ad, barkod, model kodu, varyant"
                      inputMode="search"
                      autoComplete="off"
                    />
                  </FormRow>

                  {categoryChips.length > 0 && (
                    <div className="mobile-qsell-cats" role="tablist" aria-label="Kategori filtresi">
                      <button
                        type="button"
                        role="tab"
                        className={'mobile-qsell-cat-chip' + (activeCategory === null ? ' is-active' : '')}
                        onClick={() => setActiveCategory(null)}
                        aria-pressed={activeCategory === null}
                      >
                        Tümü
                        <span className="mobile-qsell-cat-count">{products.length}</span>
                      </button>
                      {categoryChips.map(c => (
                        <button
                          key={c.category}
                          type="button"
                          role="tab"
                          className={'mobile-qsell-cat-chip' + (activeCategory === c.category ? ' is-active' : '')}
                          onClick={() => setActiveCategory(c.category)}
                          aria-pressed={activeCategory === c.category}
                        >
                          {c.category}
                          <span className="mobile-qsell-cat-count">{c.count}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {productsLoading && (
                    <div className="mobile-qpay-empty">Ürünler yükleniyor…</div>
                  )}
                  {!productsLoading && productsQuery.error && (
                    <div className="mobile-csheet-error" role="alert">
                      {productsQuery.error.message || 'Ürünler alınamadı.'}
                    </div>
                  )}
                  {!productsLoading && !productsQuery.error && products.length === 0 && (
                    <div className="mobile-qpay-empty">
                      Henüz ürün eklenmemiş. Menü → Ürünler'den ekleyebilirsin.
                    </div>
                  )}
                  {!productsLoading && !productsQuery.error && products.length > 0 && filteredProducts.length === 0 && (
                    <div className="mobile-qpay-empty">Eşleşen ürün yok.</div>
                  )}

                  {filteredProducts.length > 0 && (
                    <div className="mobile-qsell-grid" role="list">
                      {filteredProducts.map(p => {
                        const inCart = cart.get(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            role="listitem"
                            className={'mobile-qsell-card' + (inCart ? ' is-incart' : '')}
                            onClick={() => addToCart(p)}
                          >
                            <ProductThumb product={p} />
                            <span className="mobile-qsell-card-body">
                              <span className="mobile-qsell-card-name">{p.name}</span>
                              {p.variant_label && (
                                <span className="mobile-qsell-card-variant">{p.variant_label}</span>
                              )}
                              <span className="mobile-qsell-card-price">{fmtTL(p.price)}</span>
                            </span>
                            {inCart && (
                              <span className="mobile-qsell-card-badge" aria-label={`${inCart.quantity} adet`}>
                                {inCart.quantity}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {phase === 'review' && (
                <>
                  <div className="mobile-qpay-summary">
                    <div className="mobile-qpay-summary-row">
                      <span className="mobile-qpay-summary-label">Öğrenci</span>
                      <span className="mobile-qpay-summary-value">{selectedStudent.full_name}</span>
                    </div>
                  </div>

                  <div className="mobile-qsell-cart">
                    <div className="mobile-csheet-label">Sepet</div>
                    {cartItems.map(it => (
                      <div key={it.product.id} className="mobile-qsell-cart-row">
                        <ProductThumb product={it.product} size={44} />
                        <div className="mobile-qsell-cart-main">
                          <span className="mobile-qsell-cart-name">{it.product.name}</span>
                          {it.product.variant_label && (
                            <span className="mobile-qsell-cart-variant">{it.product.variant_label}</span>
                          )}
                          <span className="mobile-qsell-cart-meta">
                            {fmtTL(it.product.price)} · {fmtTL(Number(it.product.price) * it.quantity)}
                          </span>
                        </div>
                        <div className="mobile-qsell-qty">
                          <button
                            type="button"
                            className="mobile-qsell-qty-btn"
                            onClick={() => setCartQuantity(it.product.id, it.quantity - 1)}
                            aria-label="Azalt"
                          >
                            −
                          </button>
                          <span className="mobile-qsell-qty-val">{it.quantity}</span>
                          <button
                            type="button"
                            className="mobile-qsell-qty-btn"
                            onClick={() => setCartQuantity(it.product.id, it.quantity + 1)}
                            aria-label="Arttır"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="mobile-qsell-cart-total">
                      <span>Toplam</span>
                      <strong>{fmtTL(cartTotal)}</strong>
                    </div>
                  </div>

                  <FormRow label="Not (opsiyonel)">
                    <input
                      type="text"
                      className="mobile-csheet-input"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Açıklama…"
                    />
                  </FormRow>

                  {error && <div className="mobile-csheet-error" role="alert">{error}</div>}
                </>
              )}
            </div>

            {phase === 'pickProducts' && cartItems.length > 0 && (
              <div className="mobile-qsell-stickybar">
                <span className="mobile-qsell-stickybar-meta">
                  {cartCount} ürün · {fmtTL(cartTotal)}
                </span>
                <button
                  type="button"
                  className="mobile-csheet-btn-primary"
                  onClick={() => setPhase('review')}
                >
                  Devam
                </button>
              </div>
            )}

            <footer className="mobile-csheet-actions">
              {phase === 'pickStudent' && (
                <button
                  type="button"
                  className="mobile-csheet-btn-ghost mobile-csheet-btn-full"
                  onClick={onClose}
                >
                  Vazgeç
                </button>
              )}
              {phase === 'pickProducts' && (
                <>
                  <button
                    type="button"
                    className="mobile-csheet-btn-ghost"
                    onClick={onClose}
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    className="mobile-csheet-btn-ghost"
                    onClick={handleClearStudent}
                  >
                    Geri
                  </button>
                </>
              )}
              {phase === 'review' && (
                <>
                  <button
                    type="button"
                    className="mobile-csheet-btn-ghost"
                    onClick={() => setPhase('pickProducts')}
                    disabled={submitting}
                  >
                    Geri
                  </button>
                  <button
                    type="button"
                    className="mobile-csheet-btn-primary"
                    onClick={handleSubmit}
                    disabled={submitting || cartItems.length === 0}
                  >
                    {submitting ? 'Kaydediliyor…' : `Satışı tamamla · ${fmtTL(cartTotal)}`}
                  </button>
                </>
              )}
            </footer>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

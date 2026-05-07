import React from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { getProducts } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { groupByParent } from '../productSale/groupByParent';
import { ProductSaleCard } from './productSale/ProductSaleCard';
import { ProductSaleCategoryChips } from './productSale/ProductSaleCategoryChips';
import { ProductSaleCartBar } from './productSale/ProductSaleCartBar';
import { ProductSaleVariantSheet } from './productSale/ProductSaleVariantSheet';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function ChevronLeftIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CartIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 4h2l2.5 11.5a2 2 0 0 0 2 1.5h7.5a2 2 0 0 0 2-1.6L21 8H6"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}

function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function MobileProductSalePage({ cart, setCart, onOpenCheckout, onClose }) {
  const productsQuery = useQuery({
    queryKey: queryKeys.products(),
    queryFn: () => getProducts(),
    staleTime: 60 * 1000,
  });

  const [search, setSearch] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState(null);
  const [variantGroup, setVariantGroup] = React.useState(null);

  React.useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const products = React.useMemo(
    () => (productsQuery.data ?? []).filter(p => !p.archived_at),
    [productsQuery.data],
  );

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

  const filtered = React.useMemo(() => {
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

  const entries = React.useMemo(() => {
    const grouped = groupByParent(filtered);
    return grouped.sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr-TR'));
  }, [filtered]);

  const cartCount = React.useMemo(
    () => Array.from(cart.values()).reduce((acc, it) => acc + it.quantity, 0),
    [cart],
  );
  const cartTotal = React.useMemo(
    () => Array.from(cart.values()).reduce(
      (acc, it) => acc + Number(it.product.price) * it.quantity,
      0,
    ),
    [cart],
  );

  function entryQty(entry) {
    let total = 0;
    for (const v of entry.variants) {
      const inCart = cart.get(v.id);
      if (inCart) total += inCart.quantity;
    }
    return total;
  }

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

  function setProductQty(product, qty) {
    setCart(prev => {
      const next = new Map(prev);
      if (qty <= 0) {
        next.delete(product.id);
      } else {
        next.set(product.id, { product, quantity: qty });
      }
      return next;
    });
  }

  function applyVariantUpdates(updates) {
    setCart(prev => {
      const next = new Map(prev);
      for (const { product, quantity } of updates) {
        if (quantity <= 0) {
          next.delete(product.id);
        } else {
          next.set(product.id, { product, quantity });
        }
      }
      return next;
    });
  }

  function handleClose() {
    if (cartCount > 0) {
      const ok = typeof window !== 'undefined'
        ? window.confirm('Sepetinde ürün var. Çıkarsan sepet boşalacak. Devam edilsin mi?')
        : true;
      if (!ok) return;
      setCart(new Map());
    }
    onClose();
  }

  const portalRoot = getMobilePaletteRoot();
  const productsLoading = productsQuery.isLoading;
  const productsError = productsQuery.error;

  const content = (
    <div className="mobile-psale-page" role="dialog" aria-modal="true" aria-labelledby="psale-title">
      <header className="mobile-psale-topbar">
        <button
          type="button"
          className="mobile-psale-iconbtn"
          onClick={handleClose}
          aria-label="Geri"
        >
          <ChevronLeftIcon />
        </button>
        <h1 id="psale-title" className="mobile-psale-topbar-title">Ürün satışı</h1>
        <button
          type="button"
          className="mobile-psale-iconbtn mobile-psale-cart-icon"
          onClick={onOpenCheckout}
          disabled={cartCount === 0}
          aria-label={cartCount > 0 ? `Sepeti aç (${cartCount} ürün)` : 'Sepet boş'}
        >
          <CartIcon />
          {cartCount > 0 && (
            <span className="mobile-psale-cart-iconbadge" aria-hidden="true">
              {cartCount}
            </span>
          )}
        </button>
      </header>

      <div className="mobile-psale-toolbar">
        <label className="mobile-psale-search">
          <SearchIcon />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Ürün ara…"
            inputMode="search"
            autoComplete="off"
            aria-label="Ürün ara"
          />
          {search && (
            <button
              type="button"
              className="mobile-psale-search-clear"
              onClick={() => setSearch('')}
              aria-label="Aramayı temizle"
            >
              ×
            </button>
          )}
        </label>
        {categoryChips.length > 0 && (
          <ProductSaleCategoryChips
            chips={categoryChips}
            totalCount={products.length}
            activeCategory={activeCategory}
            onChange={setActiveCategory}
          />
        )}
      </div>

      <div className="mobile-psale-body">
        {productsLoading && (
          <div className="mobile-psale-state">Ürünler yükleniyor…</div>
        )}
        {!productsLoading && productsError && (
          <div className="mobile-psale-error" role="alert">
            {productsError.message || 'Ürünler alınamadı.'}
          </div>
        )}
        {!productsLoading && !productsError && products.length === 0 && (
          <div className="mobile-psale-state">
            Henüz ürün eklenmemiş. Menü → Ürünler'den ekleyebilirsin.
          </div>
        )}
        {!productsLoading && !productsError && products.length > 0 && entries.length === 0 && (
          <div className="mobile-psale-state">Eşleşen ürün yok.</div>
        )}

        {entries.length > 0 && (
          <div className="mobile-psale-grid" role="list">
            {entries.map(entry => (
              <div key={entry.key} role="listitem" className="mobile-psale-grid-cell">
                <ProductSaleCard
                  entry={entry}
                  inCartQty={entryQty(entry)}
                  onAdd={addToCart}
                  onSetQty={setProductQty}
                  onPickVariant={setVariantGroup}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <ProductSaleCartBar
        count={cartCount}
        total={cartTotal}
        onOpen={onOpenCheckout}
      />

      {variantGroup && (
        <ProductSaleVariantSheet
          group={variantGroup}
          cart={cart}
          onClose={() => setVariantGroup(null)}
          onAddVariants={applyVariantUpdates}
        />
      )}
    </div>
  );

  if (!portalRoot) return content;
  return createPortal(content, portalRoot);
}

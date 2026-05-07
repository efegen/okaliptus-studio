import React from 'react';
import { groupByParent } from './groupByParent';
import { ProductSaleCard } from './ProductSaleCard';
import { ProductSaleCategoryChips } from './ProductSaleCategoryChips';

function SearchIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export const ProductCatalogGrid = React.forwardRef(function ProductCatalogGrid({
  products,
  isLoading,
  error,
  cart,
  onAddToCart,
  onSetQty,
  onPickVariant,
  onNavigateToProducts,
}, searchInputRef) {
  const [search, setSearch] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState(null);

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

  function entryQty(entry) {
    let total = 0;
    for (const v of entry.variants) {
      const inCart = cart.get(v.id);
      if (inCart) total += inCart.quantity;
    }
    return total;
  }

  return (
    <div className="psale-catalog">
      <div className="psale-toolbar">
        <label className="psale-search">
          <SearchIcon />
          <input
            ref={searchInputRef}
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
              className="psale-search-clear"
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

      <div className="psale-catalog-body">
        {isLoading && (
          <div className="psale-state">Ürünler yükleniyor…</div>
        )}
        {!isLoading && error && (
          <div className="psale-banner-error" role="alert">
            {error.message || 'Ürünler alınamadı.'}
          </div>
        )}
        {!isLoading && !error && products.length === 0 && (
          <div className="psale-state">
            <p>Henüz ürün eklenmemiş.</p>
            <button type="button" className="btn btn-ghost" onClick={onNavigateToProducts}>
              Ürünler sayfasına git
            </button>
          </div>
        )}
        {!isLoading && !error && products.length > 0 && entries.length === 0 && (
          <div className="psale-state">Eşleşen ürün yok.</div>
        )}

        {entries.length > 0 && (
          <div className="psale-grid" role="list">
            {entries.map(entry => (
              <div key={entry.key} role="listitem">
                <ProductSaleCard
                  entry={entry}
                  inCartQty={entryQty(entry)}
                  onAdd={onAddToCart}
                  onSetQty={onSetQty}
                  onPickVariant={onPickVariant}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

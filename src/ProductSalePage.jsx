import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProducts } from './api';
import { queryKeys } from './hooks/queryKeys';
import { ProductCatalogGrid } from './productSale/ProductCatalogGrid';
import { ProductSaleCartSidebar } from './productSale/ProductSaleCartSidebar';
import { ProductVariantModal } from './productSale/ProductVariantModal';
import { ProductSaleConfirmModal } from './productSale/ProductSaleConfirmModal';

function ChevronLeftIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ProductSalePage({
  cart,
  setCart,
  student,
  setStudent,
  note,
  setNote,
  onClose,
  onCompleted,
  onNavigateToProducts,
}) {
  const [variantGroup, setVariantGroup] = React.useState(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const searchInputRef = React.useRef(null);

  const productsQuery = useQuery({
    queryKey: queryKeys.products(),
    queryFn: () => getProducts(),
    staleTime: 60 * 1000,
  });

  const products = React.useMemo(
    () => (productsQuery.data ?? []).filter(p => !p.archived_at),
    [productsQuery.data],
  );

  React.useEffect(() => {
    if (!variantGroup && !confirmOpen) {
      searchInputRef.current?.focus();
    }
  }, [variantGroup, confirmOpen]);

  React.useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (variantGroup || confirmOpen) return;
      onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [variantGroup, confirmOpen, onClose]);

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

  const cartItems = React.useMemo(() => Array.from(cart.values()), [cart]);
  const cartTotal = cartItems.reduce(
    (sum, it) => sum + Number(it.product.price) * it.quantity,
    0,
  );
  const cartCount = cartItems.reduce((sum, it) => sum + it.quantity, 0);

  function handleSubmit() {
    if (!student) return;
    if (cartItems.length === 0) return;
    setConfirmOpen(true);
  }

  return (
    <div className="psale-page">
      <div className="psale-page-head">
        <button
          type="button"
          className="psale-back btn btn-ghost"
          onClick={onClose}
          aria-label="Geri"
        >
          <ChevronLeftIcon />
          <span>Geri</span>
        </button>
        <h2 className="psale-page-title">Ürün satışı</h2>
      </div>

      <div className="psale-layout">
        <ProductCatalogGrid
          ref={searchInputRef}
          products={products}
          isLoading={productsQuery.isLoading}
          error={productsQuery.error}
          cart={cart}
          onAddToCart={addToCart}
          onSetQty={setProductQty}
          onPickVariant={setVariantGroup}
          onNavigateToProducts={onNavigateToProducts}
        />

        <ProductSaleCartSidebar
          cart={cart}
          setCart={setCart}
          student={student}
          setStudent={setStudent}
          note={note}
          setNote={setNote}
          submitting={false}
          error={null}
          onSubmit={handleSubmit}
        />
      </div>

      {variantGroup && (
        <ProductVariantModal
          group={variantGroup}
          cart={cart}
          onClose={() => setVariantGroup(null)}
          onAddVariants={applyVariantUpdates}
        />
      )}

      {confirmOpen && (
        <ProductSaleConfirmModal
          cart={cart}
          student={student}
          note={note}
          total={cartTotal}
          count={cartCount}
          onClose={() => setConfirmOpen(false)}
          onCompleted={(payload) => {
            setConfirmOpen(false);
            onCompleted(payload);
          }}
        />
      )}
    </div>
  );
}

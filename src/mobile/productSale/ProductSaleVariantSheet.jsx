import React from 'react';
import { Drawer } from 'vaul';
import { fmtTL } from '../../data';
import { ProductSaleThumb } from './ProductSaleCard';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

export function ProductSaleVariantSheet({ group, cart, onClose, onAddVariants }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  // Yerel seçim: Map<variantId, qty>. Mevcut sepet adetleri ile başlat.
  const [picks, setPicks] = React.useState(() => {
    const init = new Map();
    if (!group) return init;
    for (const v of group.variants) {
      const inCart = cart.get(v.id);
      if (inCart) init.set(v.id, inCart.quantity);
    }
    return init;
  });

  React.useEffect(() => {
    if (!group) return;
    const init = new Map();
    for (const v of group.variants) {
      const inCart = cart.get(v.id);
      if (inCart) init.set(v.id, inCart.quantity);
    }
    setPicks(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.key]);

  if (!group) return null;

  function setQty(variantId, qty) {
    setPicks(prev => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(variantId);
      else next.set(variantId, qty);
      return next;
    });
  }

  function handleApply() {
    const updates = group.variants.map(v => ({
      product: v,
      quantity: picks.get(v.id) ?? 0,
    }));
    onAddVariants(updates);
    onClose();
  }

  const totalPicked = Array.from(picks.values()).reduce((a, b) => a + b, 0);
  const totalAmount = group.variants.reduce((acc, v) => {
    const q = picks.get(v.id) ?? 0;
    return acc + Number(v.price) * q;
  }, 0);

  return (
    <Drawer.Root
      open={true}
      onOpenChange={(o) => { if (!o) onClose(); }}
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-psale-vsheet-overlay" />
        <Drawer.Content className="mobile-psale-vsheet-content">
          <Drawer.Handle className="mobile-psale-vsheet-handle" />
          <header className="mobile-psale-vsheet-head">
            <Drawer.Title className="mobile-psale-vsheet-title">
              {group.displayName}
            </Drawer.Title>
            <div className="mobile-psale-vsheet-sub">
              {group.variants.length} varyant · sepet için adet seç
            </div>
          </header>

          <div className="mobile-psale-vsheet-body">
            {group.variants.map(v => {
              const qty = picks.get(v.id) ?? 0;
              return (
                <div key={v.id} className={'mobile-psale-vrow' + (qty > 0 ? ' is-picked' : '')}>
                  <ProductSaleThumb product={v} size={48} />
                  <div className="mobile-psale-vrow-main">
                    <span className="mobile-psale-vrow-name">
                      {v.variant_label || v.name}
                    </span>
                    <span className="mobile-psale-vrow-price">{fmtTL(v.price)}</span>
                  </div>
                  <div className="mobile-psale-qty">
                    <button
                      type="button"
                      className="mobile-psale-qty-btn"
                      onClick={() => setQty(v.id, qty - 1)}
                      aria-label="Adet azalt"
                      disabled={qty <= 0}
                    >
                      −
                    </button>
                    <span className="mobile-psale-qty-val" aria-live="polite">{qty}</span>
                    <button
                      type="button"
                      className="mobile-psale-qty-btn"
                      onClick={() => setQty(v.id, qty + 1)}
                      aria-label="Adet artır"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <footer className="mobile-psale-vsheet-actions">
            <button
              type="button"
              className="mobile-psale-btn-ghost"
              onClick={onClose}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="mobile-psale-btn-primary"
              onClick={handleApply}
            >
              {totalPicked > 0
                ? `Sepete uygula · ${fmtTL(totalAmount)}`
                : 'Sepetten kaldır'}
            </button>
          </footer>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

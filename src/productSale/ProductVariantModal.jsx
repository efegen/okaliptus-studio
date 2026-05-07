import React from 'react';
import { fmtTL } from '../data';
import { ProductSaleThumb } from './ProductSaleCard';

export function ProductVariantModal({ group, cart, onClose, onAddVariants }) {
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

  React.useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal psale-variant-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="psale-variant-title"
      >
        <header className="psale-variant-head">
          <div className="psale-variant-head-row">
            <h3 id="psale-variant-title" className="psale-variant-title">{group.displayName}</h3>
            <button
              type="button"
              className="mcl-close"
              onClick={onClose}
              aria-label="Kapat"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="psale-variant-sub">
            {group.variants.length} varyant · sepet için adet seç
          </div>
        </header>

        <div className="psale-variant-body">
          {group.variants.map(v => {
            const qty = picks.get(v.id) ?? 0;
            return (
              <div key={v.id} className={'psale-variant-row' + (qty > 0 ? ' is-picked' : '')}>
                <ProductSaleThumb product={v} size={48} />
                <div className="psale-variant-row-main">
                  <span className="psale-variant-row-name">
                    {v.variant_label || v.name}
                  </span>
                  <span className="psale-variant-row-price">{fmtTL(v.price)}</span>
                </div>
                <div className="psale-stepper" role="group" aria-label="Adet">
                  <button
                    type="button"
                    className="psale-stepper-btn"
                    onClick={() => setQty(v.id, qty - 1)}
                    aria-label="Adet azalt"
                    disabled={qty <= 0}
                  >
                    −
                  </button>
                  <span className="psale-stepper-val" aria-live="polite">{qty}</span>
                  <button
                    type="button"
                    className="psale-stepper-btn"
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

        <footer className="psale-variant-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Vazgeç
          </button>
          <button type="button" className="btn btn-primary" onClick={handleApply}>
            {totalPicked > 0
              ? `Sepete uygula · ${fmtTL(totalAmount)}`
              : 'Sepetten kaldır'}
          </button>
        </footer>
      </div>
    </div>
  );
}

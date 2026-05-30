import React from 'react';
import { fmtTL } from '../../data';

export function ProductSaleCartBar({ count, total, onOpen }) {
  if (count <= 0) return null;
  return (
    <div className="mobile-psale-cartbar" role="region" aria-label="Sepet özeti">
      <div className="mobile-psale-cartbar-summary">
        <span className="mobile-psale-cartbar-count">{count} ürün</span>
        <span key={total} className="mobile-psale-cartbar-total">{fmtTL(total)}</span>
      </div>
      <button
        type="button"
        className="mobile-psale-cartbar-btn"
        onClick={onOpen}
        aria-label={`Sepete bak (${count} ürün, ${fmtTL(total)})`}
      >
        Sepete Bak
        <span className="mobile-psale-cartbar-arrow" aria-hidden="true">→</span>
      </button>
    </div>
  );
}

import React from 'react';
import { fmtTL } from '../../data';

export function ProductSaleCartBar({ count, total, onOpen }) {
  if (count <= 0) return null;
  return (
    <div className="mobile-psale-cartbar" role="region" aria-label="Sepet özeti">
      <span className="mobile-psale-cartbar-meta">
        <strong>{count}</strong> ürün · {fmtTL(total)}
      </span>
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

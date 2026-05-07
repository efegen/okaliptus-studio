import React from 'react';
import { fmtTL } from '../../data';

export function ProductSaleThumb({ product, size }) {
  const fallback = (product.name || '?').trim().charAt(0).toUpperCase();
  const style = size ? { width: size, height: size } : undefined;
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt=""
        className="mobile-psale-thumb"
        style={style}
        loading="lazy"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return (
    <span
      className="mobile-psale-thumb mobile-psale-thumb-fallback"
      style={style}
      aria-hidden="true"
    >
      {fallback}
    </span>
  );
}

function fmtPriceRange(min, max) {
  if (min === max) return fmtTL(min);
  return `${fmtTL(min)} – ${fmtTL(max)}`;
}

export function ProductSaleCard({ entry, inCartQty, onAdd, onSetQty, onPickVariant }) {
  const product = entry.kind === 'single' ? entry.variants[0] : null;
  const isGroup = entry.kind === 'group';
  const variantCount = entry.variants.length;
  const priceLabel = isGroup
    ? fmtPriceRange(entry.minPrice, entry.maxPrice)
    : fmtTL(product.price);

  const showStepper = !isGroup && inCartQty > 0;

  function handleAdd() {
    if (isGroup) onPickVariant(entry);
    else onAdd(product);
  }

  function handleDec() {
    if (!product || !onSetQty) return;
    onSetQty(product, Math.max(0, inCartQty - 1));
  }

  function handleInc() {
    if (!product || !onSetQty) return;
    onSetQty(product, inCartQty + 1);
  }

  const addLabel = isGroup
    ? (inCartQty > 0 ? `Varyant seç · ${inCartQty}` : 'Varyant seç')
    : 'Sepete ekle';

  const addAria = isGroup
    ? `${entry.displayName}, ${variantCount} varyant — varyant seç`
    : `${entry.displayName}, ${priceLabel} — sepete ekle`;

  return (
    <div className={'mobile-psale-card' + (inCartQty > 0 ? ' is-incart' : '')}>
      <div className="mobile-psale-card-imgwrap">
        <ProductSaleThumb product={isGroup ? entry.variants[0] : product} />
        {inCartQty > 0 && (
          <span className="mobile-psale-card-badge" aria-label={`Sepette ${inCartQty} adet`}>
            {inCartQty}
          </span>
        )}
        {isGroup && (
          <span className="mobile-psale-card-variantchip" aria-hidden="true">
            {variantCount} varyant
          </span>
        )}
      </div>
      <div className="mobile-psale-card-body">
        <span className="mobile-psale-card-name">{entry.displayName}</span>
        {!isGroup && product.variant_label && (
          <span className="mobile-psale-card-variant">{product.variant_label}</span>
        )}
        {entry.category && (
          <span className="mobile-psale-card-cat">{entry.category}</span>
        )}
        <span className="mobile-psale-card-price">{priceLabel}</span>
      </div>
      <div className="mobile-psale-card-footer">
        {showStepper ? (
          <div className="mobile-psale-card-stepper" role="group" aria-label="Adet">
            <button
              type="button"
              className="mobile-psale-card-stepper-btn"
              onClick={handleDec}
              aria-label="Adet azalt"
            >
              −
            </button>
            <span className="mobile-psale-card-stepper-val" aria-live="polite">
              {inCartQty}
            </span>
            <button
              type="button"
              className="mobile-psale-card-stepper-btn"
              onClick={handleInc}
              aria-label="Adet artır"
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mobile-psale-card-btn"
            onClick={handleAdd}
            aria-label={addAria}
          >
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}

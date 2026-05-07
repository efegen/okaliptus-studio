import React from 'react';
import { fmtTL } from '../data';

export function ProductSaleThumb({ product, size }) {
  const fallback = (product.name || '?').trim().charAt(0).toUpperCase();
  const style = size ? { width: size, height: size } : undefined;
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt=""
        className="psale-thumb"
        style={style}
        loading="lazy"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return (
    <span
      className="psale-thumb psale-thumb-fallback"
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
    <div className={'psale-card' + (inCartQty > 0 ? ' is-incart' : '')}>
      <div className="psale-card-imgwrap">
        <ProductSaleThumb product={isGroup ? entry.variants[0] : product} />
        {inCartQty > 0 && (
          <span className="psale-card-badge" aria-label={`Sepette ${inCartQty} adet`}>
            {inCartQty}
          </span>
        )}
        {isGroup && (
          <span className="psale-card-variantchip" aria-hidden="true">
            {variantCount} varyant
          </span>
        )}
      </div>
      <div className="psale-card-body">
        <span className="psale-card-name">{entry.displayName}</span>
        {!isGroup && product.variant_label && (
          <span className="psale-card-variant">{product.variant_label}</span>
        )}
        {entry.category && (
          <span className="psale-card-cat">{entry.category}</span>
        )}
        <span className="psale-card-price">{priceLabel}</span>
      </div>
      <div className="psale-card-footer">
        {showStepper ? (
          <div className="psale-stepper" role="group" aria-label="Adet">
            <button
              type="button"
              className="psale-stepper-btn"
              onClick={handleDec}
              aria-label="Adet azalt"
            >
              −
            </button>
            <span className="psale-stepper-val" aria-live="polite">
              {inCartQty}
            </span>
            <button
              type="button"
              className="psale-stepper-btn"
              onClick={handleInc}
              aria-label="Adet artır"
            >
              +
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="psale-card-btn"
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

import React from 'react';
import { fmtTL } from '../data';
import { ProductSaleThumb } from './ProductSaleCard';
import { ProductSaleStudentCombobox } from './ProductSaleStudentCombobox';

export function ProductSaleCartSidebar({
  cart,
  setCart,
  student,
  setStudent,
  note,
  setNote,
  submitting,
  error,
  onSubmit,
}) {
  const cartItems = React.useMemo(() => Array.from(cart.values()), [cart]);
  const cartCount = cartItems.reduce((acc, it) => acc + it.quantity, 0);
  const cartTotal = cartItems.reduce(
    (acc, it) => acc + Number(it.product.price) * it.quantity,
    0,
  );

  function setQuantity(productId, quantity) {
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

  function removeItem(productId) {
    setCart(prev => {
      const next = new Map(prev);
      next.delete(productId);
      return next;
    });
  }

  const canSubmit = !submitting && !!student && cartItems.length > 0;

  let submitLabel;
  if (submitting) submitLabel = 'Kaydediliyor…';
  else if (cartItems.length === 0) submitLabel = 'Sepete ürün ekleyin';
  else if (!student) submitLabel = 'Müşteri seç';
  else submitLabel = `Satışı tamamla · ${fmtTL(cartTotal)}`;

  return (
    <aside className="psale-cart-sidebar" aria-label="Sepet">
      <div className="psale-cart-section psale-cart-list-section">
        <div className="psale-cart-section-title">
          Sepet {cartCount > 0 ? `· ${cartCount} ürün` : ''}
        </div>
        {cartItems.length === 0 ? (
          <div className="psale-cart-empty">
            Sol taraftan ürün ekleyin.
          </div>
        ) : (
          <div className="psale-cart-list">
            {cartItems.map(it => (
              <div key={it.product.id} className="psale-cart-row">
                <ProductSaleThumb product={it.product} size={40} />
                <div className="psale-cart-row-main">
                  <span className="psale-cart-row-name">
                    {it.product.name}
                    {it.product.variant_label ? ` · ${it.product.variant_label}` : ''}
                  </span>
                  <span className="psale-cart-row-meta">
                    {fmtTL(it.product.price)} · {fmtTL(Number(it.product.price) * it.quantity)}
                  </span>
                </div>
                <div className="psale-cart-row-actions">
                  <div className="psale-stepper" role="group" aria-label="Adet">
                    <button
                      type="button"
                      className="psale-stepper-btn"
                      onClick={() => setQuantity(it.product.id, it.quantity - 1)}
                      aria-label="Adet azalt"
                      disabled={submitting}
                    >
                      −
                    </button>
                    <span className="psale-stepper-val" aria-live="polite">{it.quantity}</span>
                    <button
                      type="button"
                      className="psale-stepper-btn"
                      onClick={() => setQuantity(it.product.id, it.quantity + 1)}
                      aria-label="Adet artır"
                      disabled={submitting}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="psale-cart-row-remove"
                    onClick={() => removeItem(it.product.id)}
                    aria-label={`${it.product.name} sepetten kaldır`}
                    disabled={submitting}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="psale-cart-section">
        <div className="psale-cart-section-title">Müşteri</div>
        <ProductSaleStudentCombobox
          selected={student}
          onSelect={setStudent}
          onClear={() => setStudent(null)}
          disabled={submitting}
        />
      </div>

      <div className="psale-cart-section">
        <div className="psale-cart-section-title">Not (opsiyonel)</div>
        <textarea
          className="psale-cart-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Açıklama, iade, özel istek…"
          maxLength={500}
          disabled={submitting}
          rows={2}
        />
      </div>

      <div className="psale-cart-total">
        <span>Toplam</span>
        <span className="psale-cart-total-val">{fmtTL(cartTotal)}</span>
      </div>

      {error && (
        <div className="psale-banner-error" role="alert">
          {error}
        </div>
      )}

      <button
        type="button"
        className="psale-submit"
        onClick={onSubmit}
        disabled={!canSubmit}
      >
        {submitLabel}
      </button>
    </aside>
  );
}

import React from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { getStudents } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { MobileStudentCombobox } from './shared/MobileStudentCombobox';
import { MobileCreateStudentPage } from './MobileCreateStudentPage';
import { ProductSaleThumb } from './productSale/ProductSaleCard';
import { MobileProductSaleConfirmSheet } from './productSale/MobileProductSaleConfirmSheet';

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

export function MobileProductSaleCheckoutPage({
  cart,
  setCart,
  student,
  setStudent,
  note,
  setNote,
  onBack,
  onCompleted,
}) {
  const studentsQuery = useQuery({
    queryKey: queryKeys.students(),
    queryFn: getStudents,
    staleTime: 2 * 60 * 1000,
    enabled: !student,
  });

  const [showCreateStudent, setShowCreateStudent] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const cartItems = React.useMemo(() => Array.from(cart.values()), [cart]);
  const cartCount = cartItems.reduce((acc, it) => acc + it.quantity, 0);
  const cartTotal = cartItems.reduce(
    (acc, it) => acc + Number(it.product.price) * it.quantity,
    0,
  );

  // Cart boşalırsa otomatik katalog'a dön — kullanıcı tüm satırları silmiş demektir.
  React.useEffect(() => {
    if (cartItems.length === 0 && !confirmOpen) onBack();
  }, [cartItems.length, confirmOpen, onBack]);

  React.useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && !showCreateStudent && !confirmOpen) onBack();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack, showCreateStudent, confirmOpen]);

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

  function handleSubmit() {
    if (!student) return;
    if (cartItems.length === 0) return;
    setConfirmOpen(true);
  }

  function handleStudentCreated(created) {
    setStudent(created);
    setShowCreateStudent(false);
  }

  const canSubmit = !!student && cartItems.length > 0;

  const portalRoot = getMobilePaletteRoot();

  const content = (
    <div className="mobile-psale-page" role="dialog" aria-modal="true" aria-labelledby="psale-co-title">
      <header className="mobile-psale-topbar">
        <button
          type="button"
          className="mobile-psale-iconbtn"
          onClick={onBack}
          disabled={false}
          aria-label="Geri"
        >
          <ChevronLeftIcon />
        </button>
        <h1 id="psale-co-title" className="mobile-psale-topbar-title">Sepet</h1>
        <div />
      </header>

      <div className="mobile-psale-co-body">
        <div className="mobile-psale-co-section">
          <div className="mobile-psale-co-section-title">
            Sepet ({cartCount} ürün)
          </div>
          <div className="mobile-psale-co-cart">
            {cartItems.map(it => (
              <div key={it.product.id} className="mobile-psale-co-row">
                <ProductSaleThumb product={it.product} size={48} />
                <div className="mobile-psale-co-row-main">
                  <span className="mobile-psale-co-row-name">
                    {it.product.name}
                    {it.product.variant_label ? ` · ${it.product.variant_label}` : ''}
                  </span>
                  <span className="mobile-psale-co-row-meta">
                    {fmtTL(it.product.price)} · {fmtTL(Number(it.product.price) * it.quantity)}
                  </span>
                </div>
                <div className="mobile-psale-qty">
                  <button
                    type="button"
                    className="mobile-psale-qty-btn"
                    onClick={() => setQuantity(it.product.id, it.quantity - 1)}
                    aria-label="Adet azalt"
                    disabled={false}
                  >
                    −
                  </button>
                  <span className="mobile-psale-qty-val">{it.quantity}</span>
                  <button
                    type="button"
                    className="mobile-psale-qty-btn"
                    onClick={() => setQuantity(it.product.id, it.quantity + 1)}
                    aria-label="Adet artır"
                    disabled={false}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="mobile-psale-co-row-remove"
                  onClick={() => removeItem(it.product.id)}
                  aria-label={`${it.product.name} sepetten kaldır`}
                  disabled={false}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mobile-psale-co-section">
          <div className="mobile-psale-co-section-title">Müşteri</div>
          <div className="mobile-psale-co-card">
            <MobileStudentCombobox
              students={studentsQuery.data ?? []}
              selected={student}
              onSelect={setStudent}
              onClear={() => setStudent(null)}
              loading={studentsQuery.isLoading}
              autoFocus={!student}
            />
            {!student && (
              <button
                type="button"
                className="mobile-psale-co-newstudent"
                onClick={() => setShowCreateStudent(true)}
                disabled={false}
              >
                + Yeni öğrenci ekle
              </button>
            )}
          </div>
        </div>

        <div className="mobile-psale-co-section">
          <div className="mobile-psale-co-section-title">Not (opsiyonel)</div>
          <textarea
            className="mobile-psale-co-textarea"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Açıklama, iade, özel istek…"
            maxLength={500}
            disabled={false}
          />
        </div>

        <div className="mobile-psale-co-total">
          <span>Toplam</span>
          <span className="mobile-psale-co-total-val">{fmtTL(cartTotal)}</span>
        </div>
      </div>

      <footer className="mobile-psale-co-actions">
        <button
          type="button"
          className="mobile-psale-co-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {student
            ? `Satışı tamamla · ${fmtTL(cartTotal)}`
            : 'Müşteri seç'}
        </button>
      </footer>

      {showCreateStudent && (
        <MobileCreateStudentPage
          onClose={() => setShowCreateStudent(false)}
          onCreated={handleStudentCreated}
        />
      )}

      {confirmOpen && (
        <MobileProductSaleConfirmSheet
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

  if (!portalRoot) return content;
  return createPortal(content, portalRoot);
}

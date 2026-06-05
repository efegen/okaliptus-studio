import React from 'react';
import { createProductSaleApi, createCashPayment } from '../api';
import { fmtTL } from '../data';
import { buildModelFromCart } from '../receipt/buildReceiptModel.js';
import { ReceiptShareButton } from '../receipt/ReceiptShareButton.jsx';

function CashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function BankIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 10l9-5 9 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v8m4-8v8m6-8v8m4-8v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3 19h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="14.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CheckCircle() {
  return (
    <svg viewBox="0 0 52 52" width="64" height="64" aria-hidden="true">
      <circle
        cx="26" cy="26" r="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="psale-confirm-check-circle"
      />
      <path
        d="M14 27l8 8 16-18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="psale-confirm-check-tick"
      />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const EPSILON = 0.001;

export function ProductSaleConfirmModal({
  cart,
  student,
  note,
  total,
  count,
  onClose,
  onCompleted,
}) {
  // Ödeme yöntemleri her zaman aktif (Nakit + IBAN) — aç/kapa ayarı kaldırıldı (§8.5).
  const cashEnabled = true;
  const ibanEnabled = true;
  const anyMethodEnabled = true;

  const [phase, setPhase] = React.useState('choose');
  const [error, setError] = React.useState(null);

  // Payment form state
  const [source, setSource] = React.useState('cash');
  const [amountInput, setAmountInput] = React.useState('');

  // Result state (set on success)
  const [resultPaidAmount, setResultPaidAmount] = React.useState(0);
  const [resultPaidWith, setResultPaidWith] = React.useState(null);
  // Oluşan satış kimliği — makbuz (Teşekkür Makbuzu) yeniden üretimi için.
  const [saleResult, setSaleResult] = React.useState(null);

  // When entering payment phase, prefill amount with full total
  React.useEffect(() => {
    if (phase === 'payment') {
      setAmountInput(String(total));
      setError(null);
    }
  }, [phase, total]);

  function finish() {
    onCompleted({
      count,
      total,
      paidAmount: resultPaidAmount,
      paidWith: resultPaidWith,
    });
  }

  React.useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (phase === 'submitting') return;
      if (phase === 'success') {
        finish();
      } else if (phase === 'payment') {
        setPhase('choose');
      } else {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, resultPaidAmount, resultPaidWith]);

  async function runSubmit({ paySource, payAmount }) {
    setPhase('submitting');
    setError(null);
    try {
      const soldAt = new Date().toISOString();
      const items = Array.from(cart.values()).map(it => ({
        productId: Number(it.product.id),
        quantity: it.quantity,
      }));
      const sale = await createProductSaleApi({
        studentId: Number(student.id),
        soldAt,
        items,
        note: (note || '').trim() || null,
        lessonId: null,
      });
      let paid = 0;
      if (paySource && payAmount > 0) {
        await createCashPayment({
          targetType: 'product_sale',
          targetId: Number(sale.id),
          amount: payAmount,
          source: paySource,
          paidAt: soldAt,
          note: null,
        });
        paid = payAmount;
      }
      setSaleResult({ id: sale.id, soldAt });
      setResultPaidAmount(paid);
      setResultPaidWith(paySource);
      setPhase('success');
    } catch (err) {
      setError(err?.message || 'Bir hata oluştu.');
      setPhase('error');
    }
  }

  function handleSubmitDebt() {
    runSubmit({ paySource: null, payAmount: 0 });
  }

  function handleSubmitPayment() {
    const amt = parseFloat(amountInput);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Tutar sıfırdan büyük olmalı.');
      return;
    }
    if (amt > total + EPSILON) {
      setError(`Tutar satış toplamından (${fmtTL(total)}) büyük olamaz.`);
      return;
    }
    runSubmit({ paySource: source, payAmount: Math.round(amt * 100) / 100 });
  }

  function handleBackdropClick() {
    if (phase === 'submitting') return;
    if (phase === 'success') finish();
    else onClose();
  }

  // Makbuz modeli — satış oluşunca sabit kimlikte üret (eager pre-gen için).
  const receiptModel = React.useMemo(
    () => (saleResult
      ? buildModelFromCart({ cart, student, saleId: saleResult.id, soldAt: saleResult.soldAt })
      : null),
    [saleResult, cart, student],
  );

  // Render helpers
  const remaining = Math.max(0, total - resultPaidAmount);
  const isFullPaid = resultPaidAmount > EPSILON && remaining <= EPSILON;
  const isPartialPaid = resultPaidAmount > EPSILON && remaining > EPSILON;
  const isDebtOnly = resultPaidAmount <= EPSILON;

  let statusLabel;
  if (isFullPaid) {
    statusLabel = `${resultPaidWith === 'cash' ? 'Nakit' : 'Havale/IBAN'} olarak tahsil edildi`;
  } else if (isPartialPaid) {
    statusLabel = `${fmtTL(resultPaidAmount)} ${resultPaidWith === 'cash' ? 'nakit' : 'havale'} tahsil · ${fmtTL(remaining)} borç`;
  } else {
    statusLabel = 'Borç olarak eklendi · sonra tahsil edilecek';
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div
        className="modal psale-confirm-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="psale-confirm-title"
      >
        {phase === 'choose' && (
          <>
            <header className="psale-confirm-head">
              <h3 id="psale-confirm-title" className="psale-confirm-title">
                Ödeme alındı mı?
              </h3>
              <p className="psale-confirm-sub">
                <span>{student.full_name}</span>
                <span className="psale-confirm-sub-dot">·</span>
                <span>{count} ürün</span>
                <span className="psale-confirm-sub-dot">·</span>
                <strong className="psale-confirm-sub-total">{fmtTL(total)}</strong>
              </p>
            </header>

            <div className="psale-confirm-actions">
              <button
                type="button"
                className="psale-confirm-option"
                onClick={handleSubmitDebt}
                autoFocus
              >
                <span className="psale-confirm-option-icon">
                  <ClockIcon />
                </span>
                <span className="psale-confirm-option-main">
                  <span className="psale-confirm-option-title">Borç olarak eklensin</span>
                  <span className="psale-confirm-option-sub">
                    Sonra tahsil edilecek · {fmtTL(total)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="psale-confirm-option"
                onClick={() => setPhase('payment')}
                disabled={!anyMethodEnabled}
              >
                <span className="psale-confirm-option-icon">
                  <WalletIcon />
                </span>
                <span className="psale-confirm-option-main">
                  <span className="psale-confirm-option-title">Şimdi ödeme al</span>
                  <span className="psale-confirm-option-sub">
                    {anyMethodEnabled
                      ? 'Nakit / havale tutarı gir'
                      : 'Aktif ödeme yöntemi yok'}
                  </span>
                </span>
              </button>
            </div>

            <footer className="psale-confirm-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Vazgeç
              </button>
            </footer>
          </>
        )}

        {phase === 'payment' && (
          <>
            <header className="psale-confirm-head">
              <h3 id="psale-confirm-title" className="psale-confirm-title">
                Ödeme bilgileri
              </h3>
              <p className="psale-confirm-sub">
                <span>Satış toplamı</span>
                <span className="psale-confirm-sub-dot">·</span>
                <strong className="psale-confirm-sub-total">{fmtTL(total)}</strong>
              </p>
            </header>

            <div className="psale-confirm-form">
              {(cashEnabled && ibanEnabled) && (
                <div className="psale-pay-field">
                  <label className="psale-pay-label">Yöntem</label>
                  <div className="psale-pay-source" role="tablist" aria-label="Ödeme yöntemi">
                    <button
                      type="button"
                      role="tab"
                      aria-pressed={source === 'cash'}
                      className={'psale-pay-source-btn' + (source === 'cash' ? ' is-active' : '')}
                      onClick={() => setSource('cash')}
                    >
                      <CashIcon />
                      <span>Nakit</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-pressed={source === 'iban'}
                      className={'psale-pay-source-btn' + (source === 'iban' ? ' is-active' : '')}
                      onClick={() => setSource('iban')}
                    >
                      <BankIcon />
                      <span>Havale/IBAN</span>
                    </button>
                  </div>
                </div>
              )}

              <div className="psale-pay-field">
                <label htmlFor="psale-pay-amount" className="psale-pay-label">
                  Tutar
                  <span className="psale-pay-label-hint">en fazla {fmtTL(total)}</span>
                </label>
                <div className="psale-pay-amount-wrap">
                  <input
                    id="psale-pay-amount"
                    type="number"
                    inputMode="decimal"
                    className="psale-pay-amount"
                    value={amountInput}
                    onChange={e => { setAmountInput(e.target.value); setError(null); }}
                    min="0"
                    max={total}
                    step="0.01"
                    placeholder="0"
                    autoFocus
                  />
                  <span className="psale-pay-amount-suffix">₺</span>
                </div>
                {parseFloat(amountInput) > 0 && parseFloat(amountInput) < total - EPSILON && (
                  <span className="psale-pay-hint">
                    Kalan {fmtTL(total - parseFloat(amountInput))} borç olarak eklenecek.
                  </span>
                )}
              </div>

              {error && (
                <div className="psale-banner-error" role="alert">
                  {error}
                </div>
              )}

              <button
                type="button"
                className="psale-confirm-done"
                onClick={handleSubmitPayment}
                disabled={!parseFloat(amountInput) || parseFloat(amountInput) <= 0}
              >
                Tahsil et ve kaydet
              </button>
            </div>

            <footer className="psale-confirm-footer psale-confirm-footer-back">
              <button
                type="button"
                className="btn btn-ghost psale-confirm-back"
                onClick={() => setPhase('choose')}
              >
                <ChevronLeftIcon />
                <span>Geri</span>
              </button>
            </footer>
          </>
        )}

        {phase === 'submitting' && (
          <div className="psale-confirm-state">
            <div className="psale-confirm-spinner" aria-hidden="true" />
            <p className="psale-confirm-state-msg">Kaydediliyor…</p>
          </div>
        )}

        {phase === 'success' && (
          <div className="psale-confirm-state psale-confirm-success">
            <div className="psale-confirm-check">
              <CheckCircle />
            </div>
            <h3 id="psale-confirm-title" className="psale-confirm-title">
              Satış kaydedildi
            </h3>
            <p className="psale-confirm-success-meta">
              {count} ürün
              <span className="psale-confirm-sub-dot">·</span>
              <strong>{fmtTL(total)}</strong>
            </p>
            <div
              className={
                'psale-confirm-status ' +
                (isFullPaid
                  ? 'psale-confirm-status-paid'
                  : isPartialPaid
                    ? 'psale-confirm-status-partial'
                    : 'psale-confirm-status-debt')
              }
            >
              {statusLabel}
            </div>
            {receiptModel && (
              <ReceiptShareButton variant="web" eager label="Makbuzu paylaş" model={receiptModel} />
            )}
            <button
              type="button"
              className="psale-confirm-done"
              onClick={finish}
              autoFocus
            >
              Tamam
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div className="psale-confirm-state">
            <div className="psale-confirm-error-icon" aria-hidden="true">!</div>
            <h3 className="psale-confirm-title">Kaydedilemedi</h3>
            <p className="psale-confirm-error-msg" role="alert">
              {error}
            </p>
            <div className="psale-confirm-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Vazgeç
              </button>
              <button
                type="button"
                className="btn psale-confirm-retry"
                onClick={() => setPhase('choose')}
              >
                Tekrar dene
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

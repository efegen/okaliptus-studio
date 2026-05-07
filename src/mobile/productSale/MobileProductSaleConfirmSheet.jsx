import React from 'react';
import { Drawer } from 'vaul';
import { useQuery } from '@tanstack/react-query';
import { createProductSaleApi, createCashPayment, getSettings } from '../../api';
import { fmtTL } from '../../data';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function CashIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function BankIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
        className="mobile-psale-confirm-check-circle"
      />
      <path
        d="M14 27l8 8 16-18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mobile-psale-confirm-check-tick"
      />
    </svg>
  );
}

const EPSILON = 0.001;

export function MobileProductSaleConfirmSheet({
  cart,
  student,
  note,
  total,
  count,
  onClose,
  onCompleted,
}) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
  });
  const cashEnabled = settingsQuery.data?.paymentMethodCash ?? true;
  const ibanEnabled = settingsQuery.data?.paymentMethodIban ?? true;
  const anyMethodEnabled = cashEnabled || ibanEnabled;

  const [phase, setPhase] = React.useState('choose');
  const [error, setError] = React.useState(null);

  const [source, setSource] = React.useState(cashEnabled ? 'cash' : 'iban');
  const [amountInput, setAmountInput] = React.useState('');

  const [resultPaidAmount, setResultPaidAmount] = React.useState(0);
  const [resultPaidWith, setResultPaidWith] = React.useState(null);

  React.useEffect(() => {
    if (cashEnabled) setSource('cash');
    else if (ibanEnabled) setSource('iban');
  }, [cashEnabled, ibanEnabled]);

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

  async function runSubmit({ paySource, payAmount }) {
    setPhase('submitting');
    setError(null);
    try {
      const items = Array.from(cart.values()).map(it => ({
        productId: Number(it.product.id),
        quantity: it.quantity,
      }));
      const sale = await createProductSaleApi({
        studentId: Number(student.id),
        soldAt: new Date().toISOString(),
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
          paidAt: new Date().toISOString(),
          note: null,
        });
        paid = payAmount;
      }
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

  function handleOpenChange(open) {
    if (open) return;
    if (phase === 'submitting') return;
    if (phase === 'success') {
      finish();
    } else {
      onClose();
    }
  }

  const remaining = Math.max(0, total - resultPaidAmount);
  const isFullPaid = resultPaidAmount > EPSILON && remaining <= EPSILON;
  const isPartialPaid = resultPaidAmount > EPSILON && remaining > EPSILON;

  let statusLabel;
  if (isFullPaid) {
    statusLabel = `${resultPaidWith === 'cash' ? 'Nakit' : 'Havale/IBAN'} olarak tahsil edildi`;
  } else if (isPartialPaid) {
    statusLabel = `${fmtTL(resultPaidAmount)} ${resultPaidWith === 'cash' ? 'nakit' : 'havale'} tahsil · ${fmtTL(remaining)} borç`;
  } else {
    statusLabel = 'Borç olarak eklendi · sonra tahsil edilecek';
  }

  return (
    <Drawer.Root
      open={true}
      onOpenChange={handleOpenChange}
      shouldScaleBackground={false}
      repositionInputs={false}
      dismissible={phase !== 'submitting'}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-psale-vsheet-overlay" />
        <Drawer.Content className="mobile-psale-vsheet-content mobile-psale-confirm-content">
          <Drawer.Handle className="mobile-psale-vsheet-handle" />

          {phase === 'choose' && (
            <>
              <header className="mobile-psale-confirm-head">
                <Drawer.Title className="mobile-psale-vsheet-title">
                  Ödeme alındı mı?
                </Drawer.Title>
                <div className="mobile-psale-confirm-sub">
                  <span>{student.full_name}</span>
                  <span className="mobile-psale-confirm-dot">·</span>
                  <span>{count} ürün</span>
                  <span className="mobile-psale-confirm-dot">·</span>
                  <strong className="mobile-psale-confirm-sub-total">{fmtTL(total)}</strong>
                </div>
              </header>

              <div className="mobile-psale-confirm-body">
                <button
                  type="button"
                  className="mobile-psale-confirm-option"
                  onClick={handleSubmitDebt}
                >
                  <span className="mobile-psale-confirm-option-icon">
                    <ClockIcon />
                  </span>
                  <span className="mobile-psale-confirm-option-main">
                    <span className="mobile-psale-confirm-option-title">Borç olarak eklensin</span>
                    <span className="mobile-psale-confirm-option-sub">
                      Sonra tahsil edilecek · {fmtTL(total)}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="mobile-psale-confirm-option"
                  onClick={() => setPhase('payment')}
                  disabled={!anyMethodEnabled}
                >
                  <span className="mobile-psale-confirm-option-icon">
                    <WalletIcon />
                  </span>
                  <span className="mobile-psale-confirm-option-main">
                    <span className="mobile-psale-confirm-option-title">Şimdi ödeme al</span>
                    <span className="mobile-psale-confirm-option-sub">
                      {anyMethodEnabled
                        ? 'Nakit / havale tutarı gir'
                        : 'Aktif ödeme yöntemi yok'}
                    </span>
                  </span>
                </button>
              </div>

              <footer className="mobile-psale-confirm-footer">
                <button
                  type="button"
                  className="mobile-psale-btn-ghost"
                  onClick={onClose}
                >
                  Vazgeç
                </button>
              </footer>
            </>
          )}

          {phase === 'payment' && (
            <>
              <header className="mobile-psale-confirm-head">
                <Drawer.Title className="mobile-psale-vsheet-title">
                  Ödeme bilgileri
                </Drawer.Title>
                <div className="mobile-psale-confirm-sub">
                  <span>Satış toplamı</span>
                  <span className="mobile-psale-confirm-dot">·</span>
                  <strong className="mobile-psale-confirm-sub-total">{fmtTL(total)}</strong>
                </div>
              </header>

              <div className="mobile-psale-confirm-body">
                {(cashEnabled && ibanEnabled) && (
                  <div className="mobile-psale-pay-field">
                    <label className="mobile-psale-pay-label">Yöntem</label>
                    <div
                      className="mobile-psale-pay-source"
                      role="tablist"
                      aria-label="Ödeme yöntemi"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-pressed={source === 'cash'}
                        className={'mobile-psale-pay-source-btn' + (source === 'cash' ? ' is-active' : '')}
                        onClick={() => setSource('cash')}
                      >
                        <CashIcon />
                        <span>Nakit</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-pressed={source === 'iban'}
                        className={'mobile-psale-pay-source-btn' + (source === 'iban' ? ' is-active' : '')}
                        onClick={() => setSource('iban')}
                      >
                        <BankIcon />
                        <span>Havale/IBAN</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="mobile-psale-pay-field">
                  <label htmlFor="m-psale-pay-amount" className="mobile-psale-pay-label">
                    Tutar
                    <span className="mobile-psale-pay-label-hint">en fazla {fmtTL(total)}</span>
                  </label>
                  <div className="mobile-psale-pay-amount-wrap">
                    <input
                      id="m-psale-pay-amount"
                      type="number"
                      inputMode="decimal"
                      className="mobile-psale-pay-amount"
                      value={amountInput}
                      onChange={e => { setAmountInput(e.target.value); setError(null); }}
                      min="0"
                      max={total}
                      step="0.01"
                      placeholder="0"
                    />
                    <span className="mobile-psale-pay-amount-suffix">₺</span>
                  </div>
                  {parseFloat(amountInput) > 0 && parseFloat(amountInput) < total - EPSILON && (
                    <span className="mobile-psale-pay-hint">
                      Kalan {fmtTL(total - parseFloat(amountInput))} borç olarak eklenecek.
                    </span>
                  )}
                </div>

                {error && (
                  <div className="mobile-psale-error" role="alert">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  className="mobile-psale-confirm-done"
                  onClick={handleSubmitPayment}
                  disabled={!parseFloat(amountInput) || parseFloat(amountInput) <= 0}
                >
                  Tahsil et ve kaydet
                </button>
              </div>

              <footer className="mobile-psale-confirm-footer mobile-psale-confirm-footer-back">
                <button
                  type="button"
                  className="mobile-psale-btn-ghost mobile-psale-confirm-back"
                  onClick={() => setPhase('choose')}
                >
                  <ChevronLeftIcon />
                  <span>Geri</span>
                </button>
              </footer>
            </>
          )}

          {phase === 'submitting' && (
            <div className="mobile-psale-confirm-state">
              <div className="mobile-psale-confirm-spinner" aria-hidden="true" />
              <p className="mobile-psale-confirm-state-msg">Kaydediliyor…</p>
            </div>
          )}

          {phase === 'success' && (
            <div className="mobile-psale-confirm-state mobile-psale-confirm-success">
              <div className="mobile-psale-confirm-check">
                <CheckCircle />
              </div>
              <Drawer.Title className="mobile-psale-vsheet-title">
                Satış kaydedildi
              </Drawer.Title>
              <p className="mobile-psale-confirm-success-meta">
                {count} ürün
                <span className="mobile-psale-confirm-dot">·</span>
                <strong>{fmtTL(total)}</strong>
              </p>
              <div
                className={
                  'mobile-psale-confirm-status ' +
                  (isFullPaid
                    ? 'is-paid'
                    : isPartialPaid
                      ? 'is-partial'
                      : 'is-debt')
                }
              >
                {statusLabel}
              </div>
              <button
                type="button"
                className="mobile-psale-confirm-done"
                onClick={finish}
              >
                Tamam
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="mobile-psale-confirm-state">
              <div className="mobile-psale-confirm-error-icon" aria-hidden="true">!</div>
              <Drawer.Title className="mobile-psale-vsheet-title">
                Kaydedilemedi
              </Drawer.Title>
              <p className="mobile-psale-confirm-error-msg" role="alert">
                {error}
              </p>
              <div className="mobile-psale-confirm-footer">
                <button
                  type="button"
                  className="mobile-psale-btn-ghost"
                  onClick={onClose}
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  className="mobile-psale-confirm-retry"
                  onClick={() => setPhase('choose')}
                >
                  Tekrar dene
                </button>
              </div>
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

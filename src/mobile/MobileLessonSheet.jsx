import React from 'react';
import { Drawer } from 'vaul';
import { fmtTL } from '../data';
import { useLessonActions } from './shared/useLessonActions';
import {
  LESSON_STATE_META,
  PAYMENT_METHOD_LABELS,
  getLessonStateInfo,
  debtStateFor,
} from './shared/lessonMeta';

const ACTIVE_PAYMENT_METHODS = { cash: true, iban: true };

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function extractIstanbulParts(isoString) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(isoString));
  const get = type => Number(parts.find(p => p.type === type).value);
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

function formatHeaderDate(startsAt) {
  if (!startsAt) return '';
  const { year, month, day } = extractIstanbulParts(startsAt);
  const local = new Date(year, month, day);
  return local.toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatModeLabel(mode) {
  return mode === 'online' ? 'Online' : 'Yüzyüze';
}

function MobileDebtCard({ label, paid, total, paymentMethod, state, onCollect, onEdit }) {
  const remaining = total - paid;
  const headline = state === 'partial' ? 'kalan' : 'borç';

  return (
    <div className={`mobile-lsheet-debt-card is-${state}`}>
      <div className="mobile-lsheet-debt-head">
        <span className="mobile-lsheet-debt-label">
          <span className="mobile-lsheet-debt-label-text">{label}</span>
          {onEdit && (
            <button
              type="button"
              className="mobile-lsheet-debt-edit"
              onClick={onEdit}
              aria-label="Düzenle"
              title="Düzenle"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                <path d="M10 4l2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </span>
        {(state === 'paid' || state === 'empty') && (
          <span className="mobile-lsheet-debt-gross">
            {state === 'empty' ? '—' : fmtTL(total)}
          </span>
        )}
      </div>

      {state === 'paid' && (
        <div className="mobile-lsheet-debt-cleared">
          <span aria-hidden="true">✓</span>
          <span>Tahsil edildi{paymentMethod ? ` · ${paymentMethod}` : ''}</span>
        </div>
      )}

      {(state === 'unpaid' || state === 'partial') && (
        <>
          <div className="mobile-lsheet-debt-headline">
            <span className="mobile-lsheet-debt-amt-big">{fmtTL(remaining)}</span>
            <span className="mobile-lsheet-debt-amt-sub">{headline}</span>
          </div>
          <div className="mobile-lsheet-debt-foot">
            <span className="mobile-lsheet-debt-meta">
              {state === 'partial'
                ? `${fmtTL(paid)} / ${fmtTL(total)} ödendi`
                : `${fmtTL(total)} toplam`}
            </span>
            {onCollect && (
              <button
                type="button"
                className="mobile-lsheet-debt-collect"
                onClick={onCollect}
              >
                {fmtTL(remaining)} tahsil et
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NoteBlock({ text }) {
  return (
    <div className="mobile-lsheet-note">
      <span className="mobile-lsheet-note-label">Not</span>
      <span className="mobile-lsheet-note-text">{text}</span>
    </div>
  );
}

export function MobileLessonSheet({ session, onClose, onUpdated }) {
  const open = !!session;
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  const actions = useLessonActions();

  const [phase, setPhase] = React.useState('detail');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  // complete phase
  const [saleChoice, setSaleChoice] = React.useState(null);
  const [saleAmount, setSaleAmount] = React.useState('');
  const [saleNote, setSaleNote] = React.useState('');

  // cancel phase
  const [cancelReason, setCancelReason] = React.useState(null);

  // pay phase
  const [payTarget, setPayTarget] = React.useState(null);
  const [payAmount, setPayAmount] = React.useState('');
  const [paySource, setPaySource] = React.useState('cash');
  const [payNote, setPayNote] = React.useState('');

  // edit-sale phase
  const [editSaleTarget, setEditSaleTarget] = React.useState(null);
  const [editSaleAmount, setEditSaleAmount] = React.useState('');
  const [editSaleNote, setEditSaleNote] = React.useState('');
  const [confirmingDeleteSale, setConfirmingDeleteSale] = React.useState(false);

  function resetToDetail() {
    setPhase('detail');
    setError(null);
    setSubmitting(false);
    setSaleChoice(null);
    setSaleAmount('');
    setSaleNote('');
    setCancelReason(null);
    setPayTarget(null);
    setPayAmount('');
    setPaySource(ACTIVE_PAYMENT_METHODS.cash ? 'cash' : 'iban');
    setPayNote('');
    setEditSaleTarget(null);
    setEditSaleAmount('');
    setEditSaleNote('');
    setConfirmingDeleteSale(false);
  }

  // Reset whenever sheet opens for a new session.
  React.useEffect(() => {
    if (!session) return;
    resetToDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const stateMeta = session ? LESSON_STATE_META[session.lessonState] : null;
  const stateInfo = session ? getLessonStateInfo(session) : null;
  const productSales = session?.productSales ?? [];
  const productsRemaining = productSales.reduce((a, s) => a + (s.remaining || 0), 0);
  const lessonRemaining = session ? Math.max(0, session.price - session.paid) : 0;
  const totalRemaining = lessonRemaining + productsRemaining;

  const lessonPaymentLabel = session?.paymentMethod
    ? (PAYMENT_METHOD_LABELS[session.paymentMethod] || session.paymentMethod)
    : null;

  function openPayPhase(target) {
    setPayTarget(target);
    setPayAmount(target.remaining > 0 ? String(target.remaining) : '');
    setPaySource(ACTIVE_PAYMENT_METHODS.cash ? 'cash' : 'iban');
    setPayNote('');
    setError(null);
    setPhase('pay');
  }

  function openEditSalePhase(sale) {
    setEditSaleTarget({
      id: sale.id,
      paid: Number(sale.paidAmount) || 0,
      originalTotal: Number(sale.totalAmount) || 0,
      originalNote: sale.note || '',
    });
    setEditSaleAmount(String(Number(sale.totalAmount) || 0));
    setEditSaleNote(sale.note || '');
    setConfirmingDeleteSale(false);
    setError(null);
    setPhase('edit-sale');
  }

  async function handleComplete() {
    if (saleChoice === null) return;
    if (saleChoice === 'yes' && (!saleAmount || parseFloat(saleAmount) <= 0)) return;
    setSubmitting(true);
    setError(null);
    try {
      const productSale = saleChoice === 'yes' && parseFloat(saleAmount) > 0
        ? { totalAmount: parseFloat(saleAmount), note: saleNote.trim() || null }
        : null;
      await actions.complete(session.id, productSale ? { productSale } : {});
      onUpdated('Ders tamamlandı');
    } catch (err) {
      setError(err.message || 'Ders tamamlanamadı.');
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!cancelReason) return;
    setSubmitting(true);
    setError(null);
    try {
      await actions.cancel(session.id, cancelReason);
      onUpdated(cancelReason === 'mistake' ? 'Ders silindi' : 'Ders iptal edildi');
    } catch (err) {
      setError(err.message || 'Ders iptal edilemedi.');
      setSubmitting(false);
    }
  }

  async function handlePay() {
    if (!payAmount || parseFloat(payAmount) <= 0 || !payTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      const amount = parseFloat(payAmount);
      await actions.addPayment({
        targetType: payTarget.type,
        targetId: payTarget.id,
        amount,
        source: paySource,
        paidAt: new Date().toISOString(),
        note: payNote.trim() || null,
      });
      const remainingAfter = Math.max(0, payTarget.remaining - amount);
      const message = remainingAfter <= 0
        ? `${payTarget.label} tahsilatı tamamlandı`
        : `${fmtTL(amount)} kaydedildi · ${fmtTL(remainingAfter)} kalan`;
      onUpdated(message);
    } catch (err) {
      setError(err.message || 'Tahsilat kaydedilemedi.');
      setSubmitting(false);
    }
  }

  async function handleUpdateSale() {
    if (!editSaleTarget) return;
    const newAmount = parseFloat(editSaleAmount);
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      setError('Geçerli bir tutar gir.');
      return;
    }
    if (editSaleTarget.paid > 0 && newAmount < editSaleTarget.paid) {
      setError(`Tutar ödenenden (${fmtTL(editSaleTarget.paid)}) az olamaz.`);
      return;
    }
    const fields = {};
    if (newAmount !== editSaleTarget.originalTotal) fields.totalAmount = newAmount;
    const trimmedNote = editSaleNote.trim();
    const oldNote = editSaleTarget.originalNote.trim();
    if (trimmedNote !== oldNote) fields.note = trimmedNote || null;
    if (Object.keys(fields).length === 0) {
      resetToDetail();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await actions.updateSale(editSaleTarget.id, fields);
      onUpdated('Ürün satışı güncellendi');
    } catch (err) {
      setError(err.message || 'Ürün satışı güncellenemedi.');
      setSubmitting(false);
    }
  }

  async function handleDeleteSale() {
    if (!editSaleTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      await actions.deleteSale(editSaleTarget.id);
      onUpdated('Ürün satışı silindi');
    } catch (err) {
      setError(err.message || 'Ürün satışı silinemedi.');
      setSubmitting(false);
    }
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o && !submitting) onClose(); }}
      dismissible={!submitting}
      shouldScaleBackground={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-lsheet-overlay" />
        <Drawer.Content className="mobile-lsheet-content">
          <Drawer.Handle className="mobile-lsheet-handle" />
          {session && (
            <>
              {/* Header — always visible */}
              <header className="mobile-lsheet-header">
                <span className={`mobile-lsheet-pill ${stateMeta?.cls ?? ''}`}>
                  {stateInfo.label}
                </span>
                <Drawer.Title className="mobile-lsheet-name">
                  {session.studentName}
                  {session.studentNickname && (
                    <span className="mobile-lsheet-nick"> ({session.studentNickname})</span>
                  )}
                </Drawer.Title>
                <div className="mobile-lsheet-meta">
                  {formatHeaderDate(session.startsAt)} · {session.time} · {formatModeLabel(session.mode)}
                </div>
              </header>

              {/* DETAIL phase */}
              {phase === 'detail' && (
                <>
                  <div className="mobile-lsheet-body">
                    {session.lessonState === 'planned' && (
                      <>
                        <div className="mobile-lsheet-summary-row">
                          <span>Ders ücreti</span>
                          <span>{session.price > 0 ? fmtTL(session.price) : '—'}</span>
                        </div>
                        {session.note && <NoteBlock text={session.note} />}
                      </>
                    )}

                    {session.lessonState !== 'planned' && session.lessonState !== 'cancelled' && (
                      <>
                        <MobileDebtCard
                          label="Ders ücreti"
                          total={session.price}
                          paid={session.paid}
                          paymentMethod={lessonPaymentLabel}
                          state={session.lessonState}
                          onCollect={lessonRemaining > 0 ? () => openPayPhase({
                            type: 'lesson',
                            id: session.id,
                            label: 'Ders ücreti',
                            total: session.price,
                            paid: session.paid,
                            remaining: lessonRemaining,
                          }) : null}
                        />

                        {productSales.map(sale => {
                          const saleState = debtStateFor(sale.paidAmount, sale.totalAmount);
                          return (
                            <MobileDebtCard
                              key={sale.id}
                              label={(sale.note && sale.note.trim()) || 'Ürün satışı'}
                              total={sale.totalAmount}
                              paid={sale.paidAmount}
                              paymentMethod={null}
                              state={saleState}
                              onCollect={(saleState === 'partial' || saleState === 'unpaid')
                                ? () => openPayPhase({
                                    type: 'product_sale',
                                    id: sale.id,
                                    label: (sale.note && sale.note.trim()) || 'Ürün satışı',
                                    total: sale.totalAmount,
                                    paid: sale.paidAmount,
                                    remaining: sale.remaining,
                                  })
                                : null}
                              onEdit={() => openEditSalePhase(sale)}
                            />
                          );
                        })}

                        {productSales.length > 0 && totalRemaining > 0 && (
                          <div className="mobile-lsheet-totalremaining">
                            <span>Toplam kalan</span>
                            <span>{fmtTL(totalRemaining)}</span>
                          </div>
                        )}

                        {productSales.length > 0 && totalRemaining === 0 && (
                          <div className="mobile-lsheet-cleared">
                            <span aria-hidden="true">✓</span>
                            <span>Tüm tahsilatlar tamamlandı</span>
                          </div>
                        )}

                        {session.note && <NoteBlock text={session.note} />}
                      </>
                    )}

                    {error && (
                      <div className="mobile-lsheet-error" role="alert">{error}</div>
                    )}
                  </div>

                  {/* Detail footer — state-based actions */}
                  {session.lessonState === 'planned' && (
                    <footer className="mobile-lsheet-actions">
                      <button
                        type="button"
                        className="mobile-lsheet-btn-danger"
                        onClick={() => { setPhase('cancel'); setError(null); }}
                      >
                        İptal et
                      </button>
                      <button
                        type="button"
                        className="mobile-lsheet-btn-primary"
                        onClick={() => { setPhase('complete'); setError(null); }}
                      >
                        Dersi tamamla
                      </button>
                    </footer>
                  )}

                </>
              )}

              {/* COMPLETE phase */}
              {phase === 'complete' && (
                <>
                  <div className="mobile-lsheet-body">
                    <div className="mobile-lsheet-subtitle">Dersi tamamla</div>

                    <div className="mobile-lsheet-form-row">
                      <label className="mobile-lsheet-form-label">Bu derste ürün satışı yapıldı mı?</label>
                      <div className="mobile-lsheet-choice-grid">
                        <button
                          type="button"
                          className={'mobile-lsheet-choice-btn' + (saleChoice === 'no' ? ' is-on' : '')}
                          onClick={() => setSaleChoice('no')}
                        >
                          Hayır
                        </button>
                        <button
                          type="button"
                          className={'mobile-lsheet-choice-btn' + (saleChoice === 'yes' ? ' is-on' : '')}
                          onClick={() => setSaleChoice('yes')}
                        >
                          Evet, var
                        </button>
                      </div>
                    </div>

                    {saleChoice === 'yes' && (
                      <>
                        <div className="mobile-lsheet-form-row">
                          <label className="mobile-lsheet-form-label">Satış tutarı (₺)</label>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="1"
                            autoFocus
                            className="mobile-lsheet-input"
                            value={saleAmount}
                            onChange={e => setSaleAmount(e.target.value)}
                          />
                        </div>
                        <div className="mobile-lsheet-form-row">
                          <label className="mobile-lsheet-form-label">Not (opsiyonel)</label>
                          <input
                            type="text"
                            className="mobile-lsheet-input"
                            value={saleNote}
                            onChange={e => setSaleNote(e.target.value)}
                            placeholder="Ürün adı veya açıklama…"
                          />
                        </div>
                        <div className="mobile-lsheet-hint">
                          Satış borç olarak kaydedilir. Tahsilatı bu ekrandan sonra "Tahsil et" butonu ile yapabilirsin.
                        </div>
                      </>
                    )}

                    {error && <div className="mobile-lsheet-error" role="alert">{error}</div>}
                  </div>

                  <footer className="mobile-lsheet-actions">
                    <button
                      type="button"
                      className="mobile-lsheet-btn-ghost"
                      onClick={resetToDetail}
                      disabled={submitting}
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      className="mobile-lsheet-btn-primary"
                      onClick={handleComplete}
                      disabled={
                        submitting ||
                        saleChoice === null ||
                        (saleChoice === 'yes' && (!saleAmount || parseFloat(saleAmount) <= 0))
                      }
                    >
                      {submitting ? 'Kaydediliyor…' : 'Tamamla'}
                    </button>
                  </footer>
                </>
              )}

              {/* CANCEL phase */}
              {phase === 'cancel' && (
                <>
                  <div className="mobile-lsheet-body">
                    <div className="mobile-lsheet-subtitle">Dersi neden iptal ediyorsun?</div>
                    <div className="mobile-lsheet-hint">İptal edilen ders hiçbir durumda borç oluşturmaz.</div>

                    <div className="mobile-lsheet-reason-list">
                      <button
                        type="button"
                        className={'mobile-lsheet-reason-card' + (cancelReason === 'student' ? ' is-on' : '')}
                        onClick={() => setCancelReason('student')}
                      >
                        <span className="mobile-lsheet-reason-title">Öğrenci iptal etti</span>
                        <span className="mobile-lsheet-reason-desc">
                          Ders, öğrencinin geçmişinde 'iptal' olarak görünür. Takvimden kaldırılır, borç oluşturmaz.
                        </span>
                      </button>
                      <button
                        type="button"
                        className={'mobile-lsheet-reason-card' + (cancelReason === 'mistake' ? ' is-on' : '')}
                        onClick={() => setCancelReason('mistake')}
                      >
                        <span className="mobile-lsheet-reason-title">Yanlışlıkla eklendi</span>
                        <span className="mobile-lsheet-reason-desc">
                          Ders kaydı tamamen silinir. Hiç oluşmamış gibi, öğrencinin geçmişinde de görünmez.
                        </span>
                      </button>
                    </div>

                    {error && <div className="mobile-lsheet-error" role="alert">{error}</div>}
                  </div>

                  <footer className="mobile-lsheet-actions">
                    <button
                      type="button"
                      className="mobile-lsheet-btn-ghost"
                      onClick={resetToDetail}
                      disabled={submitting}
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      className="mobile-lsheet-btn-danger"
                      onClick={handleCancel}
                      disabled={submitting || !cancelReason}
                    >
                      {submitting
                        ? (cancelReason === 'mistake' ? 'Siliniyor…' : 'İptal ediliyor…')
                        : (cancelReason === 'mistake' ? 'Kaydı sil' : 'Dersi iptal et')}
                    </button>
                  </footer>
                </>
              )}

              {/* PAY phase */}
              {phase === 'pay' && payTarget && (
                <>
                  <div className="mobile-lsheet-body">
                    <div className="mobile-lsheet-subtitle">Tahsilat: {payTarget.label}</div>

                    <div className="mobile-lsheet-pay-summary">
                      <div>
                        <span className="mobile-lsheet-pay-summary-label">Tutar</span>
                        <span className="mobile-lsheet-pay-summary-value">{fmtTL(payTarget.total)}</span>
                      </div>
                      <div>
                        <span className="mobile-lsheet-pay-summary-label">Ödenen</span>
                        <span className="mobile-lsheet-pay-summary-value">{fmtTL(payTarget.paid)}</span>
                      </div>
                      <div>
                        <span className="mobile-lsheet-pay-summary-label">Kalan</span>
                        <span className="mobile-lsheet-pay-summary-value">{fmtTL(payTarget.remaining)}</span>
                      </div>
                    </div>

                    <div className="mobile-lsheet-form-row">
                      <label className="mobile-lsheet-form-label">Tutar (₺)</label>
                      <div className="mobile-lsheet-pay-amount-row">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="1"
                          className="mobile-lsheet-input"
                          value={payAmount}
                          onChange={e => setPayAmount(e.target.value)}
                          required
                        />
                        {payTarget.remaining > 0 && payAmount !== String(payTarget.remaining) && (
                          <button
                            type="button"
                            className="mobile-lsheet-pay-fill-btn"
                            onClick={() => setPayAmount(String(payTarget.remaining))}
                          >
                            Tümü
                          </button>
                        )}
                      </div>
                    </div>

                    {ACTIVE_PAYMENT_METHODS.cash && ACTIVE_PAYMENT_METHODS.iban && (
                      <div className="mobile-lsheet-form-row">
                        <label className="mobile-lsheet-form-label">Yöntem</label>
                        <div className="mobile-lsheet-method">
                          <button
                            type="button"
                            className={'mobile-lsheet-method-btn' + (paySource === 'cash' ? ' is-on' : '')}
                            onClick={() => setPaySource('cash')}
                          >
                            Nakit
                          </button>
                          <button
                            type="button"
                            className={'mobile-lsheet-method-btn' + (paySource === 'iban' ? ' is-on' : '')}
                            onClick={() => setPaySource('iban')}
                          >
                            IBAN
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mobile-lsheet-form-row">
                      <label className="mobile-lsheet-form-label">Not (opsiyonel)</label>
                      <input
                        type="text"
                        className="mobile-lsheet-input"
                        value={payNote}
                        onChange={e => setPayNote(e.target.value)}
                        placeholder="Açıklama…"
                      />
                    </div>

                    {error && <div className="mobile-lsheet-error" role="alert">{error}</div>}
                  </div>

                  <footer className="mobile-lsheet-actions">
                    <button
                      type="button"
                      className="mobile-lsheet-btn-ghost"
                      onClick={resetToDetail}
                      disabled={submitting}
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      className="mobile-lsheet-btn-primary"
                      onClick={handlePay}
                      disabled={submitting || !payAmount || parseFloat(payAmount) <= 0}
                    >
                      {submitting ? 'Kaydediliyor…' : 'Tahsil et'}
                    </button>
                  </footer>
                </>
              )}

              {/* EDIT-SALE phase */}
              {phase === 'edit-sale' && editSaleTarget && (
                <>
                  {!confirmingDeleteSale && (
                    <>
                      <div className="mobile-lsheet-body">
                        <div className="mobile-lsheet-subtitle">Ürün satışını düzenle</div>

                        <div className="mobile-lsheet-form-row">
                          <label className="mobile-lsheet-form-label">Satış tutarı (₺)</label>
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="1"
                            className="mobile-lsheet-input"
                            value={editSaleAmount}
                            onChange={e => setEditSaleAmount(e.target.value)}
                          />
                        </div>
                        <div className="mobile-lsheet-form-row">
                          <label className="mobile-lsheet-form-label">Not (opsiyonel)</label>
                          <input
                            type="text"
                            className="mobile-lsheet-input"
                            value={editSaleNote}
                            onChange={e => setEditSaleNote(e.target.value)}
                            placeholder="Ürün adı veya açıklama…"
                          />
                        </div>

                        <button
                          type="button"
                          className="mobile-lsheet-delete-btn"
                          onClick={() => setConfirmingDeleteSale(true)}
                          disabled={submitting || editSaleTarget.paid > 0}
                        >
                          Bu satışı sil
                        </button>
                        {editSaleTarget.paid > 0 && (
                          <div className="mobile-lsheet-hint">
                            Bu satıştan {fmtTL(editSaleTarget.paid)} tahsilat yapılmış. Silmek için önce iadelerin geri alınması gerekir.
                          </div>
                        )}

                        {error && <div className="mobile-lsheet-error" role="alert">{error}</div>}
                      </div>

                      <footer className="mobile-lsheet-actions">
                        <button
                          type="button"
                          className="mobile-lsheet-btn-ghost"
                          onClick={resetToDetail}
                          disabled={submitting}
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          className="mobile-lsheet-btn-primary"
                          onClick={handleUpdateSale}
                          disabled={submitting || !editSaleAmount || parseFloat(editSaleAmount) <= 0}
                        >
                          {submitting ? 'Kaydediliyor…' : 'Kaydet'}
                        </button>
                      </footer>
                    </>
                  )}

                  {confirmingDeleteSale && (
                    <>
                      <div className="mobile-lsheet-body">
                        <div className="mobile-lsheet-subtitle">Bu satışı silmek istediğine emin misin?</div>
                        <div className="mobile-lsheet-hint">
                          {fmtTL(editSaleTarget.originalTotal)} tutarındaki ürün satışı kaldırılacak. Bu işlem geri alınamaz.
                        </div>

                        {error && <div className="mobile-lsheet-error" role="alert">{error}</div>}
                      </div>

                      <footer className="mobile-lsheet-actions">
                        <button
                          type="button"
                          className="mobile-lsheet-btn-ghost"
                          onClick={() => setConfirmingDeleteSale(false)}
                          disabled={submitting}
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          className="mobile-lsheet-btn-danger"
                          onClick={handleDeleteSale}
                          disabled={submitting}
                        >
                          {submitting ? 'Siliniyor…' : 'Evet, sil'}
                        </button>
                      </footer>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

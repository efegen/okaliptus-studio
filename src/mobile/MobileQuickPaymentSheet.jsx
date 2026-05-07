import React from 'react';
import { Drawer } from 'vaul';
import { useQuery } from '@tanstack/react-query';
import {
  getStudents,
  getStudentLessons,
  getStudentProductSales,
  createCashPayment,
} from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { MobileStudentCombobox } from './shared/MobileStudentCombobox';

const ACTIVE_PAYMENT_METHODS = { cash: true, iban: true };

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function FormRow({ label, children }) {
  return (
    <div className="mobile-csheet-form-row">
      <label className="mobile-csheet-label">{label}</label>
      {children}
    </div>
  );
}

function formatLessonDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  });
}

function formatLessonTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  });
}

export function MobileQuickPaymentSheet({ open, onClose, onCompleted, preselectedStudent = null }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);

  const studentsQuery = useQuery({
    queryKey: queryKeys.students(),
    queryFn: getStudents,
    staleTime: 2 * 60 * 1000,
    enabled: open && !preselectedStudent,
  });

  const [phase, setPhase] = React.useState(preselectedStudent ? 'pickDebt' : 'pickStudent');
  const [selectedStudent, setSelectedStudent] = React.useState(preselectedStudent);
  const [selectedDebt, setSelectedDebt] = React.useState(null);
  const [amount, setAmount] = React.useState('');
  const [source, setSource] = React.useState('cash');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  const lessonsQuery = useQuery({
    queryKey: selectedStudent ? queryKeys.studentLessons(selectedStudent.id) : ['noop-lessons'],
    queryFn: () => getStudentLessons(selectedStudent.id),
    staleTime: 30 * 1000,
    enabled: !!selectedStudent && open,
  });
  const salesQuery = useQuery({
    queryKey: selectedStudent ? queryKeys.studentProductSales(selectedStudent.id) : ['noop-sales'],
    queryFn: () => getStudentProductSales(selectedStudent.id),
    staleTime: 30 * 1000,
    enabled: !!selectedStudent && open,
  });

  const debts = React.useMemo(() => {
    const items = [];
    const lessons = lessonsQuery.data ?? [];
    for (const l of lessons) {
      const remaining = Number(l.remaining_receivable) || 0;
      if (remaining < 0.01) continue;
      if (l.status !== 'completed') continue;
      const total = Number(l.net_amount ?? (Number(l.price_snapshot) - Number(l.discount_amount || 0))) || 0;
      const paid = Number(l.paid_amount) || 0;
      items.push({
        key: `lesson-${l.id}`,
        targetType: 'lesson',
        targetId: l.id,
        sortAt: l.starts_at,
        title: 'Ders',
        subtitle: `${formatLessonDate(l.starts_at)} · ${formatLessonTime(l.starts_at)}`,
        total,
        paid,
        remaining,
      });
    }
    const sales = salesQuery.data ?? [];
    for (const s of sales) {
      const remaining = Number(s.remaining_receivable) || 0;
      if (remaining < 0.01) continue;
      const total = Number(s.total_amount) || 0;
      const paid = Number(s.paid_amount) || 0;
      items.push({
        key: `sale-${s.product_sale_id}`,
        targetType: 'product_sale',
        targetId: s.product_sale_id,
        sortAt: s.sold_at,
        title: (s.note && String(s.note).trim()) || 'Ürün satışı',
        subtitle: formatLessonDate(s.sold_at),
        total,
        paid,
        remaining,
      });
    }
    items.sort((a, b) => {
      const ta = a.sortAt ? new Date(a.sortAt).getTime() : 0;
      const tb = b.sortAt ? new Date(b.sortAt).getTime() : 0;
      return ta - tb; // oldest first — pay older debts first
    });
    return items;
  }, [lessonsQuery.data, salesQuery.data]);

  const debtsLoading = !!selectedStudent && (lessonsQuery.isLoading || salesQuery.isLoading);
  const debtsError = (lessonsQuery.error || salesQuery.error)?.message || null;

  function reset() {
    setPhase(preselectedStudent ? 'pickDebt' : 'pickStudent');
    setSelectedStudent(preselectedStudent);
    setSelectedDebt(null);
    setAmount('');
    setSource('cash');
    setNote('');
    setSubmitting(false);
    setError(null);
  }

  React.useEffect(() => {
    if (!open) reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedStudent]);

  function handleSelectStudent(s) {
    setSelectedStudent(s);
    setPhase('pickDebt');
  }

  function handleClearStudent() {
    if (preselectedStudent) {
      // Profilden açıldığında öğrenci sabit — close ve geri dön.
      onClose();
      return;
    }
    setSelectedStudent(null);
    setSelectedDebt(null);
    setPhase('pickStudent');
  }

  function handlePickDebt(debt) {
    setSelectedDebt(debt);
    setAmount(String(debt.remaining));
    setSource(ACTIVE_PAYMENT_METHODS.cash ? 'cash' : 'iban');
    setNote('');
    setError(null);
    setPhase('enterAmount');
  }

  function handleBackToDebts() {
    setSelectedDebt(null);
    setError(null);
    setPhase('pickDebt');
  }

  async function handleSubmit() {
    if (!selectedDebt) return;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCashPayment({
        targetType: selectedDebt.targetType,
        targetId: selectedDebt.targetId,
        amount: amt,
        source,
        paidAt: new Date().toISOString(),
        note: note.trim() || null,
      });
      const remainingAfter = Math.max(0, selectedDebt.remaining - amt);
      const message = remainingAfter <= 0
        ? `${fmtTL(amt)} tahsil edildi · ${selectedStudent.full_name}`
        : `${fmtTL(amt)} kaydedildi · ${fmtTL(remainingAfter)} kalan`;
      onCompleted(message);
    } catch (err) {
      setError(err.message || 'Tahsilat kaydedilemedi.');
      setSubmitting(false);
    }
  }

  const students = studentsQuery.data ?? [];

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o && !submitting) onClose(); }}
      dismissible={!submitting}
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-csheet-overlay" />
        <Drawer.Content className="mobile-csheet-content">
          <Drawer.Handle className="mobile-csheet-handle" />
          <div className="mobile-csheet-form">
            <header className="mobile-csheet-header">
              <Drawer.Title className="mobile-csheet-title">Ödeme al</Drawer.Title>
              <div className="mobile-csheet-meta">
                {phase === 'pickStudent' && 'Önce öğrenciyi seç'}
                {phase === 'pickDebt' && (selectedStudent?.full_name || '')}
                {phase === 'enterAmount' && (selectedDebt?.title || '')}
              </div>
            </header>

            <div className="mobile-csheet-body">
              {phase === 'pickStudent' && (
                <FormRow label="Öğrenci">
                  <MobileStudentCombobox
                    students={students}
                    selected={null}
                    onSelect={handleSelectStudent}
                    onClear={() => {}}
                    loading={studentsQuery.isLoading}
                    autoFocus
                  />
                </FormRow>
              )}

              {phase === 'pickDebt' && selectedStudent && (
                <>
                  <FormRow label="Öğrenci">
                    <MobileStudentCombobox
                      students={students}
                      selected={selectedStudent}
                      onSelect={() => {}}
                      onClear={handleClearStudent}
                      loading={false}
                    />
                  </FormRow>

                  {debtsLoading && (
                    <div className="mobile-qpay-empty">Borçlar yükleniyor…</div>
                  )}
                  {!debtsLoading && debtsError && (
                    <div className="mobile-csheet-error" role="alert">{debtsError}</div>
                  )}
                  {!debtsLoading && !debtsError && debts.length === 0 && (
                    <div className="mobile-qpay-empty">
                      <span className="mobile-qpay-empty-icon" aria-hidden="true">✓</span>
                      <span>Açık borç yok</span>
                    </div>
                  )}

                  {!debtsLoading && debts.length > 0 && (
                    <div className="mobile-qpay-debt-list">
                      <div className="mobile-csheet-label">Açık borçlar</div>
                      {debts.map(d => (
                        <button
                          key={d.key}
                          type="button"
                          className="mobile-qpay-debt-card"
                          onClick={() => handlePickDebt(d)}
                        >
                          <span className="mobile-qpay-debt-main">
                            <span className="mobile-qpay-debt-title">{d.title}</span>
                            <span className="mobile-qpay-debt-sub">{d.subtitle}</span>
                          </span>
                          <span className="mobile-qpay-debt-amt">
                            <span className="mobile-qpay-debt-remaining">{fmtTL(d.remaining)}</span>
                            {d.paid > 0 && (
                              <span className="mobile-qpay-debt-meta">
                                {fmtTL(d.paid)} / {fmtTL(d.total)} ödendi
                              </span>
                            )}
                            {d.paid === 0 && (
                              <span className="mobile-qpay-debt-meta">{fmtTL(d.total)} toplam</span>
                            )}
                          </span>
                          <span className="mobile-qpay-debt-chev" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {phase === 'enterAmount' && selectedDebt && (
                <>
                  <div className="mobile-qpay-summary">
                    <div className="mobile-qpay-summary-row">
                      <span className="mobile-qpay-summary-label">Öğrenci</span>
                      <span className="mobile-qpay-summary-value">{selectedStudent.full_name}</span>
                    </div>
                    <div className="mobile-qpay-summary-row">
                      <span className="mobile-qpay-summary-label">Borç</span>
                      <span className="mobile-qpay-summary-value">
                        {selectedDebt.title}
                        {selectedDebt.subtitle && (
                          <span className="mobile-qpay-summary-meta"> · {selectedDebt.subtitle}</span>
                        )}
                      </span>
                    </div>
                    <div className="mobile-qpay-summary-row mobile-qpay-summary-row-emph">
                      <span className="mobile-qpay-summary-label">Kalan</span>
                      <span className="mobile-qpay-summary-value">{fmtTL(selectedDebt.remaining)}</span>
                    </div>
                  </div>

                  <FormRow label="Tutar (₺)">
                    <div className="mobile-lsheet-pay-amount-row">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        className="mobile-csheet-input"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        autoFocus
                      />
                      {selectedDebt.remaining > 0 && amount !== String(selectedDebt.remaining) && (
                        <button
                          type="button"
                          className="mobile-lsheet-pay-fill-btn"
                          onClick={() => setAmount(String(selectedDebt.remaining))}
                        >
                          Tümü
                        </button>
                      )}
                    </div>
                  </FormRow>

                  {ACTIVE_PAYMENT_METHODS.cash && ACTIVE_PAYMENT_METHODS.iban && (
                    <FormRow label="Yöntem">
                      <div className="mobile-csheet-mode">
                        <button
                          type="button"
                          className={'mobile-csheet-mode-btn' + (source === 'cash' ? ' is-on' : '')}
                          onClick={() => setSource('cash')}
                        >
                          Nakit
                        </button>
                        <button
                          type="button"
                          className={'mobile-csheet-mode-btn' + (source === 'iban' ? ' is-on' : '')}
                          onClick={() => setSource('iban')}
                        >
                          IBAN
                        </button>
                      </div>
                    </FormRow>
                  )}

                  <FormRow label="Not (opsiyonel)">
                    <input
                      type="text"
                      className="mobile-csheet-input"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Açıklama…"
                    />
                  </FormRow>

                  {error && <div className="mobile-csheet-error" role="alert">{error}</div>}
                </>
              )}
            </div>

            <footer className="mobile-csheet-actions">
              {phase === 'pickStudent' && (
                <>
                  <button
                    type="button"
                    className="mobile-csheet-btn-ghost mobile-csheet-btn-full"
                    onClick={onClose}
                  >
                    Vazgeç
                  </button>
                </>
              )}
              {phase === 'pickDebt' && (
                <>
                  <button
                    type="button"
                    className="mobile-csheet-btn-ghost"
                    onClick={onClose}
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    className="mobile-csheet-btn-ghost"
                    onClick={handleClearStudent}
                  >
                    Geri
                  </button>
                </>
              )}
              {phase === 'enterAmount' && (
                <>
                  <button
                    type="button"
                    className="mobile-csheet-btn-ghost"
                    onClick={handleBackToDebts}
                    disabled={submitting}
                  >
                    Geri
                  </button>
                  <button
                    type="button"
                    className="mobile-csheet-btn-primary"
                    onClick={handleSubmit}
                    disabled={submitting || !amount || parseFloat(amount) <= 0}
                  >
                    {submitting ? 'Kaydediliyor…' : 'Tahsil et'}
                  </button>
                </>
              )}
            </footer>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

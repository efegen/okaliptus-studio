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
import { allocateFifo } from '../students';
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

  const [phase, setPhase] = React.useState(preselectedStudent ? 'pay' : 'pickStudent');
  const [selectedStudent, setSelectedStudent] = React.useState(preselectedStudent);
  const [mode, setMode] = React.useState('auto'); // 'auto' | 'single'
  const [selectedTargetKey, setSelectedTargetKey] = React.useState(null);
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
        dateIso: l.starts_at,
        title: 'Ders',
        subtitle: `${formatLessonDate(l.starts_at)} · ${formatLessonTime(l.starts_at)}`,
        total,
        paid,
        remainingAmount: remaining,
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
        dateIso: s.sold_at,
        title: (s.note && String(s.note).trim()) || 'Ürün satışı',
        subtitle: formatLessonDate(s.sold_at),
        total,
        paid,
        remainingAmount: remaining,
      });
    }
    items.sort((a, b) => {
      const ta = a.dateIso ? new Date(a.dateIso).getTime() : 0;
      const tb = b.dateIso ? new Date(b.dateIso).getTime() : 0;
      return ta - tb; // en eski önce — FIFO için
    });
    return items;
  }, [lessonsQuery.data, salesQuery.data]);

  const debtsLoading = !!selectedStudent && (lessonsQuery.isLoading || salesQuery.isLoading);
  const debtsError = (lessonsQuery.error || salesQuery.error)?.message || null;
  const totalRemaining = debts.reduce((s, d) => s + d.remainingAmount, 0);

  const selectedItem = mode === 'single'
    ? (debts.find(d => d.key === selectedTargetKey) ?? null)
    : null;

  const parsedAmount = parseFloat(amount) || 0;
  const maxAmount = selectedItem ? selectedItem.remainingAmount : totalRemaining;
  const isOverDebt = parsedAmount > maxAmount + 0.001;
  const isMultiItem = debts.length > 1;
  const rowsClickable = mode === 'auto' && isMultiItem && !submitting;

  const allocations = React.useMemo(() => {
    if (parsedAmount <= 0 || isOverDebt) return [];
    if (mode === 'single' && selectedItem) {
      return [{ item: selectedItem, portion: parsedAmount }];
    }
    return allocateFifo(debts, parsedAmount);
  }, [mode, selectedItem, debts, parsedAmount, isOverDebt]);

  const listItems = React.useMemo(() => {
    if (allocations.length > 0) {
      return allocations.map(a => ({ ...a, planned: true }));
    }
    if (mode === 'single' && selectedItem) {
      return [{ item: selectedItem, portion: selectedItem.remainingAmount, planned: false }];
    }
    return debts.map(d => ({ item: d, portion: d.remainingAmount, planned: false }));
  }, [allocations, mode, selectedItem, debts]);

  const canSubmit =
    parsedAmount > 0 && !isOverDebt && !submitting && allocations.length > 0;

  function reset() {
    setPhase(preselectedStudent ? 'pay' : 'pickStudent');
    setSelectedStudent(preselectedStudent);
    setMode('auto');
    setSelectedTargetKey(null);
    setAmount('');
    setSource('cash');
    setNote('');
    setSubmitting(false);
    setError(null);
  }

  // Drawer her açılışında/kapanışında veya preselectedStudent değişiminde
  // state'i baştan kur — profilden gelen öğrenci, sheet ilk açıldığında
  // henüz state'e set edilmemiş olabilir.
  React.useEffect(() => {
    reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedStudent]);

  function handleSelectStudent(s) {
    setSelectedStudent(s);
    setPhase('pay');
  }

  function handleClearStudent() {
    if (preselectedStudent) {
      onClose();
      return;
    }
    setSelectedStudent(null);
    setMode('auto');
    setSelectedTargetKey(null);
    setAmount('');
    setError(null);
    setPhase('pickStudent');
  }

  function handlePickItem(item) {
    setMode('single');
    setSelectedTargetKey(item.key);
    setError(null);
    // Tutar otomatik doldurulmaz — kullanıcı kendi belirler.
  }

  function handleBackToAuto() {
    setMode('auto');
    setSelectedTargetKey(null);
    setError(null);
  }

  async function handleSubmit() {
    if (allocations.length === 0) { setError('Tahsil edilecek kalem yok.'); return; }
    if (parsedAmount <= 0) { setError('Tutar sıfırdan büyük olmalı.'); return; }
    if (isOverDebt) {
      setError(mode === 'single'
        ? 'Tutar bu kalemin kalanından fazla olamaz.'
        : 'Tutar açık borç toplamından fazla olamaz.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const paidAtIso = new Date().toISOString();
    const noteValue = note.trim() || null;
    let succeeded = 0;

    try {
      for (const { item, portion } of allocations) {
        await createCashPayment({
          targetType: item.targetType,
          targetId: item.targetId,
          amount: portion.toFixed(2),
          source,
          paidAt: paidAtIso,
          note: noteValue,
        });
        succeeded += 1;
      }
      const remainingAfter = Math.max(0, totalRemaining - parsedAmount);
      const message = remainingAfter <= 0.005
        ? `${fmtTL(parsedAmount)} tahsil edildi · ${selectedStudent.full_name}`
        : `${fmtTL(parsedAmount)} kaydedildi · ${fmtTL(remainingAfter)} kalan`;
      onCompleted(message);
    } catch (err) {
      const baseMsg = err?.message || 'Tahsilat kaydedilemedi.';
      const tail = succeeded > 0 ? ` (${succeeded}/${allocations.length} kalem kaydedildi)` : '';
      setError(baseMsg + tail);
      setSubmitting(false);
      if (succeeded > 0) {
        // Yarısı geçti — listeyi tazele, kullanıcı kalan için tekrar deneyebilsin
        lessonsQuery.refetch();
        salesQuery.refetch();
        setMode('auto');
        setSelectedTargetKey(null);
        setAmount('');
      }
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
                {phase === 'pay' && selectedStudent && (
                  <span className="mobile-qpay-subhead">
                    <strong>{selectedStudent.full_name}</strong>
                    {debts.length > 0 && (
                      <>
                        <span className="mobile-qpay-subhead-sep" aria-hidden="true"> · </span>
                        Açık borç: <strong>{fmtTL(totalRemaining)}</strong>
                        <span className="mobile-qpay-subhead-sep" aria-hidden="true"> · </span>
                        {debts.length} kalem
                      </>
                    )}
                  </span>
                )}
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

              {phase === 'pay' && selectedStudent && (
                <>
                  {!preselectedStudent && (
                    <FormRow label="Öğrenci">
                      <MobileStudentCombobox
                        students={students}
                        selected={selectedStudent}
                        onSelect={() => {}}
                        onClear={handleClearStudent}
                        loading={false}
                      />
                    </FormRow>
                  )}

                  {mode === 'single' && selectedItem && (
                    <div className="mobile-qpay-mode-banner">
                      <span className="mobile-qpay-mode-banner-text">
                        <strong>Sadece bu kaleme:</strong> {selectedItem.title}
                        {selectedItem.subtitle && ` · ${selectedItem.subtitle}`}
                        {' · '}{fmtTL(selectedItem.remainingAmount)} kalan
                      </span>
                      <button
                        type="button"
                        className="mobile-qpay-mode-banner-btn"
                        onClick={handleBackToAuto}
                        disabled={submitting}
                      >
                        Tüm borçlar
                      </button>
                    </div>
                  )}

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
                    <>
                      <FormRow label="Tutar (₺)">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0.01"
                          step="0.01"
                          className="mobile-csheet-input"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                          placeholder="0,00"
                          autoFocus
                        />
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

                      <div className="mobile-qpay-allocations">
                        <div className="mobile-qpay-allocations-head">
                          {allocations.length > 0
                            ? (mode === 'single' ? 'İşlenecek kalem' : 'İşlenecek kalemler')
                            : 'Açık borç kalemleri'}
                          {mode === 'auto' && listItems.length > 1 && (
                            <span className="mobile-qpay-allocations-hint"> · en eski → yeni</span>
                          )}
                        </div>
                        {rowsClickable && (
                          <div className="mobile-qpay-allocations-tip">
                            Sadece bir kaleme ödemek için kaleme dokun
                          </div>
                        )}
                        {listItems.map(({ item, portion, planned }) => {
                          const isPartial = planned && portion < item.remainingAmount - 0.001;
                          const RowTag = rowsClickable ? 'button' : 'div';
                          return (
                            <RowTag
                              key={item.key}
                              {...(rowsClickable ? { type: 'button', onClick: () => handlePickItem(item) } : {})}
                              className={'mobile-qpay-alloc-row' + (rowsClickable ? ' is-clickable' : '')}
                            >
                              <span className="mobile-qpay-alloc-main">
                                <span className="mobile-qpay-alloc-title">{item.title}</span>
                                <span className="mobile-qpay-alloc-sub">{item.subtitle}</span>
                              </span>
                              <span className="mobile-qpay-alloc-amount">
                                <span className="mobile-qpay-alloc-portion">{fmtTL(portion)}</span>
                                {isPartial && <span className="mobile-qpay-alloc-partial">kısmi</span>}
                              </span>
                              {rowsClickable && (
                                <span className="mobile-qpay-alloc-chev" aria-hidden="true">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M9 6l6 6-6 6" />
                                  </svg>
                                </span>
                              )}
                            </RowTag>
                          );
                        })}
                      </div>

                      {isOverDebt && (
                        <div className="mobile-csheet-error" role="alert">
                          Tutar {mode === 'single' ? 'bu kalemin' : 'açık borç'} kalanından ({fmtTL(maxAmount)}) fazla olamaz.
                        </div>
                      )}
                      {error && <div className="mobile-csheet-error" role="alert">{error}</div>}
                    </>
                  )}
                </>
              )}
            </div>

            <footer className="mobile-csheet-actions">
              {phase === 'pickStudent' && (
                <button
                  type="button"
                  className="mobile-csheet-btn-ghost mobile-csheet-btn-full"
                  onClick={onClose}
                >
                  Vazgeç
                </button>
              )}
              {phase === 'pay' && (
                <>
                  <button
                    type="button"
                    className="mobile-csheet-btn-ghost"
                    onClick={onClose}
                    disabled={submitting}
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    className="mobile-csheet-btn-primary"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                  >
                    {submitting
                      ? 'Kaydediliyor…'
                      : (parsedAmount > 0 && !isOverDebt
                          ? `${fmtTL(parsedAmount)} kaydet`
                          : 'Tahsil et')}
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

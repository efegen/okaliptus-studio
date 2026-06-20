import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getStudentLessons,
  getStudentProductSales,
  createCashPayment,
} from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { allocateFifo } from '../students';

// "Ödeme al" — öğrenci profilinden sağdan tam-sayfa (push) açılan tahsilat ekranı.
// Tasarım: "Mobil Ödeme Al - 2 Tasarım" · A · Sabit Tutar Başlığı.
// Tutar + yöntem üstte SABİT panoda durur; kalemler aşağıda kayar — böylece
// (eski alttan-modülün aksine) kalem sayısı ne olursa olsun Tutar alanı asla
// ekran dışına taşıp kaybolmaz. Dağıtım FIFO/otomatiktir (en eski → yeni);
// eski sheet'teki "sadece bu kaleme" tek-kalem kilidi bu tasarımda yoktur.

// ─── Biçim yardımcıları ───────────────────────────────────────────────────────

function fmtNum(n) {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function initials(name) {
  const p = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '';
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toLocaleUpperCase('tr');
}

// "1.234,56" → 1234.56 ; boş → 0 (TR yerel girişini sayıya çevirir).
function parseAmt(str) {
  if (!str) return 0;
  const clean = String(str).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  return parseFloat(clean) || 0;
}

function formatLessonDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  });
}

function formatLessonTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  });
}

// ─── İkonlar (inline SVG) ─────────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LessonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v3.2l2 1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function BagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 5h9l-.7 8.2a1 1 0 0 1-1 .8H5.2a1 1 0 0 1-1-.8L3.5 5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.8 5a2.2 2.2 0 0 1 4.4 0" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function CashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="4" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
function BankIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2L2.5 5.5h13L9 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M4 8v5M7 8v5M11 8v5M14 8v5M2.5 15.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Ortak parçalar ───────────────────────────────────────────────────────────

function MethodSeg({ value, onChange, disabled }) {
  return (
    <div className="pay-seg">
      <button
        type="button"
        className={'pay-seg-btn' + (value === 'cash' ? ' on' : '')}
        onClick={() => onChange('cash')}
        disabled={disabled}
      >
        <CashIcon /> Nakit
      </button>
      <button
        type="button"
        className={'pay-seg-btn' + (value === 'iban' ? ' on' : '')}
        onClick={() => onChange('iban')}
        disabled={disabled}
      >
        <BankIcon /> IBAN
      </button>
    </div>
  );
}

// Salt-okunur kalem önizlemesi: girilen tutarın FIFO dağılımını gösterir.
function ItemList({ debts, allocations, amountActive }) {
  const portionByKey = new Map(allocations.map(a => [a.item.key, a.portion]));
  return (
    <div className="pay-items">
      {debts.map(d => {
        const portion = portionByKey.get(d.key) || 0;
        const covered = amountActive ? portion > 0.001 : true;
        const isPartial = amountActive && portion > 0.001 && portion < d.remainingAmount - 0.001;
        const Icon = d.kind === 'sale' ? BagIcon : LessonIcon;
        return (
          <div
            key={d.key}
            className="pay-item"
            style={amountActive && !covered ? { opacity: 0.5 } : undefined}
          >
            <span className={'pay-item-dot ' + (d.kind === 'sale' ? 'sale' : (covered ? '' : 'muted'))}>
              <Icon />
            </span>
            <span className="pay-item-tx">
              <span className="pay-item-t">{d.title}</span>
              <span className="pay-item-s">{d.subtitle}</span>
            </span>
            <span className="pay-item-amt">
              <span className={'pay-item-portion' + (covered ? '' : ' zero')}>
                {fmtTL(amountActive ? portion : d.remainingAmount)}
              </span>
              {amountActive && (isPartial
                ? <span className="pay-item-partial">kısmi</span>
                : <span className="pay-item-rem">/ {fmtTL(d.remainingAmount)}</span>)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sayfa ────────────────────────────────────────────────────────────────────

export function MobileCollectPaymentPage({ student, onBack, onCompleted }) {
  const studentId = student?.id ?? null;

  const lessonsQuery = useQuery({
    queryKey: studentId ? queryKeys.studentLessons(studentId) : ['noop-lessons'],
    queryFn: () => getStudentLessons(studentId),
    staleTime: 30 * 1000,
    enabled: !!studentId,
  });
  const salesQuery = useQuery({
    queryKey: studentId ? queryKeys.studentProductSales(studentId) : ['noop-sales'],
    queryFn: () => getStudentProductSales(studentId),
    staleTime: 30 * 1000,
    enabled: !!studentId,
  });

  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState('cash');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  // Açık borç kalemleri (completed dersler + ürün satışları), en eski → yeni.
  const debts = React.useMemo(() => {
    const items = [];
    for (const l of lessonsQuery.data ?? []) {
      const remaining = Number(l.remaining_receivable) || 0;
      if (remaining < 0.01) continue;
      if (l.status !== 'completed') continue;
      items.push({
        key: `lesson-${l.id}`,
        kind: 'lesson',
        targetType: 'lesson',
        targetId: l.id,
        dateIso: l.starts_at,
        title: 'Ders',
        subtitle: `${formatLessonDate(l.starts_at)} · ${formatLessonTime(l.starts_at)}`,
        remainingAmount: remaining,
      });
    }
    for (const s of salesQuery.data ?? []) {
      const remaining = Number(s.remaining_receivable) || 0;
      if (remaining < 0.01) continue;
      items.push({
        key: `sale-${s.product_sale_id}`,
        kind: 'sale',
        targetType: 'product_sale',
        targetId: s.product_sale_id,
        dateIso: s.sold_at,
        title: (s.note && String(s.note).trim()) || 'Ürün satışı',
        subtitle: formatLessonDate(s.sold_at),
        remainingAmount: remaining,
      });
    }
    items.sort((a, b) => {
      const ta = a.dateIso ? new Date(a.dateIso).getTime() : 0;
      const tb = b.dateIso ? new Date(b.dateIso).getTime() : 0;
      return ta - tb; // FIFO — en eski önce
    });
    return items;
  }, [lessonsQuery.data, salesQuery.data]);

  const totalRemaining = debts.reduce((s, d) => s + d.remainingAmount, 0);
  const val = parseAmt(amount);
  const over = val > totalRemaining + 0.001;
  const amountActive = val > 0;

  // Tutarın FIFO dağılımı (hem önizleme hem tahsilat için). val > toplam ise
  // allocateFifo tüm kalemleri tam doldurur (artığı yok sayar) → önizleme yine
  // anlamlı; gönderim `over`/`canPay` ile engellenir.
  const allocations = React.useMemo(() => allocateFifo(debts, val), [debts, val]);

  const debtsLoading = lessonsQuery.isLoading || salesQuery.isLoading;
  const debtsError = (lessonsQuery.error || salesQuery.error)?.message || null;
  const hasDebts = debts.length > 0;
  const canPay = val > 0 && !over && allocations.length > 0 && !submitting;

  function onAmountInput(e) {
    setError(null);
    setAmount(e.target.value.replace(/[^\d,]/g, '')); // yalnız rakam + virgül
  }

  function fillAll() {
    setError(null);
    setAmount(fmtNum(totalRemaining).replace(/\./g, ''));
  }

  async function handleSubmit() {
    if (allocations.length === 0 || val <= 0) { setError('Tahsil edilecek tutarı gir.'); return; }
    if (over) { setError('Tutar açık borçtan fazla olamaz.'); return; }
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
          source: method,
          paidAt: paidAtIso,
          note: noteValue,
        });
        succeeded += 1;
      }
      const remainingAfter = Math.max(0, totalRemaining - val);
      const message = remainingAfter <= 0.005
        ? `${fmtTL(val)} tahsil edildi · ${student.full_name}`
        : `${fmtTL(val)} kaydedildi · ${fmtTL(remainingAfter)} kalan`;
      onCompleted(message);
    } catch (err) {
      const baseMsg = err?.message || 'Tahsilat kaydedilemedi.';
      const tail = succeeded > 0 ? ` (${succeeded}/${allocations.length} kalem kaydedildi)` : '';
      setError(baseMsg + tail);
      setSubmitting(false);
      if (succeeded > 0) {
        // Bir kısmı geçti — listeyi tazele, kullanıcı kalan için tekrar dener.
        lessonsQuery.refetch();
        salesQuery.refetch();
        setAmount('');
      }
    }
  }

  if (!student) {
    return (
      <div className="pay-page">
        <header className="pay-top">
          <button type="button" className="pay-back" aria-label="Geri" onClick={onBack}><BackIcon /></button>
          <div className="pay-top-title">Ödeme al</div>
          <div />
        </header>
        <div className="payA-body">
          <div className="pay-error" role="alert">Öğrenci bulunamadı.</div>
        </div>
      </div>
    );
  }

  let debtSummary;
  if (debtsLoading) debtSummary = 'Borçlar yükleniyor…';
  else if (debtsError) debtSummary = 'Borçlar alınamadı';
  else if (hasDebts) debtSummary = <>Açık borç <strong>{fmtTL(totalRemaining)}</strong> · {debts.length} kalem</>;
  else debtSummary = 'Açık borç yok';

  return (
    <div className="pay-page">
      <header className="pay-top">
        <button type="button" className="pay-back" aria-label="Geri" onClick={onBack} disabled={submitting}>
          <BackIcon />
        </button>
        <div className="pay-top-title">Ödeme al</div>
        <div />
      </header>

      {/* SABİT pano — kalem sayısı ne olursa olsun hep görünür */}
      <div className="payA-pin">
        <div className="payA-who">
          <span className="pay-av">{initials(student.full_name) || '·'}</span>
          <span className="payA-who-tx">
            <span className="payA-who-name">{student.full_name}</span>
            <span className="payA-who-debt">{debtSummary}</span>
          </span>
        </div>
        {hasDebts && (
          <>
            <div className="payA-amount">
              <span className="payA-amount-cur">₺</span>
              <input
                className="payA-amount-in"
                inputMode="decimal"
                value={amount}
                onChange={onAmountInput}
                placeholder="0"
                aria-label="Tutar"
                autoFocus
                disabled={submitting}
              />
              <button type="button" className="payA-amount-max" onClick={fillAll} disabled={submitting}>
                Tümü
              </button>
            </div>
            <MethodSeg value={method} onChange={setMethod} disabled={submitting} />
          </>
        )}
      </div>

      {/* KAYAN gövde */}
      <div className="payA-body">
        {debtsLoading && <div className="payA-empty">Borçlar yükleniyor…</div>}
        {!debtsLoading && debtsError && <div className="pay-error" role="alert">{debtsError}</div>}
        {!debtsLoading && !debtsError && !hasDebts && (
          <div className="payA-empty">
            <span className="payA-empty-ic" aria-hidden="true">✓</span>
            <span>Açık borç yok</span>
          </div>
        )}
        {!debtsLoading && !debtsError && hasDebts && (
          <>
            <div className="payA-sec">
              <div className="pay-items-h">
                <span className="pay-items-t">{amountActive ? 'İşlenecek kalemler' : 'Açık borç kalemleri'}</span>
                {debts.length > 1 && <span className="pay-items-hint">en eski → yeni</span>}
              </div>
              <ItemList debts={debts} allocations={allocations} amountActive={amountActive} />
              {over && (
                <div className="payA-over">Tutar açık borçtan ({fmtTL(totalRemaining)}) fazla olamaz.</div>
              )}
              {error && <div className="pay-error" role="alert">{error}</div>}
            </div>

            <div className="payA-sec">
              <div className="pay-items-h"><span className="pay-items-t">Not (opsiyonel)</span></div>
              <textarea
                className="payA-note"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Açıklama…"
                disabled={submitting}
              />
            </div>
          </>
        )}
      </div>

      <footer className="pay-foot">
        <button type="button" className="pay-cta" onClick={handleSubmit} disabled={!canPay}>
          {submitting
            ? 'Kaydediliyor…'
            : (canPay ? <>Tahsil et · <span className="pay-cta-amt">{fmtTL(val)}</span></> : 'Tutar gir')}
        </button>
      </footer>
    </div>
  );
}

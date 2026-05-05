// Students page — full-width list view

import React from 'react';
import ReactDOM from 'react-dom';
import { fmtTL } from './data';
import { Icon, Avatar } from './layout';
import {
  getStudents,
  getStudentById,
  getStudentLessons,
  getStudentPackages,
  getStudentProductSales,
  getStudentsKpi,
  createCashPayment,
  createStudent,
} from './api';
import { DiscountInline } from './student-profile';

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtShortDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
}

export function parseMoney(v) {
  return parseFloat(v ?? '0') || 0;
}

function toDateTimeLocalValue(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = p => String(p).padStart(2, '0');
  return [
    d.getFullYear(), '-', pad(d.getMonth() + 1), '-', pad(d.getDate()),
    'T', pad(d.getHours()), ':', pad(d.getMinutes()),
  ].join('');
}

// tone: 'high' | 'medium' | 'low' | 'absent' | 'inactive' | 'new'
export function getAttendanceStatus(student) {
  const count30 = parseInt(student.lessons_last_30_days ?? '0', 10);
  const lastAt  = student.last_lesson_at;

  if (!lastAt) {
    return { tone: 'new', main: 'Yeni öğrenci', sub: 'Henüz ders yapılmadı' };
  }

  const daysSince = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000);

  if (count30 === 0) {
    if (daysSince >= 45) {
      return { tone: 'inactive', main: 'Pasif', sub: `${daysSince} gündür katılım yok` };
    }
    return { tone: 'absent', main: 'Bu ay gelmedi', sub: `Son ders ${fmtShortDate(lastAt)}` };
  }

  if (count30 === 1) {
    return { tone: 'low', main: 'Düşük', sub: 'Son 30 günde 1 ders' };
  }

  if (count30 <= 3) {
    return { tone: 'medium', main: 'Orta', sub: `Son 30 günde ${count30} ders` };
  }

  return { tone: 'high', main: 'Yüksek', sub: `Bu ay ${count30} derse katıldı` };
}

export function getStudentFinancialState({ lessonDebt, productDebt }) {
  const total = lessonDebt + productDebt;
  if (total > 0.01) return { tone: 'debt', headline: `${fmtTL(total)} borç` };
  return { tone: 'clear', headline: 'Borç yok' };
}

export function buildOpenDebtItems(detail) {
  const lessonItems = (detail?.lessons ?? [])
    .filter(l =>
      l.status === 'completed' &&
      !l.prepaid_package_id &&
      parseMoney(l.remaining_receivable) > 0.01
    )
    .map(l => {
      const gross = parseMoney(l.price_snapshot);
      const discount = parseMoney(l.discount_amount);
      const net = parseMoney(l.net_amount ?? (gross - discount));
      return {
        key: `lesson-${l.id}`,
        targetType: 'lesson',
        targetId: l.id,
        dateIso: l.starts_at,
        typeLabel: 'Ders',
        description: l.note?.trim() || 'Özel ders',
        grossAmount: gross,
        discountAmount: discount,
        totalAmount: net,
        paidAmount: parseMoney(l.paid_amount),
        remainingAmount: parseMoney(l.remaining_receivable),
        canDiscount: true,
      };
    });

  const saleItems = (detail?.productSales ?? [])
    .filter(s => parseMoney(s.remaining_receivable) > 0.01)
    .map(s => ({
      key: `product-sale-${s.product_sale_id}`,
      targetType: 'product_sale',
      targetId: s.product_sale_id,
      dateIso: s.sold_at,
      typeLabel: 'Ürün satışı',
      description: 'Ürün satışı',
      grossAmount: parseMoney(s.total_amount),
      discountAmount: 0,
      totalAmount: parseMoney(s.total_amount),
      paidAmount: parseMoney(s.paid_amount),
      remainingAmount: parseMoney(s.remaining_receivable),
      canDiscount: false,
    }));

  return [...lessonItems, ...saleItems].sort(
    (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime(),
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function StudentsPage({ onOpenStudent }) {
  const [students, setStudents] = React.useState([]);
  const [studentsLoading, setStudentsLoading] = React.useState(true);
  const [kpi, setKpi] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [paymentTarget, setPaymentTarget] = React.useState(null);
  const [paymentLoading, setPaymentLoading] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setStudentsLoading(true);
    getStudents()
      .then(data => { if (!cancelled) setStudents(data); })
      .catch(err => console.error('[Students] liste yüklenemedi:', err))
      .finally(() => { if (!cancelled) setStudentsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    getStudentsKpi()
      .then(data => { if (!cancelled) setKpi(data); })
      .catch(err => console.error('[Students] KPI yüklenemedi:', err));
    return () => { cancelled = true; };
  }, []);

  async function refreshStudents() {
    try {
      const [fresh, freshKpi] = await Promise.all([getStudents(), getStudentsKpi()]);
      setStudents(fresh);
      setKpi(freshKpi);
    } catch (err) {
      console.error('[Students] liste yenilenemedi:', err);
    }
  }

  const filtered = students.filter(s => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      s.full_name.toLowerCase().includes(q) ||
      (s.nickname && s.nickname.toLowerCase().includes(q)) ||
      (s.phone && s.phone.includes(query))
    );
  });

  async function handleOpenPayment(studentId) {
    setPaymentLoading(true);
    try {
      const [student, lessons, packages, productSales] = await Promise.all([
        getStudentById(studentId),
        getStudentLessons(studentId),
        getStudentPackages(studentId),
        getStudentProductSales(studentId),
      ]);
      setPaymentTarget({
        student,
        detail: { student, lessons, packages, productSales },
      });
    } catch (err) {
      console.error('[Students] ödeme detayı yüklenemedi:', err);
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handlePaymentSaved() {
    setPaymentTarget(null);
    await refreshStudents();
  }

  async function handleStudentCreated(created) {
    setCreateOpen(false);
    await refreshStudents();
    if (created?.id && onOpenStudent) {
      onOpenStudent(String(created.id));
    }
  }

  return (
    <div className="page page-students">
      <div className="page-head">
        <div>
          <div className="eyebrow">{students.length} öğrenci</div>
          <h1 className="page-title">Öğrenciler</h1>
        </div>
        <div className="head-actions">
          <div className="page-search">
            <Icon.Search width="15" height="15"/>
            <input
              placeholder="İsim veya telefon ara..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            <Icon.Plus width="15" height="15"/>Yeni öğrenci
          </button>
        </div>
      </div>

      <StudentsKpiRow kpi={kpi} />

      <div className="card stu-list-card">
        {studentsLoading ? (
          <div className="stu-state-msg">Yükleniyor...</div>
        ) : students.length === 0 ? (
          <EmptyStudents onCreate={() => setCreateOpen(true)} />
        ) : filtered.length === 0 ? (
          <div className="stu-state-msg">"{query}" için sonuç bulunamadı.</div>
        ) : (
          <table className="stu-table">
            <thead className="stu-thead">
              <tr>
                <th className="stu-th">Öğrenci</th>
                <th className="stu-th">Telefon</th>
                <th className="stu-th">Finansal Durum</th>
                <th className="stu-th">Devam Durumu</th>
                <th className="stu-th">Son Ders</th>
                <th className="stu-th stu-th-end"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(st => (
                <StudentRow
                  key={st.id}
                  student={st}
                  onPaymentClick={handleOpenPayment}
                  onOpenStudent={onOpenStudent}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {paymentLoading && (
        <div className="modal-backdrop">
          <div className="modal stu-loading-modal">Yükleniyor...</div>
        </div>
      )}

      {paymentTarget && (
        <ReceivePaymentModal
          student={paymentTarget.student}
          detail={paymentTarget.detail}
          onClose={() => setPaymentTarget(null)}
          onSuccess={handlePaymentSaved}
        />
      )}

      {createOpen && (
        <CreateStudentModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleStudentCreated}
        />
      )}
    </div>
  );
}

// ─── KPI Row ──────────────────────────────────────────────────────────────────

function StudentsKpiRow({ kpi }) {
  const activeCount = kpi?.activeCount ?? null;
  const newThisMonth = kpi?.newThisMonth ?? null;
  const debtorCount = kpi?.debtorCount ?? null;
  const totalDebt = kpi ? parseMoney(kpi.totalDebt) : 0;
  const inactive14 = kpi?.inactiveOver14Days ?? null;
  const monthlyCompleted = kpi?.monthlyCompletedLessons ?? null;
  const prevMonthlyCompleted = kpi?.previousMonthCompletedLessons ?? null;

  const monthlyDelta =
    monthlyCompleted !== null && prevMonthlyCompleted !== null
      ? monthlyCompleted - prevMonthlyCompleted
      : null;

  const monthlyDeltaTone =
    monthlyDelta === null ? 'flat' : monthlyDelta > 0 ? 'up' : monthlyDelta < 0 ? 'down' : 'flat';

  function fmtNum(v) {
    return v === null ? '—' : String(v);
  }

  const debtorWarn = (debtorCount ?? 0) > 0;

  return (
    <div className="kpi-row">
      <div className="kpi-card">
        <div className="kpi-card-label">Aktif öğrenci</div>
        <div className="kpi-card-main">
          <span className="kpi-card-val">{fmtNum(activeCount)}</span>
        </div>
        <div className="kpi-card-sub">
          {newThisMonth !== null
            ? <><strong>{newThisMonth}</strong> bu ay yeni eklendi</>
            : <>—</>
          }
        </div>
      </div>

      <div className={`kpi-card${debtorWarn ? ' kpi-card-warn' : ''}`}>
        <div className="kpi-card-label">Borçlu öğrenci</div>
        <div className="kpi-card-main">
          <span className="kpi-card-val">{fmtNum(debtorCount)}</span>
        </div>
        <div className="kpi-card-sub">
          {kpi
            ? <>Toplam borç <strong>{fmtTL(totalDebt)}</strong></>
            : <>—</>
          }
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-card-label">14+ gündür gelmeyen</div>
        <div className="kpi-card-main">
          <span className="kpi-card-val">{fmtNum(inactive14)}</span>
        </div>
        <div className="kpi-card-sub">
          {inactive14 !== null
            ? <>Aktif öğrenciler arasında</>
            : <>—</>
          }
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-card-label">Bu ay tamamlanan ders</div>
        <div className="kpi-card-main">
          <span className="kpi-card-val">{fmtNum(monthlyCompleted)}</span>
        </div>
        <div className="kpi-card-sub">
          {monthlyDelta === null ? (
            <>—</>
          ) : (
            <>
              Geçen ay <strong>{prevMonthlyCompleted}</strong>
              {' · '}
              <span className={`stu-kpi-delta stu-kpi-delta-${monthlyDeltaTone}`}>
                {monthlyDelta > 0 ? `+${monthlyDelta}` : monthlyDelta}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyStudents({ onCreate }) {
  return (
    <div className="stu-empty">
      <div className="stu-empty-icon">
        <Icon.Users width="26" height="26"/>
      </div>
      <div className="stu-empty-title">Henüz öğrenci yok</div>
      <div className="stu-empty-sub">İlk öğrenciyi ekleyerek başlayın.</div>
      <button className="btn btn-primary" onClick={onCreate}>
        <Icon.Plus width="15" height="15"/>Yeni öğrenci
      </button>
    </div>
  );
}

// ─── Student Row ──────────────────────────────────────────────────────────────

function StudentRow({ student, onPaymentClick, onOpenStudent }) {
  const lessonDebt  = parseMoney(student.lesson_debt);
  const productDebt = parseMoney(student.product_debt);
  const fin = getStudentFinancialState({ lessonDebt, productDebt });
  const hasBreakdown = lessonDebt > 0.01 && productDebt > 0.01;
  const att = getAttendanceStatus(student);

  const [tipPos, setTipPos] = React.useState(null);
  const wrapRef = React.useRef(null);

  function handleMouseEnter() {
    if (!hasBreakdown) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setTipPos({ top: rect.bottom + 7, left: rect.left });
  }

  function handleMouseLeave() {
    setTipPos(null);
  }

  return (
    <tr
      className="stu-tr"
      onClick={() => onOpenStudent && onOpenStudent(String(student.id))}
    >
      <td className="stu-td">
        <div className="stu-name-cell">
          <Avatar name={student.full_name} size="sm" soft/>
          <div className="stu-name-stack">
            <div className="stu-full-name">
              {student.full_name}
              {student.nickname && (
                <span className="stu-nick" title="Lakap">{student.nickname}</span>
              )}
            </div>
            {!student.is_active && <span className="stu-inactive-tag">pasif</span>}
          </div>
        </div>
      </td>

      <td className="stu-td">
        {student.phone
          ? <span className="stu-phone">{student.phone}</span>
          : <span className="stu-muted">—</span>
        }
      </td>

      <td className="stu-td">
        <div
          className="stu-fin-wrap"
          ref={wrapRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className={`stu-fin-badge stu-fin-${fin.tone}`}>
            {fin.headline}
          </div>
          {tipPos && ReactDOM.createPortal(
            <div className="stu-fin-tip" style={{ top: tipPos.top, left: tipPos.left }}>
              <div className="sft-row">
                <span className="sft-k">Ders borcu</span>
                <span className="sft-v sft-debt">{fmtTL(lessonDebt)}</span>
              </div>
              <div className="sft-row">
                <span className="sft-k">Ürün borcu</span>
                <span className="sft-v sft-debt">{fmtTL(productDebt)}</span>
              </div>
              <div className="sft-row sft-row-total">
                <span className="sft-k">Toplam borç</span>
                <span className="sft-v sft-debt">{fmtTL(lessonDebt + productDebt)}</span>
              </div>
            </div>,
            document.body
          )}
        </div>
      </td>

      <td className="stu-td">
        <div className="stu-att-wrap">
          <span className={`stu-att-badge stu-att-${att.tone}`}>{att.main}</span>
          <span className="stu-att-sub">{att.sub}</span>
        </div>
      </td>

      <td className="stu-td">
        {student.last_lesson_at
          ? <span className="stu-activity">{fmtDate(student.last_lesson_at)}</span>
          : <span className="stu-muted">—</span>
        }
      </td>

      <td className="stu-td stu-td-actions">
        <div className="stu-row-actions">
          <button
            className="btn btn-ghost btn-xs"
            onClick={e => { e.stopPropagation(); }}
          >
            Ders ekle
          </button>
          <button
            className="btn btn-accent btn-xs"
            onClick={e => { e.stopPropagation(); onPaymentClick(String(student.id)); }}
          >
            Ödeme al
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Receive Payment Modal ────────────────────────────────────────────────────

export function ReceivePaymentModal({ student, detail, onClose, onSuccess }) {
  const [localDetail, setLocalDetail] = React.useState(detail);
  React.useEffect(() => { setLocalDetail(detail); }, [detail]);

  async function refreshDetail() {
    const [lessons, productSales] = await Promise.all([
      getStudentLessons(student.id),
      getStudentProductSales(student.id),
    ]);
    setLocalDetail({ ...localDetail, lessons, productSales });
  }

  const debtItems = buildOpenDebtItems(localDetail);
  const [selectedKey, setSelectedKey] = React.useState(null);
  const [amount, setAmount] = React.useState('');
  const [source, setSource] = React.useState('cash');
  const [paidAt, setPaidAt] = React.useState(() => toDateTimeLocalValue(new Date()));
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  const selectedItem = debtItems.find(item => item.key === selectedKey) ?? null;
  const parsedAmount = parseMoney(amount);
  const isOverDebt = selectedItem && parsedAmount > selectedItem.remainingAmount + 0.001;
  const remainingAfterPayment = selectedItem
    ? Math.max(selectedItem.remainingAmount - parsedAmount, 0)
    : 0;
  const canSubmit =
    !!selectedItem && parsedAmount > 0 && !!paidAt && !submitting && !isOverDebt;

  function handleSelectItem(item) {
    setSelectedKey(item.key);
    setAmount(item.remainingAmount.toFixed(2));
    setError(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!selectedItem) { setError('Önce bir borç kalemi seçin.'); return; }
    if (parsedAmount <= 0) { setError('Ödeme tutarı sıfırdan büyük olmalı.'); return; }
    if (isOverDebt) {
      setError('Ödeme tutarı kalan borcu aşamaz.');
      return;
    }

    const paidAtDate = new Date(paidAt);
    if (Number.isNaN(paidAtDate.getTime())) { setError('Geçerli bir ödeme tarihi girin.'); return; }

    setSubmitting(true);
    setError(null);

    try {
      await createCashPayment({
        targetType: selectedItem.targetType,
        targetId: selectedItem.targetId,
        amount: amount.trim(),
        source,
        paidAt: paidAtDate.toISOString(),
        note: note.trim() || null,
      });
      await onSuccess();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Ödeme alınamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal rpm-modal" onClick={e => e.stopPropagation()}>
        <div className="rpm-head">
          <div>
            <h3>Ödeme al</h3>
            <div className="rpm-subtitle">{student.full_name} için açık borç kalemi seçin.</div>
          </div>
          <button className="btn btn-ghost btn-xs" onClick={onClose} disabled={submitting}>Kapat</button>
        </div>

        {!debtItems.length ? (
          <div className="rpm-empty">
            Öğrencinin tahsil edilebilir açık borç kalemi bulunmuyor.
          </div>
        ) : (
          <>
            <div className="rpm-section">
              <div className="rpm-section-head">
                <span className="eyebrow">Açık borç kalemleri</span>
              </div>
              <div className="rpm-list" role="list">
                {debtItems.map(item => {
                  const iconKind = item.targetType === 'lesson' ? 'lesson' : 'sale';
                  const Icn = iconKind === 'lesson' ? Icon.Calendar : Icon.Tag;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`rpm-item${selectedKey === item.key ? ' is-selected' : ''}`}
                      onClick={() => handleSelectItem(item)}
                    >
                      <div className="rpm-item-lead">
                        <span className={'rpm-item-icon rpm-item-icon-' + iconKind} aria-hidden="true">
                          <Icn width="14" height="14" />
                        </span>
                        <div className="rpm-item-main">
                          <div className="rpm-item-title">{fmtDate(item.dateIso)} · {item.typeLabel}</div>
                          <div className="rpm-item-desc">{item.description}</div>
                        </div>
                      </div>
                      <div className="rpm-item-meta">
                        <span>Toplam: {fmtTL(item.totalAmount)}</span>
                        <span>Ödenen: {fmtTL(item.paidAmount)}</span>
                        <span className="rpm-item-remaining">Kalan: {fmtTL(item.remainingAmount)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedItem && selectedItem.canDiscount && (
              <DiscountInline
                item={selectedItem}
                onApplied={async () => { await refreshDetail(); }}
              />
            )}

            {selectedItem && (
              <form className="rpm-form" onSubmit={handleSubmit}>
                <div className="rpm-section">
                  <div className="rpm-section-head">
                    <span className="eyebrow">Ödeme formu</span>
                    <span className="rpm-selected-pill">
                      {selectedItem.typeLabel} · {fmtTL(selectedItem.remainingAmount)} kalan
                    </span>
                  </div>

                  <div className="form-row-2">
                    <div className="form-row">
                      <label>Ödeme tutarı</label>
                      <input
                        type="number" min="0.01" step="0.01"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="form-row">
                      <label>Ödeme yöntemi</label>
                      <select value={source} onChange={e => setSource(e.target.value)}>
                        <option value="cash">Nakit</option>
                        <option value="iban">IBAN</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-row">
                    <label>Ödeme tarihi</label>
                    <input type="datetime-local" value={paidAt} onChange={e => setPaidAt(e.target.value)}/>
                  </div>

                  <div className="form-row">
                    <label>Not</label>
                    <textarea rows="3" value={note} onChange={e => setNote(e.target.value)} placeholder="İsteğe bağlı"/>
                  </div>

                  {parsedAmount > 0 && !isOverDebt && (
                    <div className="rpm-summary">
                      <div className="rpm-summary-row">
                        <span>Borca işlenecek</span>
                        <strong>{fmtTL(parsedAmount)}</strong>
                      </div>
                      <div className="rpm-summary-row">
                        <span>İşlem sonrası kalan borç</span>
                        <strong>{fmtTL(remainingAfterPayment)}</strong>
                      </div>
                    </div>
                  )}

                  {isOverDebt && (
                    <div className="rpm-error">Ödeme tutarı kalan borçtan ({fmtTL(selectedItem.remainingAmount)}) fazla olamaz.</div>
                  )}

                  {error && <div className="rpm-error">{error}</div>}

                  <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Vazgeç</button>
                    <button type="submit" className="btn btn-accent" disabled={!canSubmit}>
                      {submitting ? 'Kaydediliyor...' : 'Ödemeyi kaydet'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Create Student Modal ─────────────────────────────────────────────────────

export function todayIso() {
  const d = new Date();
  const pad = p => String(p).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatPhoneTr(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  if (digits.length <= 9) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

export function previewInitials(name) {
  const src = (name || '').trim();
  if (!src) return '';
  return src.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
}

function CreateStudentModal({ onClose, onCreated }) {
  const [fullName, setFullName] = React.useState('');
  const [nickname, setNickname] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [birthday, setBirthday] = React.useState('');
  const [joinedAt, setJoinedAt] = React.useState(todayIso());
  const [preferredMode, setPreferredMode] = React.useState(null); // 'online' | 'onsite' | null
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const nameRef = React.useRef(null);

  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  React.useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const trimmedName = fullName.trim();
  const trimmedNickname = nickname.trim();
  const initialsPreview = previewInitials(fullName) || '?';
  const nameValid = trimmedName.length >= 2;
  const canSubmit = nameValid && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      const created = await createStudent({
        fullName: trimmedName,
        nickname: trimmedNickname || null,
        preferredMode: preferredMode,
        phone: phone.trim() || null,
        email: email.trim() || null,
        birthday: birthday || null,
        joinedAt: joinedAt || null,
        note: note.trim() || null,
      });
      await onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Öğrenci oluşturulamadı.');
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="modal modal-create-student"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcs-title"
      >
        <header className="mcs-head">
          <div className={'mcs-head-avatar' + (trimmedName ? '' : ' is-placeholder')}>
            {initialsPreview}
          </div>
          <div className="mcs-head-text">
            <h3 id="mcs-title">
              {trimmedName || 'Öğrenci ekle'}
              {trimmedNickname && (
                <span className="mcs-head-nick">“{trimmedNickname}”</span>
              )}
            </h3>
            <div className="mcs-sub">
              {trimmedName
                ? 'Bilgileri kontrol et ve kaydet.'
                : 'Temel bilgiler yeterli; detaylar sonra eklenebilir.'}
            </div>
          </div>
          <button
            type="button"
            className="mcs-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Kapat"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </header>

        <form onSubmit={handleSubmit} className="mcs-form" noValidate>

          <div className="mcs-grid-2">
            <div className="mcs-field">
              <label htmlFor="mcs-name">
                Ad Soyad <span className="mcs-req" aria-hidden="true">*</span>
              </label>
              <input
                id="mcs-name"
                ref={nameRef}
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Örn. Ayşe Yılmaz"
                maxLength={120}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>

            <div className="mcs-field">
              <label htmlFor="mcs-nick">
                Lakap <span className="mcs-opt">opsiyonel</span>
              </label>
              <input
                id="mcs-nick"
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="Çağırırken kullandığın isim"
                maxLength={60}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="mcs-grid-2">
            <div className="mcs-field">
              <label htmlFor="mcs-phone">Telefon</label>
              <input
                id="mcs-phone"
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={e => setPhone(formatPhoneTr(e.target.value))}
                placeholder="0 5__ ___ __ __"
                autoComplete="off"
              />
            </div>

            <div className="mcs-field">
              <label htmlFor="mcs-email">E-posta</label>
              <input
                id="mcs-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="ornek@posta.com"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mcs-grid-2">
            <div className="mcs-field">
              <label htmlFor="mcs-birth">Doğum günü</label>
              <input
                id="mcs-birth"
                type="date"
                value={birthday}
                onChange={e => setBirthday(e.target.value)}
                max={todayIso()}
              />
            </div>

            <div className="mcs-field">
              <label htmlFor="mcs-joined">Kayıt tarihi</label>
              <input
                id="mcs-joined"
                type="date"
                value={joinedAt}
                onChange={e => setJoinedAt(e.target.value)}
              />
            </div>
          </div>

          <div className="mcs-field">
            <label>
              Ders tercihi <span className="mcs-opt">opsiyonel</span>
            </label>
            <ModePreferenceSeg value={preferredMode} onChange={setPreferredMode} />
            <div className="mcs-hint">
              Yeni ders atandığında otomatik seçilir; her ders için değiştirilebilir.
            </div>
          </div>

          <div className="mcs-field mcs-field-note">
            <label htmlFor="mcs-note">
              Not <span className="mcs-opt">opsiyonel</span>
            </label>
            <textarea
              id="mcs-note"
              rows="2"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Tercih, sağlık bilgisi, hatırlatıcı…"
              maxLength={500}
            />
          </div>

          {error && <div className="mcs-banner mcs-banner-error">{error}</div>}

          <footer className="mcs-actions">
            <div className="mcs-req-note">
              <span className="mcs-req">*</span> zorunlu alan
            </div>
            <div className="mcs-actions-btns">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onClose}
                disabled={submitting}
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canSubmit}
              >
                {submitting ? 'Ekleniyor…' : 'Öğrenciyi ekle'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function ModePreferenceSeg({ value, onChange }) {
  const options = [
    {
      key: 'onsite',
      label: 'Yüzyüze',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        </svg>
      ),
    },
    {
      key: 'online',
      label: 'Online',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="3" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      key: null,
      label: 'Belirtmedim',
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M6 7c.2-1.3 1-2 2-2 1.2 0 2 .7 2 1.8 0 1-.5 1.5-1.5 2M8 10.8v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="mode-seg mode-seg-3">
      {options.map(opt => (
        <button
          key={opt.key ?? 'null'}
          type="button"
          className={'mode-btn' + (value === opt.key ? ' is-on' : '')}
          onClick={() => onChange(opt.key)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

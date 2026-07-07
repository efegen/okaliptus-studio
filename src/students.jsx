// Students page — full-width list view

import React from 'react';
import ReactDOM from 'react-dom';
import './students.css';
import { fmtTL, initials } from './data';
import { Icon } from './layout';
import {
  getStudents,
  getStudentById,
  getStudentLessons,
  getStudentPackages,
  getStudentProductSales,
  createCashPayment,
  createStudent,
  updateStudent,
  deleteStudent,
} from './api';
import { useCan } from './currentUser';

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
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

function summarizeSaleItems(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const parts = items
    .filter(it => (it?.name_snapshot ?? '').trim().length > 0)
    .map(it => {
      const qty = parseInt(it.quantity ?? '1', 10) || 1;
      const name = String(it.name_snapshot).trim();
      return qty > 1 ? `${qty}× ${name}` : name;
    });
  return parts.length ? parts.join(', ') : null;
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
      const paid = parseMoney(l.paid_amount);
      const remaining = parseMoney(l.remaining_receivable);
      return {
        key: `lesson-${l.id}`,
        targetType: 'lesson',
        targetId: l.id,
        dateIso: l.starts_at,
        typeLabel: 'Ders',
        description: l.note?.trim() || null,
        grossAmount: gross,
        discountAmount: discount,
        totalAmount: net,
        paidAmount: paid,
        remainingAmount: remaining,
        paidRatio: net > 0 ? Math.min(paid / net, 1) : 0,
      };
    });

  const saleItems = (detail?.productSales ?? [])
    .filter(s => parseMoney(s.remaining_receivable) > 0.01)
    .map(s => {
      const total = parseMoney(s.total_amount);
      const paid = parseMoney(s.paid_amount);
      const remaining = parseMoney(s.remaining_receivable);
      return {
        key: `product-sale-${s.product_sale_id}`,
        targetType: 'product_sale',
        targetId: s.product_sale_id,
        dateIso: s.sold_at,
        typeLabel: 'Ürün satışı',
        description: summarizeSaleItems(s.items),
        grossAmount: total,
        discountAmount: 0,
        totalAmount: total,
        paidAmount: paid,
        remainingAmount: remaining,
        paidRatio: total > 0 ? Math.min(paid / total, 1) : 0,
      };
    });

  return [...lessonItems, ...saleItems].sort(
    (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime(),
  );
}

// Tutarı, en eski borçtan başlayarak FIFO sırasında alt kalemlere böler.
// Backend ders bazında ödeme alır — submit pipeline bu çıktı üzerinden
// her kalem için ayrı createCashPayment çağrısı yapar.
export function allocateFifo(items, totalAmount) {
  const amount = parseFloat(totalAmount) || 0;
  if (amount <= 0.005 || !Array.isArray(items) || items.length === 0) return [];
  const sorted = [...items].sort(
    (a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime(),
  );
  const allocations = [];
  let remaining = amount;
  for (const item of sorted) {
    if (remaining <= 0.005) break;
    const portion = Math.min(item.remainingAmount, remaining);
    if (portion > 0.005) {
      allocations.push({ item, portion });
    }
    remaining -= portion;
  }
  // Float yuvarlama: son non-zero alocasyona kalan farkı ekleyip toplam
  // parsedAmount'a eşit kalsın.
  const rounded = allocations.map(a => ({ ...a, portion: Math.round(a.portion * 100) / 100 }));
  if (rounded.length > 0) {
    const sum = rounded.reduce((s, a) => s + a.portion, 0);
    const diff = Math.round((amount - sum) * 100) / 100;
    if (Math.abs(diff) > 0.001) {
      const last = rounded[rounded.length - 1];
      last.portion = Math.round((last.portion + diff) * 100) / 100;
    }
  }
  return rounded;
}


// ─── Main Page ────────────────────────────────────────────────────────────────

export function StudentsPage({ onOpenStudent }) {
  const [students, setStudents] = React.useState([]);
  const [studentsLoading, setStudentsLoading] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [view, setView] = React.useState('all');
  const [chips, setChips] = React.useState([]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [sort, setSort] = React.useState({ key: 'debt', dir: 'desc' });
  const [sel, setSel] = React.useState(() => new Set());
  const [paymentTarget, setPaymentTarget] = React.useState(null);
  const [paymentLoading, setPaymentLoading] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState(null); // tam öğrenci kaydı
  const [editLoading, setEditLoading] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setStudentsLoading(true);
    getStudents()
      .then(data => { if (!cancelled) setStudents(data); })
      .catch(err => console.error('[Students] liste yüklenemedi:', err))
      .finally(() => { if (!cancelled) setStudentsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function refreshStudents() {
    try {
      setStudents(await getStudents());
    } catch (err) {
      console.error('[Students] liste yenilenemedi:', err);
    }
  }

  // Ham API satırlarını tablo hücrelerinin beklediği zengin şekle çevir.
  const decorated = React.useMemo(() => students.map(decorateStudent), [students]);

  // Sekme sayıları (canlı). Görünüm predikatları saf fonksiyonlardır.
  const viewCounts = React.useMemo(() => {
    const counts = {};
    for (const v of VIEWS) counts[v.k] = decorated.filter(v.test).length;
    return counts;
  }, [decorated]);

  const activeChips = chips.map(id => PRESETS.find(p => p.id === id)).filter(Boolean);
  const available = PRESETS.filter(p => !chips.includes(p.id));

  const rows = React.useMemo(() => {
    const viewDef = VIEWS.find(v => v.k === view) ?? VIEWS[0];
    let list = decorated.filter(viewDef.test);
    chips.forEach(id => {
      const preset = PRESETS.find(p => p.id === id);
      if (preset) list = list.filter(preset.test);
    });
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(s =>
        s.full_name.toLowerCase().includes(q) ||
        (s.nickname && s.nickname.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(query.trim()))
      );
    }
    return sortRows(list, sort);
  }, [decorated, view, chips, query, sort]);

  // Görünüm/koşul/arama değişince seçim sıfırlanır (kapsam dışı satır kalmasın).
  React.useEffect(() => { setSel(new Set()); }, [view, chips, query]);

  // Filtre açılır menüsü dışarı tıkla / Escape ile kapanır.
  const filterRef = React.useRef(null);
  React.useEffect(() => {
    if (!addOpen) return undefined;
    function onDown(e) {
      if (filterRef.current && !filterRef.current.contains(e.target)) setAddOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setAddOpen(false); }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [addOpen]);

  // Koşul ekle — menü açık kalır ki üst üste birkaç koşul eklenebilsin.
  function addChip(id) {
    if (id && !chips.includes(id)) setChips([...chips, id]);
  }
  function removeChip(id) { setChips(chips.filter(c => c !== id)); }

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

  // Düzenleme — liste satırında tüm alanlar yok, tam kaydı çekip modalı açarız.
  async function handleOpenEdit(studentId) {
    setEditLoading(true);
    try {
      const full = await getStudentById(studentId);
      setEditTarget(full);
    } catch (err) {
      console.error('[Students] öğrenci düzenleme yüklenemedi:', err);
      window.alert(err instanceof Error ? err.message : 'Öğrenci bilgileri yüklenemedi.');
    } finally {
      setEditLoading(false);
    }
  }

  async function handleStudentUpdated() {
    setEditTarget(null);
    await refreshStudents();
  }

  // Aktif ↔ pasif. Optimistik değil — başarıda listeyi tazeleriz.
  async function handleSetActive(student, active) {
    try {
      await updateStudent(student.id, { isActive: active });
      await refreshStudents();
    } catch (err) {
      console.error('[Students] aktiflik güncellenemedi:', err);
      window.alert(err instanceof Error ? err.message : 'Öğrenci durumu güncellenemedi.');
    }
  }

  // ConfirmDeleteStudentModal hata fırlatırsa modal kendi içinde gösterir
  // (örn. 409 — geçmişi olan öğrenci). Başarıda hedefi temizleyip tazeleriz.
  async function handleConfirmDelete() {
    await deleteStudent(deleteTarget.id);
    setDeleteTarget(null);
    await refreshStudents();
  }

  // Toplu pasife alma — geri alınabilir, düşük riskli; yine de onay isteriz.
  async function handleBulkPassive(ids) {
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length} öğrenci pasife alınsın mı?`)) return;
    try {
      await Promise.all(ids.map(id => updateStudent(id, { isActive: false })));
      setSel(new Set());
      await refreshStudents();
    } catch (err) {
      console.error('[Students] toplu pasife alma hatası:', err);
      window.alert(err instanceof Error ? err.message : 'Öğrenciler güncellenemedi.');
    }
  }

  const hasStudents = students.length > 0;

  return (
    <div className="ox-page">
      <div className="ox-phead">
        <div className="ox-phead-t">
          <h1 className="ox-h1">Öğrenciler</h1>
          <span className="ox-phead-sub">Kayıtlı görünüm seç, gerektikçe koşul ekle</span>
        </div>
        <div className="ox-phead-a">
          <button
            className="ox-btn ghost"
            onClick={() => exportStudentsCsv(rows)}
            disabled={rows.length === 0}
          >
            <Ic.Download width="15" height="15" />Dışa aktar
          </button>
          <button className="ox-btn primary" onClick={() => setCreateOpen(true)}>
            <Ic.Plus width="15" height="15" />Yeni öğrenci
          </button>
        </div>
      </div>

      {studentsLoading ? (
        <div className="ox-page-state">Yükleniyor…</div>
      ) : !hasStudents ? (
        <div className="ox-empty-wrap">
          <EmptyStudents onCreate={() => setCreateOpen(true)} />
        </div>
      ) : (
        <>
          <div className="ox-vtabs">
            {VIEWS.map(v => (
              <button
                key={v.k}
                className={'ox-vtab' + (view === v.k ? ' on' : '') + (v.warn ? ' warn' : '')}
                onClick={() => setView(v.k)}
              >
                {v.lbl}<span className="vn">{viewCounts[v.k] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="ox-ftbar">
            <div className="ox-localsearch">
              <Ic.Search width="14" height="14" />
              <input
                placeholder="İsim veya telefon ara…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <div className="ox-fwrap" ref={filterRef}>
              <button
                className={'ox-fbtn' + (chips.length ? ' on' : '') + (addOpen ? ' open' : '')}
                onClick={() => setAddOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={addOpen}
              >
                <Ic.Filter width="14" height="14" />Filtre
                {chips.length > 0 && <span className="ox-fbtn-badge">{chips.length}</span>}
              </button>
              {addOpen && (
                <div className="ox-fmenu" role="menu">
                  <div className="ox-fmenu-head">Koşul ekle</div>
                  {available.length === 0 ? (
                    <div className="ox-fmenu-empty">Tüm koşullar eklendi</div>
                  ) : (
                    available.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        className="ox-fmenu-item"
                        role="menuitem"
                        onClick={() => addChip(p.id)}
                      >
                        <span className="k">{p.k}:</span> <b>{p.v}</b>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <span className="ox-ftbar-sp" />
            <select
              className="ox-sel"
              value={SORT_KEYS.includes(sort.key) ? sort.key : 'att'}
              onChange={e => setSort({ key: e.target.value, dir: e.target.value === 'name' ? 'asc' : 'desc' })}
            >
              <option value="debt">Sırala: Açık borç</option>
              <option value="name">Sırala: Ada göre</option>
              <option value="last">Sırala: Son ders</option>
              <option value="att">Sırala: Devam</option>
            </select>
          </div>

          {activeChips.length > 0 && (
            <div className="ox-chips">
              {activeChips.map(c => (
                <span key={c.id} className="ox-chip">
                  <span className="k">{c.k}:</span> <b>{c.v}</b>
                  <button className="ox-chip-x" onClick={() => removeChip(c.id)} aria-label="Kaldır">×</button>
                </span>
              ))}
              <button className="ox-chips-clear" onClick={() => setChips([])}>Tümünü temizle</button>
            </div>
          )}

          <OpsTable
            rows={rows}
            sort={sort}
            setSort={setSort}
            sel={sel}
            setSel={setSel}
            onOpenStudent={onOpenStudent}
            onPayment={handleOpenPayment}
            onEdit={handleOpenEdit}
            onSetActive={handleSetActive}
            onDelete={setDeleteTarget}
            onBulkPassive={handleBulkPassive}
            onExport={exportStudentsCsv}
          />
        </>
      )}

      {(paymentLoading || editLoading) && (
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
        <StudentFormModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={handleStudentCreated}
        />
      )}

      {editTarget && (
        <StudentFormModal
          mode="edit"
          student={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleStudentUpdated}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteStudentModal
          student={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

// ─── Redesigned roster: helpers, cells, views, table ───────────────────────
// Tasarım devir paketi (Ogrenciler-Filtre): kayıtlı görünüm sekmeleri +
// kaldırılabilir koşul rozetleri + operasyon tablosu. Veri gerçek API'den
// gelir; satırlar decorateStudent ile zenginleştirilir.

const SORT_KEYS = ['debt', 'name', 'last', 'att'];

// Son ders tarihinden bu yana geçen güne göre kısa Türkçe göreli etiket.
function relativeLastLabel(days) {
  if (days === null) return 'Henüz ders almadı';
  if (days <= 0) return 'Bugün';
  if (days === 1) return 'Dün';
  if (days < 7) return `${days} gün önce`;
  if (days < 14) return '1 hafta önce';
  if (days < 30) return `${Math.floor(days / 7)} hafta önce`;
  if (days < 365) return `${Math.floor(days / 30)} ay önce`;
  return `${Math.floor(days / 365)} yıl önce`;
}

// Ham API satırını tablo hücrelerinin beklediği zengin şekle çevirir.
function decorateStudent(s) {
  const lessonDebt = parseMoney(s.lesson_debt);
  const productDebt = parseMoney(s.product_debt);
  const totalDebt = lessonDebt + productDebt;
  const last30 = parseInt(s.lessons_last_30_days ?? '0', 10) || 0;
  const lastDays = s.last_lesson_at
    ? Math.max(0, Math.floor((Date.now() - new Date(s.last_lesson_at).getTime()) / 86_400_000))
    : null;
  return {
    ...s,
    id: String(s.id),
    lessonDebt,
    productDebt,
    total_debt: totalDebt,
    has_debt: totalDebt > 0.01,
    lessons_last_30: last30,
    last_days: lastDays,
    last_label: relativeLastLabel(lastDays),
    weeks: Array.isArray(s.weeks) ? s.weeks : [],
    att: getAttendanceStatus(s),
    initials: initials(s.full_name),
  };
}

// Öncelik: borçlu > riskli (gelmeyen/pasif/düşük devam) > normal. "Takip
// listesi" görünümü borcu olmayan ama riskli öğrencileri toplar.
function priorityOf(s) {
  if (s.has_debt) return 'debt';
  if (s.att.tone === 'absent' || s.att.tone === 'inactive' || s.att.tone === 'low') return 'risk';
  return 'ok';
}

// ── İkonlar (bu sayfaya özel; tasarım devir dosyasından) ──
const Ic = {
  Search:  (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>),
  Plus:    (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" {...p}><path d="M12 5v14M5 12h14"/></svg>),
  Caret:   (p) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 15.5 5.5 9h13z"/></svg>),
  Wallet:  (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18M16 14h2"/></svg>),
  Moon:    (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>),
  Download:(p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>),
  Check:   (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5"/></svg>),
  Sparkle: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>),
  Filter:  (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 5h18l-7 8.2V20l-4 1v-7.8z"/></svg>),
};

// ── Paylaşılan hücreler ──
function OxAvatar({ s }) {
  return <span className={`ox-av t-${s.att.tone}`}>{s.initials}</span>;
}
function Identity({ s }) {
  return (
    <div className="ox-idc">
      <OxAvatar s={s} />
      <div className="ox-idc-stack">
        <span className="ox-idc-name">
          {s.full_name}
          {s.nickname && <span className="nick">“{s.nickname}”</span>}
          {!s.is_active && <span className="ox-pasif">pasif</span>}
        </span>
        <span className="ox-idc-sub">{s.phone || '—'}</span>
      </div>
    </div>
  );
}
function AttCell({ s }) {
  return (
    <div className="ox-att">
      <span className="ox-att-lbl"><span className={`ox-dot t-${s.att.tone}`} />{s.att.main}</span>
      <span className="ox-att-sub">{s.att.sub}</span>
    </div>
  );
}
// Son 12 hafta ritmi: 'go' geldi · 'no' gelmedi · 'skip' o hafta ders yok.
// weeks en yeni → en eski gelir; soldan sağa eskiden yeniye çizmek için reverse.
function Spark({ weeks, n = 12, h = 18 }) {
  if (!weeks || weeks.length === 0) return <span className="ox-spark-empty">—</span>;
  const w = weeks.slice(0, n).reverse();
  const H = { go: 1, no: 0.55, skip: 0.22 };
  return (
    <span className="ox-spark" title="Son haftalar" style={{ height: h }}>
      {w.map((v, i) => <i key={i} className={v} style={{ height: Math.round(h * (H[v] || 0.22)) }} />)}
    </span>
  );
}
function Money({ value }) {
  if (value <= 0.01) return <span className="ox-money zero">—</span>;
  return <span className="ox-money debt">{fmtTL(value)}</span>;
}
function LastLesson({ s }) {
  if (!s.last_lesson_at) return <span className="ox-muted">—</span>;
  const dt = new Date(s.last_lesson_at);
  const abs = dt.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
  return <span className="ox-date">{abs}<span className="rel">{s.last_label}</span></span>;
}
function StatusTag({ s }) {
  return <span className={`ox-stat ${s.is_active ? '' : 'off'}`}><i />{s.is_active ? 'Aktif' : 'Pasif'}</span>;
}

// ── Sıralama ──
function sortRows(list, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const pick = {
    name: s => s.full_name.toLocaleLowerCase('tr-TR'),
    att: s => s.lessons_last_30,
    month: s => s.lessons_last_30,
    last: s => (s.last_days === null ? 99999 : s.last_days),
    debt: s => s.total_debt,
  }[sort.key] || (s => s.total_debt);
  return [...list].sort((a, b) => {
    const av = pick(a), bv = pick(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.full_name.localeCompare(b.full_name, 'tr');
  });
}

// ── Kayıtlı görünümler + eklenebilir koşullar (saf predikatlar) ──
const VIEWS = [
  { k: 'all', lbl: 'Tüm öğrenciler', test: () => true },
  { k: 'debt', lbl: 'Borçlular', warn: true, test: s => s.has_debt },
  { k: 'follow', lbl: 'Takip listesi', test: s => !s.has_debt && priorityOf(s) === 'risk' },
  { k: 'passive', lbl: 'Pasifler', test: s => !s.is_active },
];
const PRESETS = [
  { id: 'active', k: 'Durum', v: 'Aktif', test: s => s.is_active },
  { id: 'passive', k: 'Durum', v: 'Pasif', test: s => !s.is_active },
  { id: 'debt', k: 'Finans', v: 'Açık borç var', test: s => s.has_debt },
  { id: 'regular', k: 'Devam', v: 'Düzenli', test: s => s.att.tone === 'high' },
  { id: 'low', k: 'Devam', v: 'Düşük', test: s => s.att.tone === 'low' },
  { id: 'absent', k: 'Devam', v: 'Gelmiyor', test: s => s.att.tone === 'absent' },
  { id: 'stale', k: 'Son ders', v: '30+ gün önce', test: s => (s.last_days ?? 99999) >= 30 },
];

// ── CSV dışa aktarma (istemci tarafı; Türkçe Excel için ; ayraç + UTF-8 BOM) ──
function exportStudentsCsv(rows, filename = 'ogrenciler.csv') {
  if (!rows || rows.length === 0) return;
  const header = ['Ad Soyad', 'Lakap', 'Telefon', 'Durum', 'Devam', 'Son ders', 'Bu ay (ders)', 'Açık borç'];
  const esc = v => {
    const str = String(v ?? '');
    return /[";\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const body = rows.map(s => [
    s.full_name,
    s.nickname || '',
    s.phone || '',
    s.is_active ? 'Aktif' : 'Pasif',
    s.att.main,
    s.last_lesson_at ? new Date(s.last_lesson_at).toLocaleDateString('tr-TR') : '',
    String(s.lessons_last_30),
    String(Math.round(s.total_debt)),
  ]);
  const csv = [header, ...body].map(r => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Operasyon tablosu ──
function OpsTable({ rows, sort, setSort, sel, setSel, onOpenStudent, onPayment, onEdit, onSetActive, onDelete, onBulkPassive, onExport }) {
  const allSel = rows.length > 0 && rows.every(s => sel.has(s.id));
  const someSel = sel.size > 0 && !allSel;
  function toggleAll() { setSel(allSel ? new Set() : new Set(rows.map(s => s.id))); }
  function toggle(id) {
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const totalDebt = rows.reduce((t, s) => t + s.total_debt, 0);
  const debtors = rows.filter(s => s.has_debt).length;
  const selectedRows = rows.filter(s => sel.has(s.id));
  const selDebt = selectedRows.reduce((t, s) => t + s.total_debt, 0);

  function Th({ k, children, cls }) {
    const on = sort.key === k;
    return (
      <th className={cls}>
        <button
          className={`ox-sort ${on ? 'on' : ''}`}
          onClick={() => setSort(p => p.key === k
            ? { key: k, dir: p.dir === 'asc' ? 'desc' : 'asc' }
            : { key: k, dir: k === 'name' ? 'asc' : 'desc' })}
        >
          {children}
          <span className="car" style={{ transform: on && sort.dir === 'asc' ? 'rotate(180deg)' : 'none' }}>
            <Ic.Caret width="10" height="10" />
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className="ox-tablecard">
      {sel.size > 0 && (
        <div className="ox-bulkbar">
          <span className="ox-bulk-count">
            <b>{sel.size}</b> öğrenci seçili
            {selDebt > 0.01 && <span className="ox-bulk-dim"> · {fmtTL(selDebt)} açık borç</span>}
          </span>
          <div className="ox-bulk-actions">
            <button className="ox-bulk-btn" onClick={() => onBulkPassive(selectedRows.map(s => s.id))}>
              <Ic.Moon width="14" height="14" />Pasife al
            </button>
            <button className="ox-bulk-btn" onClick={() => onExport(selectedRows, 'ogrenciler-secili.csv')}>
              <Ic.Download width="14" height="14" />Dışa aktar
            </button>
            <button className="ox-bulk-btn clear" onClick={() => setSel(new Set())}>Temizle</button>
          </div>
        </div>
      )}
      <div className="ox-tablewrap">
        <table className="ox-table">
          <thead>
            <tr>
              <th className="ox-chk-th">
                <button
                  className={'ox-chk' + (allSel ? ' on' : someSel ? ' some' : '')}
                  onClick={toggleAll}
                  aria-label="Tümünü seç"
                >
                  {allSel ? <Ic.Check width="12" height="12" /> : someSel ? <span className="dash" /> : null}
                </button>
              </th>
              <Th k="name">Öğrenci</Th>
              <th>Durum</th>
              <Th k="att">Devam</Th>
              <th>Son 12 hafta</th>
              <Th k="last">Son ders</Th>
              <Th k="month" cls="r">Bu ay</Th>
              <Th k="debt" cls="r">Açık borç</Th>
              <th className="r"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const on = sel.has(s.id);
              return (
                <tr
                  key={s.id}
                  className={on ? 'sel' : ''}
                  onClick={() => onOpenStudent && onOpenStudent(s.id)}
                >
                  <td className="ox-chk-td" onClick={e => e.stopPropagation()}>
                    <button
                      className={'ox-chk' + (on ? ' on' : '')}
                      onClick={() => toggle(s.id)}
                      aria-label="Seç"
                    >
                      {on && <Ic.Check width="12" height="12" />}
                    </button>
                  </td>
                  <td><Identity s={s} /></td>
                  <td><StatusTag s={s} /></td>
                  <td><AttCell s={s} /></td>
                  <td><Spark weeks={s.weeks} /></td>
                  <td><LastLesson s={s} /></td>
                  <td className="r"><span className="ox-num">{s.lessons_last_30}</span></td>
                  <td className="r"><Money value={s.total_debt} /></td>
                  <td className="r" onClick={e => e.stopPropagation()}>
                    <div className="ox-rowact">
                      {s.has_debt && (
                        <button className="ox-quickpay" onClick={() => onPayment(s.id)}>
                          <Ic.Wallet width="13" height="13" />Ödeme
                        </button>
                      )}
                      <RowActionsMenu
                        student={s}
                        hasDebt={s.has_debt}
                        onPayment={onPayment}
                        onEdit={onEdit}
                        onSetActive={onSetActive}
                        onDelete={onDelete}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9}><div className="ox-empty">Bu filtrelere uyan öğrenci yok.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ox-foot">
        <span className="ox-foot-i"><b>{rows.length}</b> öğrenci</span>
        <span className="ox-foot-i"><b className="warn">{debtors}</b> borçlu</span>
        <span className="ox-foot-sp" />
        <span className="ox-foot-i">Toplam açık borç <b className="warn">{fmtTL(totalDebt)}</b></span>
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

// ─── Row Actions Menu (kebab) ───────────────────────────────────────────────
// Profil sayfasındaki ⋯ menüsüyle aynı dil. Tablo içinde clip/oklama sorunlarını
// önlemek için menü body'ye portal'lanır ve fixed konumlanır (stu-fin-tip ile
// aynı yaklaşım). Aksiyonlar: Ödeme al (yalnız borçluda) · Pasife al / Tekrar
// aktif et · Tamamen sil (yalnız pasif öğrencide — önce pasife alma kuralı).

function RowActionsMenu({ student, hasDebt, onPayment, onEdit, onSetActive, onDelete }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const btnRef = React.useRef(null);
  const isActive = student.is_active;
  const canHardDelete = useCan('students.delete'); // asistan öğrenci silemez

  React.useEffect(() => {
    if (!open) return undefined;
    function onDocPointer(e) {
      if (btnRef.current?.contains(e.target)) return;
      if (e.target.closest?.('.stu-row-menu')) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    function onReflow() { setOpen(false); }
    document.addEventListener('mousedown', onDocPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open]);

  function toggle(e) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const MENU_W = 200;
      setPos({ top: r.bottom + 6, left: Math.max(8, r.right - MENU_W) });
    }
    setOpen(true);
  }

  // Aksiyonu çalıştırıp menüyü kapat. stopPropagation satır navigasyonunu engeller.
  const run = fn => e => { e.stopPropagation(); setOpen(false); fn(); };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={'iconbtn stu-kebab' + (open ? ' is-open' : '')}
        aria-label="İşlemler"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon.More width="16" height="16" />
      </button>
      {open && pos && ReactDOM.createPortal(
        <div className="stu-row-menu" style={{ top: pos.top, left: pos.left }} role="menu">
          {onEdit && (
            <>
              <button
                type="button"
                className="stu-row-menu-item"
                role="menuitem"
                onClick={run(() => onEdit(String(student.id)))}
              >
                Düzenle
              </button>
              <div className="stu-row-menu-sep" />
            </>
          )}
          {hasDebt && (
            <>
              <button
                type="button"
                className="stu-row-menu-item"
                role="menuitem"
                onClick={run(() => onPayment(String(student.id)))}
              >
                Ödeme al
              </button>
              <div className="stu-row-menu-sep" />
            </>
          )}
          {isActive ? (
            <button
              type="button"
              className="stu-row-menu-item"
              role="menuitem"
              onClick={run(() => onSetActive(student, false))}
            >
              Pasife al
            </button>
          ) : (
            <button
              type="button"
              className="stu-row-menu-item"
              role="menuitem"
              onClick={run(() => onSetActive(student, true))}
            >
              Tekrar aktif et
            </button>
          )}
          {!isActive && canHardDelete && (
            <button
              type="button"
              className="stu-row-menu-item stu-row-menu-item-danger"
              role="menuitem"
              onClick={run(() => onDelete(student))}
            >
              Tamamen sil
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Confirm Delete Student Modal ───────────────────────────────────────────
// "Tamamen sil" = kalıcı (hard) silme: öğrenci + tüm ders/ödeme/paket/satış
// fiziksel silinir, geri alınamaz ve geçmiş raporlarını etkiler. Bu yüzden modal
// açılınca silinecek kayıtları (blast radius) sayar ve gösterir; geçmişi olan
// öğrencide ek bir onay kutusu ister. Profil sayfası da bunu yeniden kullanır.

export function ConfirmDeleteStudentModal({ student, onClose, onConfirm }) {
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [impact, setImpact] = React.useState(null); // { lessons, packages, sales } | null = yükleniyor
  const [ack, setAck] = React.useState(false);

  // Silinecek kayıtları say — mevcut öğrenci-bazlı listeleri yeniden kullanır.
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      getStudentLessons(student.id),
      getStudentPackages(student.id),
      getStudentProductSales(student.id),
    ])
      .then(([lessons, packages, sales]) => {
        if (cancelled) return;
        setImpact({
          lessons: lessons?.length ?? 0,
          packages: packages?.length ?? 0,
          sales: sales?.length ?? 0,
        });
      })
      .catch(() => {
        // Sayım başarısız olsa da silmeyi engelleme; sadece genel uyarı göster.
        if (!cancelled) setImpact({ lessons: 0, packages: 0, sales: 0, unknown: true });
      });
    return () => { cancelled = true; };
  }, [student.id]);

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !submitting) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const loadingImpact = impact === null;
  const totalRecords = impact ? impact.lessons + impact.packages + impact.sales : 0;
  const hasHistory = totalRecords > 0;
  const canConfirm = !submitting && !loadingImpact && (!hasHistory || ack);

  async function handleConfirm() {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      // Başarı: caller hedefi temizler → modal unmount olur.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Öğrenci silinemedi.');
      setSubmitting(false);
    }
  }

  function impactParts() {
    const parts = [];
    if (impact.lessons > 0) parts.push(`${impact.lessons} ders`);
    if (impact.packages > 0) parts.push(`${impact.packages} paket`);
    if (impact.sales > 0) parts.push(`${impact.sales} ürün satışı`);
    return parts.join(' · ');
  }

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal cds-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="cds-icon"><Icon.Trash width="22" height="22" /></div>
        <h3 className="cds-title">Öğrenciyi kalıcı olarak sil?</h3>
        <p className="cds-body">
          <strong>{student.full_name}</strong> ve tüm kayıtları kalıcı olarak silinecek.
          Bu işlem <strong>geri alınamaz</strong> ve geçmiş raporları (ciro, ders sayısı) etkiler.
        </p>

        <div className="cds-impact">
          {loadingImpact ? (
            'Silinecek kayıtlar kontrol ediliyor…'
          ) : hasHistory ? (
            <>Silinecek: <strong>{impactParts()}</strong> ve bunlara bağlı tüm ödemeler.</>
          ) : (
            'Bu öğrencinin ders, paket veya satış kaydı yok.'
          )}
        </div>

        {hasHistory && (
          <label className="cds-ack">
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} disabled={submitting} />
            <span>Bu işlemin geri alınamayacağını ve geçmiş kayıtların silineceğini anlıyorum.</span>
          </label>
        )}

        {error && <div className="cds-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Vazgeç
          </button>
          <button type="button" className="btn btn-danger" onClick={handleConfirm} disabled={!canConfirm}>
            {submitting ? 'Siliniyor…' : 'Kalıcı olarak sil'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Receive Payment Modal ────────────────────────────────────────────────────

function RpmCheckCircle() {
  return (
    <svg viewBox="0 0 52 52" width="64" height="64" aria-hidden="true">
      <circle
        cx="26" cy="26" r="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="rpm-success-check-circle"
      />
      <path
        d="M14 27l8 8 16-18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="rpm-success-check-tick"
      />
    </svg>
  );
}

export function ReceivePaymentModal({ student, detail, onClose, onSuccess }) {
  const [localDetail, setLocalDetail] = React.useState(detail);
  React.useEffect(() => { setLocalDetail(detail); }, [detail]);

  async function refreshDetail() {
    const [lessons, productSales] = await Promise.all([
      getStudentLessons(student.id),
      getStudentProductSales(student.id),
    ]);
    setLocalDetail(prev => ({ ...prev, lessons, productSales }));
  }

  const debtItems = buildOpenDebtItems(localDetail);
  const totalRemaining = debtItems.reduce((sum, it) => sum + it.remainingAmount, 0);

  const [phase, setPhase] = React.useState('form'); // 'form' | 'success'
  const [result, setResult] = React.useState(null); // { paidAmount, remainingAfter, count }
  const [mode, setMode] = React.useState('auto'); // 'auto' | 'single'
  const [selectedTargetKey, setSelectedTargetKey] = React.useState(null);
  const [amount, setAmount] = React.useState('');
  const [source, setSource] = React.useState('cash');
  const [paidAt, setPaidAt] = React.useState(() => toDateTimeLocalValue(new Date()));
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  const selectedItem = mode === 'single'
    ? (debtItems.find(it => it.key === selectedTargetKey) ?? null)
    : null;

  const parsedAmount = parseMoney(amount);
  const maxAmount = selectedItem ? selectedItem.remainingAmount : totalRemaining;
  const isOverDebt = parsedAmount > maxAmount + 0.001;
  const isMultiItem = debtItems.length > 1;
  const rowsClickable = mode === 'auto' && isMultiItem && !submitting;

  const allocations = React.useMemo(() => {
    if (parsedAmount <= 0 || isOverDebt) return [];
    if (mode === 'single' && selectedItem) {
      return [{ item: selectedItem, portion: parsedAmount }];
    }
    return allocateFifo(debtItems, parsedAmount);
  }, [mode, selectedItem, debtItems, parsedAmount, isOverDebt]);

  // Liste her zaman görünür. Tutar > 0 ve geçerliyse "işlenecek kalemler",
  // aksi halde tüm açık borçlar (en eski → yeni) gösterilir.
  const listItems = React.useMemo(() => {
    if (allocations.length > 0) {
      return allocations.map(a => ({ ...a, planned: true }));
    }
    if (mode === 'single' && selectedItem) {
      return [{ item: selectedItem, portion: selectedItem.remainingAmount, planned: false }];
    }
    const sorted = [...debtItems].sort(
      (a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime(),
    );
    return sorted.map(it => ({ item: it, portion: it.remainingAmount, planned: false }));
  }, [allocations, mode, selectedItem, debtItems]);

  const canSubmit =
    parsedAmount > 0 && !isOverDebt && !!paidAt && !submitting && allocations.length > 0;

  function handleAmountFocus(event) {
    event.target.select();
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

  async function handleSubmit(event) {
    event.preventDefault();

    if (allocations.length === 0) { setError('Ödeme yapılacak kalem yok.'); return; }
    if (parsedAmount <= 0) { setError('Ödeme tutarı sıfırdan büyük olmalı.'); return; }
    if (isOverDebt) {
      setError(mode === 'single'
        ? 'Tutar bu kalemin kalanından fazla olamaz.'
        : 'Tutar açık borç toplamından fazla olamaz.');
      return;
    }
    const paidAtDate = new Date(paidAt);
    if (Number.isNaN(paidAtDate.getTime())) { setError('Geçerli bir ödeme tarihi girin.'); return; }

    setSubmitting(true);
    setError(null);

    const paidAtIso = paidAtDate.toISOString();
    const noteValue = note.trim() || null;
    const remainingBefore = totalRemaining;
    const totalToPay = allocations.reduce((s, a) => s + a.portion, 0);
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
      setResult({
        paidAmount: totalToPay,
        remainingAfter: Math.max(0, remainingBefore - totalToPay),
        count: allocations.length,
      });
      setPhase('success');
    } catch (submitError) {
      const baseMsg = submitError instanceof Error ? submitError.message : 'Ödeme alınamadı.';
      const tail = succeeded > 0
        ? ` (${succeeded}/${allocations.length} kalem kaydedildi)`
        : '';
      setError(baseMsg + tail);
      if (succeeded > 0) {
        await refreshDetail();
        setMode('auto');
        setSelectedTargetKey(null);
        setAmount('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinish() {
    // Kullanıcı "Tamam" dedikten sonra caller modal'ı kapatıp listeyi tazeler.
    await onSuccess();
  }

  if (phase === 'success' && result) {
    const isFullyPaid = result.remainingAfter <= 0.005;
    const statusLabel = isFullyPaid
      ? 'Tüm borçlar kapandı'
      : `${fmtTL(result.remainingAfter)} borç kaldı`;
    return (
      <div className="modal-backdrop" onClick={handleFinish}>
        <div className="modal rpm-modal" onClick={e => e.stopPropagation()}>
          <div className="rpm-success">
            <div className="rpm-success-check">
              <RpmCheckCircle />
            </div>
            <h3 className="rpm-success-title">Tahsilat alındı</h3>
            <p className="rpm-success-meta">
              <span>{student.full_name}</span>
              <span className="rpm-success-sub-dot" aria-hidden="true">·</span>
              <span>{result.count} kalem</span>
              <span className="rpm-success-sub-dot" aria-hidden="true">·</span>
              <strong>{fmtTL(result.paidAmount)}</strong>
            </p>
            <div className={'rpm-success-status ' + (isFullyPaid ? 'is-paid' : 'is-partial')}>
              {statusLabel}
            </div>
            <button
              type="button"
              className="rpm-success-done"
              onClick={handleFinish}
              autoFocus
            >
              Tamam
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="modal rpm-modal" onClick={e => e.stopPropagation()}>
        <div className="rpm-head">
          <div>
            <h3>Ödeme al</h3>
            <div className="rpm-modal-subhead">
              <strong>{student.full_name}</strong>
              {debtItems.length > 0 && (
                <>
                  <span className="rpm-modal-subhead-sep" aria-hidden="true">·</span>
                  <span>Açık borç toplamı: <strong>{fmtTL(totalRemaining)}</strong></span>
                  <span className="rpm-modal-subhead-sep" aria-hidden="true">·</span>
                  <span>{debtItems.length} kalem</span>
                </>
              )}
            </div>
          </div>
          <button className="btn btn-ghost btn-xs" onClick={onClose} disabled={submitting}>Kapat</button>
        </div>

        {!debtItems.length ? (
          <div className="rpm-empty">
            Öğrencinin tahsil edilebilir açık borç kalemi bulunmuyor.
          </div>
        ) : (
          <form className="rpm-form" onSubmit={handleSubmit}>
            {mode === 'single' && selectedItem && (
              <div className="rpm-mode-banner">
                <span>
                  <strong>Sadece bu kaleme:</strong> {selectedItem.typeLabel}
                  {' · '}{fmtDate(selectedItem.dateIso)}
                  {' · '}{fmtTL(selectedItem.remainingAmount)} kalan
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={handleBackToAuto}
                  disabled={submitting}
                >
                  Tüm borçlara dön
                </button>
              </div>
            )}

            <div className="form-row-2">
              <div className="form-row">
                <label>Ödeme tutarı</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01" step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  onFocus={handleAmountFocus}
                  placeholder="0,00"
                  disabled={submitting}
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label>Ödeme yöntemi</label>
                <select value={source} onChange={e => setSource(e.target.value)} disabled={submitting}>
                  <option value="cash">Nakit</option>
                  <option value="iban">IBAN</option>
                </select>
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-row">
                <label>Ödeme tarihi</label>
                <input
                  type="datetime-local"
                  value={paidAt}
                  onChange={e => setPaidAt(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="form-row">
                <label>Not</label>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="İsteğe bağlı"
                  disabled={submitting}
                />
              </div>
            </div>

            {listItems.length > 0 && (
              <div className="rpm-allocations">
                <div className="rpm-allocations-head">
                  {allocations.length > 0
                    ? (mode === 'single' ? 'İşlenecek kalem' : 'İşlenecek kalemler')
                    : 'Açık borç kalemleri'}
                  {mode === 'auto' && listItems.length > 1 && (
                    <span className="rpm-allocations-hint"> · en eski → yeni</span>
                  )}
                  {rowsClickable && (
                    <span className="rpm-allocations-action-hint"> · sadece bir kaleme ödemek için tıkla</span>
                  )}
                </div>
                {listItems.map(({ item, portion, planned }) => {
                  const isPartial = planned && portion < item.remainingAmount - 0.001;
                  const RowTag = rowsClickable ? 'button' : 'div';
                  return (
                    <RowTag
                      key={item.key}
                      {...(rowsClickable ? { type: 'button', onClick: () => handlePickItem(item) } : {})}
                      className={'rpm-allocations-row' + (rowsClickable ? ' is-clickable' : '')}
                      title={rowsClickable ? 'Sadece bu kaleme öde' : undefined}
                    >
                      <span className="rpm-allocations-date">{fmtDate(item.dateIso)}</span>
                      <span className="rpm-allocations-type">{item.typeLabel}</span>
                      <span className="rpm-allocations-desc" title={item.description || ''}>
                        {item.description || ''}
                      </span>
                      <span className="rpm-allocations-amount">
                        <strong>{fmtTL(portion)}</strong>
                        {isPartial && <span className="rpm-allocations-partial"> · kısmi</span>}
                      </span>
                    </RowTag>
                  );
                })}
              </div>
            )}

            {isOverDebt && (
              <div className="rpm-error">
                Tutar {mode === 'single' ? 'bu kalemin' : 'açık borç'} kalanından ({fmtTL(maxAmount)}) fazla olamaz.
              </div>
            )}

            {error && <div className="rpm-error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
                Vazgeç
              </button>
              <button type="submit" className="btn btn-accent" disabled={!canSubmit}>
                {submitting
                  ? 'Kaydediliyor...'
                  : (parsedAmount > 0 && !isOverDebt
                      ? `${fmtTL(parsedAmount)} kaydet`
                      : 'Ödemeyi kaydet')}
              </button>
            </div>
          </form>
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

// Tarih alanını <input type="date"> değerine çevirir. API DATE'i 'YYYY-MM-DD'
// string döndürür ama Date nesnesi / ISO string de gelse doğru çalışır (yerel
// bileşenler kullanılır; toISOString TZ kayması yapmaz).
export function toDateInputValue(v) {
  if (!v) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

// Öğrenci oluşturma + düzenleme ortak formu.
//   mode='create' → createStudent, boş alanlar, "Öğrenciyi ekle"
//   mode='edit'   → updateStudent(student.id), alanlar student'tan doldurulur
// onSaved(saved) her iki modda da kaydedilen kaydı alır.
export function StudentFormModal({ mode = 'create', student = null, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const [fullName, setFullName] = React.useState(student?.full_name ?? '');
  const [nickname, setNickname] = React.useState(student?.nickname ?? '');
  const [phone, setPhone] = React.useState(student?.phone ? formatPhoneTr(student.phone) : '');
  const [email, setEmail] = React.useState(student?.email ?? '');
  const [birthday, setBirthday] = React.useState(toDateInputValue(student?.birthday));
  const [joinedAt, setJoinedAt] = React.useState(
    isEdit ? toDateInputValue(student?.joined_at) : todayIso(),
  );
  const [preferredMode, setPreferredMode] = React.useState(student?.preferred_mode ?? null); // 'online' | 'onsite' | null
  const [note, setNote] = React.useState(student?.note ?? '');
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

    const payload = {
      fullName: trimmedName,
      nickname: trimmedNickname || null,
      preferredMode: preferredMode,
      phone: phone.trim() || null,
      email: email.trim() || null,
      birthday: birthday || null,
      joinedAt: joinedAt || null,
      note: note.trim() || null,
    };

    try {
      const saved = isEdit
        ? await updateStudent(student.id, payload)
        : await createStudent(payload);
      await onSaved(saved);
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : (isEdit ? 'Öğrenci güncellenemedi.' : 'Öğrenci oluşturulamadı.'));
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
              {trimmedName || (isEdit ? 'Öğrenciyi düzenle' : 'Öğrenci ekle')}
              {trimmedNickname && (
                <span className="mcs-head-nick">“{trimmedNickname}”</span>
              )}
            </h3>
            <div className="mcs-sub">
              {isEdit
                ? 'Bilgileri güncelle ve kaydet.'
                : (trimmedName
                    ? 'Bilgileri kontrol et ve kaydet.'
                    : 'Temel bilgiler yeterli; detaylar sonra eklenebilir.')}
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
                {submitting
                  ? (isEdit ? 'Kaydediliyor…' : 'Ekleniyor…')
                  : (isEdit ? 'Kaydet' : 'Öğrenciyi ekle')}
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

// Student profile page — dedicated detail/CRM screen.
// Data fetched client-side; financial summary derived from the same arrays
// (no separate /students/:id/summary endpoint yet — see follow-up notes).

import React from 'react';
import { fmtTL } from './data';
import { Icon } from './layout';
import {
  getStudentById,
  getStudentLessons,
  getStudentPackages,
  getStudentProductSales,
  getStudentMovements,
  updateStudent,
  deleteStudent,
} from './api';
import { ReceivePaymentModal, ConfirmDeleteStudentModal } from './students';

const LESSON_STATUS_TR = {
  scheduled: 'Planlı',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
  no_show:   'Gelmedi',
};

const LESSON_MODE_TR = { online: 'Online', onsite: 'Yüzyüze' };

function money(v) { return parseFloat(v ?? '0') || 0; }

function fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'short', year: opts.year !== false ? 'numeric' : undefined,
  });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

// Tek satır tarih formatı — smart year (cari yıl gizlenir).
function fmtRowDate(iso, { withTime = false } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  });
  if (!withTime) return date;
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

// Tarih grup etiketi: "Bugün" / "Dün" / "Bu hafta" / "Geçen hafta" / "Nisan 2026".
function dateBucket(iso) {
  if (!iso) return { key: '0-unknown', label: '—' };
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x) => { const c = new Date(x); c.setHours(0,0,0,0); return c; };
  const today = startOfDay(now);
  const target = startOfDay(d);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  // Pazartesi başlangıçlı haftalık pencere
  const dow = (today.getDay() + 6) % 7; // 0 = Pzt
  const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - dow);
  const startOfPrevWeek = new Date(startOfWeek); startOfPrevWeek.setDate(startOfWeek.getDate() - 7);

  if (diffDays === 0) return { key: '1-today',     label: 'Bugün' };
  if (diffDays === -1) return { key: '0-tomorrow', label: 'Yarın' };
  if (diffDays < -1) {
    // Gelecek tarih — "Önümüzdeki günler" başlığı altında topla
    return { key: '-1-future', label: 'Yaklaşan' };
  }
  if (diffDays === 1) return { key: '2-yesterday', label: 'Dün' };
  if (target >= startOfWeek)     return { key: '3-this-week', label: 'Bu hafta' };
  if (target >= startOfPrevWeek) return { key: '4-prev-week', label: 'Geçen hafta' };

  // Aylık bucket — en yeni ay 5'ten başlayarak küçülür
  const monthsBehind = (today.getFullYear() - target.getFullYear()) * 12 + (today.getMonth() - target.getMonth());
  const monthLabel = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  return { key: `5-${String(1000 - monthsBehind).padStart(4,'0')}-${target.getFullYear()}-${target.getMonth()}`, label: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1) };
}

function bucketByDate(items, { dateKey = 'date' } = {}) {
  const groups = new Map();
  for (const it of items) {
    const b = dateBucket(it[dateKey]);
    if (!groups.has(b.key)) groups.set(b.key, { key: b.key, label: b.label, items: [] });
    groups.get(b.key).items.push(it);
  }
  return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// Tek birleşik durum etiketi — ders status + ödeme durumu
function lessonStatusLabel(l) {
  if (l.status === 'scheduled') return { label: 'Planlı',  tone: 'scheduled' };
  if (l.status === 'cancelled') return { label: 'İptal',   tone: 'neutral' };
  if (l.status === 'no_show')   return { label: 'Gelmedi', tone: 'warn' };
  // completed
  if (l.prepaid_package_id)     return { label: 'Krediden', tone: 'credit' };
  const remaining = money(l.remaining_receivable);
  const paid = money(l.paid_amount);
  if (remaining < 0.01 && paid > 0.01) return { label: 'Ödendi', tone: 'paid' };
  if (paid > 0.01 && remaining > 0.01) return { label: 'Kısmi',  tone: 'partial' };
  return                                    { label: 'Borçlu', tone: 'open' };
}

function saleStatusLabel(s) {
  const remaining = money(s.remaining_receivable);
  const paid = money(s.paid_amount);
  if (remaining < 0.01) return { label: 'Ödendi', tone: 'paid' };
  if (paid > 0.01)      return { label: 'Kısmi',  tone: 'partial' };
  return                       { label: 'Borçlu', tone: 'open' };
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

// ─── Derived metrics ──────────────────────────────────────────────────────────
// Debt-first. No standing balance concept exists anymore — payments either
// exactly cover a lesson/product debt or are rejected upstream.
function computeFinancials({ lessons, productSales, packages }) {
  const lessonDebt = lessons
    .filter(l => l.status === 'completed' && !l.prepaid_package_id && !l.deleted_at)
    .reduce((s, l) => s + money(l.remaining_receivable), 0);

  const productDebt = (productSales ?? [])
    .reduce((s, p) => s + money(p.remaining_receivable), 0);

  const activeCredits = (packages ?? [])
    .reduce((s, p) => s + Number(p.remaining_credits || 0), 0);

  const activeCreditValue = (packages ?? [])
    .reduce((s, p) => s + money(p.remaining_value), 0);

  const totalDebt = lessonDebt + productDebt;
  const state = totalDebt > 0.01 ? 'debt' : 'clear';
  const headline = totalDebt > 0.01 ? `${fmtTL(totalDebt)} borçlu` : 'Güncel';

  return {
    lessonDebt, productDebt, totalDebt,
    activeCredits, activeCreditValue,
    state, headline,
  };
}

function lessonPaymentState(l) {
  if (l.status !== 'completed') return null;
  if (l.prepaid_package_id) return { tone: 'credit', label: 'Krediden' };
  const remaining = money(l.remaining_receivable);
  const paid = money(l.paid_amount);
  if (remaining < 0.01 && paid > 0.01) return { tone: 'paid', label: 'Ödendi' };
  if (paid > 0.01 && remaining > 0.01) return { tone: 'partial', label: 'Kısmi' };
  return { tone: 'open', label: 'Açık' };
}

// ─── Activity timeline ────────────────────────────────────────────────────────
// One unified, chronological stream of *everything* that touches this student's
// account: lessons, package purchases, product sales.
// The "Kayıtlar" tab renders this directly; the typed tabs (Dersler,
// Ürün Satışı) render a filter of the same stream. The "Hareketler" tab is
// separate — it shows every individual state change (minute precision) fetched
// from the /students/:id/movements endpoint.
function buildActivity({ lessons, packages, productSales }) {
  const items = [];

  for (const l of lessons ?? []) {
    if (l.deleted_at) continue;
    const remaining = money(l.remaining_receivable);
    const gross = money(l.price_snapshot);
    const discount = money(l.discount_amount);
    const net = money(l.net_amount ?? (gross - discount));
    const status = lessonStatusLabel(l);
    const hasDebt = l.status === 'completed' && !l.prepaid_package_id && remaining > 0.01;
    items.push({
      key:           `lesson-${l.id}`,
      date:          l.starts_at,
      withTime:      true,
      kind:          'lesson',
      lessonStatus:  l.status,
      paymentTone:   status.tone,
      title:         LESSON_MODE_TR[l.mode] || l.mode,
      sub:           l.note?.trim() || null,
      status,
      discount,
      amount:     l.prepaid_package_id ? null : net,
      amountSub:  hasDebt ? `Kalan: ${fmtTL(remaining)}` : null,
      amountTone: l.prepaid_package_id ? 'mute'
                : hasDebt ? 'warn'
                : 'quiet',
      _search: [
        LESSON_STATUS_TR[l.status],
        LESSON_MODE_TR[l.mode],
        l.note,
        status.label,
      ].filter(Boolean).join(' ').toLowerCase(),
    });
  }

  for (const p of packages ?? []) {
    const total = Number(p.credit_count || 0);
    const remaining = Number(p.remaining_credits || 0);
    const used = Number(p.used_credits || 0);
    items.push({
      key:        `pkg-${p.package_id}`,
      date:       p.purchased_at,
      withTime:   false,
      kind:       'package',
      title:      `${total} kredi · ${fmtTL(money(p.unit_price))}/ders`,
      sub:        remaining > 0 ? `${used}/${total} kullanıldı` : 'Tükendi',
      status:     remaining > 0 ? { label: 'Aktif', tone: 'paid' } : { label: 'Tükendi', tone: 'neutral' },
      packageStatus: remaining > 0 ? 'active' : 'used_up',
      amount:     money(p.total_amount),
      amountTone: 'quiet',
      _search: ['paket', String(total), 'kredi', remaining > 0 ? 'aktif' : 'tükendi'].join(' ').toLowerCase(),
    });
  }

  for (const s of productSales ?? []) {
    const remaining = money(s.remaining_receivable);
    const total = money(s.total_amount);
    const status = saleStatusLabel(s);
    const hasDebt = remaining > 0.01;
    items.push({
      key:        `sale-${s.product_sale_id}`,
      saleId:     s.product_sale_id,
      date:       s.sold_at,
      withTime:   false,
      kind:       'sale',
      title:      'Ürün satışı',
      sub:        s.note?.trim() || null,
      status,
      paymentTone: status.tone,
      amount:     total,
      amountSub:  hasDebt ? `Kalan: ${fmtTL(remaining)}` : null,
      amountTone: hasDebt ? 'warn' : 'quiet',
      _search: ['ürün', 'satış', s.note, status.label].filter(Boolean).join(' ').toLowerCase(),
    });
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function StudentProfilePage({ studentId, onBack, onOpenSale }) {
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [student, setStudent] = React.useState(null);
  const [lessons, setLessons] = React.useState([]);
  const [productSales, setProductSales] = React.useState([]);
  const [packages, setPackages] = React.useState([]);
  const [movements, setMovements] = React.useState([]);
  const [tab, setTab] = React.useState('stats');
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  // Aktif ↔ pasif. Başarıda profili tazeleyip yeni durumu yansıtırız.
  async function handleSetActive(active) {
    try {
      await updateStudent(student.id, { isActive: active });
      await loadAll();
    } catch (e) {
      console.error('[StudentProfile] aktiflik güncellenemedi:', e);
      window.alert(e instanceof Error ? e.message : 'Öğrenci durumu güncellenemedi.');
    }
  }

  // Silme başarılıysa profil artık yok → listeye dön. 409'da modal kendi
  // hatasını gösterir (throw ederiz, onBack çağrılmaz).
  async function handleConfirmDelete() {
    await deleteStudent(student.id);
    setDeleteOpen(false);
    onBack();
  }

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [s, l, p, ps, mv] = await Promise.all([
        getStudentById(studentId),
        getStudentLessons(studentId),
        getStudentPackages(studentId),
        getStudentProductSales(studentId),
        getStudentMovements(studentId),
      ]);
      setStudent(s);
      setLessons(l);
      setPackages(p);
      setProductSales(ps);
      setMovements(mv);
    } catch (e) {
      console.error('[StudentProfile] yüklenemedi:', e);
      setErr(e instanceof Error ? e.message : 'Profil yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  React.useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) {
    return (
      <div className="page page-sp">
        <ProfileBackLink onBack={onBack} />
        <div className="sp-state-msg">Yükleniyor...</div>
      </div>
    );
  }

  if (err || !student) {
    return (
      <div className="page page-sp">
        <ProfileBackLink onBack={onBack} />
        <div className="sp-state-msg">{err || 'Öğrenci bulunamadı.'}</div>
      </div>
    );
  }

  const fin = computeFinancials({ lessons, productSales, packages });
  const activity = buildActivity({ lessons, packages, productSales });
  const counts = {
    lessons:   activity.filter(i => i.kind === 'lesson').length,
    products:  activity.filter(i => i.kind === 'sale').length,
    movements: movements.length,
  };

  return (
    <div className="page page-sp">
      <ProfileBackLink onBack={onBack} />

      <BandHeader
        student={student}
        fin={fin}
        onPayment={() => setPaymentOpen(true)}
        onOpenSale={onOpenSale ? () => onOpenSale(student) : undefined}
        onSetActive={handleSetActive}
        onDelete={() => setDeleteOpen(true)}
      />

      <Tabs tab={tab} setTab={setTab} counts={counts} />

      {tab === 'stats' ? (
        <OverviewTab
          student={student}
          lessons={lessons}
          sales={productSales}
          movements={movements}
        />
      ) : tab === 'movements' ? (
        <div className="card sp-tab-card"><MovementsView items={movements} /></div>
      ) : (
        <div className="card sp-tab-card"><ActivityView items={activity} tab={tab} /></div>
      )}

      {paymentOpen && (
        <ReceivePaymentModal
          student={student}
          detail={{ lessons, productSales }}
          onClose={() => setPaymentOpen(false)}
          onSuccess={async () => { setPaymentOpen(false); await loadAll(); }}
        />
      )}

      {deleteOpen && (
        <ConfirmDeleteStudentModal
          student={student}
          onClose={() => setDeleteOpen(false)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}

// ─── Back link ────────────────────────────────────────────────────────────────

function ProfileBackLink({ onBack }) {
  return (
    <button className="sp-back" onClick={onBack} type="button">
      <Icon.ChevronL width="14" height="14" />
      <span>Öğrenciler</span>
    </button>
  );
}

// ─── A11 durum bandı + Özet (web yeniden tasarımı) ────────────────────────────

// A11 (devir paketi) ikon seti — durum bandı, Özet kartları ve iletişim için.
// Liste sekmeleri hâlâ layout'tan gelen `Icon`'u kullanır.
const G = {
  pay:    (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><rect x="1.5" y="3" width="13" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.4"/><path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.4"/><path d="M4 10h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>),
  cart:   (p) => (<svg viewBox="0 0 16 16" fill="none" {...p}><path d="M1.5 2.5h1.6l1.5 7.4a1.3 1.3 0 001.3 1h5a1.3 1.3 0 001.3-1l.9-4.6H4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><circle cx="6.5" cy="13.5" r="1" fill="currentColor"/><circle cx="11.5" cy="13.5" r="1" fill="currentColor"/></svg>),
  online: (p) => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><rect x="1.5" y="3" width="13" height="8.5" rx="1.5"/><path d="M5.5 14h5M8 11.5V14" strokeLinecap="round"/></svg>),
  onsite: (p) => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" {...p}><path d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z"/></svg>),
  phone:  (p) => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M4.5 2h2l1 3-1.3.9a8 8 0 003.5 3.5l.9-1.3 3 1v2a1.3 1.3 0 01-1.5 1.3A11 11 0 013.2 4.5 1.3 1.3 0 014.5 2z" strokeLinejoin="round"/></svg>),
  mail:   (p) => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M2.5 4.5L8 9l5.5-4.5" strokeLinecap="round"/></svg>),
  cake:   (p) => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><path d="M2.5 13.5h11v-4a1.3 1.3 0 00-1.3-1.3H3.8A1.3 1.3 0 002.5 9.5v4z" strokeLinejoin="round"/><path d="M8 5V3M5.5 5.5V4M10.5 5.5V4M2.5 10.5h11" strokeLinecap="round"/></svg>),
  cal:    (p) => (<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6h12M5.5 1.8V4M10.5 1.8V4" strokeLinecap="round"/></svg>),
  more:   (p) => (<svg viewBox="0 0 16 16" fill="currentColor" {...p}><circle cx="8" cy="3.5" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="8" cy="12.5" r="1.2"/></svg>),
};
const MODE_ICON = { online: G.online, onsite: G.onsite };
const WD = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

// ── Tarih yardımcıları (A11 kartları için, gerçek "now" ile) ──
function dayStart(x) { const d = new Date(x); d.setHours(0, 0, 0, 0); return d; }
function fmtDayLong(iso, { withTime = false } = {}) {
  const d = new Date(iso);
  let s = WD[d.getDay()] + ' · ' + d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  if (withTime) s += ' · ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return s;
}
function agoLabel(iso) {
  const n = Math.round((dayStart(new Date()) - dayStart(new Date(iso))) / 86_400_000);
  if (n <= 0) return 'bugün';
  if (n === 1) return 'dün';
  if (n < 7) return n + ' gün önce';
  if (n < 14) return '1 hafta önce';
  if (n < 30) return Math.floor(n / 7) + ' hafta önce';
  return Math.floor(n / 30) + ' ay önce';
}
function inDaysLabel(iso) {
  const n = Math.round((dayStart(new Date(iso)) - dayStart(new Date())) / 86_400_000);
  if (n <= 0) return 'bugün';
  if (n === 1) return 'yarın';
  if (n < 7) return n + ' gün sonra';
  return Math.floor(n / 7) + ' hafta sonra';
}

function Initials({ name }) {
  const txt = (name || '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('');
  return txt.toLocaleUpperCase('tr-TR') || '?';
}

function Badge({ tone, children }) {
  return <span className={'wp-badge t-' + tone}>{children}</span>;
}

// Ders durum + ödeme tonu (A11 kart/rozet için).
function lessonTone(l) {
  if (l.status === 'scheduled') return { label: 'Planlı', tone: 'scheduled' };
  if (l.status === 'cancelled') return { label: 'İptal', tone: 'neutral' };
  if (l.status === 'no_show')   return { label: 'Gelmedi', tone: 'neutral' };
  if (l.prepaid_package_id)     return { label: 'Krediden', tone: 'credit' };
  const remaining = money(l.remaining_receivable);
  const paid = money(l.paid_amount);
  if (remaining > 0.01 && paid > 0.01) return { label: 'Kısmi', tone: 'partial' };
  if (remaining > 0.01)                return { label: 'Açık', tone: 'open' };
  return { label: 'Ödendi', tone: 'paid' };
}

// ─── Durum renkli başlık bandı (A11) ──────────────────────────────────────────
function BandHeader({ student, fin, onPayment, onOpenSale, onSetActive, onDelete }) {
  const isDebt = fin.totalDebt > 0.01;
  const breakdown = isDebt
    ? [
        fin.lessonDebt > 0.01  ? `${fmtTL(fin.lessonDebt)} ders` : null,
        fin.productDebt > 0.01 ? `${fmtTL(fin.productDebt)} ürün` : null,
      ].filter(Boolean).join(' · ')
    : 'Ödenmemiş borç yok';

  const modeText = student.preferred_mode === 'onsite' ? 'Yüzyüze tercih'
                 : student.preferred_mode === 'online' ? 'Online tercih'
                 : null;

  return (
    <div className={'wp-banner ' + (isDebt ? 'debt' : 'clear')}>
      <div className="wp-banner-top">
        <div className="wp-id light">
          <div className="wp-av light"><Initials name={student.full_name} /></div>
          <div>
            <div className="wp-id-row">
              <h1 className="wp-name light">{student.full_name}</h1>
              <span className="wp-status light"><i />{student.is_active ? 'Aktif' : 'Pasif'}</span>
            </div>
            <div className="wp-id-meta light">
              {student.phone && <span>{student.phone}</span>}
              {student.phone && modeText && <span>·</span>}
              {modeText && <span>{modeText}</span>}
            </div>
          </div>
        </div>

        <div className="sp-more">
          <button className="wp-icbtn light" type="button" aria-label="Diğer işlemler">
            <G.more width="16" height="16" />
          </button>
          <div className="sp-more-menu">
            <button
              type="button"
              className="sp-more-item"
              onClick={() => onSetActive(!student.is_active)}
            >
              {student.is_active ? 'Pasife al' : 'Tekrar aktif et'}
            </button>
            {!student.is_active && (
              <button type="button" className="sp-more-item sp-more-item-warn" onClick={onDelete}>
                Tamamen sil
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="wp-banner-bottom">
        <div className="wp-banner-bal">
          <span className="wp-banner-lbl">{isDebt ? 'Toplam borç' : 'Hesap durumu'}</span>
          <span className="wp-banner-val">{isDebt ? fmtTL(fin.totalDebt) : 'Güncel'}</span>
          <span className="wp-banner-brk">{breakdown}</span>
        </div>
        <div className="wp-actions onbanner">
          <button className="wp-btn light-solid" type="button" disabled={!isDebt} onClick={onPayment}>
            <G.pay width="15" height="15" /> Ödeme al
          </button>
          {onOpenSale && (
            <button className="wp-btn light-outline" type="button" onClick={onOpenSale}>
              <G.cart width="15" height="15" /> Ürün satışı
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Özet sekmesi (A11) ───────────────────────────────────────────────────────
// Üstte 3 kart (son katılım · sıradaki ders · aylık hedef), altta hesap
// hareketleri zaman tüneli + hızlı bilgiler / iletişim / not.

function SectCard({ title, sub, children, className }) {
  return (
    <div className={'wp-card ' + (className || '')}>
      <div className="wp-sect-head">
        <span className="wp-side-title">{title}</span>
        {sub && <span className="wp-sect-sub">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Ring({ n, pct, label, now, size = 52 }) {
  const st = 6, r = (size - st) / 2, c = 2 * Math.PI * r, off = c * (1 - pct / 100), full = pct >= 100;
  return (
    <div className={'wp-ring' + (now ? ' now' : '')}>
      <div className="wp-ring-svg" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-2)" strokeWidth={st} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={full ? 'var(--sage)' : 'var(--accent)'} strokeWidth={st} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </svg>
        <span className="wp-ring-n">{n}</span>
      </div>
      <span className="wp-ring-l">{label}</span>
    </div>
  );
}

function pastCompleted(lessons) {
  return lessons
    .filter(l => !l.deleted_at && l.status === 'completed')
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))[0] || null;
}
function upcomingScheduled(lessons) {
  const t = Date.now();
  return lessons
    .filter(l => !l.deleted_at && l.status === 'scheduled' && new Date(l.starts_at).getTime() >= t)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null;
}

function LastLessonCard({ lessons }) {
  const l = pastCompleted(lessons);
  if (!l) return <div className="wp-mute-row">Henüz tamamlanan ders yok</div>;
  const st = lessonTone(l);
  const Ic = MODE_ICON[l.mode] || G.onsite;
  const open = st.tone === 'open' || st.tone === 'partial';
  const d = new Date(l.starts_at);
  return (
    <div className={'wp-last t-' + st.tone}>
      <div className="wp-last-cal"><b>{d.getDate()}</b><span>{d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '')}</span></div>
      <div className="wp-last-mid">
        <div className="wp-last-eyebrow">Son katılım · {agoLabel(l.starts_at)}</div>
        <div className="wp-last-title"><Ic width="14" height="14" /> {LESSON_MODE_TR[l.mode] || 'Ders'} ders</div>
        <div className="wp-last-meta">{fmtDayLong(l.starts_at, { withTime: true })}</div>
      </div>
      <div className="wp-last-right">
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className={'wp-last-amt' + (open ? ' open' : '')}>
          {open ? fmtTL(money(l.remaining_receivable)) : (l.prepaid_package_id ? 'Krediden' : 'Ödendi')}
        </span>
      </div>
    </div>
  );
}

function NextLessonCard({ lessons }) {
  const l = upcomingScheduled(lessons);
  if (!l) return <div className="wp-mute-row">Planlı ders bulunmuyor</div>;
  const Ic = MODE_ICON[l.mode] || G.onsite;
  const d = new Date(l.starts_at);
  const note = l.note?.trim();
  return (
    <div className="wp-last t-scheduled">
      <div className="wp-last-cal"><b>{d.getDate()}</b><span>{d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '')}</span></div>
      <div className="wp-last-mid">
        <div className="wp-last-eyebrow">Sıradaki ders · {inDaysLabel(l.starts_at)}</div>
        <div className="wp-last-title"><Ic width="14" height="14" /> {LESSON_MODE_TR[l.mode] || 'Ders'} ders</div>
        <div className="wp-last-meta">{fmtDayLong(l.starts_at, { withTime: true })}{note ? ' · ' + note : ''}</div>
      </div>
      <div className="wp-last-right"><Badge tone="scheduled">Planlı</Badge></div>
    </div>
  );
}

// Aylık hedef + üyelik/ortalama (4 ders/ay = %100). Gerçek "now" üzerinden.
function computeAttendance(lessons, student) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const n = lessons.filter(l => {
      if (l.deleted_at || l.status !== 'completed') return false;
      const x = new Date(l.starts_at);
      return x.getMonth() === d.getMonth() && x.getFullYear() === d.getFullYear();
    }).length;
    months.push({ m: d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', ''), n, pct: Math.min(n / 4, 1) * 100 });
  }
  const avgMonthly = Math.round((months.reduce((s, m) => s + m.n, 0) / months.length) * 10) / 10;
  let memberMonths = 1;
  if (student.joined_at) {
    const j = new Date(student.joined_at);
    memberMonths = Math.max(1, (now.getFullYear() - j.getFullYear()) * 12 + (now.getMonth() - j.getMonth()) + 1);
  }
  return { months, avgMonthly, memberMonths };
}

function richStats(lessons, sales) {
  const done = lessons.filter(l => !l.deleted_at && l.status === 'completed');
  const lifetimePaid =
    lessons.reduce((s, l) => s + money(l.paid_amount), 0) +
    (sales || []).reduce((s, x) => s + money(x.paid_amount), 0);
  const avgFee = done.length
    ? Math.round(done.reduce((s, l) => s + money(l.net_amount ?? (money(l.price_snapshot) - money(l.discount_amount))), 0) / done.length)
    : 0;
  return { lifetimePaid, avgFee, doneCount: done.length };
}

function KeyFacts({ lessons, sales, att }) {
  const r = richStats(lessons, sales);
  const rows = [
    { k: 'Üyelik süresi', v: att.memberMonths + ' ay' },
    { k: 'Bugüne dek ödenen', v: fmtTL(r.lifetimePaid) },
    { k: 'Ortalama ders ücreti', v: fmtTL(r.avgFee) },
    { k: 'Aylık ortalama', v: att.avgMonthly + ' ders' },
  ];
  return (
    <dl className="wp-kv">
      {rows.map(x => <div key={x.k} className="wp-kv-row"><dt>{x.k}</dt><dd>{x.v}</dd></div>)}
    </dl>
  );
}

function ContactCard({ student }) {
  const rows = [
    { ic: G.phone, k: 'Telefon', v: student.phone },
    { ic: G.mail, k: 'E-posta', v: student.email },
    { ic: G.cake, k: 'Doğum günü', v: student.birthday ? new Date(student.birthday).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : null },
    { ic: G.cal, k: 'Üyelik', v: student.joined_at ? new Date(student.joined_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : null },
  ];
  return (
    <div className="wp-card">
      <div className="wp-side-title">İletişim</div>
      <dl className="wp-kv">
        {rows.map(r => (
          <div key={r.k} className="wp-kv-row">
            <span className="wp-kv-ic"><r.ic width="14" height="14" /></span>
            <dt>{r.k}</dt>
            <dd>{r.v || <span className="sp-muted">—</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Hesap hareketleri zaman tüneli — gerçek movements'ı describeMovement ile çevirir.
function Timeline({ movements, limit = 7 }) {
  if (!movements || movements.length === 0) return <div className="wp-mute-row">Henüz hareket yok</div>;
  const items = [...movements]
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
    .slice(0, limit);
  return (
    <div className="wp-tl">
      {items.map((m, idx) => {
        const desc = describeMovement(m);
        const Icn = MV_PILL_ICON[desc.pillTone] || Icon.Calendar;
        const tn = desc.amountTone === 'paid' ? 'paid' : desc.amountTone === 'discount' ? 'disc' : 'mute';
        const d = new Date(m.occurred_at);
        const sub = [
          desc.title,
          d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }),
          d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
        ].filter(Boolean).join(' · ');
        const showAmt = desc.amount != null && desc.amountTone !== 'mute';
        return (
          <div key={`${m.kind}-${idx}-${m.occurred_at}`} className="wp-tl-row">
            <div className="wp-tl-spine"><span className={'wp-tl-dot ' + tn}><Icn width="11" height="11" /></span></div>
            <div className="wp-tl-body">
              <div className="wp-tl-top">
                <span className="wp-tl-label">{desc.typeLabel}</span>
                {showAmt && (
                  <span className={'wp-amt' + (desc.amountTone === 'paid' ? ' credit' : '')}>
                    {desc.amountTone === 'paid' ? '+' : desc.amountTone === 'discount' ? '−' : ''}{fmtTL(Math.abs(desc.amount))}
                  </span>
                )}
              </div>
              <div className="wp-tl-sub">{sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OverviewTab({ student, lessons, sales, movements }) {
  const att = React.useMemo(() => computeAttendance(lessons, student), [lessons, student]);
  const m4 = att.months.slice(-4);
  const note = student.note?.trim();
  return (
    <>
      <div className="wp-ov-3">
        <SectCard title="Son katılım"><LastLessonCard lessons={lessons} /></SectCard>
        <SectCard title="Sıradaki ders"><NextLessonCard lessons={lessons} /></SectCard>
        <SectCard title="Aylık hedef" sub="4 ders = %100">
          <div className="wp-rings">
            {m4.map((mm, i) => <Ring key={i} n={mm.n} pct={mm.pct} label={mm.m} now={i === m4.length - 1} size={44} />)}
          </div>
        </SectCard>
      </div>
      <div className="wp-ov-2b">
        <SectCard title="Hesap hareketleri" sub="zaman tüneli"><Timeline movements={movements} limit={7} /></SectCard>
        <div className="wp-ov-col">
          <SectCard title="Hızlı bilgiler"><KeyFacts lessons={lessons} sales={sales} att={att} /></SectCard>
          <ContactCard student={student} />
          {note && <SectCard title="Not"><p className="wp-note">{note}</p></SectCard>}
        </div>
      </div>
    </>
  );
}

// ─── Tabs (A11) ───────────────────────────────────────────────────────────────
// Özet (landing) · Dersler · Satışlar · Hareketler. Paket sekmesi A11 düzeninde
// yok (paket akışı kaldırılıyor); paket geçmişi Hareketler tünelinde görünür.

const TAB_DEFS = [
  { id: 'stats',     label: 'Özet' },
  { id: 'lessons',   label: 'Dersler' },
  { id: 'products',  label: 'Satışlar' },
  { id: 'movements', label: 'Hareketler' },
];

function Tabs({ tab, setTab, counts }) {
  return (
    <div className="wp-tabs">
      {TAB_DEFS.map(t => {
        const n = t.id === 'stats' ? null : counts[t.id];
        return (
          <button
            key={t.id}
            type="button"
            className={'wp-tab' + (tab === t.id ? ' on' : '')}
            onClick={() => setTab(t.id)}
          >
            <span className="wp-tab-l">{t.label}</span>
            {n != null && <span className="wp-tab-n">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Activity view (shared across Kayıtlar/Dersler/Ürün/Paket) ────────────────
// Each typed tab is a filter over the same merged timeline. The Kayıtlar tab is
// the unified everything-view (no sub-filter); the typed tabs each get a status
// sub-filter that's specific to that record kind.

const LESSON_SUBFILTERS = [
  { id: 'all',       label: 'Tümü',            match: () => true },
  { id: 'upcoming',  label: 'Yaklaşan',        match: i => i.lessonStatus === 'scheduled' },
  { id: 'completed', label: 'Tamamlanan',      match: i => i.lessonStatus === 'completed' },
  { id: 'cancelled', label: 'İptal / Gelmedi', match: i => i.lessonStatus === 'cancelled' || i.lessonStatus === 'no_show' },
];

const PRODUCT_FILTERS = [
  { id: 'all',     label: 'Tümü',   match: () => true },
  { id: 'open',    label: 'Borçlu', match: i => i.paymentTone === 'open' },
  { id: 'partial', label: 'Kısmi',  match: i => i.paymentTone === 'partial' },
  { id: 'paid',    label: 'Ödendi', match: i => i.paymentTone === 'paid' },
];

const PACKAGE_FILTERS = [
  { id: 'all',     label: 'Tümü',    match: () => true },
  { id: 'active',  label: 'Aktif',   match: i => i.packageStatus === 'active' },
  { id: 'used_up', label: 'Tükendi', match: i => i.packageStatus === 'used_up' },
];

const PAGE_SIZE = 20;

const KIND_ICON = {
  lesson:  Icon.Calendar,
  sale:    Icon.Tag,
  package: Icon.Layers,
};

function ActivityView({ items, tab }) {
  const filterDef =
    tab === 'lessons'  ? LESSON_SUBFILTERS :
    tab === 'products' ? PRODUCT_FILTERS   :
    tab === 'packages' ? PACKAGE_FILTERS   :
    null;

  const [filterId, setFilterId] = React.useState('all');
  const [search,   setSearch]   = React.useState('');
  const [order,    setOrder]    = React.useState('desc');
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE);

  React.useEffect(() => { setFilterId('all'); setSearch(''); setPageSize(PAGE_SIZE); }, [tab]);
  React.useEffect(() => { setPageSize(PAGE_SIZE); }, [filterId, search, order]);

  let scoped = items;
  if (tab === 'lessons')  scoped = items.filter(i => i.kind === 'lesson');
  if (tab === 'products') scoped = items.filter(i => i.kind === 'sale');
  if (tab === 'packages') scoped = items.filter(i => i.kind === 'package');

  if (scoped.length === 0) {
    const empty = emptyCopy(tab);
    return <EmptyBlock title={empty.title} sub={empty.sub} />;
  }

  const activeFilter = filterDef ? (filterDef.find(x => x.id === filterId) ?? filterDef[0]) : null;
  let visible = activeFilter ? scoped.filter(activeFilter.match) : scoped;

  const q = search.trim().toLowerCase();
  if (q) visible = visible.filter(i => (i._search || '').includes(q));

  visible = [...visible].sort((a, b) => {
    const t = new Date(a.date).getTime() - new Date(b.date).getTime();
    return order === 'asc' ? t : -t;
  });

  const total = visible.length;
  const sliced = visible.slice(0, pageSize);
  const groups = bucketByDate(sliced);

  return (
    <div className="sp-activity">
      <ActivityToolbar
        filterDef={filterDef}
        filterId={filterId}
        setFilterId={setFilterId}
        scoped={scoped}
        search={search}
        setSearch={setSearch}
      />

      {total === 0 ? (
        <div className="sp-state-msg sp-state-msg-inline">
          {q ? `"${search.trim()}" için kayıt yok.` : 'Bu filtrede kayıt yok.'}
        </div>
      ) : (
        <>
          <div className="sp-table-head">
            <span className="sp-th sp-th-icon" />
            <button
              type="button"
              className="sp-th sp-th-date sp-th-sortable"
              onClick={() => setOrder(o => (o === 'asc' ? 'desc' : 'asc'))}
              title={order === 'desc' ? 'Eskiden yeniye' : 'Yeniden eskiye'}
            >
              Tarih <span className="sp-th-arrow">{order === 'desc' ? '↓' : '↑'}</span>
            </button>
            <span className="sp-th sp-th-title">Açıklama</span>
            <span className="sp-th sp-th-status">Durum</span>
            <span className="sp-th sp-th-money">Tutar</span>
          </div>

          <ul className="sp-rows">
            {groups.map(g => (
              <React.Fragment key={g.key}>
                <li className="sp-bucket-head">{g.label}</li>
                {g.items.map(i => <ActivityRow key={i.key} item={i} />)}
              </React.Fragment>
            ))}
          </ul>

          {sliced.length < total && (
            <div className="sp-more-row">
              <button
                type="button"
                className="sp-load-more"
                onClick={() => setPageSize(s => s + PAGE_SIZE)}
              >
                Daha fazla göster
                <span className="sp-load-more-n">+{Math.min(PAGE_SIZE, total - sliced.length)}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActivityToolbar({ filterDef, filterId, setFilterId, scoped, search, setSearch }) {
  return (
    <div className="sp-toolbar">
      {filterDef && (
        <div className="sp-filter">
          {filterDef.map(f => {
            const count = f.id === 'all' ? scoped.length : scoped.filter(f.match).length;
            return (
              <button
                key={f.id}
                type="button"
                className={'sp-chip' + (filterId === f.id ? ' is-active' : '')}
                onClick={() => setFilterId(f.id)}
              >
                {f.label}
                <span className="sp-chip-n">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="sp-toolbar-search">
        <Icon.Search width="13" height="13" />
        <input
          type="text"
          placeholder="Ara..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className="sp-toolbar-search-clear"
            onClick={() => setSearch('')}
            aria-label="Aramayı temizle"
          >×</button>
        )}
      </div>
    </div>
  );
}

function emptyCopy(tab) {
  if (tab === 'lessons')  return { title: 'Henüz ders yok',  sub: 'Bu öğrenciye yeni bir ders planlayın.' };
  if (tab === 'products') return { title: 'Ürün satışı yok', sub: 'Bu öğrenciye henüz ürün satışı kaydı girilmedi.' };
  if (tab === 'packages') return { title: 'Paket yok',       sub: 'Bu öğrenci adına henüz paket alımı yapılmadı.' };
  return                       { title: 'Hareket yok',       sub: 'Bu öğrenci için kayıtlı bir hareket bulunmuyor.' };
}

function ActivityRow({ item }) {
  const Icn = KIND_ICON[item.kind] || Icon.Calendar;
  const dateText = fmtRowDate(item.date, { withTime: !!item.withTime });
  const status = item.status;

  return (
    <li className={'sp-row sp-row-activity sp-row-activity-' + item.kind}>
      <span className={'sp-row-icon sp-row-icon-' + item.kind} aria-hidden="true">
        <Icn width="14" height="14" />
      </span>

      <div className="sp-row-date">{dateText}</div>

      <div className="sp-row-title">
        <div className="sp-row-title-main">{item.title}</div>
        {item.sub && <div className="sp-row-title-sub">{item.sub}</div>}
      </div>

      <div className="sp-row-status">
        {status && (
          <span className={'sp-badge sp-badge-tone-' + status.tone}>{status.label}</span>
        )}
        {item.discount > 0.01 && (
          <span className="sp-badge sp-badge-discount" title={`İndirim: ${fmtTL(item.discount)}`}>
            −{fmtTL(item.discount)}
          </span>
        )}
      </div>

      <div className="sp-row-money">
        <ActivityAmount item={item} />
      </div>
    </li>
  );
}

function ActivityAmount({ item }) {
  if (item.amount == null || item.amountTone === 'mute') {
    return <span className="sp-muted">—</span>;
  }
  const mainCls =
    'sp-money-main' +
    (item.amountTone === 'credit' ? ' sp-money-credit' :
     item.amountTone === 'quiet'  ? ' sp-money-quiet'  : '');
  const subCls =
    'sp-money-hint' +
    (item.amountTone === 'warn' ? ' sp-money-hint-warn' : '');
  return (
    <>
      <span className={mainCls}>{fmtTL(item.amount)}</span>
      {item.amountSub && <span className={subCls}>{item.amountSub}</span>}
    </>
  );
}

// ─── Movements view (granular, minute-precision event log) ───────────────────
// One row per discrete event the backend emitted. Unlike the Kayıtlar stream
// (which folds multiple events into the "current state" of a lesson/sale),
// this splits every state change into its own entry with the exact timestamp.

const MOVEMENT_LESSON_MODE_TR = { online: 'Online', onsite: 'Yüzyüze' };

function fmtFullDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = d.toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function describeMovement(m) {
  const d = m.details || {};
  const modeLabel = MOVEMENT_LESSON_MODE_TR[d.mode] || d.mode;

  switch (m.kind) {
    case 'lesson_scheduled':
      return {
        pillTone: 'lesson',
        typeLabel: 'Ders planlandı',
        title: `${modeLabel || 'Ders'} · ${fmtDateTime(d.starts_at)}`,
        sub: d.prepaid_package_id ? 'Paketten' : (d.note?.trim() || null),
        amount: d.prepaid_package_id ? null : money(d.price),
        amountTone: 'quiet',
      };
    case 'lesson_completed':
      return {
        pillTone: 'lesson-done',
        typeLabel: 'Ders tamamlandı',
        title: `${modeLabel || 'Ders'} · ${fmtDateTime(d.starts_at)}`,
        sub: d.prepaid_package_id ? 'Krediden düşüldü' : (d.note?.trim() || null),
        amount: d.prepaid_package_id ? null : money(d.price),
        amountTone: d.prepaid_package_id ? 'mute' : 'quiet',
      };
    case 'lesson_cancelled':
      return {
        pillTone: 'lesson-off',
        typeLabel: 'Ders iptal edildi',
        title: `${modeLabel || 'Ders'} · ${fmtDateTime(d.starts_at)}`,
        sub: null,
        amount: null,
        amountTone: 'mute',
      };
    case 'lesson_no_show':
      return {
        pillTone: 'lesson-off',
        typeLabel: 'Gelmedi olarak işaretlendi',
        title: `${modeLabel || 'Ders'} · ${fmtDateTime(d.starts_at)}`,
        sub: null,
        amount: null,
        amountTone: 'mute',
      };
    case 'package_purchased':
      return {
        pillTone: 'package',
        typeLabel: 'Paket alındı',
        title: `${Number(d.credit_count || 0)} kredi · ${fmtTL(money(d.unit_price))}/ders`,
        sub: d.note?.trim() || null,
        amount: money(d.total_amount),
        amountTone: 'quiet',
      };
    case 'product_sale':
      return {
        pillTone: 'sale',
        typeLabel: 'Ürün satışı',
        title: d.note?.trim() || 'Ürün satışı',
        sub: null,
        amount: money(d.total_amount),
        amountTone: 'quiet',
      };
    case 'payment_lesson': {
      const startsAt = d.lesson_starts_at ? fmtDateTime(d.lesson_starts_at) : 'ders';
      const modeTxt  = d.lesson_mode ? (MOVEMENT_LESSON_MODE_TR[d.lesson_mode] || d.lesson_mode) : '';
      return {
        pillTone: 'payment',
        typeLabel: d.source === 'iban' ? 'Ödeme (IBAN)' : 'Ödeme (Nakit)',
        title: `${modeTxt ? modeTxt + ' · ' : ''}${startsAt} için`,
        sub: d.note?.trim() || null,
        amount: money(d.amount),
        amountTone: 'paid',
      };
    }
    case 'payment_product_sale':
      return {
        pillTone: 'payment',
        typeLabel: d.source === 'iban' ? 'Ödeme (IBAN)' : 'Ödeme (Nakit)',
        title: 'Ürün satışı için',
        sub: d.note?.trim() || null,
        amount: money(d.amount),
        amountTone: 'paid',
      };
    case 'payment_package':
      return {
        pillTone: 'payment',
        typeLabel: d.source === 'iban' ? 'Paket ödemesi (IBAN)' : 'Paket ödemesi (Nakit)',
        title: 'Paket alımı için',
        sub: d.note?.trim() || null,
        amount: money(d.amount),
        amountTone: 'paid',
      };
    case 'lesson_discount_updated': {
      // Karar 9: olay metni mutlak değer kullanır (delta değil).
      const oldDisc = money(d.old_discount);
      const newDisc = money(d.new_discount);
      const lessonMode = d.mode ? (MOVEMENT_LESSON_MODE_TR[d.mode] || d.mode) : '';
      const lessonLabel = `${lessonMode ? lessonMode + ' · ' : ''}${fmtDateTime(d.starts_at)}`;
      let typeLabel;
      if (oldDisc < 0.01 && newDisc > 0.01)       typeLabel = 'İndirim uygulandı';
      else if (newDisc < 0.01 && oldDisc > 0.01)  typeLabel = 'İndirim kaldırıldı';
      else                                         typeLabel = 'İndirim güncellendi';
      const amountLabel =
        newDisc < 0.01 && oldDisc > 0.01 ? oldDisc : newDisc;
      return {
        pillTone: 'discount',
        typeLabel,
        title: `${lessonLabel} için`,
        sub: oldDisc > 0.01 && newDisc > 0.01 && Math.abs(newDisc - oldDisc) > 0.001
          ? `${fmtTL(oldDisc)} → ${fmtTL(newDisc)}${d.note?.trim() ? ' · ' + d.note.trim() : ''}`
          : (d.note?.trim() || null),
        amount: amountLabel,
        amountTone: newDisc < 0.01 && oldDisc > 0.01 ? 'mute' : 'discount',
      };
    }
    default:
      return {
        pillTone: 'other',
        typeLabel: m.kind,
        title: '',
        sub: null,
        amount: null,
        amountTone: 'mute',
      };
  }
}

const MOVEMENT_CATEGORY = {
  lesson_scheduled:        'lessons',
  lesson_completed:        'lessons',
  lesson_cancelled:        'lessons',
  lesson_no_show:          'lessons',
  package_purchased:       'packages',
  product_sale:            'products',
  payment_lesson:          'payments',
  payment_product_sale:    'payments',
  payment_package:         'payments',
  lesson_discount_updated: 'discount',
};

const MOVEMENT_FILTERS = [
  { id: 'all',      label: 'Tümü',     match: () => true },
  { id: 'lessons',  label: 'Dersler',  match: m => MOVEMENT_CATEGORY[m.kind] === 'lessons' },
  { id: 'payments', label: 'Ödemeler', match: m => MOVEMENT_CATEGORY[m.kind] === 'payments' },
  { id: 'products', label: 'Ürünler',  match: m => MOVEMENT_CATEGORY[m.kind] === 'products' },
  { id: 'discount', label: 'İndirim',  match: m => MOVEMENT_CATEGORY[m.kind] === 'discount' },
];

const MV_PILL_ICON = {
  lesson:      Icon.Calendar,
  'lesson-done':Icon.Check,
  'lesson-off':Icon.ChevronL,
  package:     Icon.Layers,
  sale:        Icon.Tag,
  payment:     Icon.Wallet,
  discount:    Icon.Tag,
  other:       Icon.Calendar,
};

function MovementsView({ items }) {
  const [filterId, setFilterId] = React.useState('all');
  const [search,   setSearch]   = React.useState('');
  const [order,    setOrder]    = React.useState('desc');
  const [pageSize, setPageSize] = React.useState(PAGE_SIZE);

  React.useEffect(() => { setPageSize(PAGE_SIZE); }, [filterId, search, order]);

  if (!items || items.length === 0) {
    return <EmptyBlock title="Hareket yok" sub="Bu öğrenci için henüz kayıtlı bir işlem bulunmuyor." />;
  }

  const enriched = items.map(m => {
    const desc = describeMovement(m);
    const searchText = [
      desc.typeLabel, desc.title, desc.sub,
      m.details?.note, m.details?.source,
    ].filter(Boolean).join(' ').toLowerCase();
    return { m, desc, searchText, occurred_at: m.occurred_at };
  });

  const activeFilter = MOVEMENT_FILTERS.find(x => x.id === filterId) ?? MOVEMENT_FILTERS[0];
  let visible = enriched.filter(e => activeFilter.match(e.m));

  const q = search.trim().toLowerCase();
  if (q) visible = visible.filter(e => e.searchText.includes(q));

  visible = [...visible].sort((a, b) => {
    const t = new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
    return order === 'asc' ? t : -t;
  });

  const total = visible.length;
  const sliced = visible.slice(0, pageSize);
  const groups = bucketByDate(sliced, { dateKey: 'occurred_at' });

  return (
    <div className="sp-activity sp-activity-mv">
      <div className="sp-toolbar">
        <div className="sp-filter">
          {MOVEMENT_FILTERS.map(f => {
            const count = f.id === 'all' ? enriched.length : enriched.filter(e => f.match(e.m)).length;
            return (
              <button
                key={f.id}
                type="button"
                className={'sp-chip' + (filterId === f.id ? ' is-active' : '')}
                onClick={() => setFilterId(f.id)}
              >
                {f.label}
                <span className="sp-chip-n">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="sp-toolbar-search">
          <Icon.Search width="13" height="13" />
          <input
            type="text"
            placeholder="Ara..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="sp-toolbar-search-clear"
              onClick={() => setSearch('')}
              aria-label="Aramayı temizle"
            >×</button>
          )}
        </div>
      </div>

      {total === 0 ? (
        <div className="sp-state-msg sp-state-msg-inline">
          {q ? `"${search.trim()}" için hareket yok.` : 'Bu filtrede hareket yok.'}
        </div>
      ) : (
        <>
          <div className="sp-table-head sp-table-head-mv">
            <span className="sp-th sp-th-icon" />
            <button
              type="button"
              className="sp-th sp-th-date sp-th-sortable"
              onClick={() => setOrder(o => (o === 'asc' ? 'desc' : 'asc'))}
            >
              Zaman <span className="sp-th-arrow">{order === 'desc' ? '↓' : '↑'}</span>
            </button>
            <span className="sp-th sp-th-title">Olay</span>
            <span className="sp-th sp-th-money">Tutar</span>
          </div>

          <ul className="sp-rows sp-mv-rows">
            {groups.map(g => (
              <React.Fragment key={g.key}>
                <li className="sp-bucket-head">{g.label}</li>
                {g.items.map((e, idx) => (
                  <MovementRow key={`${e.m.kind}-${idx}-${e.occurred_at}`} entry={e} />
                ))}
              </React.Fragment>
            ))}
          </ul>

          {sliced.length < total && (
            <div className="sp-more-row">
              <button
                type="button"
                className="sp-load-more"
                onClick={() => setPageSize(s => s + PAGE_SIZE)}
              >
                Daha fazla göster
                <span className="sp-load-more-n">+{Math.min(PAGE_SIZE, total - sliced.length)}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MovementRow({ entry }) {
  const { m, desc } = entry;
  const Icn = MV_PILL_ICON[desc.pillTone] || Icon.Calendar;

  return (
    <li className={'sp-row sp-row-mv sp-row-mv-' + desc.pillTone}>
      <span className={'sp-row-icon sp-row-icon-mv sp-row-icon-mv-' + desc.pillTone} aria-hidden="true">
        <Icn width="13" height="13" />
      </span>

      <div className="sp-row-date sp-row-date-mv">{fmtFullDateTime(m.occurred_at)}</div>

      <div className="sp-row-title">
        <div className="sp-row-title-main sp-row-title-main-mv">
          {desc.typeLabel}
          {desc.title && <span className="sp-row-title-mv-sep"> · </span>}
          {desc.title && <span className="sp-row-title-mv-ctx">{desc.title}</span>}
        </div>
        {desc.sub && <div className="sp-row-title-sub">{desc.sub}</div>}
      </div>

      <div className="sp-row-money">
        {desc.amount == null || desc.amountTone === 'mute' ? (
          <span className="sp-muted">—</span>
        ) : desc.amountTone === 'paid' ? (
          <span className="sp-money-main sp-money-credit">+{fmtTL(Math.abs(desc.amount))}</span>
        ) : desc.amountTone === 'discount' ? (
          <span className="sp-money-main sp-money-warn">−{fmtTL(Math.abs(desc.amount))}</span>
        ) : (
          <span className="sp-money-quiet">{fmtTL(desc.amount)}</span>
        )}
      </div>
    </li>
  );
}

// ─── Empty block ──────────────────────────────────────────────────────────────

function EmptyBlock({ title, sub }) {
  return (
    <div className="sp-empty">
      <div className="sp-empty-title">{title}</div>
      <div className="sp-empty-sub">{sub}</div>
    </div>
  );
}

// NOT: Ders-bazı manuel indirim kontrolü (DiscountInline) v1.6'da kaldırıldı.
// İndirim artık öğrenci × ders türü bazında özel fiyatla (Ders Türleri ekranı)
// yönetiliyor. Manuel indirim sonradan geri eklenebilir.


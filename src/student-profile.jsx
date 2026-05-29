// Student profile page — dedicated detail/CRM screen.
// Data fetched client-side; financial summary derived from the same arrays
// (no separate /students/:id/summary endpoint yet — see follow-up notes).

import React from 'react';
import { fmtTL } from './data';
import { Icon, Avatar } from './layout';
import {
  getStudentById,
  getStudentLessons,
  getStudentPackages,
  getStudentProductSales,
  getStudentMovements,
  setLessonDiscount,
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

const ModeIcon = {
  Onsite: (p) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" {...p}>
      <path d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z"/>
    </svg>
  ),
  Online: (p) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" {...p}>
      <rect x="1.5" y="3" width="13" height="8.5" rx="1.5"/>
      <path d="M5.5 14h5M8 11.5V14" strokeLinecap="round"/>
    </svg>
  ),
};

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
  const [tab, setTab] = React.useState('all');
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
  const activePackages = packages.filter(p => Number(p.remaining_credits || 0) > 0);
  const counts = {
    all:       activity.length,
    lessons:   activity.filter(i => i.kind === 'lesson').length,
    products:  activity.filter(i => i.kind === 'sale').length,
    packages:  activity.filter(i => i.kind === 'package').length,
    movements: movements.length,
  };

  return (
    <div className="page page-sp">
      <ProfileBackLink onBack={onBack} />

      <ProfileHeader
        student={student}
        onPayment={() => setPaymentOpen(true)}
        onOpenSale={onOpenSale ? () => onOpenSale(student) : undefined}
        onSetActive={handleSetActive}
        onDelete={() => setDeleteOpen(true)}
      />

      <FinanceStrip fin={fin} />

      <div className="sp-body">
        <div className="sp-main">
          <Tabs tab={tab} setTab={setTab} counts={counts} />

          <div className="card sp-tab-card">
            {tab === 'movements'
              ? <MovementsView items={movements} />
              : <ActivityView items={activity} tab={tab} />}
          </div>
        </div>

        <aside className="sp-aside">
          {activePackages.length > 0 && <ActivePackageCard packages={activePackages} />}
          <ContactCard student={student} />
          <NoteCard note={student.note} />
          <SummaryCard student={student} lessons={lessons} />
        </aside>
      </div>

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

// ─── Identity header ──────────────────────────────────────────────────────────

function ProfileHeader({ student, onPayment, onOpenSale, onSetActive, onDelete }) {
  const modeMeta = student.preferred_mode === 'onsite'
    ? { icon: ModeIcon.Onsite, text: 'Yüzyüze tercih' }
    : student.preferred_mode === 'online'
      ? { icon: ModeIcon.Online, text: 'Online tercih' }
      : null;

  const meta = [
    student.phone ? { icon: Icon.Phone, text: student.phone } : null,
    student.email ? { icon: Icon.Mail,  text: student.email } : null,
    student.joined_at
      ? { icon: Icon.Calendar, text: `Üye: ${fmtDate(student.joined_at)}` }
      : null,
    student.birthday
      ? { icon: Icon.Cake, text: fmtDate(student.birthday, { year: false }) }
      : null,
    modeMeta,
  ].filter(Boolean);

  return (
    <header className="sp-header">
      <div className="sp-id">
        <Avatar name={student.full_name} size="xl" soft />
        <div className="sp-id-text">
          <div className="sp-id-row">
            <h1 className="sp-name">{student.full_name}</h1>
            {student.nickname && (
              <span className="sp-nick" title="Lakap">“{student.nickname}”</span>
            )}
            <span className={'sp-status ' + (student.is_active ? 'sp-status-on' : 'sp-status-off')}>
              <span className="sp-status-dot" />
              {student.is_active ? 'Aktif' : 'Pasif'}
            </span>
          </div>
          {meta.length > 0 && (
            <div className="sp-meta">
              {meta.map((m, i) => {
                const I = m.icon;
                return (
                  <span key={i} className="sp-meta-item">
                    <I width="13" height="13" />
                    <span>{m.text}</span>
                  </span>
                );
              })}

            </div>
          )}
        </div>
      </div>

      <div className="sp-actions">
        <button className="btn btn-ghost" type="button" title="Bu turda eklenmedi">
          <Icon.Plus width="14" height="14" /> Ders ekle
        </button>
        <button className="btn btn-accent" type="button" onClick={onPayment}>
          Ödeme al
        </button>
        <div className="sp-more">
          <button className="iconbtn sp-more-btn" aria-label="Diğer işlemler">
            <Icon.ChevronDown width="14" height="14" />
          </button>
          <div className="sp-more-menu">
            <button
              type="button"
              className="sp-more-item"
              onClick={onOpenSale}
              disabled={!onOpenSale}
            >
              Ürün satışı ekle
            </button>
            <button type="button" className="sp-more-item">Paket oluştur</button>
            <button type="button" className="sp-more-item">Düzenle</button>
            <button
              type="button"
              className="sp-more-item"
              onClick={() => onSetActive(!student.is_active)}
            >
              {student.is_active ? 'Pasife al' : 'Tekrar aktif et'}
            </button>
            {!student.is_active && (
              <button
                type="button"
                className="sp-more-item sp-more-item-warn"
                onClick={onDelete}
              >
                Tamamen sil
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ─── Finance strip ────────────────────────────────────────────────────────────
// Headline is *always* a single number (net debt) — no co-equal "overpayment"
// to confuse. The breakdown line below shows how the net was computed so the
// operator can still see the parts. Active package is the only right-side
// extra, since it's a separate concept (credits, not cash).

function FinanceStrip({ fin }) {
  const breakdown = [];
  if (fin.lessonDebt > 0.01)  breakdown.push(`${fmtTL(fin.lessonDebt)} ders`);
  if (fin.productDebt > 0.01) breakdown.push(`${fmtTL(fin.productDebt)} ürün`);
  if (breakdown.length === 0) breakdown.push('Borç / alacak yok');

  return (
    <section className={'sp-fin sp-fin-' + fin.state}>
      <div className="sp-fin-lead">
        <div className="eyebrow">Finansal Durum</div>
        <div className="sp-fin-headline">{fin.headline}</div>
        <div className="sp-fin-breakdown">{breakdown.join(' · ')}</div>
      </div>

      {fin.activeCredits > 0 && (
        <div className="sp-fin-extras">
          <div className="sp-fin-ex sp-fin-ex-neutral">
            <div className="sp-fin-ex-k">Aktif paket</div>
            <div className="sp-fin-ex-v">
              {fin.activeCredits} ders · {fmtTL(fin.activeCreditValue)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function Tabs({ tab, setTab, counts }) {
  const items = [
    { id: 'all',       label: 'Kayıtlar',    n: counts.all },
    { id: 'lessons',   label: 'Dersler',     n: counts.lessons },
    { id: 'products',  label: 'Ürün Satışı', n: counts.products },
    { id: 'packages',  label: 'Paket',       n: counts.packages },
    { id: 'movements', label: 'Hareketler',  n: counts.movements },
  ];
  return (
    <div className="sp-tabs">
      {items.map(it => (
        <button
          key={it.id}
          type="button"
          className={'sp-tab' + (tab === it.id ? ' is-active' : '')}
          onClick={() => setTab(it.id)}
        >
          <span>{it.label}</span>
          <span className="sp-tab-n">{it.n}</span>
        </button>
      ))}
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

// ─── Sidebar cards ────────────────────────────────────────────────────────────

function ActivePackageCard({ packages }) {
  return (
    <div className="card sp-side-card sp-active-pkg-card">
      <div className="sp-side-title">Aktif Paket{packages.length > 1 ? 'ler' : ''}</div>
      <div className="sp-active-pkg-list">
        {packages.map(p => {
          const used = Number(p.used_credits || 0);
          const total = Number(p.credit_count || 0);
          const remaining = Number(p.remaining_credits || 0);
          const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
          return (
            <div key={p.package_id} className="sp-active-pkg">
              <div className="sp-active-pkg-head">
                <div className="sp-active-pkg-rem">{remaining} kredi kaldı</div>
                <div className="sp-active-pkg-val">{fmtTL(money(p.remaining_value))}</div>
              </div>
              <div className="sp-pkg-bar">
                <div className="sp-pkg-bar-fill" style={{ width: pct + '%' }} />
              </div>
              <div className="sp-active-pkg-foot">
                <span>{used} / {total} kullanıldı</span>
                <span>{fmtDate(p.purchased_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContactCard({ student }) {
  const rows = [
    { k: 'Telefon',     v: student.phone,    mono: true },
    { k: 'E-posta',     v: student.email },
    { k: 'Doğum günü',  v: student.birthday ? fmtDate(student.birthday) : null },
    { k: 'Üyelik',      v: student.joined_at ? fmtDate(student.joined_at) : null },
  ];
  return (
    <div className="card sp-side-card">
      <div className="sp-side-title">İletişim</div>
      <dl className="sp-kv">
        {rows.map(r => (
          <div key={r.k} className="sp-kv-row">
            <dt>{r.k}</dt>
            <dd className={r.mono ? 'sp-kv-mono' : ''}>
              {r.v || <span className="sp-muted">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function NoteCard({ note }) {
  return (
    <div className="card sp-side-card">
      <div className="sp-side-title">Not</div>
      {note?.trim() ? (
        <p className="sp-note">{note}</p>
      ) : (
        <p className="sp-note sp-muted">Bu öğrenci için not eklenmedi.</p>
      )}
    </div>
  );
}

function SummaryCard({ student, lessons }) {
  const completed = lessons.filter(l => l.status === 'completed').length;
  const scheduled = lessons.filter(l => l.status === 'scheduled').length;
  const lastCompleted = lessons
    .filter(l => l.status === 'completed')
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))[0];

  return (
    <div className="card sp-side-card">
      <div className="sp-side-title">Özet</div>
      <div className="sp-stats">
        <div className="sp-stat">
          <div className="sp-stat-k">Tamamlanan ders</div>
          <div className="sp-stat-v">{completed}</div>
        </div>
        <div className="sp-stat">
          <div className="sp-stat-k">Planlı ders</div>
          <div className="sp-stat-v">{scheduled}</div>
        </div>
        <div className="sp-stat">
          <div className="sp-stat-k">Son ders</div>
          <div className="sp-stat-v sp-stat-v-sm">
            {lastCompleted ? fmtDate(lastCompleted.starts_at) : '—'}
          </div>
        </div>
      </div>
    </div>
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

// ─── Discount inline control (karar 4–6) ─────────────────────────────────────
// Ödeme modalı içinde sadece completed & non-prepaid derslerde görünür.
// PATCH /lessons/:id/discount çağırır; 0 indirimi kaldırır.
// Backend validation: 0 <= discount <= price_snapshot ve paid <= price - discount.

export function DiscountInline({ item, onApplied }) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(() => item.discountAmount.toFixed(2));
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    setValue(item.discountAmount.toFixed(2));
    setError(null);
  }, [item.targetId, item.discountAmount]);

  const parsed = parseFloat(value);
  const hasDiscount = item.discountAmount > 0.01;
  const parsedValid = Number.isFinite(parsed) && parsed >= 0 && parsed <= item.grossAmount + 0.001;
  const wouldExceedNet = Number.isFinite(parsed) && item.paidAmount > item.grossAmount - parsed + 0.001;

  async function apply(newAmount) {
    setSubmitting(true); setError(null);
    try {
      await setLessonDiscount(item.targetId, {
        discountAmount: newAmount.toFixed(2),
        note: note.trim() || null,
      });
      setOpen(false);
      setNote('');
      await onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İndirim uygulanamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="rpm-section rpm-discount-row">
        {hasDiscount ? (
          <div className="rpm-discount-summary">
            <span className="eyebrow">İndirim</span>
            <span className="rpm-discount-value">-{fmtTL(item.discountAmount)}</span>
            <span className="rpm-discount-meta">
              Brüt {fmtTL(item.grossAmount)} · Net {fmtTL(item.totalAmount)}
            </span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(true)}>
              Değiştir
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(true)}>
            İndirim uygula
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rpm-section rpm-discount-edit">
      <div className="rpm-section-head">
        <span className="eyebrow">İndirim uygula</span>
        <span className="rpm-discount-meta">
          Brüt {fmtTL(item.grossAmount)} · Ödenen {fmtTL(item.paidAmount)}
        </span>
      </div>
      <div className="form-row-2">
        <div className="form-row">
          <label>İndirim tutarı (TL)</label>
          <input
            type="number" min="0" step="0.01"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="0.00"
            disabled={submitting}
          />
        </div>
        <div className="form-row">
          <label>Not</label>
          <input
            type="text" value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="İsteğe bağlı"
            disabled={submitting}
          />
        </div>
      </div>
      {parsedValid && !wouldExceedNet && (
        <div className="rpm-summary rpm-summary-compact">
          <div className="rpm-summary-row">
            <span>İndirim sonrası net</span>
            <strong>{fmtTL(Math.max(0, item.grossAmount - parsed))}</strong>
          </div>
        </div>
      )}
      {!parsedValid && <div className="rpm-error">İndirim 0 ile brüt tutar arasında olmalı.</div>}
      {parsedValid && wouldExceedNet && (
        <div className="rpm-error">
          Ödenen tutar ({fmtTL(item.paidAmount)}) bu indirim sonrası net tutarı aşar; önce ödemeyi azaltın.
        </div>
      )}
      {error && <div className="rpm-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={submitting}>
          Vazgeç
        </button>
        {hasDiscount && (
          <button
            type="button" className="btn btn-ghost"
            onClick={() => apply(0)}
            disabled={submitting || item.paidAmount > item.grossAmount + 0.001}
          >
            İndirimi kaldır
          </button>
        )}
        <button
          type="button" className="btn btn-accent"
          onClick={() => apply(parsed)}
          disabled={submitting || !parsedValid || wouldExceedNet}
        >
          {submitting ? 'Uygulanıyor...' : 'İndirimi uygula'}
        </button>
      </div>
    </div>
  );
}


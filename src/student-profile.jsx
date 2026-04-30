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
  createCashPayment,
  setLessonDiscount,
} from './api';

const LESSON_STATUS_TR = {
  scheduled: 'Planlı',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
  no_show:   'Gelmedi',
};

const LESSON_MODE_TR = { online: 'Online', onsite: 'Stüdyo' };

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
    const pay = lessonPaymentState(l);
    const remaining = money(l.remaining_receivable);
    const paid = money(l.paid_amount);
    const gross = money(l.price_snapshot);
    const discount = money(l.discount_amount);
    // Karar 7: etkin ders tutarı = price_snapshot - discount_amount.
    const net = money(l.net_amount ?? (gross - discount));
    items.push({
      key:          `lesson-${l.id}`,
      date:         l.starts_at,
      dateFmt:      'datetime',
      kind:         'lesson',
      lessonStatus: l.status,
      typeLabel:    'Ders',
      title:        LESSON_MODE_TR[l.mode] || l.mode,
      sub:          l.note?.trim() || null,
      badges: [
        { cls: 'sp-badge-' + l.status,            label: LESSON_STATUS_TR[l.status] || l.status },
        ...(pay ? [{ cls: 'sp-badge-pay-' + pay.tone, label: pay.label }] : []),
        ...(discount > 0.01 ? [{ cls: 'sp-badge-discount', label: `İndirim -${fmtTL(discount)}` }] : []),
      ],
      amount:     l.prepaid_package_id ? null
                : l.status !== 'completed' ? net
                : remaining > 0.01 ? remaining
                : (paid || net),
      amountSub:  l.prepaid_package_id ? null
                : (l.status === 'completed' && remaining > 0.01) ? `/ ${fmtTL(net)}`
                : null,
      amountTone: l.prepaid_package_id ? 'mute'
                : l.status !== 'completed' ? 'quiet'
                : remaining > 0.01 ? 'warn'
                : 'quiet',
    });
  }

  for (const p of packages ?? []) {
    const total = Number(p.credit_count || 0);
    const remaining = Number(p.remaining_credits || 0);
    const used = Number(p.used_credits || 0);
    items.push({
      key:        `pkg-${p.package_id}`,
      date:       p.purchased_at,
      dateFmt:    'date',
      kind:       'package',
      typeLabel:  'Paket',
      title:      `${total} kredi · ${fmtTL(money(p.unit_price))}/ders`,
      sub:        remaining > 0 ? `${used}/${total} kullanıldı` : 'Tükendi',
      badges:     [],
      amount:     money(p.total_amount),
      amountTone: 'quiet',
    });
  }

  for (const s of productSales ?? []) {
    const paid = money(s.paid_amount);
    const remaining = money(s.remaining_receivable);
    const total = money(s.total_amount);
    const payState =
      remaining < 0.01 ? { tone: 'paid',    label: 'Ödendi' } :
      paid > 0.01      ? { tone: 'partial', label: 'Kısmi'  } :
                         { tone: 'open',    label: 'Açık'   };
    items.push({
      key:        `sale-${s.product_sale_id}`,
      date:       s.sold_at,
      dateFmt:    'date',
      kind:       'sale',
      typeLabel:  'Ürün',
      title:      'Ürün satışı',
      sub:        remaining > 0.01 ? `${fmtTL(remaining)} kalan` : null,
      badges:     [{ cls: 'sp-badge-pay-' + payState.tone, label: payState.label }],
      amount:     total,
      amountSub:  remaining > 0.01 ? `/ ${fmtTL(total)}` : null,
      amountTone: remaining > 0.01 ? 'warn' : 'quiet',
    });
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function StudentProfilePage({ studentId, onBack }) {
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [student, setStudent] = React.useState(null);
  const [lessons, setLessons] = React.useState([]);
  const [productSales, setProductSales] = React.useState([]);
  const [packages, setPackages] = React.useState([]);
  const [movements, setMovements] = React.useState([]);
  const [tab, setTab] = React.useState('all');
  const [paymentOpen, setPaymentOpen] = React.useState(false);

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
    movements: movements.length,
  };

  return (
    <div className="page page-sp">
      <ProfileBackLink onBack={onBack} />

      <ProfileHeader
        student={student}
        onPayment={() => setPaymentOpen(true)}
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
        <ProfilePaymentModal
          student={student}
          detail={{ lessons, productSales }}
          onClose={() => setPaymentOpen(false)}
          onSuccess={async () => { setPaymentOpen(false); await loadAll(); }}
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

function ProfileHeader({ student, onPayment }) {
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
            <button type="button" className="sp-more-item">Ürün satışı ekle</button>
            <button type="button" className="sp-more-item">Paket oluştur</button>
            <button type="button" className="sp-more-item">Düzenle</button>
            <button type="button" className="sp-more-item sp-more-item-warn">
              {student.is_active ? 'Pasife al' : 'Tekrar aktif et'}
            </button>
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

// ─── Activity view (shared across all three tabs) ─────────────────────────────
// Each tab is a filter over the same merged timeline. The lessons tab gets an
// extra sub-filter row (upcoming / completed / cancelled) since that's the
// operationally useful split — other tabs don't need one.

const LESSON_SUBFILTERS = [
  { id: 'all',       label: 'Tümü',           match: () => true },
  { id: 'upcoming',  label: 'Yaklaşan',       match: l => l.status === 'scheduled' },
  { id: 'completed', label: 'Tamamlanan',     match: l => l.status === 'completed' },
  { id: 'cancelled', label: 'İptal / Gelmedi', match: l => l.status === 'cancelled' || l.status === 'no_show' },
];

function ActivityView({ items, tab }) {
  const [lessonSub, setLessonSub] = React.useState('all');

  let scoped = items;
  if (tab === 'lessons')  scoped = items.filter(i => i.kind === 'lesson');
  if (tab === 'products') scoped = items.filter(i => i.kind === 'sale');

  if (scoped.length === 0) {
    const empty = emptyCopy(tab);
    return <EmptyBlock title={empty.title} sub={empty.sub} />;
  }

  let visible = scoped;
  let subFilter = null;
  if (tab === 'lessons') {
    const f = LESSON_SUBFILTERS.find(x => x.id === lessonSub) ?? LESSON_SUBFILTERS[0];
    visible = scoped.filter(i => f.match({ status: i.lessonStatus }));
    subFilter = (
      <div className="sp-filter">
        {LESSON_SUBFILTERS.map(sf => (
          <button
            key={sf.id}
            type="button"
            className={'sp-chip' + (lessonSub === sf.id ? ' is-active' : '')}
            onClick={() => setLessonSub(sf.id)}
          >
            {sf.id === 'all' ? `${sf.label} (${scoped.length})` : sf.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="sp-activity">
      {subFilter}
      {visible.length === 0 ? (
        <div className="sp-state-msg sp-state-msg-inline">Bu filtrede kayıt yok.</div>
      ) : (
        <ul className="sp-rows">
          {visible.map(i => <ActivityRow key={i.key} item={i} />)}
        </ul>
      )}
    </div>
  );
}

function emptyCopy(tab) {
  if (tab === 'lessons')  return { title: 'Henüz ders yok',        sub: 'Bu öğrenciye yeni bir ders planlayın.' };
  if (tab === 'products') return { title: 'Ürün satışı yok',        sub: 'Bu öğrenciye henüz ürün satışı kaydı girilmedi.' };
  return                       { title: 'Hareket yok',              sub: 'Bu öğrenci için kayıtlı bir hareket bulunmuyor.' };
}

function ActivityRow({ item }) {
  const sign = item.signed && item.amount > 0 ? '+' : '';
  const amountClass =
    'sp-money-main' +
    (item.amountTone === 'credit' ? ' sp-money-credit' :
     item.amountTone === 'warn'   ? ' sp-money-warn'   : '');

  const pillCls =
    item.kind === 'balance'
      ? `sp-type-pill sp-type-pill-balance sp-type-pill-balance-${item.balanceDir}`
      : `sp-type-pill sp-type-pill-${item.kind}`;

  const dateText = item.dateFmt === 'datetime' ? fmtDateTime(item.date) : fmtDate(item.date);

  return (
    <li className={'sp-row sp-row-activity sp-row-activity-' + item.kind}>
      <span className={pillCls}>{item.typeLabel}</span>

      <div className="sp-row-when">
        <div className="sp-row-date">{dateText}</div>
        <div className="sp-row-sub">{item.title}</div>
      </div>

      <div className="sp-row-desc">
        {item.sub ? <span>{item.sub}</span> : <span className="sp-muted">—</span>}
      </div>

      <div className="sp-row-badges">
        {(item.badges ?? []).map((b, i) => (
          <span key={i} className={'sp-badge ' + b.cls}>{b.label}</span>
        ))}
      </div>

      <div className="sp-row-money">
        {item.amount == null ? (
          <span className="sp-muted">—</span>
        ) : item.amountTone === 'quiet' ? (
          <span className="sp-money-quiet">{fmtTL(item.amount)}</span>
        ) : item.amountTone === 'mute' ? (
          <span className="sp-muted">—</span>
        ) : (
          <>
            <span className={amountClass}>
              {sign}{fmtTL(Math.abs(item.amount))}
            </span>
            {item.amountSub && <span className="sp-money-hint">{item.amountSub}</span>}
          </>
        )}
      </div>
    </li>
  );
}

// ─── Movements view (granular, minute-precision event log) ───────────────────
// One row per discrete event the backend emitted. Unlike the Kayıtlar stream
// (which folds multiple events into the "current state" of a lesson/sale),
// this splits every state change into its own entry with the exact timestamp.

const MOVEMENT_LESSON_MODE_TR = { online: 'Online', onsite: 'Stüdyo' };

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

function MovementsView({ items }) {
  if (!items || items.length === 0) {
    return <EmptyBlock title="Hareket yok" sub="Bu öğrenci için henüz kayıtlı bir işlem bulunmuyor." />;
  }

  return (
    <ul className="sp-rows sp-mv-rows">
      {items.map((m, idx) => {
        const desc = describeMovement(m);
        return (
          <li
            key={`${m.kind}-${idx}-${m.occurred_at}`}
            className={'sp-row sp-row-mv sp-row-mv-' + desc.pillTone}
          >
            <span className={'sp-type-pill sp-type-pill-mv sp-type-pill-mv-' + desc.pillTone}>
              {desc.typeLabel}
            </span>

            <div className="sp-row-when">
              <div className="sp-row-date">{fmtFullDateTime(m.occurred_at)}</div>
              {desc.title && <div className="sp-row-sub">{desc.title}</div>}
            </div>

            <div className="sp-row-desc">
              {desc.sub ? <span>{desc.sub}</span> : <span className="sp-muted">—</span>}
            </div>

            <div className="sp-row-money">
              {desc.amount == null ? (
                <span className="sp-muted">—</span>
              ) : desc.amountTone === 'paid' ? (
                <span className="sp-money-main sp-money-credit">+{fmtTL(Math.abs(desc.amount))}</span>
              ) : desc.amountTone === 'discount' ? (
                <span className="sp-money-main sp-money-warn">-{fmtTL(Math.abs(desc.amount))}</span>
              ) : desc.amountTone === 'mute' ? (
                <span className="sp-muted">—</span>
              ) : (
                <span className="sp-money-quiet">{fmtTL(desc.amount)}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
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

// ─── Payment modal (profile-scoped, same payload as list version) ─────────────

function ProfilePaymentModal({ student, detail, onClose, onSuccess }) {
  // Detay lokal state'te tutulur ki, indirim uygulandıktan sonra modalı
  // kapatmadan borç kalemleri yeniden hesaplansın.
  const [localDetail, setLocalDetail] = React.useState(detail);
  React.useEffect(() => { setLocalDetail(detail); }, [detail]);

  async function refreshDetail() {
    const [lessons, productSales] = await Promise.all([
      getStudentLessons(student.id),
      getStudentProductSales(student.id),
    ]);
    setLocalDetail({ lessons, productSales });
  }

  const debtItems = React.useMemo(() => {
    const lessonItems = (localDetail.lessons ?? [])
      .filter(l =>
        l.status === 'completed' &&
        !l.prepaid_package_id &&
        money(l.remaining_receivable) > 0.01,
      )
      .map(l => {
        const gross = money(l.price_snapshot);
        const discount = money(l.discount_amount);
        const net = money(l.net_amount ?? (gross - discount));
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
          paidAmount: money(l.paid_amount),
          remainingAmount: money(l.remaining_receivable),
          canDiscount: true,
        };
      });

    const saleItems = (localDetail.productSales ?? [])
      .filter(s => money(s.remaining_receivable) > 0.01)
      .map(s => ({
        key: `product-sale-${s.product_sale_id}`,
        targetType: 'product_sale',
        targetId: s.product_sale_id,
        dateIso: s.sold_at,
        typeLabel: 'Ürün satışı',
        description: 'Ürün satışı',
        grossAmount: money(s.total_amount),
        discountAmount: 0,
        totalAmount: money(s.total_amount),
        paidAmount: money(s.paid_amount),
        remainingAmount: money(s.remaining_receivable),
        canDiscount: false,
      }));

    return [...lessonItems, ...saleItems].sort(
      (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime(),
    );
  }, [localDetail]);

  const [selectedKey, setSelectedKey] = React.useState(null);
  const [amount, setAmount] = React.useState('');
  const [source, setSource] = React.useState('cash');
  const [paidAt, setPaidAt] = React.useState(() => toDateTimeLocalValue(new Date()));
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  const selectedItem = debtItems.find(i => i.key === selectedKey) ?? null;
  const parsed = parseFloat(amount) || 0;
  const isOverDebt = selectedItem && parsed > selectedItem.remainingAmount + 0.001;
  const afterRemaining = selectedItem
    ? Math.max(selectedItem.remainingAmount - parsed, 0)
    : 0;
  const canSubmit = !!selectedItem && parsed > 0 && !!paidAt && !submitting && !isOverDebt;

  function selectItem(item) {
    setSelectedKey(item.key);
    setAmount(item.remainingAmount.toFixed(2));
    setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (!selectedItem) { setError('Önce bir borç kalemi seçin.'); return; }
    if (parsed <= 0) { setError('Ödeme tutarı sıfırdan büyük olmalı.'); return; }
    if (isOverDebt) {
      setError('Ödeme tutarı kalan borcu aşamaz.'); return;
    }
    const d = new Date(paidAt);
    if (Number.isNaN(d.getTime())) { setError('Geçerli bir ödeme tarihi girin.'); return; }

    setSubmitting(true); setError(null);
    try {
      await createCashPayment({
        targetType: selectedItem.targetType,
        targetId: selectedItem.targetId,
        amount: amount.trim(),
        source,
        paidAt: d.toISOString(),
        note: note.trim() || null,
      });
      await onSuccess();
    } catch (submitErr) {
      setError(submitErr instanceof Error ? submitErr.message : 'Ödeme alınamadı.');
    } finally { setSubmitting(false); }
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
          <div className="rpm-empty">Öğrencinin tahsil edilebilir açık borç kalemi bulunmuyor.</div>
        ) : (
          <>
            <div className="rpm-section">
              <div className="rpm-section-head">
                <span className="eyebrow">Açık borç kalemleri</span>
              </div>
              <div className="rpm-list" role="list">
                {debtItems.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    className={'rpm-item' + (selectedKey === item.key ? ' is-selected' : '')}
                    onClick={() => selectItem(item)}
                  >
                    <div className="rpm-item-main">
                      <div className="rpm-item-title">{fmtDate(item.dateIso)} · {item.typeLabel}</div>
                      <div className="rpm-item-desc">{item.description}</div>
                    </div>
                    <div className="rpm-item-meta">
                      <span>Toplam: {fmtTL(item.totalAmount)}</span>
                      <span>Ödenen: {fmtTL(item.paidAmount)}</span>
                      <span className="rpm-item-remaining">Kalan: {fmtTL(item.remainingAmount)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {selectedItem && selectedItem.canDiscount && (
              <DiscountInline
                item={selectedItem}
                onApplied={async () => { await refreshDetail(); }}
              />
            )}

            {selectedItem && (
              <form className="rpm-form" onSubmit={submit}>
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
                      <input type="number" min="0.01" step="0.01" value={amount}
                        onChange={e => setAmount(e.target.value)} placeholder="0.00" />
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
                    <input type="datetime-local" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
                  </div>

                  <div className="form-row">
                    <label>Not</label>
                    <textarea rows="3" value={note} onChange={e => setNote(e.target.value)} placeholder="İsteğe bağlı" />
                  </div>

                  {parsed > 0 && !isOverDebt && (
                    <div className="rpm-summary">
                      <div className="rpm-summary-row">
                        <span>Borca işlenecek</span>
                        <strong>{fmtTL(parsed)}</strong>
                      </div>
                      <div className="rpm-summary-row">
                        <span>İşlem sonrası kalan borç</span>
                        <strong>{fmtTL(afterRemaining)}</strong>
                      </div>
                    </div>
                  )}

                  {isOverDebt && (
                    <div className="rpm-error">Ödeme tutarı kalan borçtan ({fmtTL(selectedItem.remainingAmount)}) fazla olamaz.</div>
                  )}

                  {error && <div className="rpm-error">{error}</div>}

                  <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
                      Vazgeç
                    </button>
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

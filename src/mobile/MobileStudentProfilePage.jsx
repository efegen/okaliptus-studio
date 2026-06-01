import React from 'react';
import {
  useStudent,
  useStudentLessons,
  useStudentSales,
  useUpdateStudent,
  useDeleteStudent,
} from '../hooks/useStudent';
import {
  fmtTL,
  parseMoney,
  fmtShortDate,
  formatPhoneTr,
  previewInitials,
} from './shared/studentMeta';
import { MobileEditStudentPage } from './MobileEditStudentPage';

// Mobil öğrenci profili — "design_handoff_ogrenci_profili" v16 yeniden tasarımı.
// Tek-uzun-scroll ekran yerine: durum renkli sabit başlık + sayfa içi sekme barı
// (Özet · Dersler · Satışlar · Hareketler) + kayan sekme içeriği.
// Ödeme/satış mevcut akışlara (onOpenPayment/onOpenSale) bağlanır; paket
// (prepaid_package_id) ve adres dalları bu ekrana taşınmaz.

const MODE_LABEL = { online: 'Online', onsite: 'Yüzyüze' };
const TR_WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

const TABS = [
  { id: 'overview', label: 'Özet' },
  { id: 'lessons', label: 'Dersler' },
  { id: 'sales', label: 'Satışlar' },
  { id: 'movements', label: 'Hareketler' },
];

const pad2 = n => String(n).padStart(2, '0');

// ─── Icons (inline SVG) ───────────────────────────────────────────────────────

function ChevronLeftIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronRightIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MoreIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}
function CardIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.4" stroke="currentColor" strokeWidth="1.9" />
      <path d="M3 10.5h18" stroke="currentColor" strokeWidth="1.9" />
      <path d="M6.5 15h4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
function CartIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 4h2.2l2.3 11a2 2 0 002 1.6h7.6a2 2 0 002-1.5L21 8H6.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20" r="1.5" fill="currentColor" />
      <circle cx="17.5" cy="20" r="1.5" fill="currentColor" />
    </svg>
  );
}
function VideoIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="6" width="13" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15.5 10l5-2.5v9L15.5 14" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function HomeIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 11l8-6 8 6v8a1.5 1.5 0 01-1.5 1.5H5.5A1.5 1.5 0 014 19v-8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function TagIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4h7l9 9-7 7-9-9V4z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}
function CalendarIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function XIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function PhoneIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.5 3h3l1.5 4.5-2 1.3a12 12 0 005.2 5.2l1.3-2L20 13.5v3a2 2 0 01-2.2 2A16 16 0 014.5 5.2 2 2 0 016.5 3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function MailIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function CakeIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h16v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 8V5M8 9V6.5M16 9V6.5M4 16h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

const modeIcon = mode => (mode === 'online' ? VideoIcon : HomeIcon);

// ─── Status + formatting helpers ──────────────────────────────────────────────

function lessonStatus(l) {
  if (l.status === 'scheduled') return { label: 'Planlı', tone: 'scheduled' };
  if (l.status === 'cancelled') return { label: 'İptal', tone: 'muted' };
  if (l.status === 'no_show') return { label: 'Gelmedi', tone: 'muted' };
  // completed
  const remaining = parseMoney(l.remaining_receivable);
  const paid = parseMoney(l.paid_amount);
  if (remaining > 0.01 && paid > 0.01) return { label: 'Kısmi', tone: 'partial' };
  if (remaining > 0.01) return { label: 'Açık', tone: 'open' };
  return { label: 'Ödendi', tone: 'paid' };
}

function saleStatus(s) {
  const remaining = parseMoney(s.remaining_receivable);
  const paid = parseMoney(s.paid_amount);
  if (remaining > 0.01 && paid > 0.01) return { label: 'Kısmi', tone: 'partial' };
  if (remaining > 0.01) return { label: 'Açık', tone: 'open' };
  return { label: 'Ödendi', tone: 'paid' };
}

// Satış başlığı kalem snapshot'larından türetilir (tek doğruluk: name_snapshot).
function saleTitle(s) {
  const items = Array.isArray(s.items) ? s.items : [];
  if (items.length === 0) return 'Ürün satışı';
  const first = items[0]?.name_snapshot?.trim() || 'Ürün';
  if (items.length === 1) {
    const q = Number(items[0]?.quantity) || 1;
    return q > 1 ? `${first} ×${q}` : first;
  }
  return `${first} +${items.length - 1}`;
}

function fmtMeta(iso, { withTime } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = [TR_WEEKDAYS[d.getDay()], d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })];
  if (withTime) parts.push(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`);
  return parts.join(' · ');
}

function dayMon(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { d: '—', m: '' };
  return { d: d.getDate(), m: d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '') };
}

function shortDayMon(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '')}`;
}

function fmtJoinedDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Takvim günü farkına dayalı göreli zaman ("bugün/dün/N gün önce/…").
function relativeDay(iso) {
  const startOf = x => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOf(new Date()) - startOf(iso)) / 86_400_000);
  if (days <= 0) return 'bugün';
  if (days === 1) return 'dün';
  if (days < 7) return `${days} gün önce`;
  if (days < 14) return '1 hafta önce';
  if (days < 30) return `${Math.floor(days / 7)} hafta önce`;
  return `${Math.floor(days / 30)} ay önce`;
}

function startOfWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  // Monday-based (CLAUDE.md: Europe/Istanbul, hafta Pazartesi).
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function timeBucket(iso, now) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: 'older', label: 'Önceki' };
  const startNow = new Date(now); startNow.setHours(0, 0, 0, 0);
  const tomorrow = new Date(startNow); tomorrow.setDate(tomorrow.getDate() + 1);
  const thisWeek = startOfWeek(now);
  const lastWeek = new Date(thisWeek); lastWeek.setDate(lastWeek.getDate() - 7);
  if (d.getTime() >= tomorrow.getTime()) return { key: 'upcoming', label: 'Yaklaşan' };
  if (d.getTime() >= thisWeek.getTime()) return { key: 'this-week', label: 'Bu hafta' };
  if (d.getTime() >= lastWeek.getTime()) return { key: 'last-week', label: 'Geçen hafta' };
  const monthLabel = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  return { key: `m-${d.getFullYear()}-${d.getMonth()}`, label: monthLabel.charAt(0).toLocaleUpperCase('tr-TR') + monthLabel.slice(1) };
}

// Bitişik öğeleri zaman kovasına göre gruplar (öğeler zaten azalan sıralı).
function groupByBucket(items, getDate) {
  const now = new Date();
  const groups = [];
  let current = null;
  for (const it of items) {
    const b = timeBucket(getDate(it), now);
    if (!current || current.key !== b.key) {
      current = { key: b.key, label: b.label, items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }
  return groups;
}

// ─── Derived data ─────────────────────────────────────────────────────────────

function computeFinance(lessons, sales) {
  let lessonDebt = 0;
  let openLessonCount = 0;
  for (const l of lessons ?? []) {
    if (l.deleted_at) continue;
    if (l.status !== 'completed') continue;
    const r = parseMoney(l.remaining_receivable);
    if (r > 0.01) { lessonDebt += r; openLessonCount += 1; }
  }
  let productDebt = 0;
  let openSaleCount = 0;
  for (const s of sales ?? []) {
    const r = parseMoney(s.remaining_receivable);
    if (r > 0.01) { productDebt += r; openSaleCount += 1; }
  }
  return { lessonDebt, productDebt, totalDebt: lessonDebt + productDebt, openLessonCount, openSaleCount };
}

// Birleşik zaman akışı: ders + satış kayıtları (silinmişler hariç), tarihe göre azalan.
function buildTimeline(lessons, sales) {
  const items = [];
  for (const l of lessons ?? []) {
    if (l.deleted_at) continue;
    items.push({ key: 'l-' + l.id, type: 'lesson', date: l.starts_at, ref: l });
  }
  for (const s of sales ?? []) {
    items.push({ key: 's-' + s.product_sale_id, type: 'sale', date: s.sold_at, ref: s });
  }
  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// "Son katılım" = starts_at <= now olan derslerin en yenisi (planlı/gelecek hariç).
function lastAttendedLesson(lessons) {
  const now = Date.now();
  let best = null;
  let bestT = -Infinity;
  for (const l of lessons ?? []) {
    if (l.deleted_at) continue;
    if (l.status === 'scheduled') continue;
    const t = new Date(l.starts_at).getTime();
    if (Number.isNaN(t) || t > now) continue;
    if (t > bestT) { best = l; bestT = t; }
  }
  return best;
}

// Aylık katılım hedefi: haftada 1 ders → ayda 4 ders = %100. Son 6 ay.
function computeMonthlyGoal(lessons) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    let n = 0;
    for (const l of lessons ?? []) {
      if (l.deleted_at || l.status !== 'completed') continue;
      const d = new Date(l.starts_at);
      if (d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear()) n += 1;
    }
    months.push({
      m: ref.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', ''),
      n,
      pct: Math.min(n / 4, 1) * 100,
      isNow: i === 0,
    });
  }
  return months;
}

// ─── Small presentational pieces ──────────────────────────────────────────────

function Pill({ tone, children }) {
  return <span className={'mobile-msp-pill t-' + tone}>{children}</span>;
}

function MiniRing({ n, pct, label, now }) {
  const size = 46;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  const full = pct >= 100;
  return (
    <div className={'mobile-msp-mring' + (now ? ' is-now' : '')}>
      <div className="mobile-msp-mring-svg" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={full ? 'var(--paid)' : 'var(--accent)'} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className="mobile-msp-mring-n">{n}</span>
      </div>
      <span className="mobile-msp-mring-l">{label}</span>
    </div>
  );
}

function LastLessonCard({ lesson, onOpen }) {
  const st = lessonStatus(lesson);
  const dm = dayMon(lesson.starts_at);
  const d = new Date(lesson.starts_at);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const metaParts = [TR_WEEKDAYS[d.getDay()], time, relativeDay(lesson.starts_at)].filter(Boolean);
  const open = st.tone === 'open' || st.tone === 'partial';
  let right = null;
  if (open) right = <span className="mobile-msp-last-amt open">{fmtTL(parseMoney(lesson.remaining_receivable))}</span>;
  else if (st.tone === 'paid') right = <span className="mobile-msp-last-amt">Ödendi</span>;
  return (
    <button type="button" className={'mobile-msp-last is-link t-' + st.tone} onClick={onOpen}>
      <div className="mobile-msp-last-cal"><b>{dm.d}</b><span>{dm.m}</span></div>
      <div className="mobile-msp-last-body">
        <div className="mobile-msp-last-top">
          <span className="mobile-msp-last-title">{(MODE_LABEL[lesson.mode] || 'Ders')} ders</span>
          <Pill tone={st.tone}>{st.label}</Pill>
        </div>
        <div className="mobile-msp-last-meta">{metaParts.join(' · ')}</div>
      </div>
      {right}
      <span className="mobile-msp-last-chev" aria-hidden="true"><ChevronRightIcon /></span>
    </button>
  );
}

// Özet "Son hareketler" kompakt satırı (zaman akışı öğesinden türetilir).
function MovementRow({ entry }) {
  const ref = entry.ref;
  const short = shortDayMon(entry.date);
  let Icon;
  let tone;
  let title;
  let meta;
  let amount = null;
  let amountClass = 'neutral';

  if (entry.type === 'lesson') {
    const st = lessonStatus(ref);
    tone = st.tone;
    title = `${MODE_LABEL[ref.mode] || 'Ders'} ders`;
    meta = `${st.label} · ${short}`;
    if (ref.status === 'completed') {
      Icon = modeIcon(ref.mode);
      const rem = parseMoney(ref.remaining_receivable);
      if (rem > 0.01) { amount = rem; amountClass = 'open'; }
      else { amount = parseMoney(ref.net_amount ?? ref.price_snapshot); amountClass = 'neutral'; }
    } else if (ref.status === 'scheduled') {
      Icon = CalendarIcon;
    } else {
      Icon = XIcon; // cancelled / no_show
    }
  } else {
    const open = parseMoney(ref.remaining_receivable) > 0.01;
    tone = open ? 'open' : 'accent';
    Icon = TagIcon;
    title = saleTitle(ref);
    meta = `Ürün satışı · ${short}`;
    amount = open ? parseMoney(ref.remaining_receivable) : parseMoney(ref.total_amount);
    amountClass = open ? 'open' : 'neutral';
  }

  return (
    <div className="mobile-msp-mvrow">
      <span className={'mobile-msp-mvrow-ic t-' + tone}><Icon size={15} /></span>
      <div className="mobile-msp-mvrow-body">
        <span className="mobile-msp-mvrow-title">{title}</span>
        <span className="mobile-msp-mvrow-meta">{meta}</span>
      </div>
      {amount != null && <span className={'mobile-msp-mvrow-amt ' + amountClass}>{fmtTL(amount)}</span>}
    </div>
  );
}

function ContactRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="mobile-msp-info-row">
      <span className="mobile-msp-info-ic"><Icon /></span>
      <span className="mobile-msp-info-k">{label}</span>
      <span className="mobile-msp-info-v">{value}</span>
    </div>
  );
}

// ─── Statement rows (Dersler · Satışlar · Hareketler) ─────────────────────────

function StmtLesson({ l }) {
  const st = lessonStatus(l);
  const dm = dayMon(l.starts_at);
  const open = st.tone === 'open' || st.tone === 'partial';
  const showAmount = l.status !== 'cancelled';
  const amount = open ? parseMoney(l.remaining_receivable) : parseMoney(l.net_amount ?? l.price_snapshot);
  const dur = l.duration_minutes ? ` · ${l.duration_minutes} dk` : '';
  const note = l.note?.trim();
  return (
    <div className="mobile-msp-stmt">
      <div className="mobile-msp-stmt-date"><b>{dm.d}</b><span>{dm.m}</span></div>
      <div className="mobile-msp-stmt-mid">
        <div className="mobile-msp-stmt-title">{(MODE_LABEL[l.mode] || 'Ders')} ders</div>
        <div className="mobile-msp-stmt-sub">{fmtMeta(l.starts_at, { withTime: true })}{dur}{note ? ` · ${note}` : ''}</div>
      </div>
      <div className="mobile-msp-stmt-right">
        {showAmount && <span className={'mobile-msp-stmt-amt' + (open ? ' open' : '')}>{fmtTL(amount)}</span>}
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
    </div>
  );
}

function StmtSale({ s }) {
  const st = saleStatus(s);
  const dm = dayMon(s.sold_at);
  const open = st.tone !== 'paid';
  const amount = open ? parseMoney(s.remaining_receivable) : parseMoney(s.total_amount);
  const note = s.note?.trim();
  return (
    <div className="mobile-msp-stmt">
      <div className="mobile-msp-stmt-date"><b>{dm.d}</b><span>{dm.m}</span></div>
      <div className="mobile-msp-stmt-mid">
        <div className="mobile-msp-stmt-title">{saleTitle(s)}</div>
        <div className="mobile-msp-stmt-sub">Ürün satışı{note ? ` · ${note}` : ''}</div>
      </div>
      <div className="mobile-msp-stmt-right">
        <span className={'mobile-msp-stmt-amt' + (open ? ' open' : '')}>{fmtTL(amount)}</span>
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
    </div>
  );
}

function FilterChips({ defs, val, set, counts }) {
  return (
    <div className="mobile-msp-chips">
      {defs.map(d => (
        <button
          key={d.id}
          type="button"
          className={'mobile-msp-chip' + (val === d.id ? ' on' : '')}
          onClick={() => set(d.id)}
        >
          {d.label}<span className="mobile-msp-chip-n">{counts[d.id]}</span>
        </button>
      ))}
    </div>
  );
}

function StatementGroup({ group, children }) {
  return (
    <div className="mobile-msp-grp">
      <div className="mobile-msp-grp-lbl">{group.label}</div>
      <div className="mobile-msp-stmt-grp">{children}</div>
    </div>
  );
}

// ─── Tab content ──────────────────────────────────────────────────────────────

function OverviewTab({ student, lastLesson, months, recent, onOpenLessons }) {
  const phone = student.phone ? formatPhoneTr(student.phone) : null;
  const birthday = student.birthday ? fmtShortDate(student.birthday) : null;
  const joined = fmtJoinedDate(student.joined_at);
  const hasContact = phone || student.email || birthday || joined;

  return (
    <div className="mobile-msp-ov">
      <div className="mobile-msp-seclbl">Son katılım</div>
      {lastLesson ? (
        <LastLessonCard lesson={lastLesson} onOpen={onOpenLessons} />
      ) : (
        <div className="mobile-msp-last is-empty">
          <div className="mobile-msp-last-cal"><b>—</b><span /></div>
          <div className="mobile-msp-last-body">
            <div className="mobile-msp-last-title">Henüz ders yok</div>
            <div className="mobile-msp-last-meta">Geçmiş ders kaydı bulunmuyor</div>
          </div>
        </div>
      )}

      <div className="mobile-msp-goalcard">
        <div className="mobile-msp-goalcard-lbl">Aylık hedef · 4 ders</div>
        <div className="mobile-msp-mrings">
          {months.map((m, i) => <MiniRing key={i} n={m.n} pct={m.pct} label={m.m} now={m.isNow} />)}
        </div>
      </div>

      <div className="mobile-msp-seclbl">Son hareketler</div>
      {recent.length ? (
        <div className="mobile-msp-mvlist">
          {recent.map(e => <MovementRow key={e.key} entry={e} />)}
        </div>
      ) : (
        <div className="mobile-msp-empty">Henüz hareket yok.</div>
      )}

      <div className="mobile-msp-seclbl">İletişim</div>
      <div className="mobile-msp-info">
        {hasContact ? (
          <>
            <ContactRow icon={PhoneIcon} label="Telefon" value={phone} />
            <ContactRow icon={MailIcon} label="E-posta" value={student.email} />
            <ContactRow icon={CakeIcon} label="Doğum günü" value={birthday} />
            <ContactRow icon={CalendarIcon} label="Üyelik" value={joined} />
          </>
        ) : (
          <div className="mobile-msp-info-empty">Bilgi girilmemiş</div>
        )}
      </div>

      {student.note && (
        <>
          <div className="mobile-msp-seclbl">Not</div>
          <div className="mobile-msp-note">{student.note}</div>
        </>
      )}
    </div>
  );
}

const LESSON_FILTERS = [
  { id: 'all', label: 'Tümü', test: () => true },
  { id: 'up', label: 'Yaklaşan', test: l => l.status === 'scheduled' },
  { id: 'done', label: 'Tamamlanan', test: l => l.status === 'completed' },
  { id: 'off', label: 'İptal · Gelmedi', test: l => l.status === 'cancelled' || l.status === 'no_show' },
];

function LessonsTab({ lessons }) {
  const [filter, setFilter] = React.useState('all');
  const live = (lessons ?? []).filter(l => !l.deleted_at);
  const counts = Object.fromEntries(LESSON_FILTERS.map(d => [d.id, live.filter(d.test).length]));
  const filtered = live
    .filter(LESSON_FILTERS.find(d => d.id === filter).test)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  const groups = groupByBucket(filtered, l => l.starts_at);
  return (
    <>
      <FilterChips defs={LESSON_FILTERS} val={filter} set={setFilter} counts={counts} />
      {filtered.length === 0 ? (
        <div className="mobile-msp-empty">Bu filtrede ders yok.</div>
      ) : (
        groups.map(g => (
          <StatementGroup key={g.key} group={g}>
            {g.items.map(l => <StmtLesson key={l.id} l={l} />)}
          </StatementGroup>
        ))
      )}
    </>
  );
}

const SALE_FILTERS = [
  { id: 'all', label: 'Tümü', test: () => true },
  { id: 'open', label: 'Borçlu', test: s => parseMoney(s.remaining_receivable) > 0.01 },
  { id: 'paid', label: 'Ödendi', test: s => parseMoney(s.remaining_receivable) <= 0.01 },
];

function SalesTab({ sales }) {
  const [filter, setFilter] = React.useState('all');
  const all = sales ?? [];
  const counts = Object.fromEntries(SALE_FILTERS.map(d => [d.id, all.filter(d.test).length]));
  const filtered = all
    .filter(SALE_FILTERS.find(d => d.id === filter).test)
    .sort((a, b) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime());
  const groups = groupByBucket(filtered, s => s.sold_at);
  return (
    <>
      <FilterChips defs={SALE_FILTERS} val={filter} set={setFilter} counts={counts} />
      {filtered.length === 0 ? (
        <div className="mobile-msp-empty">Bu filtrede satış yok.</div>
      ) : (
        groups.map(g => (
          <StatementGroup key={g.key} group={g}>
            {g.items.map(s => <StmtSale key={s.product_sale_id} s={s} />)}
          </StatementGroup>
        ))
      )}
    </>
  );
}

function MovementsTab({ timeline }) {
  if (!timeline.length) return <div className="mobile-msp-empty">Henüz hareket yok.</div>;
  const groups = groupByBucket(timeline, e => e.date);
  return groups.map(g => (
    <StatementGroup key={g.key} group={g}>
      {g.items.map(e => (
        e.type === 'lesson'
          ? <StmtLesson key={e.key} l={e.ref} />
          : <StmtSale key={e.key} s={e.ref} />
      ))}
    </StatementGroup>
  ));
}

// ─── Main body ────────────────────────────────────────────────────────────────

function ProfileBody({ student, lessons, sales, onClose, onOpenPayment, onOpenSale, onEdit }) {
  const updateMutation = useUpdateStudent(student.id);
  const deleteMutation = useDeleteStudent(student.id);
  const [tab, setTab] = React.useState('overview');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(null);
  const [error, setError] = React.useState(null);
  const scrollRef = React.useRef(null);

  const finance = React.useMemo(() => computeFinance(lessons, sales), [lessons, sales]);
  const timeline = React.useMemo(() => buildTimeline(lessons, sales), [lessons, sales]);
  const lastLesson = React.useMemo(() => lastAttendedLesson(lessons), [lessons]);
  const months = React.useMemo(() => computeMonthlyGoal(lessons), [lessons]);
  const recent = React.useMemo(() => timeline.slice(0, 5), [timeline]);

  const isDebt = finance.totalDebt > 0.01;
  const initials = previewInitials(student.full_name);
  const phoneDisplay = student.phone ? formatPhoneTr(student.phone) : null;
  const prefLabel = student.preferred_mode
    ? (student.preferred_mode === 'online' ? 'Online' : 'Yüzyüze')
    : null;
  const subParts = [];
  if (phoneDisplay) subParts.push(phoneDisplay);
  if (prefLabel) subParts.push(`${prefLabel} tercih`);
  const subLine = subParts.length ? subParts.join(' · ') : (student.email || null);
  const canDelete = finance.totalDebt < 0.01 && busy !== 'delete';

  // Sekme değişiminde içerik başa sarılır.
  React.useEffect(() => { scrollRef.current?.scrollTo?.(0, 0); }, [tab]);

  React.useEffect(() => {
    function onDocClick(e) {
      if (!menuOpen) return;
      if (e.target?.closest?.('.mobile-msp-menu')) return;
      if (e.target?.closest?.('.mobile-msp-more-btn')) return;
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [menuOpen]);

  async function handleToggleActive() {
    setMenuOpen(false);
    setError(null);
    setBusy('toggle');
    try {
      await updateMutation.mutateAsync({ isActive: !student.is_active });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Güncellenemedi.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setMenuOpen(false);
    if (!canDelete) return;
    const ok = window.confirm(`${student.full_name} silinecek. Bu işlem geri alınamaz. Emin misiniz?`);
    if (!ok) return;
    setError(null);
    setBusy('delete');
    try {
      await deleteMutation.mutateAsync();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silinemedi.');
      setBusy(null);
    }
  }

  return (
    <div className="mobile-msp-page">
      <header className={'mobile-msp-hd ' + (isDebt ? 'is-debt' : 'is-clear')}>
        <div className="mobile-msp-hd-nav">
          <button type="button" className="mobile-msp-hd-ic" onClick={onClose} aria-label="Geri">
            <ChevronLeftIcon />
          </button>
          <div className="mobile-msp-hd-menuwrap">
            <button
              type="button"
              className="mobile-msp-hd-ic mobile-msp-more-btn"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Menü"
              aria-expanded={menuOpen}
            >
              <MoreIcon />
            </button>
            {menuOpen && (
              <div className="mobile-msp-menu" role="menu">
                <button
                  type="button" className="mobile-msp-menu-item" role="menuitem"
                  onClick={() => { setMenuOpen(false); onEdit(); }}
                >
                  Düzenle
                </button>
                <button
                  type="button" className="mobile-msp-menu-item" role="menuitem"
                  onClick={handleToggleActive} disabled={busy === 'toggle'}
                >
                  {student.is_active ? 'Pasifleştir' : 'Aktifleştir'}
                </button>
                <button
                  type="button" className="mobile-msp-menu-item is-danger" role="menuitem"
                  onClick={handleDelete} disabled={!canDelete}
                  title={!canDelete ? 'Bağlı borç var' : undefined}
                >
                  Sil
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mobile-msp-hd-id">
          <div className="mobile-msp-hd-av">{initials || '·'}</div>
          <div className="mobile-msp-hd-id-txt">
            <div className="mobile-msp-hd-name">
              <span className="mobile-msp-hd-nametext">{student.full_name}</span>
              <span className={'mobile-msp-hd-badge' + (student.is_active ? '' : ' is-inactive')}>
                {student.is_active ? 'Aktif' : 'Pasif'}
              </span>
            </div>
            {subLine && <div className="mobile-msp-hd-sub">{subLine}</div>}
          </div>
        </div>

        <div className="mobile-msp-hd-bal">
          <span className="mobile-msp-hd-bal-lbl">{isDebt ? 'Toplam borç' : 'Hesap durumu'}</span>
          <span className="mobile-msp-hd-bal-val">{isDebt ? fmtTL(finance.totalDebt) : 'Güncel'}</span>
          <span className="mobile-msp-hd-bal-brk">
            {isDebt
              ? `${fmtTL(finance.lessonDebt)} ders · ${fmtTL(finance.productDebt)} ürün`
              : 'Ödenmemiş borç yok'}
          </span>
        </div>

        <div className="mobile-msp-hd-actions">
          <button
            type="button"
            className="mobile-msp-hd-btn solid"
            onClick={() => onOpenPayment(student)}
            disabled={!isDebt}
          >
            <CardIcon /><span>Ödeme al</span>
          </button>
          <button
            type="button"
            className="mobile-msp-hd-btn outline"
            onClick={() => onOpenSale(student)}
          >
            <CartIcon /><span>Ürün satışı</span>
          </button>
        </div>
      </header>

      <div className="mobile-msp-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={'mobile-msp-tab' + (tab === t.id ? ' on' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mobile-msp-scroll" ref={scrollRef}>
        {error && <div className="mobile-msp-error" role="alert">{error}</div>}
        {tab === 'overview' && (
          <OverviewTab
            student={student}
            lastLesson={lastLesson}
            months={months}
            recent={recent}
            onOpenLessons={() => setTab('lessons')}
          />
        )}
        {tab === 'lessons' && <LessonsTab lessons={lessons} />}
        {tab === 'sales' && <SalesTab sales={sales} />}
        {tab === 'movements' && <MovementsTab timeline={timeline} />}
      </div>
    </div>
  );
}

// ─── Loading / error shells ───────────────────────────────────────────────────

function ProfileShell({ onClose, header, children }) {
  return (
    <div className="mobile-msp-page">
      <header className="mobile-msp-hd is-clear">
        <div className="mobile-msp-hd-nav">
          <button type="button" className="mobile-msp-hd-ic" onClick={onClose} aria-label="Geri">
            <ChevronLeftIcon />
          </button>
          <span />
        </div>
        {header}
      </header>
      {children}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function MobileStudentProfilePage({ studentId, onClose, onOpenPayment, onOpenSale }) {
  const studentQuery = useStudent(studentId);
  const lessonsQuery = useStudentLessons(studentId);
  const salesQuery = useStudentSales(studentId);
  const [editing, setEditing] = React.useState(false);

  if (studentQuery.isLoading) {
    return (
      <ProfileShell
        onClose={onClose}
        header={
          <>
            <div className="mobile-msp-skel mobile-msp-skel-id" />
            <div className="mobile-msp-skel mobile-msp-skel-bal" />
            <div className="mobile-msp-skel mobile-msp-skel-acts" />
          </>
        }
      />
    );
  }

  if (studentQuery.error || !studentQuery.data) {
    return (
      <ProfileShell
        onClose={onClose}
        header={
          <div className="mobile-msp-hd-bal">
            <span className="mobile-msp-hd-bal-lbl">Öğrenci profili</span>
          </div>
        }
      >
        <div className="mobile-msp-scroll">
          <div className="mobile-msp-error" role="alert">
            {studentQuery.error?.message || 'Öğrenci bulunamadı.'}
          </div>
        </div>
      </ProfileShell>
    );
  }

  return (
    <>
      <ProfileBody
        student={studentQuery.data}
        lessons={lessonsQuery.data ?? []}
        sales={salesQuery.data ?? []}
        onClose={onClose}
        onOpenPayment={onOpenPayment}
        onOpenSale={onOpenSale}
        onEdit={() => setEditing(true)}
      />
      {editing && (
        <MobileEditStudentPage
          student={studentQuery.data}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </>
  );
}

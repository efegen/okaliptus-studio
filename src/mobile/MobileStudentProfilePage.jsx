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

const MODE_LABEL = { online: 'Online', onsite: 'Yüzyüze' };
const TR_WEEKDAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

const ACTIVITY_LIMIT = 12;

function ChevronLeftIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

function PaymentIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CartIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 4h2l2.4 11.2a2 2 0 002 1.6h7.8a2 2 0 002-1.5L21 8H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="20" r="1.4" fill="currentColor" />
      <circle cx="17" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}

function CheckIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="mobile-msp-info-row">
      <span className="mobile-msp-info-label">{label}</span>
      <span className="mobile-msp-info-value">{value}</span>
    </div>
  );
}

// ─── Derived data ───────────────────────────────────────────────────────────

function computeFinance(lessons, sales) {
  let lessonDebt = 0;
  let openLessonCount = 0;
  for (const l of lessons ?? []) {
    if (l.deleted_at) continue;
    if (l.status !== 'completed') continue;
    if (l.prepaid_package_id) continue;
    const r = parseMoney(l.remaining_receivable);
    if (r > 0.01) {
      lessonDebt += r;
      openLessonCount += 1;
    }
  }

  let productDebt = 0;
  let openSaleCount = 0;
  for (const s of sales ?? []) {
    const r = parseMoney(s.remaining_receivable);
    if (r > 0.01) {
      productDebt += r;
      openSaleCount += 1;
    }
  }

  return {
    lessonDebt,
    productDebt,
    totalDebt: lessonDebt + productDebt,
    openLessonCount,
    openSaleCount,
  };
}

function startOfWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  // Monday-based week start (CLAUDE.md: Europe/Istanbul, hafta Pazartesi)
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

function lessonRowStatus(l) {
  if (l.status === 'scheduled') return { label: 'Planlı', tone: 'scheduled' };
  if (l.status === 'cancelled') return { label: 'İptal', tone: 'muted' };
  if (l.status === 'no_show') return { label: 'Gelmedi', tone: 'muted' };
  // completed
  if (l.prepaid_package_id) return { label: 'Tamamlandı', tone: 'paid' };
  const remaining = parseMoney(l.remaining_receivable);
  const paid = parseMoney(l.paid_amount);
  if (remaining > 0.01 && paid > 0.01) return { label: 'Kısmi', tone: 'partial' };
  if (remaining > 0.01) return { label: 'Açık', tone: 'open' };
  return { label: 'Ödendi', tone: 'paid' };
}

function fmtRowMeta(iso, { withTime, withDuration } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const wd = TR_WEEKDAYS[d.getDay()];
  const datePart = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
  const parts = [wd, datePart];
  if (withTime) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    parts.push(`${hh}:${mm}`);
  }
  if (withDuration) parts.push(withDuration);
  return parts.join(' · ');
}

function bucketKey(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: 'older', label: 'Önceki' };

  const startNow = new Date(now);
  startNow.setHours(0, 0, 0, 0);
  const tomorrow = new Date(startNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  if (d.getTime() >= tomorrow.getTime()) return { key: 'upcoming', label: 'Yaklaşan' };
  if (d.getTime() >= thisWeekStart.getTime()) return { key: 'this-week', label: 'Bu hafta' };
  if (d.getTime() >= lastWeekStart.getTime()) return { key: 'last-week', label: 'Geçen hafta' };

  const monthLabel = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  const cap = monthLabel.charAt(0).toLocaleUpperCase('tr-TR') + monthLabel.slice(1);
  return { key: 'm-' + d.getFullYear() + '-' + d.getMonth(), label: cap };
}

function buildActivity(lessons, sales) {
  const items = [];

  for (const l of lessons ?? []) {
    if (l.deleted_at) continue;
    const status = lessonRowStatus(l);
    const remaining = parseMoney(l.remaining_receivable);
    const net = parseMoney(l.net_amount ?? l.price_snapshot);
    const discount = parseMoney(l.discount_amount);
    const duration = l.duration_minutes ? `${l.duration_minutes} dk` : null;

    let amount = null;
    let amountTone = 'muted';
    if (l.prepaid_package_id) {
      amount = null;
    } else if (l.status === 'completed') {
      if (remaining > 0.01) { amount = remaining; amountTone = 'warn'; }
      else { amount = net; amountTone = 'muted'; }
    } else if (l.status === 'scheduled') {
      amount = net;
      amountTone = 'quiet';
    }

    items.push({
      key: 'l-' + l.id,
      kind: 'lesson',
      date: l.starts_at,
      title: MODE_LABEL[l.mode] || 'Ders',
      meta: fmtRowMeta(l.starts_at, { withTime: true, withDuration: duration }),
      note: l.note?.trim() || null,
      status,
      amount,
      amountTone,
      discount: discount > 0.01 ? discount : 0,
    });
  }

  for (const s of sales ?? []) {
    const remaining = parseMoney(s.remaining_receivable);
    const total = parseMoney(s.total_amount);
    const status = remaining > 0.01
      ? { label: 'Açık', tone: 'open' }
      : { label: 'Ödendi', tone: 'paid' };

    items.push({
      key: 's-' + s.product_sale_id,
      kind: 'sale',
      date: s.sold_at,
      title: 'Ürün satışı',
      meta: fmtRowMeta(s.sold_at, { withTime: false }),
      note: s.note?.trim() || null,
      status,
      amount: remaining > 0.01 ? remaining : total,
      amountTone: remaining > 0.01 ? 'warn' : 'muted',
      discount: 0,
    });
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function FinanceCard({ finance }) {
  const { lessonDebt, productDebt, totalDebt, openLessonCount, openSaleCount } = finance;

  if (totalDebt < 0.01) {
    return (
      <div className="mobile-msp-finance is-clear">
        <div className="mobile-msp-finance-clear-icon">
          <CheckIcon size={18} />
        </div>
        <div className="mobile-msp-finance-clear-body">
          <div className="mobile-msp-finance-clear-title">Hesap güncel</div>
          <div className="mobile-msp-finance-clear-sub">Ödenmemiş borç yok</div>
        </div>
      </div>
    );
  }

  const captionParts = [];
  if (openLessonCount > 0) captionParts.push(`${openLessonCount} ödenmemiş ders`);
  if (openSaleCount > 0) captionParts.push(`${openSaleCount} ödenmemiş satış`);
  const caption = captionParts.join(' · ');

  const showSplit = lessonDebt > 0.01 && productDebt > 0.01;

  return (
    <div className="mobile-msp-finance is-debt">
      <div className="mobile-msp-finance-head">
        <span className="mobile-msp-finance-eyebrow">Borç</span>
        <span className="mobile-msp-finance-amount">{fmtTL(totalDebt)}</span>
        {caption && <span className="mobile-msp-finance-caption">{caption}</span>}
      </div>
      {showSplit && (
        <div className="mobile-msp-finance-split">
          <div className="mobile-msp-finance-split-row">
            <span className="mobile-msp-finance-split-lbl">Ders</span>
            <span className="mobile-msp-finance-split-val">{fmtTL(lessonDebt)}</span>
          </div>
          <div className="mobile-msp-finance-split-row">
            <span className="mobile-msp-finance-split-lbl">Ürün</span>
            <span className="mobile-msp-finance-split-val">{fmtTL(productDebt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }) {
  return (
    <div className={'mobile-msp-act-row mobile-msp-act-row-' + item.kind}>
      <div className="mobile-msp-act-main">
        <div className="mobile-msp-act-title-row">
          <span className="mobile-msp-act-title">{item.title}</span>
          <span className={'mobile-msp-act-pill mobile-msp-act-pill-' + item.status.tone}>
            {item.status.label}
          </span>
        </div>
        <div className="mobile-msp-act-meta">{item.meta}</div>
        {item.note && <div className="mobile-msp-act-note">{item.note}</div>}
      </div>
      <div className="mobile-msp-act-right">
        {item.amount != null && (
          <div className={'mobile-msp-act-amount mobile-msp-act-amount-' + item.amountTone}>
            {fmtTL(item.amount)}
          </div>
        )}
        {item.discount > 0 && (
          <div className="mobile-msp-act-discount">−{fmtTL(item.discount)}</div>
        )}
      </div>
    </div>
  );
}

function ActivitySection({ items }) {
  if (!items.length) return null;
  const visible = items.slice(0, ACTIVITY_LIMIT);

  // Group consecutively by bucket (items already sorted desc).
  const groups = [];
  let current = null;
  for (const it of visible) {
    const b = bucketKey(it.date);
    if (!current || current.key !== b.key) {
      current = { key: b.key, label: b.label, items: [] };
      groups.push(current);
    }
    current.items.push(it);
  }

  const overflow = items.length - visible.length;

  return (
    <div className="mobile-msp-section">
      <div className="mobile-msp-section-label">Hareketler</div>
      <div className="mobile-msp-activity">
        {groups.map(g => (
          <div key={g.key} className="mobile-msp-act-group">
            <div className="mobile-msp-act-group-label">{g.label}</div>
            {g.items.map(it => <ActivityRow key={it.key} item={it} />)}
          </div>
        ))}
        {overflow > 0 && (
          <div className="mobile-msp-act-more">+{overflow} daha eski kayıt</div>
        )}
      </div>
    </div>
  );
}

// ─── Main body ──────────────────────────────────────────────────────────────

function ProfileBody({ student, lessons, sales, onClose, onOpenPayment, onOpenSale, onEdit }) {
  const updateMutation = useUpdateStudent(student.id);
  const deleteMutation = useDeleteStudent(student.id);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(null);
  const [error, setError] = React.useState(null);

  const finance = React.useMemo(() => computeFinance(lessons, sales), [lessons, sales]);
  const activity = React.useMemo(() => buildActivity(lessons, sales), [lessons, sales]);

  const initials = previewInitials(student.full_name);
  const phoneDisplay = student.phone ? formatPhoneTr(student.phone) : null;
  const birthdayDisplay = student.birthday ? fmtShortDate(student.birthday) : null;
  const joinedDisplay = student.joined_at ? fmtShortDate(student.joined_at) : null;
  const modeDisplay = student.preferred_mode ? MODE_LABEL[student.preferred_mode] : null;

  const hasContact = phoneDisplay || student.email || birthdayDisplay || joinedDisplay || modeDisplay;
  const canDelete = finance.totalDebt < 0.01 && busy !== 'delete';

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

  const subParts = [phoneDisplay, modeDisplay].filter(Boolean);
  const subLine = subParts.length ? subParts.join(' · ') : student.email || null;

  return (
    <div className="mobile-msp-page">
      <header className="mobile-msp-topbar">
        <button type="button" className="mobile-msp-back" onClick={onClose} aria-label="Geri">
          <ChevronLeftIcon />
        </button>
        <h1 className="mobile-msp-topbar-title">{student.full_name}</h1>
        <div className="mobile-msp-topbar-right">
          <button
            type="button"
            className="mobile-msp-more-btn"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menü"
            aria-expanded={menuOpen}
          >
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className="mobile-msp-menu" role="menu">
              <button type="button" className="mobile-msp-menu-item" role="menuitem"
                onClick={() => { setMenuOpen(false); onEdit(); }}>
                Düzenle
              </button>
              <button type="button" className="mobile-msp-menu-item" role="menuitem"
                onClick={handleToggleActive} disabled={busy === 'toggle'}>
                {student.is_active ? 'Pasifleştir' : 'Aktifleştir'}
              </button>
              <button type="button" className="mobile-msp-menu-item is-danger" role="menuitem"
                onClick={handleDelete} disabled={!canDelete}
                title={!canDelete ? 'Bağlı borç var' : undefined}>
                Sil
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="mobile-msp-body">
        {/* Hero */}
        <div className="mobile-msp-hero">
          <div className={'mobile-msp-avatar' + (initials ? '' : ' is-empty')}>
            {initials || '·'}
          </div>
          <div className="mobile-msp-hero-info">
            <div className="mobile-msp-hero-name-row">
              <span className="mobile-msp-hero-name">{student.full_name}</span>
              <span className={'mobile-msp-badge' + (student.is_active ? '' : ' is-inactive')}>
                {student.is_active ? 'Aktif' : 'Pasif'}
              </span>
            </div>
            {subLine && <div className="mobile-msp-hero-sub">{subLine}</div>}
            {student.nickname && <div className="mobile-msp-hero-nick">"{student.nickname}"</div>}
          </div>
        </div>

        <FinanceCard finance={finance} />

        <div className="mobile-msp-actions">
          <button
            type="button"
            className="mobile-msp-action-primary"
            onClick={() => onOpenPayment(student)}
            disabled={finance.totalDebt < 0.01}
          >
            <PaymentIcon />
            <span>Ödeme al</span>
          </button>
          <button
            type="button"
            className="mobile-msp-action-secondary"
            onClick={() => onOpenSale(student)}
          >
            <CartIcon />
            <span>Ürün satışı</span>
          </button>
        </div>

        {error && <div className="mobile-msp-error" role="alert">{error}</div>}

        <ActivitySection items={activity} />

        <div className="mobile-msp-section">
          <div className="mobile-msp-section-label">İletişim</div>
          <div className="mobile-msp-rows">
            <InfoRow label="Telefon" value={phoneDisplay} />
            <InfoRow label="E-posta" value={student.email} />
            <InfoRow label="Doğum günü" value={birthdayDisplay} />
            <InfoRow label="Üyelik tarihi" value={joinedDisplay} />
            <InfoRow label="Ders tercihi" value={modeDisplay} />
            {!hasContact && (
              <div className="mobile-msp-rows-empty">Bilgi girilmemiş</div>
            )}
          </div>
        </div>

        {student.note && (
          <div className="mobile-msp-section">
            <div className="mobile-msp-section-label">Not</div>
            <div className="mobile-msp-note">{student.note}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MobileStudentProfilePage({ studentId, onClose, onOpenPayment, onOpenSale }) {
  const studentQuery = useStudent(studentId);
  const lessonsQuery = useStudentLessons(studentId);
  const salesQuery = useStudentSales(studentId);
  const [editing, setEditing] = React.useState(false);

  if (studentQuery.isLoading) {
    return (
      <div className="mobile-msp-page">
        <header className="mobile-msp-topbar">
          <button type="button" className="mobile-msp-back" onClick={onClose} aria-label="Geri"><ChevronLeftIcon /></button>
          <h1 className="mobile-msp-topbar-title">Öğrenci profili</h1>
          <div className="mobile-msp-topbar-spacer" />
        </header>
        <div className="mobile-msp-body">
          <div className="mobile-msp-skel mobile-msp-skel-hero" />
          <div className="mobile-msp-skel mobile-msp-skel-finance" />
          <div className="mobile-msp-skel mobile-msp-skel-actions" />
          <div className="mobile-msp-skel mobile-msp-skel-activity" />
          <div className="mobile-msp-skel mobile-msp-skel-info" />
        </div>
      </div>
    );
  }

  if (studentQuery.error || !studentQuery.data) {
    return (
      <div className="mobile-msp-page">
        <header className="mobile-msp-topbar">
          <button type="button" className="mobile-msp-back" onClick={onClose} aria-label="Geri"><ChevronLeftIcon /></button>
          <h1 className="mobile-msp-topbar-title">Öğrenci profili</h1>
          <div className="mobile-msp-topbar-spacer" />
        </header>
        <div className="mobile-msp-body">
          <div className="mobile-msp-error" role="alert">
            {studentQuery.error?.message || 'Öğrenci bulunamadı.'}
          </div>
        </div>
      </div>
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

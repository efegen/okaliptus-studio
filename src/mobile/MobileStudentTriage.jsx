import React from 'react';
import { Icon } from '../layout';
import {
  parseMoney,
  getAttendanceStatus,
  previewInitials,
  formatLastLessonShort,
  fmtTL,
} from './shared/studentMeta';

// Triyaj ikonları — projenin Icon seti çoğunu karşılıyor; ₺ (lira) ve ay
// (moon) sette yok, satır içi tanımlanır (referans tasarımla aynı çizim).
const TriIcon = {
  Lira: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M8 4v15c4 0 7-2.2 7-6M6.5 9.5l6-2.4M6.5 13l6-2.4" />
    </svg>
  ),
  Moon: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />
    </svg>
  ),
};

const trCmp = (a, b) => a.localeCompare(b, 'tr');

// Ham öğrenci kaydını listede gereken türevlerle zenginleştirir. Devam tonu,
// borç durumu ve baş harfler tek kaynaktan (shared studentMeta) gelir.
function decorate(student) {
  const lessonDebt = parseMoney(student.lesson_debt);
  const productDebt = parseMoney(student.product_debt);
  const totalDebt = lessonDebt + productDebt;
  return {
    raw: student,
    id: student.id,
    fullName: student.full_name,
    nickname: student.nickname,
    isActive: student.is_active,
    totalDebt,
    hasDebt: totalDebt > 0.01,
    att: getAttendanceStatus(student),
    initials: previewInitials(student.full_name),
    lastLabel: formatLastLessonShort(student.last_lesson_at),
  };
}

function matchesQuery(s, q) {
  if (!q) return true;
  return (
    s.fullName.toLowerCase().includes(q) ||
    (s.nickname && s.nickname.toLowerCase().includes(q)) ||
    (s.raw.phone && s.raw.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')))
  );
}

// Aramayla süzülmüş havuzu, birbirini dışlayan 4 triyaj grubuna böler (sırayla):
// Borçlu → Aksayan → Düzenli gelenler → Pasif. Boş gruplar dışarıda çağrı
// tarafından elenir.
function buildTriageGroups(pool) {
  const debtors = pool.filter(s => s.hasDebt).sort((a, b) => b.totalDebt - a.totalDebt);
  const used = new Set(debtors.map(s => s.id));
  const lapsed = pool.filter(s =>
    !used.has(s.id) && s.isActive && (s.att.tone === 'absent' || s.att.tone === 'low'),
  );
  lapsed.forEach(s => used.add(s.id));
  const regular = pool
    .filter(s => !used.has(s.id) && s.isActive)
    .sort((a, b) => trCmp(a.fullName, b.fullName));
  regular.forEach(s => used.add(s.id));
  const passive = pool.filter(s => !used.has(s.id));
  return [
    { key: 'debt', label: 'Borçlu', tone: 'warn', icon: TriIcon.Lira, items: debtors },
    { key: 'lapsed', label: 'Aksayan', tone: 'amber', icon: Icon.Clock, items: lapsed },
    { key: 'regular', label: 'Düzenli gelenler', tone: 'accent', icon: Icon.Check, items: regular },
    { key: 'passive', label: 'Pasif', tone: 'mute', icon: TriIcon.Moon, items: passive },
  ];
}

function TriageRow({ s, groupKey, onOpen }) {
  return (
    <button type="button" className="mobile-tri-row" onClick={() => onOpen(s.id)}>
      <div className={'mobile-tri-avatar mobile-tri-tone-' + s.att.tone}>{s.initials}</div>
      <div className="mobile-tri-row-body">
        <div className="mobile-tri-row-name">
          {s.fullName}
          {s.nickname && <span className="mobile-tri-row-nick">"{s.nickname}"</span>}
        </div>
        <div className="mobile-tri-row-sub">
          {groupKey === 'passive' ? `${s.lastLabel} · son ders` : s.att.sub}
        </div>
      </div>
      <div className="mobile-tri-row-tail">
        {s.hasDebt ? (
          <span className="mobile-tri-amt is-warn">{fmtTL(s.totalDebt)}</span>
        ) : (
          <span className="mobile-tri-amt is-mute">{s.lastLabel}</span>
        )}
        <Icon.ChevronR width="15" height="15" />
      </div>
    </button>
  );
}

function TriageGroup({ group, collapsed, onToggle, onOpen }) {
  const Ic = group.icon;
  return (
    <section className={'mobile-tri-group' + (collapsed ? ' is-collapsed' : '')}>
      <button
        type="button"
        className={'mobile-tri-group-head mobile-tri-tone-' + group.tone}
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="mobile-tri-group-ic"><Ic width="14" height="14" /></span>
        <span className="mobile-tri-group-label">{group.label}</span>
        <span className="mobile-tri-group-n">{group.items.length}</span>
        <Icon.ChevronDown width="18" height="18" className="mobile-tri-group-chev" />
      </button>
      <div className="mobile-tri-group-body">
        <div>
          <div className="mobile-tri-group-card">
            {group.items.map(s => (
              <TriageRow key={s.id} s={s} groupKey={group.key} onOpen={onOpen} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function MobileStudentTriage({ students, query, isLoading, error, onOpenStudent }) {
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const q = (query || '').trim().toLowerCase();

  const groups = React.useMemo(() => {
    if (!students) return null;
    const pool = students.map(decorate).filter(s => matchesQuery(s, q));
    return buildTriageGroups(pool).filter(g => g.items.length);
  }, [students, q]);

  function toggle(key) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (isLoading) {
    return <div className="mobile-students-state">Yükleniyor…</div>;
  }
  if (error) {
    return <div className="mobile-students-state mobile-students-state-error">{error}</div>;
  }
  if (!students || students.length === 0) {
    return (
      <div className="mobile-students-state">
        <div className="mobile-students-empty-title">Henüz öğrenci yok</div>
        <div className="mobile-students-empty-sub">Sağ üstteki + ile ilk öğrenciyi ekleyebilirsin.</div>
      </div>
    );
  }
  if (!groups || groups.length === 0) {
    return (
      <div className="mobile-students-state">
        "{query.trim()}" için sonuç yok.
      </div>
    );
  }

  return (
    <div className="mobile-tri-groups">
      {groups.map(g => (
        <TriageGroup
          key={g.key}
          group={g}
          collapsed={collapsed.has(g.key)}
          onToggle={() => toggle(g.key)}
          onOpen={onOpenStudent}
        />
      ))}
    </div>
  );
}

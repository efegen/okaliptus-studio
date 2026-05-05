import React from 'react';
import { Avatar, Icon } from '../layout';
import {
  parseMoney,
  getStudentFinancialState,
  formatLastLessonRelative,
  FINANCIAL_TONE_CLASS,
} from './shared/studentMeta';

const TWENTY_EIGHT_DAYS_MS = 28 * 86_400_000;

function StudentCard({ student, onOpen }) {
  const lessonDebt = parseMoney(student.lesson_debt);
  const productDebt = parseMoney(student.product_debt);
  const fin = getStudentFinancialState({ lessonDebt, productDebt });
  const isInactive = !student.is_active;
  const subtitle = formatLastLessonRelative(student.last_lesson_at);

  return (
    <button
      type="button"
      className={'mobile-students-card' + (isInactive ? ' is-inactive' : '')}
      onClick={() => onOpen(student.id)}
    >
      <div className="mobile-students-card-lead">
        <Avatar name={student.full_name} size="md" soft />
        <div className="mobile-students-card-identity">
          <div className="mobile-students-card-name">
            {student.full_name}
            {student.nickname && (
              <span className="mobile-students-card-nick">"{student.nickname}"</span>
            )}
            {isInactive && (
              <span className="mobile-students-card-inactive">Pasif</span>
            )}
          </div>
          <div className="mobile-students-card-sub">{subtitle}</div>
        </div>
      </div>
      <div className="mobile-students-card-tail">
        <span className={`mobile-students-fin-badge ${FINANCIAL_TONE_CLASS[fin.tone]}`}>
          {fin.headline}
        </span>
      </div>
      <Icon.ChevronR width="16" height="16" />
    </button>
  );
}

function totalDebtOf(s) {
  return parseMoney(s.lesson_debt) + parseMoney(s.product_debt);
}

function passesActiveFilter(student, filter) {
  if (!filter) return true;
  if (filter === 'active') return student.is_active === true;
  if (filter === 'debtor') return totalDebtOf(student) > 0.01;
  if (filter === 'inactive14') {
    if (!student.is_active) return false;
    if (!student.last_lesson_at) return true;
    const age = Date.now() - new Date(student.last_lesson_at).getTime();
    return age >= 14 * 86_400_000;
  }
  return true;
}

function passesFilterMode(student, mode) {
  if (!mode || mode === 'all') return true;
  if (mode === 'debtors') return totalDebtOf(student) > 0.01;
  if (mode === 'this-week-active') {
    return parseInt(student.lessons_this_week ?? '0', 10) > 0;
  }
  if (mode === 'this-week-inactive') {
    return student.is_active && parseInt(student.lessons_this_week ?? '0', 10) === 0;
  }
  if (mode === 'inactive-4w') {
    if (!student.is_active) return false;
    if (!student.last_lesson_at) return true;
    return Date.now() - new Date(student.last_lesson_at).getTime() >= TWENTY_EIGHT_DAYS_MS;
  }
  return true;
}

function passesQuery(student, q) {
  if (!q) return true;
  return (
    student.full_name.toLowerCase().includes(q) ||
    (student.nickname && student.nickname.toLowerCase().includes(q)) ||
    (student.phone && student.phone.includes(q))
  );
}

function compareStudents(a, b, sortMode) {
  if (sortMode === 'name-desc') {
    return b.full_name.localeCompare(a.full_name, 'tr');
  }
  if (sortMode === 'last-lesson-recent') {
    const aAt = a.last_lesson_at ? new Date(a.last_lesson_at).getTime() : -Infinity;
    const bAt = b.last_lesson_at ? new Date(b.last_lesson_at).getTime() : -Infinity;
    if (aAt !== bAt) return bAt - aAt;
    return a.full_name.localeCompare(b.full_name, 'tr');
  }
  if (sortMode === 'last-lesson-old') {
    const aAt = a.last_lesson_at ? new Date(a.last_lesson_at).getTime() : -Infinity;
    const bAt = b.last_lesson_at ? new Date(b.last_lesson_at).getTime() : -Infinity;
    if (aAt !== bAt) return aAt - bAt;
    return a.full_name.localeCompare(b.full_name, 'tr');
  }
  if (sortMode === 'debt-high') {
    const diff = totalDebtOf(b) - totalDebtOf(a);
    if (Math.abs(diff) > 0.01) return diff;
    return a.full_name.localeCompare(b.full_name, 'tr');
  }
  if (sortMode === 'created-new') {
    const diff = parseInt(b.id, 10) - parseInt(a.id, 10);
    if (diff !== 0) return diff;
    return a.full_name.localeCompare(b.full_name, 'tr');
  }
  return a.full_name.localeCompare(b.full_name, 'tr');
}

export function MobileStudentList({
  students,
  query,
  isLoading,
  error,
  activeFilter,
  filterMode,
  sortMode,
  onOpenStudent,
  onResetFilter,
}) {
  const q = (query || '').trim().toLowerCase();

  const visible = React.useMemo(() => {
    if (!students) return null;
    const filtered = students.filter(s =>
      passesActiveFilter(s, activeFilter) &&
      passesFilterMode(s, filterMode) &&
      passesQuery(s, q),
    );
    if (sortMode && sortMode !== 'name-asc') {
      filtered.sort((a, b) => compareStudents(a, b, sortMode));
    }
    return filtered;
  }, [students, activeFilter, filterMode, q, sortMode]);

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

  if (!visible || visible.length === 0) {
    if (q) {
      return (
        <div className="mobile-students-state">
          "{query.trim()}" için sonuç bulunamadı.
        </div>
      );
    }
    return (
      <div className="mobile-students-state">
        <div className="mobile-students-empty-title">Bu filtreye uyan öğrenci yok.</div>
        {onResetFilter && (
          <button type="button" className="mobile-students-reset-filter-btn" onClick={onResetFilter}>
            Sıfırla
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mobile-students-list">
      {visible.map(s => (
        <StudentCard key={s.id} student={s} onOpen={onOpenStudent} />
      ))}
    </div>
  );
}

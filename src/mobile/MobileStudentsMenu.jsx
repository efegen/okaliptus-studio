import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../layout';
import { parseMoney } from './shared/studentMeta';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function totalDebtOf(s) {
  return parseMoney(s.lesson_debt) + parseMoney(s.product_debt);
}

const TWENTY_EIGHT_DAYS_MS = 28 * 86_400_000;

const FILTER_OPTIONS = [
  { id: 'all', label: 'Tüm öğrenciler' },
  { id: 'debtors', label: 'Borçlular' },
  { id: 'this-week-active', label: 'Bu hafta dersi olanlar' },
  { id: 'this-week-inactive', label: 'Bu hafta dersi olmayanlar' },
  { id: 'inactive-4w', label: 'Pasif (4+ hafta)' },
];

const SORT_OPTIONS = [
  { id: 'name-asc', label: 'İsme göre A→Z' },
  { id: 'name-desc', label: 'İsme göre Z→A' },
  { id: 'last-lesson-recent', label: 'Son ders (yakın önce)' },
  { id: 'last-lesson-old', label: 'Son ders (eski önce)' },
  { id: 'debt-high', label: 'Borç (yüksek önce)' },
  { id: 'created-new', label: 'Yeni eklenen önce' },
];

function computeFilterCounts(students) {
  if (!students) return {};
  const counts = { all: students.length };
  counts.debtors = students.filter(s => totalDebtOf(s) > 0.01).length;
  counts['this-week-active'] = students.filter(
    s => parseInt(s.lessons_this_week ?? '0', 10) > 0,
  ).length;
  counts['this-week-inactive'] = students.filter(
    s => s.is_active && parseInt(s.lessons_this_week ?? '0', 10) === 0,
  ).length;
  counts['inactive-4w'] = students.filter(s => {
    if (!s.is_active) return false;
    if (!s.last_lesson_at) return true;
    return Date.now() - new Date(s.last_lesson_at).getTime() >= TWENTY_EIGHT_DAYS_MS;
  }).length;
  return counts;
}

export function MobileStudentsMenu({
  open,
  onClose,
  triggerRef,
  kind,
  value,
  onChange,
  students,
}) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  const [anchor, setAnchor] = React.useState(null);
  const counts = React.useMemo(
    () => (kind === 'filter' ? computeFilterCounts(students) : {}),
    [kind, students],
  );

  React.useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const t = triggerRef?.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    setAnchor({
      top: r.bottom + 6,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, [open, triggerRef]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, onClose]);

  if (!open || !anchor) return null;

  function pick(id) {
    onChange(id);
    onClose();
  }

  const options = kind === 'filter' ? FILTER_OPTIONS : SORT_OPTIONS;
  const showCounts = kind === 'filter';
  const title = kind === 'filter' ? 'Filtrele' : 'Sırala';

  const node = (
    <>
      <div className="mobile-students-menu-scrim" onClick={onClose} />
      <div
        className="mobile-students-menu"
        style={{ top: anchor.top, right: anchor.right }}
        role="menu"
      >
        <div className="mobile-students-menu-title">{title}</div>
        {options.map(opt => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              className={'mobile-students-menu-item' + (selected ? ' is-selected' : '')}
              onClick={() => pick(opt.id)}
            >
              <span className="mobile-students-menu-check" aria-hidden="true">
                {selected && <Icon.Check width="14" height="14" />}
              </span>
              <span className="mobile-students-menu-label">{opt.label}</span>
              {showCounts && counts[opt.id] != null && (
                <span className="mobile-students-menu-count">{counts[opt.id]}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );

  return portalContainer ? createPortal(node, portalContainer) : node;
}

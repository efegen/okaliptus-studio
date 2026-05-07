import React from 'react';
import { Avatar } from '../../layout';

// Dropdown renders inline below the input. For mobile sheets, the parent
// sheet uses `repositionInputs={false}` on Drawer.Root so vaul does not
// transform/scroll the focused input — combined with the keyboard-aware
// `--mobile-kb-h` lift on .mobile-csheet-content, the body has enough room
// for the dropdown without clipping.
export function MobileStudentCombobox({ students, selected, onSelect, onClear, loading, autoFocus = false, placeholder = 'Öğrenci ara…' }) {
  const [query, setQuery] = React.useState('');

  // iOS Safari can leave the focused input out of the visible area after the
  // soft keyboard opens (the scrollable sheet body shifts and our --mobile-kb-h
  // lift fires after the focus). Re-pin the input near the top of its
  // scroll container once the keyboard layout has settled.
  function pinIntoView(el) {
    if (!el) return;
    const run = () => el.scrollIntoView({ block: 'start', inline: 'nearest' });
    setTimeout(run, 50);
    setTimeout(run, 280);
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const qd = q.replace(/\D/g, '');
    return students.filter(s =>
      s.full_name?.toLowerCase().includes(q) ||
      (s.nickname && s.nickname.toLowerCase().includes(q)) ||
      (qd.length > 0 && s.phone && s.phone.replace(/\D/g, '').includes(qd))
    ).slice(0, 200);
  }, [students, query]);

  const hasQuery = query.trim().length > 0;

  if (selected) {
    return (
      <div className="mobile-csheet-combo-chip">
        <Avatar name={selected.full_name || ''} size="sm" />
        <span className="mobile-csheet-combo-chip-name">
          {selected.full_name}
          {selected.nickname && <span className="mobile-csheet-combo-chip-nick"> ({selected.nickname})</span>}
        </span>
        <button
          type="button"
          className="mobile-csheet-combo-chip-clear"
          onClick={onClear}
          aria-label="Öğrenciyi temizle"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="mobile-csheet-combo">
      <input
        type="text"
        className="mobile-csheet-combo-input"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={(e) => pinIntoView(e.currentTarget)}
      />
      {hasQuery && (
        <div
          className="mobile-csheet-combo-list"
          // Prevent input blur (and keyboard close) when tapping a result.
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading && students.length === 0 && (
            <div className="mobile-csheet-combo-empty">Yükleniyor…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="mobile-csheet-combo-empty">Sonuç bulunamadı</div>
          )}
          {filtered.map(s => (
            <button
              key={s.id}
              type="button"
              className="mobile-csheet-combo-item"
              onClick={() => onSelect(s)}
            >
              <Avatar name={s.full_name || ''} size="sm" />
              <span className="mobile-csheet-combo-item-name">
                {s.full_name}
                {s.nickname && <span className="mobile-csheet-combo-item-nick"> ({s.nickname})</span>}
              </span>
              {s.phone && (
                <span className="mobile-csheet-combo-item-meta">{s.phone}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

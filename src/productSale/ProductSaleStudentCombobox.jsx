import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStudents } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { Avatar } from '../layout';

export function ProductSaleStudentCombobox({ selected, onSelect, onClear, autoFocus, disabled }) {
  const studentsQuery = useQuery({
    queryKey: queryKeys.students(),
    queryFn: getStudents,
    staleTime: 2 * 60 * 1000,
    enabled: !selected,
  });
  const students = studentsQuery.data ?? [];

  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef(null);
  const rootRef = React.useRef(null);

  React.useEffect(() => {
    if (autoFocus && !selected && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus, selected]);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return students;
    const q = query.toLowerCase();
    const qd = query.replace(/\D/g, '');
    return students.filter(s =>
      s.full_name.toLowerCase().includes(q) ||
      (s.nickname && s.nickname.toLowerCase().includes(q)) ||
      (qd.length > 0 && s.phone && s.phone.replace(/\D/g, '').includes(qd))
    );
  }, [students, query]);

  function selectItem(s) {
    onSelect(s);
    setQuery('');
    setOpen(false);
  }

  function handleClear() {
    onClear();
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKey(e) {
    const opts = filtered.slice(0, 8);
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
        setHighlight(0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, opts.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (opts[highlight]) selectItem(opts[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="combo-root" ref={rootRef}>
      {selected ? (
        <div className="combo-chosen">
          <Avatar name={selected.full_name} size="xs" soft />
          <span className="combo-chosen-name">
            {selected.full_name}
            {selected.nickname && <span className="combo-opt-nick"> ({selected.nickname})</span>}
          </span>
          {!disabled && (
            <button
              type="button"
              className="combo-clear"
              onClick={handleClear}
              aria-label="Seçimi temizle"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      ) : (
        <div className="combo-field">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="combo-icon" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.35"/>
            <path d="M9.5 9.5L13.5 13.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="combo-input"
            placeholder="İsim veya telefon ara…"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKey}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
          />
        </div>
      )}
      {open && !selected && (
        <div className="combo-drop">
          {studentsQuery.isLoading ? (
            <div className="combo-hint">Öğrenciler yükleniyor…</div>
          ) : filtered.length === 0 ? (
            <div className="combo-hint">Sonuç bulunamadı.</div>
          ) : (
            filtered.slice(0, 8).map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={'combo-opt' + (i === highlight ? ' is-hi' : '')}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={e => { e.preventDefault(); selectItem(s); }}
              >
                <Avatar name={s.full_name} size="xs" soft />
                <span className="combo-opt-name">
                  {s.full_name}
                  {s.nickname && <span className="combo-opt-nick"> ({s.nickname})</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

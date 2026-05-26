// Shared layout: sidebar (narrow, icons only), icons, primitives

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { initials } from './data';
import { getStudents } from './api';
import { queryKeys } from './hooks/queryKeys';

export const Icon = {
  Calendar: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>),
  Users: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-5.9"/></svg>),
  Home: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/></svg>),
  Wallet: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M3 7a2 2 0 0 1 2-2h14v4H5a2 2 0 0 1-2-2zM3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3M17 13h5v4h-5a2 2 0 0 1 0-4z"/></svg>),
  Plus: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 5v14M5 12h14"/></svg>),
  Search: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>),
  ChevronR: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M9 6l6 6-6 6"/></svg>),
  ChevronL: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M15 6l-6 6 6 6"/></svg>),
  Studio: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M12 3c-3 3-3 7 0 10 3-3 3-7 0-10zM5 21c0-4 3-7 7-7s7 3 7 7"/></svg>),
  Phone: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 2z"/></svg>),
  Mail: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 6l10 7 10-7"/></svg>),
  Check: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" {...p}><path d="M5 12l5 5 9-11"/></svg>),
  Cake: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M4 20V13h16v7zM6 13v-3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M12 8V5"/></svg>),
  Bell: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>),
  MessageCircle: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg>),
  Repeat: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>),
  Tag: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>),
  Layers: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>),
  Edit: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>),
  Clock: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>),
  ArrowUp: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 19V5M5 12l7-7 7 7"/></svg>),
  ArrowDown: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 5v14M5 12l7 7 7-7"/></svg>),
  ChevronDown: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M6 9l6 6 6-6"/></svg>),
  Settings: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
  Instructor: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>),
  LogOut: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>),
  Filter: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>),
  Sort: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><path d="M7 3v18M3 17l4 4 4-4M17 21V3M13 7l4-4 4 4"/></svg>),
  Menu: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" {...p}><path d="M3 6h18M3 12h18M3 18h18"/></svg>),
  Upload: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>),
  Camera: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>),
  Trash: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>),
};

export function Sidebar({ page, setPage }) {
  const topItems = [
    { id: "home",     label: "Ana Sayfa",            icon: Icon.Home },
    { id: "students", label: "Öğrenciler",           icon: Icon.Users },
    { id: "catalog",  label: "Dersler ve Eğitmenler", icon: Icon.Layers },
    { id: "products", label: "Ürünler",                icon: Icon.Tag },
  ];
  return (
    <aside className="sidebar">
      <img src="/logo.png" className="brand-logo" alt="Okaliptus"/>
      <nav className="nav">
        {topItems.map(it => {
          const I = it.icon;
          return (
            <button
              key={it.id}
              className={"nav-item" + (page === it.id ? " active" : "")}
              onClick={() => setPage(it.id)}
              aria-label={it.label}
            >
              <I width="20" height="20"/>
              <span className="nav-tip">{it.label}</span>
            </button>
          );
        })}
      </nav>
      <nav className="nav nav-bottom">
        <button
          className={"nav-item" + (page === "settings" ? " active" : "")}
          onClick={() => setPage("settings")}
          aria-label="Ayarlar"
        >
          <Icon.Settings width="20" height="20"/>
          <span className="nav-tip">Ayarlar</span>
        </button>
      </nav>
    </aside>
  );
}

export const PAGE_LABELS = {
  home: "Ana Sayfa",
  students: "Öğrenciler",
  catalog: "Dersler ve Eğitmenler",
  products: "Ürünler",
  settings: "Ayarlar",
};

export function Header({ page, user, onLogout, onOpenStudent }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  return (
    <header className="header">
      <div className="header-left">
        <span className="header-brand-name">Okaliptus Yoga</span>
        {page && PAGE_LABELS[page] && (
          <>
            <span className="header-divider" aria-hidden="true">/</span>
            <span className="header-page-label">{PAGE_LABELS[page]}</span>
          </>
        )}
      </div>
      <div className="header-tools">
        <HeaderSearch onOpenStudent={onOpenStudent} />
        <div className="header-actions">
          <button className="iconbtn" aria-label="Bildirimler"><Icon.Bell width="16" height="16"/></button>
          <div className="header-profile-wrap" ref={menuRef}>
            <button
              type="button"
              className="header-profile"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Hesap menüsü"
            >
              {user?.displayName && (
                <span className="header-profile-name">{user.displayName}</span>
              )}
              <span className="avatar avatar-sm" aria-hidden="true">
                {user ? initials(user.displayName) : ''}
              </span>
            </button>
            {menuOpen && (
              <div className="profile-menu">
                <div className="profile-menu-name">{user?.displayName ?? ''}</div>
                {onLogout && (
                  <button className="profile-menu-item" onClick={() => { setMenuOpen(false); onLogout(); }}>
                    <Icon.LogOut width="14" height="14"/>
                    Çıkış yap
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function HeaderSearch({ onOpenStudent }) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const wrapRef = React.useRef(null);
  const inputRef = React.useRef(null);

  const trimmed = query.trim();
  const enabled = trimmed.length >= 1;

  const studentsQuery = useQuery({
    queryKey: queryKeys.students(),
    queryFn: getStudents,
    staleTime: 2 * 60 * 1000,
    enabled,
  });

  const matches = React.useMemo(() => {
    if (!enabled) return [];
    const list = studentsQuery.data ?? [];
    const q = trimmed.toLowerCase();
    return list
      .filter(s =>
        s.full_name.toLowerCase().includes(q) ||
        (s.nickname && s.nickname.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(trimmed))
      )
      .slice(0, 8);
  }, [studentsQuery.data, trimmed, enabled]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [trimmed]);

  React.useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function selectStudent(id) {
    if (!id) return;
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    if (onOpenStudent) onOpenStudent(String(id));
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setQuery('');
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!enabled || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[activeIndex] ?? matches[0];
      selectStudent(pick?.id);
    }
  }

  const showDropdown = open && enabled;
  const isLoading = studentsQuery.isLoading || studentsQuery.isFetching;

  return (
    <div className="header-search-wrap" ref={wrapRef}>
      <div className={"header-search" + (showDropdown ? " is-open" : "")}>
        <Icon.Search width="15" height="15"/>
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Öğrenci ara..."
          aria-label="Öğrenci ara"
        />
      </div>
      {showDropdown && (
        <div className="header-search-menu" role="listbox">
          {matches.length === 0 ? (
            <div className="header-search-empty">
              {isLoading && !studentsQuery.data
                ? 'Yükleniyor...'
                : `"${trimmed}" için sonuç bulunamadı.`}
            </div>
          ) : (
            matches.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={"header-search-item" + (i === activeIndex ? " active" : "")}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectStudent(s.id)}
                role="option"
                aria-selected={i === activeIndex}
              >
                <span className="avatar avatar-xs avatar-soft" aria-hidden="true">
                  {initials(s.full_name)}
                </span>
                <span className="header-search-item-main">
                  <span className="header-search-item-name">
                    {s.full_name}
                    {s.nickname && (
                      <span className="header-search-item-nick"> · {s.nickname}</span>
                    )}
                  </span>
                  {s.phone && (
                    <span className="header-search-item-phone">{s.phone}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }) {
  return <span className={"pill pill-" + tone}>{children}</span>;
}

export function Avatar({ name, size = "md", soft }) {
  return <div className={"avatar avatar-" + size + (soft ? " avatar-soft" : "")}>{initials(name)}</div>;
}

export function MetricCard({ label, value, sub, tone, children }) {
  return (
    <div className={"metric " + (tone ? "metric-" + tone : "")}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
      {children}
    </div>
  );
}

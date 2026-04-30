// Shared layout: sidebar (narrow, icons only), icons, primitives

import React from 'react';
import { initials } from './data';

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
  ArrowUp: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 19V5M5 12l7-7 7 7"/></svg>),
  ArrowDown: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M12 5v14M5 12l7 7 7-7"/></svg>),
  ChevronDown: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M6 9l6 6 6-6"/></svg>),
  Settings: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
  Instructor: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>),
};

export function Sidebar({ page, setPage }) {
  const topItems = [
    { id: "home",         label: "Ana Sayfa",  icon: Icon.Home },
    { id: "students",     label: "Öğrenciler", icon: Icon.Users },
    { id: "lesson-types", label: "Ders Türleri", icon: Icon.Repeat },
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
  instructors: "Eğitmenler",
  "lesson-types": "Ders Türleri",
  settings: "Ayarlar",
};

export function Header({ page }) {
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
        <div className="header-search">
          <Icon.Search width="15" height="15"/>
          <input placeholder="Öğrenci, ders ya da not ara..."/>
        </div>
        <div className="header-actions">
          <button className="iconbtn" aria-label="Bildirimler"><Icon.Bell width="16" height="16"/></button>
          <div className="header-profile">
            <span className="header-profile-name">Efe</span>
            <div className="avatar avatar-sm">E</div>
          </div>
        </div>
      </div>
    </header>
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

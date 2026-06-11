import React from 'react';
import { Icon } from '../layout';

/*
 * 5-slot bottom tab bar (iOS native pattern).
 *   Ana Sayfa · Takvim · [+] · Öğrenciler · Menü
 *
 * The center "+" slot is a FAB that will open the Quick-Add bottom sheet in
 * Faz E.1. For Faz B it's wired to onQuickAdd which is currently a no-op stub
 * passed in by MobileApp.
 *
 * The "Menü" slot opens the mobile menu page (Ayarlar, Katalog, Çıkış). The
 * tab is rendered as active not just for `page === 'menu'` but also when the
 * user has drilled into one of the pages reachable only from the menu —
 * `settings` and `catalog` — so the active indicator stays consistent.
 */

const TABS = [
  { id: 'home',     label: 'Ana',        icon: Icon.Home,  matches: ['home'] },
  { id: 'students', label: 'Öğrenciler', icon: Icon.Users, matches: ['students'] },
  { id: 'calendar', label: 'Takvim',     icon: Icon.Calendar, matches: ['calendar'] },
  { id: 'menu',     label: 'Menü',       icon: Icon.Menu,  matches: ['menu', 'settings', 'catalog', 'products', 'movements', 'finance'] },
];

export function BottomTabBar({ page, onNavigate, onQuickAdd }) {
  const tab = (id) => {
    const def = TABS.find((t) => t.id === id);
    if (!def) return null;
    const I = def.icon;
    const active = def.matches.includes(page);
    return (
      <button
        key={def.id}
        type="button"
        className={'mobile-tab-btn' + (active ? ' active' : '')}
        onClick={() => onNavigate(def.id)}
        aria-label={def.label}
        aria-current={active ? 'page' : undefined}
      >
        <I width="22" height="22" />
        <span className="mobile-tab-label">{def.label}</span>
      </button>
    );
  };

  return (
    <nav className="mobile-bottom-tab" aria-label="Ana navigasyon">
      {tab('home')}
      {tab('calendar')}
      <button
        type="button"
        className="mobile-tab-fab"
        onClick={onQuickAdd}
        aria-label="Hızlı ekle"
      >
        <Icon.Plus width="26" height="26" />
      </button>
      {tab('students')}
      {tab('menu')}
    </nav>
  );
}

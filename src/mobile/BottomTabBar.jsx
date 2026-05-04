import React from 'react';
import { Icon } from '../layout';

/*
 * 5-slot bottom tab bar (iOS native pattern).
 *   Ana Sayfa · Takvim · [+] · Öğrenciler · Ayarlar
 *
 * The center "+" slot is a FAB that will open the Quick-Add bottom sheet in
 * Faz E.1. For Faz B it's wired to onQuickAdd which is currently a no-op stub
 * passed in by MobileApp.
 */

const TABS = [
  { id: 'home',     label: 'Ana',        icon: Icon.Home },
  { id: 'students', label: 'Öğrenciler', icon: Icon.Users },
  { id: 'calendar', label: 'Takvim',     icon: Icon.Calendar },
  { id: 'settings', label: 'Ayarlar',    icon: Icon.Settings },
];

export function BottomTabBar({ page, onNavigate, onQuickAdd }) {
  const tab = (id) => {
    const def = TABS.find((t) => t.id === id);
    if (!def) return null;
    const I = def.icon;
    const active = page === def.id;
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
      {tab('settings')}
    </nav>
  );
}

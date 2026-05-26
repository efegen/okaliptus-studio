import React from 'react';
import { Icon } from '../layout';

const PAGE_TITLES = {
  home: 'Ana Sayfa',
  students: 'Öğrenciler',
  calendar: 'Takvim',
  settings: 'Ayarlar',
  catalog: 'Dersler ve Eğitmenler',
  products: 'Ürünler',
  menu: 'Menü',
};

// action (opsiyonel): sağ üstte tek bir ikon-buton render eder.
//   { icon: Component, onClick, label }
// Hesap/çıkış artık Menü sekmesinde olduğu için header'da avatar yok.
export function MobileHeader({ page, showBack, onBack, title, action }) {
  const resolvedTitle = title ?? PAGE_TITLES[page] ?? 'Okaliptus';
  const ActionIcon = action?.icon;

  return (
    <header className="mobile-header">
      <div className="mobile-header-title">
        {showBack && (
          <button
            type="button"
            className="mobile-iconbtn"
            onClick={onBack}
            aria-label="Geri"
          >
            <Icon.ChevronL width="22" height="22" />
          </button>
        )}
        <span className="mobile-header-title-text">{resolvedTitle}</span>
      </div>
      <div className="mobile-header-actions">
        {action && ActionIcon && (
          <button
            type="button"
            className="mobile-iconbtn mobile-iconbtn-accent"
            onClick={action.onClick}
            aria-label={action.label}
          >
            <ActionIcon width="22" height="22" />
          </button>
        )}
      </div>
    </header>
  );
}

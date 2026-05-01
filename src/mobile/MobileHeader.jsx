import React from 'react';
import { Icon } from '../layout';

const PAGE_TITLES = {
  home: 'Ana Sayfa',
  students: 'Öğrenciler',
  catalog: 'Katalog',
  settings: 'Ayarlar',
};

export function MobileHeader({ page, showBack, onBack, title }) {
  const resolvedTitle = title ?? PAGE_TITLES[page] ?? 'Okaliptus';

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
        <button
          type="button"
          className="mobile-iconbtn"
          aria-label="Bildirimler"
        >
          <Icon.Bell width="20" height="20" />
        </button>
      </div>
    </header>
  );
}

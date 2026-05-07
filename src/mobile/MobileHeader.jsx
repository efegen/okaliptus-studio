import React from 'react';
import { Icon } from '../layout';
import { initials } from '../data';

const PAGE_TITLES = {
  home: 'Ana Sayfa',
  students: 'Öğrenciler',
  calendar: 'Takvim',
  settings: 'Ayarlar',
  catalog: 'Dersler ve Eğitmenler',
  products: 'Ürünler',
  menu: 'Menü',
};

export function MobileHeader({ page, showBack, onBack, title, currentUser, onLogout }) {
  const resolvedTitle = title ?? PAGE_TITLES[page] ?? 'Okaliptus';
  const [profileOpen, setProfileOpen] = React.useState(false);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    if (!profileOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [profileOpen]);

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
        <div className="mobile-profile-wrap" ref={menuRef}>
          <button
            type="button"
            className="mobile-avatar-btn"
            onClick={() => setProfileOpen(o => !o)}
            aria-label="Hesap menüsü"
          >
            <span className="avatar avatar-sm" aria-hidden="true">
              {currentUser ? initials(currentUser.displayName) : '?'}
            </span>
          </button>
          {profileOpen && (
            <div className="mobile-profile-menu">
              {currentUser?.displayName && (
                <div className="mobile-profile-menu-name">{currentUser.displayName}</div>
              )}
              {onLogout && (
                <button
                  className="mobile-profile-menu-item"
                  onClick={() => { setProfileOpen(false); onLogout(); }}
                >
                  <Icon.LogOut width="16" height="16" />
                  Çıkış yap
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

import React from 'react';
import { Avatar, Icon } from '../layout';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Günaydın';
  if (hour >= 12 && hour < 18) return 'Merhaba';
  if (hour >= 18 && hour < 22) return 'İyi akşamlar';
  return 'İyi geceler';
}

function getTodayChip() {
  const formatter = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  return formatter.format(new Date());
}

export function MobileGreetingHeader({ user, onLogout }) {
  const displayName = user?.displayName || '';
  const greeting = displayName ? `${getGreeting()}, ${displayName}` : getGreeting();
  const todayChip = getTodayChip();

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
    <div className="mobile-greeting-header">
      <div className="mobile-greeting-text">
        <h1 className="mobile-greeting-line1">{greeting}</h1>
        <p className="mobile-greeting-date">{todayChip}</p>
      </div>
      {displayName && (
        <div className="mobile-profile-wrap" ref={menuRef}>
          <button
            type="button"
            className="mobile-avatar-btn"
            onClick={() => setProfileOpen(o => !o)}
            aria-label="Hesap menüsü"
          >
            <Avatar name={displayName} size="sm" />
          </button>
          {profileOpen && (
            <div className="mobile-profile-menu">
              <div className="mobile-profile-menu-name">{displayName}</div>
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
      )}
    </div>
  );
}

import React from 'react';
import { Icon } from '../layout';
import { initials } from '../data';
import { canSeePage, roleLabel } from '../permissions';

// Mobil "Menü" sayfası — Yaklaşım A (Gruplu ayarlar). Üstte tıklanamaz profil
// kartı (yalnız kimlik), altında iOS tarzı bölümlü liste: renkli ikon karosu +
// etiket + chevron. Alt navigasyon çubuğu bu ekranın parçası değil; global
// shell (BottomTabBar) sağlar.

const SECTIONS = [
  {
    label: 'Stüdyo',
    items: [
      { id: 'catalog', label: 'Dersler ve Eğitmenler', icon: Icon.Layers, tone: 'sage' },
      { id: 'products', label: 'Ürünler', icon: Icon.Tag, tone: 'amber' },
    ],
  },
  {
    label: 'Kayıtlar',
    items: [
      { id: 'finance', label: 'Finans', icon: Icon.Wallet, tone: 'sage' },
      { id: 'movements', label: 'Hareketler', icon: Icon.Repeat, tone: 'blue' },
    ],
  },
  {
    label: 'Genel',
    items: [
      { id: 'settings', label: 'Ayarlar', icon: Icon.Settings, tone: 'neutral' },
    ],
  },
];

export function MobileMenu({ user, onNavigate, onLogout }) {
  const displayName = user?.displayName || 'Operatör';
  const avatarText = user?.displayName ? initials(user.displayName) : '·';
  const role = user?.role;

  // Rol-bazlı süzme: erişilemeyen menü kalemleri (ör. asistan için Finans /
  // Hareketler / Ayarlar / Katalog) hiç gösterilmez; boşalan bölüm de düşer.
  const sections = SECTIONS
    .map(sec => ({ ...sec, items: sec.items.filter(it => canSeePage(role, it.id)) }))
    .filter(sec => sec.items.length > 0);

  return (
    <div className="mobile-menu">
      <h1 className="mobile-menu-title">Menü</h1>

      <div className="mobile-menu-profile">
        <span className="mobile-menu-avatar" aria-hidden="true">{avatarText}</span>
        <span className="mobile-menu-profile-tx">
          <span className="mobile-menu-profile-name">{displayName}</span>
          <span className="mobile-menu-profile-sub">Okaliptus Studio · {roleLabel(role)}</span>
        </span>
      </div>

      {sections.map(sec => (
        <div className="mobile-menu-group" key={sec.label}>
          <p className="mobile-menu-group-lbl">{sec.label}</p>
          <div className="mobile-menu-card" role="list">
            {sec.items.map(it => {
              const I = it.icon;
              return (
                <button
                  key={it.id}
                  type="button"
                  role="listitem"
                  className="mobile-menu-row"
                  onClick={() => onNavigate(it.id)}
                >
                  <span className={'mobile-menu-tile tone-' + it.tone} aria-hidden="true">
                    <I width="19" height="19" />
                  </span>
                  <span className="mobile-menu-row-label">{it.label}</span>
                  <span className="mobile-menu-row-chev" aria-hidden="true">
                    <Icon.ChevronR width="17" height="17" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mobile-menu-card mobile-menu-card-logout">
        <button type="button" className="mobile-menu-row is-danger" onClick={onLogout}>
          <span className="mobile-menu-tile tone-red" aria-hidden="true">
            <Icon.LogOut width="19" height="19" />
          </span>
          <span className="mobile-menu-row-label">Çıkış yap</span>
        </button>
      </div>
    </div>
  );
}

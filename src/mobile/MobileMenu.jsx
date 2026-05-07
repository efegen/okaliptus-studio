import React from 'react';
import { Icon } from '../layout';

export function MobileMenu({ onNavigate, onLogout }) {
  const items = [
    {
      id: 'settings',
      label: 'Ayarlar',
      icon: Icon.Settings,
      onPress: () => onNavigate('settings'),
    },
    {
      id: 'catalog',
      label: 'Dersler ve Eğitmenler',
      icon: Icon.Layers,
      onPress: () => onNavigate('catalog'),
    },
    {
      id: 'products',
      label: 'Ürünler',
      icon: Icon.Tag,
      onPress: () => onNavigate('products'),
    },
    {
      id: 'logout',
      label: 'Çıkış yap',
      icon: Icon.LogOut,
      onPress: onLogout,
      danger: true,
    },
  ];

  return (
    <div className="mobile-menu">
      <h1 className="mobile-menu-title">Menü</h1>
      <div className="mobile-menu-list" role="list">
        {items.map(it => {
          const I = it.icon;
          return (
            <button
              key={it.id}
              type="button"
              role="listitem"
              className={'mobile-menu-item' + (it.danger ? ' is-danger' : '')}
              onClick={it.onPress}
            >
              <span className="mobile-menu-icon" aria-hidden="true">
                <I width="20" height="20" />
              </span>
              <span className="mobile-menu-label">{it.label}</span>
              {!it.danger && (
                <span className="mobile-menu-chevron" aria-hidden="true">
                  <Icon.ChevronR width="18" height="18" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

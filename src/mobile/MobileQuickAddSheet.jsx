import React from 'react';
import { Drawer } from 'vaul';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function PaymentIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h14v4H5a2 2 0 0 1-2-2zM3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3M17 13h5v4h-5a2 2 0 0 1 0-4z" />
    </svg>
  );
}

function ProductIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M5 8h14l-1 11a2 2 0 0 1-2 1.8H8a2 2 0 0 1-2-1.8L5 8z" strokeLinejoin="round" />
      <path d="M9 8V6a3 3 0 1 1 6 0v2" strokeLinecap="round" />
    </svg>
  );
}

function LessonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
      <path d="M12 13v4M10 15h4" strokeLinecap="round" />
    </svg>
  );
}

const ACTIONS = [
  {
    id: 'payment',
    title: 'Ödeme al',
    subtitle: 'Açık borca tahsilat',
    icon: PaymentIcon,
    tone: 'mint',
  },
  {
    id: 'sale',
    title: 'Ürün sat',
    subtitle: 'Tütsü, yastık, aksesuar',
    icon: ProductIcon,
    tone: 'amber',
  },
  {
    id: 'lesson',
    title: 'Ders oluştur',
    subtitle: 'Yeni ders planla',
    icon: LessonIcon,
    tone: 'lavender',
  },
];

export function MobileQuickAddSheet({ open, onClose, onPick }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      shouldScaleBackground={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-qadd-overlay" />
        <Drawer.Content className="mobile-qadd-content">
          <Drawer.Handle className="mobile-qadd-handle" />
          <header className="mobile-qadd-header">
            <Drawer.Title className="mobile-qadd-title">Hızlı ekle</Drawer.Title>
            <Drawer.Description className="mobile-qadd-desc">
              Sık yaptığın işlemler
            </Drawer.Description>
          </header>

          <div className="mobile-qadd-list">
            {ACTIONS.map(action => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  className={`mobile-qadd-tile is-${action.tone}`}
                  onClick={() => onPick(action.id)}
                >
                  <span className="mobile-qadd-tile-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="mobile-qadd-tile-text">
                    <span className="mobile-qadd-tile-title">{action.title}</span>
                    <span className="mobile-qadd-tile-subtitle">{action.subtitle}</span>
                  </span>
                  <span className="mobile-qadd-tile-chev" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>

          <footer className="mobile-qadd-actions">
            <button
              type="button"
              className="mobile-qadd-cancel"
              onClick={onClose}
            >
              Vazgeç
            </button>
          </footer>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

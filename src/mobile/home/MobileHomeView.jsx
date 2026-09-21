import React from 'react';
import { Avatar, Icon } from '../../layout';
import { fmtTL } from '../../data';

// Türkçe iyelik eki: "%53'ü", "%50'si", "%40'ı" ... Son okunan sözcüğün
// ünlü uyumuna göre. 0–100 arası yüzdeler için doğru ek üretir.
function percentSuffix(n) {
  const map = {
    0: 'ı', 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u',
    10: 'u', 20: 'si', 30: 'u', 40: 'ı', 50: 'si', 60: 'ı', 70: 'i', 80: 'i', 90: 'ı', 100: 'ü',
  };
  if (n <= 10 || n === 100) return map[n] ?? 'i';
  const ones = n % 10;
  return ones === 0 ? (map[n] ?? 'ı') : map[ones];
}

function EyeIcon({ open }) {
  return open
    ? (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>)
    : (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-6.9M9.9 4.2A10.5 10.5 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.4M1 1l22 22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>);
}

function ProfileMenu({ user, onLogout }) {
  const displayName = user?.displayName || '';
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [open]);

  if (!displayName) return null;

  return (
    <div className="mobile-profile-wrap" ref={wrapRef}>
      <button
        type="button"
        className="mobile-avatar-btn"
        onClick={() => setOpen(o => !o)}
        aria-label="Hesap menüsü"
      >
        <Avatar name={displayName} size="sm" />
      </button>
      {open && (
        <div className="mobile-profile-menu">
          <div className="mobile-profile-menu-name">{displayName}</div>
          {onLogout && (
            <button
              className="mobile-profile-menu-item"
              onClick={() => { setOpen(false); onLogout(); }}
            >
              <Icon.LogOut width="16" height="16" />
              Çıkış yap
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "B Temel" mobil ana sayfa üst kısmı — başlık + hero (son 30 gün tahsilat) + iki pill.
 * Bugünün dersleri ayrı bir bileşendir (MobileAgenda). Veri MobileHome'dan gelir.
 */

export function MobileHomeView({
  dateLabel, headline, user, onLogout, onOpenFinance, onOpenOccupancy, onOpenOrders, onOpenNotes,
  collected = 0, revenue = 0, collectionRate = 0,
  receivable = 0, debtorCount = 0,
  occupancy = 0, plannedLessons = 0, capacity = null,
  kpiLoading = false,
  ordersPending = 0, ordersUrgent = 0, notesHasNew = false,
  canSeeFinance = true, canSeeOrders = true,
}) {
  const barWidth = Math.max(0, Math.min(100, collectionRate));
  const occupancyTag = capacity != null
    ? `${plannedLessons}/${capacity} ders`
    : `${plannedLessons} ders`;
  const kpiDim = kpiLoading ? ' is-loading' : '';
  const [hidden, setHidden] = React.useState(() => {
    try { return localStorage.getItem('mh-hide-amounts') === '1'; } catch { return false; }
  });
  function toggleHidden() {
    setHidden(h => {
      const next = !h;
      try { localStorage.setItem('mh-hide-amounts', next ? '1' : '0'); } catch { /* yok say */ }
      return next;
    });
  }
  const money = (n) => (hidden ? '•••• ₺' : fmtTL(n));

  return (
    <div className="mobile-home mh-wrap">
      <div className="mh-head">
        <div>
          <p className="mh-date">{dateLabel}</p>
          <div className="mh-hi-row">
            <h1 className="mh-hi">{headline}</h1>
            {canSeeFinance && (
              <button
                type="button"
                className="mh-eye-btn"
                onClick={toggleHidden}
                aria-label={hidden ? 'Tutarları göster' : 'Tutarları gizle'}
                aria-pressed={hidden}
              >
                <EyeIcon open={!hidden} />
              </button>
            )}
          </div>
        </div>
        <ProfileMenu user={user} onLogout={onLogout} />
      </div>

      {canSeeFinance && (() => {
        const heroInner = (
          <>
            <div className="mh-hero-top">
              <div>
                <p className="mh-hero-label">Son 30 günde tahsil edilen</p>
                <p className="mh-hero-big">{kpiLoading ? '—' : money(collected)}</p>
              </div>
              {onOpenFinance && (
                <Icon.ChevronR className="mh-hero-chev" width="20" height="20" aria-hidden="true" />
              )}
            </div>
            <p className="mh-hero-sub">
              {kpiLoading
                ? '—'
                : `${money(revenue)} cironun %${collectionRate}'${percentSuffix(collectionRate)} tahsil edildi`}
            </p>
            <div className="mh-hero-prog">
              <div className="mh-hero-prog-fill" style={{ width: `${barWidth}%` }} />
            </div>
          </>
        );
        const financeSlide = onOpenFinance ? (
          <button
            type="button"
            className={`mh-hero mh-hero-btn${kpiDim}`}
            onClick={onOpenFinance}
            aria-label="Finans ekranını aç"
          >
            {heroInner}
          </button>
        ) : (
          <div className={`mh-hero${kpiDim}`}>{heroInner}</div>
        );
        return financeSlide;
      })()}

      <div className={`mh-pills${canSeeFinance ? '' : ' mh-pills-solo'}`}>
        {canSeeFinance && (
          <div className={`mh-pill warn${kpiDim}`}>
            <p className="mh-pill-label">Bekleyen tahsilat</p>
            <div className="mh-pill-val">{kpiLoading ? '—' : money(receivable)}</div>
            <span className="mh-pill-tag">{debtorCount} öğrenci</span>
          </div>
        )}
        {(() => {
          const body = (
            <>
              <div className="mh-pill-val">%{occupancy}</div>
              <span className="mh-pill-tag">{occupancyTag}</span>
            </>
          );
          // Doluluk kartı tıklanınca Doluluk · Yoklama ekranını açar; tıklanabilir
          // olduğu, hero kartındaki gibi sağ üstteki ok ile belli olur.
          return onOpenOccupancy ? (
            <button
              type="button"
              className={`mh-pill mh-pill-btn${kpiDim}`}
              onClick={onOpenOccupancy}
              aria-label="Doluluk ekranını aç"
            >
              <div className="mh-pill-top">
                <p className="mh-pill-label">Haftalık doluluk</p>
                <Icon.ChevronR className="mh-pill-chev" width="16" height="16" aria-hidden="true" />
              </div>
              {body}
            </button>
          ) : (
            <div className={`mh-pill${kpiDim}`}>
              <p className="mh-pill-label">Haftalık doluluk</p>
              {body}
            </div>
          );
        })()}
      </div>

      {/* Modül çifti — KPI pill'lerinin hemen altı, ders akışının üstü.
          Siparişler tasarımı "V3·B · Aciliyet" (Trendyol pazaryeri): ikonda
          bildirim noktası + alt metinde turuncu "N acil" vurgusu (24 saat içinde
          kargoya verilmesi gereken sipariş) aksiyon gerektiren işi öne çıkarır.
          Yan yana ikinci kutu "Notlar" eklenince tek satırlık geniş satır
          yerine iki eşit, alçak kutuya (mod-tile) dönüştü. Alt metinler yarım
          genişlikte tek satıra sığacak kadar kısa tutulmalı (~105px): aciliyet
          ayrı bir çip rozetiyken metne taşındı, "Bekleyen sipariş yok" da
          "Sipariş yok"a indi.
          Siparişler asistana kapalı; o durumda Notlar tek başına tam genişlik
          kaplar (flex: 1). */}
      <div className="mod-wrap mod-pair">
        {canSeeOrders && (
          <button type="button" className="mod-tile mod-tileu" onClick={onOpenOrders}>
            <span className="mod-tile-icon">
              <Icon.Box width="16" height="16" aria-hidden="true" />
              {ordersPending > 0 && <span className="mod-tileu-dot" />}
            </span>
            <span className="mod-tile-body">
              <span className="mod-tile-title">Siparişler</span>
              <span className="mod-tile-sub">
                {ordersUrgent > 0 ? (
                  <>
                    {ordersPending} bekleyen ·{' '}
                    <span className="mod-tileu-urgent">{ordersUrgent} acil</span>
                  </>
                ) : ordersPending > 0 ? (
                  `${ordersPending} bekleyen sipariş`
                ) : (
                  'Sipariş yok'
                )}
              </span>
            </span>
          </button>
        )}
        <button type="button" className="mod-tile mod-tilen" onClick={onOpenNotes}>
          <span className="mod-tile-icon">
            <Icon.Edit width="16" height="16" aria-hidden="true" />
            {notesHasNew && <span className="mod-tilen-dot" />}
          </span>
          <span className="mod-tile-body">
            <span className="mod-tile-title">Notlar</span>
            <span className="mod-tile-sub">{notesHasNew ? 'Yeni not eklendi' : 'Ekip notları'}</span>
          </span>
        </button>
      </div>
    </div>
  );
}

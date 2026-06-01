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
 * "B Temel" mobil ana sayfa üst kısmı — başlık + hero (aylık tahsilat) + iki pill.
 * Bugünün dersleri ayrı bir bileşendir (MobileAgenda). Veri MobileHome'dan gelir.
 */
export function MobileHomeView({
  dateLabel, headline, user, onLogout,
  collected = 0, revenue = 0, collectionRate = 0,
  receivable = 0, debtorCount = 0,
  occupancy = 0, plannedLessons = 0, capacity = null,
  kpiLoading = false,
}) {
  const barWidth = Math.max(0, Math.min(100, collectionRate));
  const occupancyTag = capacity != null
    ? `${plannedLessons}/${capacity} ders`
    : `${plannedLessons} ders`;
  const kpiDim = kpiLoading ? ' is-loading' : '';

  return (
    <div className="mobile-home mh-wrap">
      <div className="mh-head">
        <div>
          <p className="mh-date">{dateLabel}</p>
          <h1 className="mh-hi">{headline}</h1>
        </div>
        <ProfileMenu user={user} onLogout={onLogout} />
      </div>

      <div className={`mh-hero${kpiDim}`}>
        <div className="mh-hero-top">
          <div>
            <p className="mh-hero-label">Bu ay tahsil edilen</p>
            <p className="mh-hero-big">{kpiLoading ? '—' : fmtTL(collected)}</p>
          </div>
        </div>
        <p className="mh-hero-sub">
          {kpiLoading
            ? '—'
            : `${fmtTL(revenue)} cironun %${collectionRate}'${percentSuffix(collectionRate)} tahsil edildi`}
        </p>
        <div className="mh-hero-prog">
          <div className="mh-hero-prog-fill" style={{ width: `${barWidth}%` }} />
        </div>
      </div>

      <div className="mh-pills">
        <div className={`mh-pill warn${kpiDim}`}>
          <p className="mh-pill-label">Bekleyen tahsilat</p>
          <div className="mh-pill-val">{kpiLoading ? '—' : fmtTL(receivable)}</div>
          <span className="mh-pill-tag">{debtorCount} öğrenci</span>
        </div>
        <div className={`mh-pill${kpiDim}`}>
          <p className="mh-pill-label">Haftalık doluluk</p>
          <div className="mh-pill-val">%{occupancy}</div>
          <span className="mh-pill-tag">{occupancyTag}</span>
        </div>
      </div>
    </div>
  );
}

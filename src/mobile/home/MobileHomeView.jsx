import React from 'react';
import { Avatar, Icon } from '../../layout';
import { fmtTL } from '../../data';

const MONTHS_TR = ['OCA', 'ŞUB', 'MAR', 'NİS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKİ', 'KAS', 'ARA'];
const WEEKDAY_LONG = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long' });
const MONTH_LONG = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' });
const TIME_FMT = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });

function eventCountdownLabel(startsAt) {
  const days = Math.ceil((new Date(startsAt).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'BUGÜN';
  if (days === 1) return 'YARIN';
  return `${days} GÜN`;
}

/** Ana sayfa hero'sundaki yaklaşan etkinlik kartı (Canvas-2 "4d"). */
function EventHeroCard({ event, onOpen, showAmount }) {
  const date = new Date(event.starts_at);
  const day = date.getDate();
  const month = MONTHS_TR[date.getMonth()];
  const coming = event.coming;
  const unsure = event.unsure;
  const total = event.totalParticipants || 1;
  const notCounted = Math.max(0, total - coming - unsure);
  const participantCount = event.totalParticipants ?? event.registeredCount ?? 0;

  return (
    <button type="button" className="mh-event-card" onClick={() => onOpen(event.id)}>
      <span className="mh-event-card-bg" aria-hidden="true" />
      <div className="mh-event-top">
        <div className="mh-event-datebadge" aria-hidden="true">
          <span className="mh-event-datebadge-day">{day}</span>
          <span className="mh-event-datebadge-month">{month}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="mh-event-eyebrow">Yaklaşan etkinlik</p>
          <p className="mh-event-name">{event.name}</p>
        </div>
        <span className="mh-event-countdown">{eventCountdownLabel(event.starts_at)}</span>
      </div>
      <p className="mh-event-meta">
        {WEEKDAY_LONG.format(date)} · {TIME_FMT.format(date)}{event.location ? ` · ${event.location}` : ''}
      </p>
      <div className="mh-event-tear" aria-hidden="true">
        <span className="mh-event-notch mh-event-notch-l" />
        <span className="mh-event-notch mh-event-notch-r" />
      </div>
      <div className="mh-event-bottom">
        <div className="mh-event-stat-row">
          <span className="mh-event-stat-num">{coming}</span>
          <span className="mh-event-stat-label">kişi geliyor</span>
          <span style={{ flex: 1 }} />
          {unsure > 0 && <span className="mh-event-stat-unsure">{unsure} belirsiz</span>}
        </div>
        <div className="mh-event-bar">
          <span style={{ flexGrow: coming, flexBasis: 0, background: 'oklch(0.68 0.13 150)' }} />
          <span style={{ flexGrow: unsure, flexBasis: 0, background: 'oklch(0.78 0.13 78)' }} />
          <span style={{ flexGrow: notCounted, flexBasis: 0, background: 'oklch(1 0 0 / 0.12)' }} />
        </div>
        <div className="mh-event-foot">
          <span>{participantCount} katılımcı</span>
          {showAmount && <span>Potansiyel gelir · ≈ {fmtTL(event.potentialAmount)}</span>}
        </div>
      </div>
    </button>
  );
}

function EventHeroEmpty({ onOpen }) {
  return (
    <button type="button" className="mh-event-empty" onClick={() => onOpen()}>
      <Icon.Calendar width="22" height="22" aria-hidden="true" />
      <span className="mh-event-empty-title">Yaklaşan etkinlik yok</span>
      <span>Etkinlik oluşturmak için dokunun</span>
    </button>
  );
}

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
 * "B Temel" mobil ana sayfa üst kısmı — başlık + hero (son 30 gün tahsilat) + iki pill.
 * Bugünün dersleri ayrı bir bileşendir (MobileAgenda). Veri MobileHome'dan gelir.
 */
function HeroScroller({ slideCount, children }) {
  if (slideCount <= 1) return children;

  return (
    <div className="mh-hero-scroll">
      {React.Children.map(children, (child) => <div className="mh-hero-slide">{child}</div>)}
    </div>
  );
}

export function MobileHomeView({
  dateLabel, headline, user, onLogout, onOpenFinance, onOpenOccupancy, onOpenOrders, onOpenNotes,
  collected = 0, revenue = 0, collectionRate = 0,
  receivable = 0, debtorCount = 0,
  occupancy = 0, plannedLessons = 0, capacity = null,
  kpiLoading = false,
  ordersPending = 0, ordersUrgent = 0,
  canSeeFinance = true, canSeeOrders = true,
  event = null, onOpenEvent,
}) {
  const barWidth = Math.max(0, Math.min(100, collectionRate));
  const occupancyTag = capacity != null
    ? `${plannedLessons}/${capacity} ders`
    : `${plannedLessons} ders`;
  const kpiDim = kpiLoading ? ' is-loading' : '';
  const eventSlide = event
    ? <EventHeroCard event={event} onOpen={onOpenEvent} showAmount={canSeeFinance} />
    : <EventHeroEmpty onOpen={onOpenEvent} />;
  // Etkinlik kartı yalnızca yaklaşan/canlı bir etkinlik varken öne (1.
  // sıraya) geçer; yoksa veya yalnız geçmiş etkinlik varsa (event=null)
  // "son 30 gün tahsilat" hero'su öne alınır, etkinlik 2. sıraya düşer.
  const eventFirst = Boolean(event);

  return (
    <div className="mobile-home mh-wrap">
      <div className="mh-head">
        <div>
          <p className="mh-date">{dateLabel}</p>
          <h1 className="mh-hi">{headline}</h1>
        </div>
        <ProfileMenu user={user} onLogout={onLogout} />
      </div>

      {!canSeeFinance && eventSlide}

      {canSeeFinance && (() => {
        const heroInner = (
          <>
            <div className="mh-hero-top">
              <div>
                <p className="mh-hero-label">Son 30 günde tahsil edilen</p>
                <p className="mh-hero-big">{kpiLoading ? '—' : fmtTL(collected)}</p>
              </div>
              {onOpenFinance && (
                <Icon.ChevronR className="mh-hero-chev" width="20" height="20" aria-hidden="true" />
              )}
            </div>
            <p className="mh-hero-sub">
              {kpiLoading
                ? '—'
                : `${fmtTL(revenue)} cironun %${collectionRate}'${percentSuffix(collectionRate)} tahsil edildi`}
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
        return (
          <HeroScroller slideCount={2}>
            {eventFirst ? eventSlide : financeSlide}
            {eventFirst ? financeSlide : eventSlide}
          </HeroScroller>
        );
      })()}

      <div className={`mh-pills${canSeeFinance ? '' : ' mh-pills-solo'}`}>
        {canSeeFinance && (
          <div className={`mh-pill warn${kpiDim}`}>
            <p className="mh-pill-label">Bekleyen tahsilat</p>
            <div className="mh-pill-val">{kpiLoading ? '—' : fmtTL(receivable)}</div>
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
        <button type="button" className="mod-tile" onClick={onOpenNotes}>
          <span className="mod-tile-icon">
            <Icon.Edit width="16" height="16" aria-hidden="true" />
          </span>
          <span className="mod-tile-body">
            <span className="mod-tile-title">Notlar</span>
            <span className="mod-tile-sub">Ekip notları</span>
          </span>
        </button>
      </div>
    </div>
  );
}

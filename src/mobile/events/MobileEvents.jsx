import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { getEvents } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';

// Menüden açılan giriş ekranı — Canvas-2'de doğrudan bir karşılığı yok
// ("Etkinlik oluştur" butonu 8a'ya gider" talimatına göre eklendi).

const STATUS_LABEL = { upcoming: 'Yaklaşıyor', live: 'Canlı', completed: 'Tamamlandı', cancelled: 'İptal' };

function EventListRow({ event, onOpen }) {
  const date = new Date(event.starts_at);
  return (
    <button type="button" className="evx-row" onClick={onOpen}>
      <span className="evx-row-body">
        <span className="evx-participant-name-row">
          <span className="evx-row-name">{event.name}</span>
          <span className={`evx-badge ${event.status === 'upcoming' ? 'tone-neutral' : 'tone-role-volunteer'}`}>{STATUS_LABEL[event.status]}</span>
        </span>
        <span className="evx-row-sub">
          {new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', year: 'numeric' }).format(date)}
          {' · '}{event.totalParticipants} kişi
        </span>
      </span>
      <span className="evx-row-chev">›</span>
    </button>
  );
}

export function MobileEvents({ onOpenEvent, onOpenCreate }) {
  const eventsQuery = useQuery({ queryKey: queryKeys.events(), queryFn: () => getEvents() });
  const events = eventsQuery.data ?? [];
  const active = events.filter((e) => e.status === 'upcoming' || e.status === 'live');
  const past = events.filter((e) => e.status === 'completed' || e.status === 'cancelled');

  return (
    <div className="evx" style={{ minHeight: '100%' }}>
      <div className="evx-body" style={{ paddingTop: 4 }}>
        <button type="button" className="evx-btn-primary evx-btn-accent" style={{ minHeight: 52 }} onClick={onOpenCreate}>
          <Icon.Plus width="17" height="17" /> Yeni etkinlik oluştur
        </button>

        {eventsQuery.isLoading && <p className="evx-hint">Yükleniyor…</p>}

        {!eventsQuery.isLoading && events.length === 0 && (
          <div className="evx-empty">
            <Icon.Calendar width="28" height="28" />
            <span className="evx-empty-title">Henüz etkinlik yok</span>
            <span className="evx-empty-sub">İlk etkinliğinizi oluşturmak için yukarıdaki butona dokunun.</span>
          </div>
        )}

        {active.length > 0 && (
          <div className="evx-section">
            <span className="evx-section-label">Yaklaşan</span>
            <ul className="evx-group-list">
              {active.map((e) => <li key={e.id}><EventListRow event={e} onOpen={() => onOpenEvent(e.id)} /></li>)}
            </ul>
          </div>
        )}

        {past.length > 0 && (
          <div className="evx-section">
            <span className="evx-section-label">Geçmiş</span>
            <ul className="evx-group-list">
              {past.map((e) => <li key={e.id}><EventListRow event={e} onOpen={() => onOpenEvent(e.id)} /></li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

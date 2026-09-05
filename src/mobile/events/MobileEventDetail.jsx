import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { fmtTL } from '../../data';
import { getEventById, getEventParticipants, getNotes, removeEventParticipant } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { SwipeToRemove } from './SwipeToRemove';

// Canvas-2 "5a" — Durum grupları, misafirler ağaç bağlantılı. "Finans" kartı
// (2d/2e canlı etkinlik günü ekranlarına bağlıydı) hâlâ pasif — o ekranlar
// Canvas-2 kapsamında değil. "Notlar" ise Canvas-2'nin 2d/2e'sinden FARKLI,
// ad hoc bir eklenti (bkz. MobileNotes.jsx): herkesin görebildiği paylaşılan
// not akışı, kullanıcı isteğiyle devreye alındı (migration 0268) ve sonradan
// etkinlikten koparıldı (0273) — bu kısayol artık stüdyo geneli tek not
// ekranını açar, ana sayfadaki "Notlar" kutusuyla aynı yeri. Eski
// "Arama listesi" kısayolu kaldırıldı (zaten aynı listenin "Belirsiz"
// filtresiyle aynı işi görüyordu) — yerine MobileEventSettings'e açılan
// "Etkinlik ayarları" kısayolu geldi.
//
// RSVP'de "Gelmiyor" bilinçli olarak yok: gelmeyecek kişi işaretlenmez,
// doğrudan listeden kaldırılır (satırı sola kaydırarak, bkz. handleRemove).
// "Gelmedi" (no-show) ayrı bir kavram — canlı etkinlik günü (deferred) için
// attendance_status'ta duruyor, rsvp_status ile karışmıyor.

const ROLE_LABEL = { regular: null, invited: 'DAVETLİ', volunteer: 'GÖNÜLLÜ' };
const ROLE_TONE = { invited: 'tone-role-invited', volunteer: 'tone-role-volunteer' };
const RSVP_DOT = { coming: 'oklch(0.5 0.08 145)', unsure: 'oklch(0.8 0.13 80)' };
const RSVP_LABEL = { coming: 'Geliyor', unsure: 'Belirsiz' };
const SECTIONS = [
  { status: 'coming', title: 'GELİYOR', color: 'var(--accent-ink)' },
  { status: 'unsure', title: 'BELİRSİZ', color: 'var(--amber-ink)' },
];

function initialsOf(name) {
  return (name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

// Satırın gövdesi etkinliğe özel katılımcı profiline açılır (bkz.
// MobileEventParticipantDetail — RSVP/rol değiştirme, ücret düzenleme, ödeme
// alma, not ve "kaldır" orada da var). Sola kaydırma profile gitmeden kaldırır.
function ParticipantRow({ participant, guestOfName, eventId, onOpen, swipeOpen, onSwipeOpenChange }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const due = Number(participant.total_due);
  const paid = Number(participant.total_paid);
  const remaining = Math.max(0, due - paid);
  const roleLabel = ROLE_LABEL[participant.role];
  const studioCovered = Number(participant.total_studio_covered || 0);
  const displayName = participant.student_nickname || participant.student_name;

  async function handleRemove() {
    if (busy) return;
    const sure = window.confirm(`"${displayName}" etkinlik listesinden kaldırılacak. Emin misiniz?`);
    if (!sure) return;
    setBusy(true);
    try {
      await removeEventParticipant(participant.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventById(eventId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() });
    } catch (err) {
      window.alert(err?.message || 'Katılımcı kaldırılamadı.');
      setBusy(false);
    }
  }

  return (
    <li>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {guestOfName && <span className="evx-tree-branch" aria-hidden="true" />}
        <SwipeToRemove label={displayName} open={swipeOpen} onOpenChange={onSwipeOpenChange}
          onOpen={() => onOpen(participant.id)} onRemove={handleRemove} busy={busy}>
            <span className="evx-avatar-wrap">
              <span className="evx-avatar">{initialsOf(participant.student_name)}</span>
              <span className="evx-avatar-dot" style={{ background: RSVP_DOT[participant.rsvp_status] }} />
            </span>
            <span className="evx-participant-row">
              <span className="evx-participant-name-row">
                <span className="evx-participant-name">{displayName}</span>
                {roleLabel && <span className={`evx-badge ${ROLE_TONE[participant.role]}`}>{roleLabel}</span>}
              </span>
              <span className="evx-row-sub">
                {guestOfName
                  ? `${guestOfName} · misafiri`
                  : due > 0
                    ? RSVP_LABEL[participant.rsvp_status]
                    : studioCovered > 0
                      ? 'Stüdyo karşılıyor'
                      : 'Ücretsiz'}
              </span>
            </span>
            {due > 0 && (
              <span className="evx-participant-amt" style={{ color: remaining > 0.001 ? 'oklch(0.5 0.18 30)' : 'var(--accent-ink)' }}>
                {remaining > 0.001 ? fmtTL(remaining) : 'Ödendi'}
              </span>
            )}
        </SwipeToRemove>
      </div>
    </li>
  );
}

export function MobileEventDetail({ eventId, onBack, onOpenAddPerson, onOpenTransport, onOpenSettings, onOpenParticipant, onOpenNotes }) {
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [openSwipeId, setOpenSwipeId] = React.useState(null);

  React.useEffect(() => { setOpenSwipeId(null); }, [eventId, search, filter]);

  const eventQuery = useQuery({ queryKey: queryKeys.eventById(eventId), queryFn: () => getEventById(eventId), enabled: !!eventId });
  const participantsQuery = useQuery({
    queryKey: queryKeys.eventParticipants(eventId),
    queryFn: () => getEventParticipants(eventId),
    enabled: !!eventId,
  });
  // Notlar rozeti için sayım — notlar artık etkinliğe özel değil, stüdyo geneli
  // tek bir akış (bkz. MobileNotes.jsx); bu kısayol da ana sayfadaki "Notlar"
  // kutusuyla aynı ekranı açar. MobileNotes açıldığında liste zaten sıcak
  // önbellekten gelir, ekstra bekleme olmaz.
  const notesQuery = useQuery({ queryKey: queryKeys.notes(), queryFn: getNotes });

  const event = eventQuery.data;
  const participants = participantsQuery.data ?? [];
  // Rozette yalnız üst seviye + silinmemiş notlar sayılır — yanıtlar ve
  // "silindi" placeholder'ına dönmüş notlar burada bir not gibi görünmez.
  const activeNoteCount = (notesQuery.data ?? []).filter((n) => !n.parent_note_id && !n.deleted_at).length;
  const guestNameByParticipantId = React.useMemo(() => {
    const map = new Map();
    for (const p of participants) map.set(p.id, p.student_nickname || p.student_name);
    return map;
  }, [participants]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = participants
      .filter((p) => {
        if (filter !== 'all' && p.rsvp_status !== filter) return false;
        if (!q) return true;
        return (p.student_name || '').toLowerCase().includes(q) || (p.student_nickname || '').toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const na = (a.student_nickname || a.student_name || '').toLocaleLowerCase('tr-TR');
        const nb = (b.student_nickname || b.student_name || '').toLocaleLowerCase('tr-TR');
        return na.localeCompare(nb, 'tr');
      });

    // Misafir satırı, host'u da bu (filtrelenmiş) listedeyse tam host'un
    // ardına taşınır (bkz. evx-tree-branch) — host farklı bir RSVP
    // durumundaysa (örn. host "Belirsiz", misafir "Geliyor") host bu listede
    // yoktur, o zaman misafir kendi adına göre normal sırada kalır.
    const idsInBase = new Set(base.map((p) => p.id));
    const guestsByHostId = new Map();
    const ordered = [];
    for (const p of base) {
      if (p.guest_of_participant_id && idsInBase.has(p.guest_of_participant_id)) {
        if (!guestsByHostId.has(p.guest_of_participant_id)) guestsByHostId.set(p.guest_of_participant_id, []);
        guestsByHostId.get(p.guest_of_participant_id).push(p);
      } else {
        ordered.push(p);
      }
    }
    const result = [];
    for (const p of ordered) {
      result.push(p);
      const guests = guestsByHostId.get(p.id);
      if (guests) result.push(...guests);
    }
    return result;
  }, [participants, search, filter]);

  const coming = participants.filter((p) => p.rsvp_status === 'coming').length;
  const unsure = participants.filter((p) => p.rsvp_status === 'unsure').length;

  if (eventQuery.isLoading) return <div className="evx"><div className="evx-body"><p>Yükleniyor…</p></div></div>;
  if (eventQuery.isError || !event) {
    return <div className="evx"><div className="evx-body"><p>Etkinlik alınamadı.</p><button type="button" className="evx-btn-secondary" onClick={onBack}>Geri</button></div></div>;
  }

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={onBack} title="Geri">
          <Icon.ChevronL width="22" height="22" />
        </button>
        <div className="evx-header-mid">
          <span className="evx-header-title">{event.name}</span>
          <span className="evx-header-sub">
            {new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(event.starts_at))}
            {' · '}{participants.length} öğrenci
          </span>
        </div>
      </header>

      <div className="evx-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 2px 2px' }}>
          <div className="evx-stat-row">
            <span className="evx-stat-num">{coming}</span>
            <span className="evx-stat-body">
              <span className="evx-stat-label">kişi geliyor</span>
              <span className="evx-stat-sub">{participants.length} öğrenciden</span>
            </span>
            <span style={{ flex: 1 }} />
            {unsure > 0 && <span className="evx-pill tone-amber">{unsure} yanıt bekleniyor</span>}
          </div>
          <div className="evx-segbar">
            <span style={{ flexGrow: coming, flexBasis: 0, background: 'oklch(0.5 0.08 145)' }} />
            <span style={{ flexGrow: unsure, flexBasis: 0, background: 'oklch(0.8 0.13 80)' }} />
          </div>
        </div>

        {/* Yalnız 3 buton bir seferde tam görünür (bkz. .evx-scroller.is-overflowing
            CSS'i) — 4. kısayol (Ulaşım açıkken) sola kaydırarak görülür. */}
        <div className={`evx-scroller${event.transport_enabled ? ' is-overflowing' : ''}`}>
          {event.transport_enabled && (
            <button type="button" className="evx-chip" onClick={onOpenTransport}>
              <Icon.Truck width="17" height="17" style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
              <span className="evx-chip-body">
                <span className="evx-chip-title">Ulaşım</span>
                <span className="evx-chip-sub">Araç planı</span>
              </span>
            </button>
          )}
          <button type="button" className="evx-chip" onClick={onOpenNotes}>
            <Icon.Edit width="17" height="17" style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
            <span className="evx-chip-body">
              <span className="evx-chip-title">Notlar</span>
              <span className="evx-chip-sub">{activeNoteCount > 0 ? `${activeNoteCount} not` : 'Ekle, paylaş'}</span>
            </span>
          </button>
          <button type="button" className="evx-chip" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
            <Icon.Wallet width="17" height="17" style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
            <span className="evx-chip-body">
              <span className="evx-chip-title">Finans</span>
              <span className="evx-chip-sub">Yakında</span>
            </span>
          </button>
          <button type="button" className="evx-chip" onClick={onOpenSettings}>
            <Icon.Settings width="17" height="17" style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
            <span className="evx-chip-body">
              <span className="evx-chip-title">Ayarlar</span>
              <span className="evx-chip-sub">Bilgiler, durum</span>
            </span>
          </button>
        </div>

        <div className="evx-toggle-row" style={{ minHeight: 44 }}>
          <Icon.Search width="17" height="17" style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Öğrenci ara…"
            style={{ border: 0, background: 'none', outline: 'none', flex: 1, fontSize: 14, color: 'var(--ink)' }}
          />
        </div>

        <div className="evx-scroller">
          {[['all', 'Tümü'], ['coming', 'Geliyor'], ['unsure', 'Belirsiz']].map(([id, label]) => (
            <button key={id} type="button" className={`evx-filter-chip${filter === id ? ' is-on' : ''}`} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>

        {participantsQuery.isLoading && <p className="evx-hint">Katılımcılar yükleniyor…</p>}

        {!participantsQuery.isLoading && filtered.length === 0 && (
          <div className="evx-empty">
            <Icon.Users width="28" height="28" />
            <span className="evx-empty-title">Kimse yok</span>
            <span className="evx-empty-sub">Filtreyi değiştirin veya "Ekle" ile katılımcı ekleyin.</span>
          </div>
        )}

        {SECTIONS.map((sec) => {
          const rows = filtered.filter((p) => p.rsvp_status === sec.status);
          if (rows.length === 0) return null;
          return (
            <div className="evx-section" key={sec.status}>
              <div className="evx-group-head">
                <span className="evx-group-title" style={{ color: sec.color }}>{sec.title}</span>
                <span className="evx-group-count">{rows.length}</span>
                <span className="evx-group-line" />
              </div>
              <ul className="evx-group-list">
                {rows.map((p) => (
                  <ParticipantRow
                    key={p.id}
                    participant={p}
                    eventId={eventId}
                    guestOfName={p.guest_of_participant_id ? guestNameByParticipantId.get(p.guest_of_participant_id) : null}
                    onOpen={onOpenParticipant}
                    swipeOpen={openSwipeId === p.id}
                    onSwipeOpenChange={(open) => setOpenSwipeId((current) => open ? p.id : current === p.id ? null : current)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="evx-footer">
        <div className="evx-footer-row">
          <button type="button" className="evx-btn-secondary" onClick={onOpenAddPerson}>
            <Icon.Plus width="16" height="16" />
            Ekle
          </button>
          <button type="button" className="evx-btn-primary" disabled title="Etkinlik günü modu yakında">
            <Icon.Clock width="17" height="17" />
            Etkinlik gününü başlat
          </button>
        </div>
      </div>
    </div>
  );
}

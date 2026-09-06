import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { fmtTL } from '../../data';
import {
  getEventById,
  getEventParticipants,
  getNotes,
  markEventParticipantContacted,
  removeEventParticipant,
} from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { useCan } from '../../currentUser';
import { EventParticipantActionSheet } from './EventParticipantActionSheet';
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
// "Etkinlik ayarları" kısayolu geldi. "Hareketler" (Notlar ile Finans arası)
// bu etkinlikte kimin ne yaptığını gösterir ve hatalı işlemi geri aldırır
// (bkz. MobileEventActivity); tahsilat tutarı içerdiği için asistana kapalı.
//
// RSVP'de "Gelmiyor" bilinçli olarak yok: gelmeyecek kişi işaretlenmez,
// doğrudan listeden kaldırılır (satırı sola kaydırarak, bkz. handleRemove).
// "Gelmedi" (no-show) ayrı bir kavram — canlı etkinlik günü (deferred) için
// attendance_status'ta duruyor, rsvp_status ile karışmıyor.

const ROLE_LABEL = { regular: null, invited: 'DAVETLİ', volunteer: 'GÖNÜLLÜ' };
const ROLE_TONE = { invited: 'tone-role-invited', volunteer: 'tone-role-volunteer' };
const RSVP_DOT = { coming: 'oklch(0.5 0.08 145)', unsure: 'oklch(0.8 0.13 80)' };
const RSVP_LABEL = { coming: 'Geliyor', unsure: 'Belirsiz' };

function initialsOf(name) {
  return (name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

// Satırın gövdesi etkinliğe özel katılımcı profiline açılır (bkz.
// MobileEventParticipantDetail — RSVP/rol değiştirme, ücret düzenleme, ödeme
// alma, not ve "kaldır" orada da var). Sola kaydırma kaldırma, sağa
// kaydırma arama kaydı formunu profile gitmeden açar.
function ParticipantRow({ participant, guestOfName, onOpen, swipeSide, onSwipeSideChange, onAction, busy }) {
  const roleLabel = ROLE_LABEL[participant.role];
  const displayName = participant.student_nickname
    ? `${participant.student_name} "${participant.student_nickname}"`
    : participant.student_name;
  const contactCount = Number(participant.contact_count || (participant.last_contacted_at ? 1 : 0));
  const paidAmount = Number(participant.total_paid || 0);
  const dueAmount = Number(participant.total_due || 0);
  const isFullyPaid = paidAmount > 0.001 && paidAmount + 0.001 >= dueAmount;
  const secondaryLabel = guestOfName
    ? `${guestOfName} · misafiri`
    : null;

  return (
    <li>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {guestOfName && <span className="evx-tree-branch" aria-hidden="true" />}
        <SwipeToRemove label={displayName} openSide={swipeSide} onOpenSideChange={onSwipeSideChange}
          onOpen={() => onOpen?.(participant.id)}
          onRemove={() => onAction('remove', participant)}
          onContact={() => onAction('contact', participant)}
          busy={busy}>
            <span className="evx-avatar-wrap">
              <span className="evx-avatar">{initialsOf(participant.student_name)}</span>
              <span className="evx-avatar-dot" style={{ background: RSVP_DOT[participant.rsvp_status] }} />
            </span>
            <span className="evx-participant-row">
              <span className="evx-participant-name-row">
                <span className="evx-participant-name">
                  {participant.student_name}
                  {participant.student_nickname && (
                    <span className="mobile-tri-row-nick">"{participant.student_nickname}"</span>
                  )}
                </span>
                {participant.is_new_student && (
                  <span className="evx-badge tone-new-student evx-badge-sm">
                    <Icon.Sparkle width="8" height="8" aria-hidden="true" />
                    YENİ
                  </span>
                )}
                {roleLabel && <span className={`evx-badge ${ROLE_TONE[participant.role]}`}>{roleLabel}</span>}
              </span>
              {(secondaryLabel || contactCount > 0 || paidAmount > 0.001) && (
                <span className="evx-participant-meta-row">
                  {secondaryLabel && <span className="evx-row-sub">{secondaryLabel}</span>}
                {contactCount > 0 && (
                  <span className="evx-called-badge" aria-label={`${contactCount} kez arandı`}>
                    <Icon.Phone width="10" height="10" aria-hidden="true" />
                    <span>ARANDI</span>
                    <span aria-hidden="true">· {contactCount}</span>
                  </span>
                )}
                {paidAmount > 0.001 && (
                  <span className={`evx-called-badge ${isFullyPaid ? 'tone-paid' : 'tone-partial-paid'}`} aria-label={`${fmtTL(paidAmount)} ödeme yaptı`}>
                    {isFullyPaid && <Icon.Check width="10" height="10" aria-hidden="true" />}
                    <span>ÖDEME YAPTI</span>
                    <span aria-hidden="true">· {fmtTL(paidAmount)}</span>
                  </span>
                )}
                </span>
              )}
            </span>
            <span className={`evx-participant-status tone-${participant.rsvp_status}`}>
              <span className="evx-participant-status-dot" aria-hidden="true" />
              {RSVP_LABEL[participant.rsvp_status] || 'Durum yok'}
            </span>
        </SwipeToRemove>
      </div>
    </li>
  );
}

export function MobileEventDetail({ eventId, onBack, onOpenAddPerson, onOpenTransport, onOpenSettings, onOpenParticipant, onOpenNotes, onOpenActivity }) {
  const queryClient = useQueryClient();
  // "Hareketler" tahsilat tutarlarını da gösterir; asistan rolüne kapalı
  // (backend requireCan('audit.read')). Gizleme kozmetik, güvenlik sunucuda.
  const canSeeActivity = useCan('audit.read');
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState('all');
  const [openSwipe, setOpenSwipe] = React.useState(null);
  const [actionState, setActionState] = React.useState(null);
  const [actionBusy, setActionBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState('');

  React.useEffect(() => { setOpenSwipe(null); }, [eventId, search, filter]);

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

  function openParticipantAction(action, participant) {
    setOpenSwipe(null);
    setActionError('');
    setActionState({ action, participant });
  }

  function closeParticipantAction() {
    if (actionBusy) return;
    setActionState(null);
    setActionError('');
  }

  async function submitParticipantAction(input) {
    if (!actionState || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    try {
      if (actionState.action === 'remove') {
        await removeEventParticipant(actionState.participant.id, input);
      } else {
        await markEventParticipantContacted(actionState.participant.id, input);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.eventById(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() }),
      ]);
      setActionState(null);
    } catch (err) {
      setActionError(err?.message || (actionState.action === 'remove'
        ? 'Katılımcı kaldırılamadı.'
        : 'Arama bilgisi kaydedilemedi.'));
    } finally {
      setActionBusy(false);
    }
  }

  const event = eventQuery.data;
  const participants = participantsQuery.data ?? [];
  // Rozette yalnız üst seviye + silinmemiş notlar sayılır — yanıtlar ve
  // "silindi" placeholder'ına dönmüş notlar burada bir not gibi görünmez.
  const activeNoteCount = (notesQuery.data ?? []).filter((n) => !n.parent_note_id && !n.deleted_at).length;
  const participantsById = React.useMemo(() => {
    const map = new Map();
    for (const p of participants) map.set(p.id, p);
    return map;
  }, [participants]);
  // Kaldırma panelinde misafiri olan katılımcı için "bağlantıları kopart" /
  // "misafirleri de kaldır" seçimi sunulur (bkz. EventParticipantActionSheet) —
  // liste zaten sıcak önbellekte olduğundan ayrı bir istek gerekmez.
  const actionGuests = React.useMemo(() => {
    if (actionState?.action !== 'remove') return [];
    return participants.filter((p) => String(p.guest_of_participant_id) === String(actionState.participant.id));
  }, [actionState, participants]);

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

    // "Geliyor"/"Belirsiz" filtresi açıkken misafirler host'un altına dar bir
    // dal ile taşınmaz: host farklı bir RSVP durumundaysa (örn. host
    // "Belirsiz", misafir "Geliyor") bu, misafiri hatalı biçimde dar/alt
    // gösterirdi. Filtre "Tümü" değilken herkes normal öğrenci gibi düz,
    // alfabetik sırada kalır.
    if (filter !== 'all') return base;

    // "Tümü" görünümünde misafir satırı, host'u da listedeyse RSVP durumu
    // farklı olsa bile tam host'un ardına taşınır (bkz. evx-tree-branch) —
    // bağlantı burada her zaman görünür kalmalı. Bu ekran karışık statüleri
    // zaten tek listede gösterdiği için host farklı statüdeyse bile bulunabilir;
    // sorunlu olan yalnız "Geliyor"/"Belirsiz" filtreleriydi (yukarıda ele alındı).
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
  // Katılımcı isteği yüklenirken veya hata verdiğinde gerçek etkinlik
  // özetini kullan. Bir API hatasını "0 öğrenci" gibi göstermek veri kaybı
  // izlenimi yaratır.
  const visibleComing = participantsQuery.isSuccess ? coming : Number(event?.coming ?? 0);
  const visibleUnsure = participantsQuery.isSuccess ? unsure : Number(event?.unsure ?? 0);
  const visibleParticipantCount = participantsQuery.isSuccess
    ? participants.length
    : Number(event?.totalParticipants ?? 0);

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
            {' · '}{visibleParticipantCount} öğrenci
          </span>
        </div>
      </header>

      <div className="evx-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 2px 2px' }}>
          <div className="evx-stat-row">
            <span className="evx-stat-num">{visibleComing}</span>
            <span className="evx-stat-body">
              <span className="evx-stat-label">kişi geliyor</span>
              <span className="evx-stat-sub">{visibleParticipantCount} öğrenciden</span>
            </span>
            <span style={{ flex: 1 }} />
            {visibleUnsure > 0 && <span className="evx-pill tone-amber">{visibleUnsure} yanıt bekleniyor</span>}
          </div>
          <div className="evx-segbar">
            <span style={{ flexGrow: visibleComing, flexBasis: 0, background: 'oklch(0.5 0.08 145)' }} />
            <span style={{ flexGrow: visibleUnsure, flexBasis: 0, background: 'oklch(0.8 0.13 80)' }} />
          </div>
        </div>

        {/* Kısayol sayısı artık her hâlükârda 3'ü aşıyor (Notlar · Hareketler ·
            Finans · Ayarlar, Ulaşım açıksa 5). Satır bu yüzden DAİMA
            "is-overflowing": çipler sabit genişlikte kalır — yeni kısayol
            eskilerini daraltmaz — yalnız 3'ü tam görünür, gerisi sola
            kaydırılarak açılır. */}
        <div className="evx-scroller is-overflowing">
          {event.transport_enabled && (
            <button type="button" className="evx-chip" onClick={onOpenTransport}>
              <Icon.Car width="17" height="17" style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
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
          {canSeeActivity && (
            <button type="button" className="evx-chip" onClick={onOpenActivity}>
              <Icon.Repeat width="17" height="17" style={{ color: 'var(--ink-2)', flexShrink: 0 }} />
              <span className="evx-chip-body">
                <span className="evx-chip-title">Hareketler</span>
                <span className="evx-chip-sub">Kim ne yaptı</span>
              </span>
            </button>
          )}
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

        {participantsQuery.isError && (
          <div className="evx-empty evx-participant-error" role="alert">
            <Icon.Repeat width="28" height="28" />
            <span className="evx-empty-title">Katılımcılar gösterilemiyor</span>
            <span className="evx-empty-sub">Kayıtlarınız korunuyor. Bağlantıyı kontrol edip yeniden deneyin.</span>
            <button type="button" className="evx-btn-secondary" disabled={participantsQuery.isFetching} onClick={() => participantsQuery.refetch()}>
              {participantsQuery.isFetching ? 'Yeniden deneniyor…' : 'Yeniden dene'}
            </button>
          </div>
        )}

        {participantsQuery.isSuccess && filtered.length === 0 && (
          <div className="evx-empty">
            <Icon.Users width="28" height="28" />
            <span className="evx-empty-title">Kimse yok</span>
            <span className="evx-empty-sub">Filtreyi değiştirin veya "Ekle" ile katılımcı ekleyin.</span>
          </div>
        )}

        {filtered.length > 0 && (
          <ul className="evx-group-list">
            {filtered.map((p) => {
              const host = p.guest_of_participant_id ? participantsById.get(p.guest_of_participant_id) : null;
              const guestOfName = filter === 'all' && host
                ? (host.student_nickname || host.student_name)
                : null;
              return (
                <ParticipantRow
                  key={p.id}
                  participant={p}
                  guestOfName={guestOfName}
                  onOpen={onOpenParticipant}
                  swipeSide={openSwipe?.id === p.id ? openSwipe.side : null}
                  onSwipeSideChange={(side) => setOpenSwipe((current) => side
                    ? { id: p.id, side }
                    : current?.id === p.id ? null : current)}
                  onAction={openParticipantAction}
                  busy={actionBusy && actionState?.participant.id === p.id}
                />
              );
            })}
          </ul>
        )}
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

      <EventParticipantActionSheet
        participant={actionState?.participant ?? null}
        action={actionState?.action ?? null}
        guests={actionGuests}
        busy={actionBusy}
        error={actionError}
        onClose={closeParticipantAction}
        onSubmit={submitParticipantAction}
      />
    </div>
  );
}

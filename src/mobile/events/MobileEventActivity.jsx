import React from 'react';
import { Drawer } from 'vaul';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { fmtTL } from '../../data';
import { getEventActivity, getEventById, revertEventActivity } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';

// "Hareketler" — etkinlik detayındaki üçüncü kısayol (Notlar ile Finans arası).
// Bu etkinlikte kimin ne yaptığını sırayla gösterir ve hatalı bir işlemi geri
// aldırır. Kaynak ayrı bir tablo DEĞİL: audit_logs'un etkinliğe bağlı satırları
// (bkz. backend 0279_event_activity.sql) — yani buradaki liste, sistemin zaten
// tuttuğu denetim kaydının etkinliğe göre okunmuş hâlidir.
//
// Geri alma silmez: sunucu telafi işlemini normal servis yolundan yapar (aynı
// doğrulamalar, kendi hareket kaydı) ve orijinal satır "geri alındı" damgası
// alır. Bu yüzden akışta hem hata hem düzeltmesi görünür kalır.
//
// Ekran finansal tutar (tahsilat) içerdiğinden asistan rolüne kapalıdır —
// kısayol MobileEventDetail'de `audit.read` yetkisiyle gizlenir, gerçek koruma
// sunucuda requireCan('audit.read').

const RSVP_LABEL = { coming: 'Geliyor', unsure: 'Belirsiz' };
const ROLE_LABEL = { regular: 'Katılımcı', invited: 'Davetli', volunteer: 'Gönüllü' };
const ATTENDANCE_LABEL = { pending: 'Bekliyor', arrived: 'Geldi', no_show: 'Gelmedi' };
const TRANSPORT_LABEL = {
  needs_vehicle: 'Araç gerekiyor',
  self_arranged: 'Kendi geliyor',
  unspecified: 'Belirsiz',
};
const COVERAGE_LABEL = {
  student: 'Öğrenci öder',
  studio: 'Stüdyo karşılar',
  comp: 'Ücretsiz kontenjan',
  external: 'Kendi öder',
  none: 'Almıyor',
};
const REMOVAL_REASON_LABEL = {
  student_cancelled: 'Öğrenci iptal etti',
  plans_changed: 'Planı değişti',
  added_by_mistake: 'Yanlışlıkla eklendi',
  other: 'Diğer',
};
const SOURCE_LABEL = { cash: 'Nakit', iban: 'IBAN' };
const EVENT_STATUS_LABEL = {
  upcoming: 'Yaklaşıyor',
  live: 'Canlı',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

const dayFormat = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long',
});
const timeFormat = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit',
});
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' });

function dayKeyOf(value) {
  return dayKeyFormat.format(new Date(value));
}

function dayLabelOf(value) {
  const key = dayKeyOf(value);
  const today = dayKeyOf(Date.now());
  if (key === today) return 'BUGÜN';
  const yesterday = dayKeyOf(Date.now() - 86400000);
  if (key === yesterday) return 'DÜN';
  return dayFormat.format(new Date(value)).toLocaleUpperCase('tr-TR');
}

function personOf(row) {
  return row.subject_nickname || row.subject_name || 'Bir kişi';
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function labelled(dict, value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  return dict[value] ?? String(value);
}

// Katılımcı güncellemesinde yalnız gerçekten gönderilen alanlar karşılaştırılır
// (backend `before`'ı input ile aynı alan kümesiyle yazar, bkz.
// participantUpdateSnapshot) — "değişmedi" satırı üretilmez.
const PARTICIPANT_FIELDS = [
  ['rsvpStatus', 'Durum', (v) => labelled(RSVP_LABEL, v)],
  ['role', 'Rol', (v) => labelled(ROLE_LABEL, v)],
  ['attendanceStatus', 'Katılım', (v) => labelled(ATTENDANCE_LABEL, v)],
  ['transportMode', 'Ulaşım', (v) => labelled(TRANSPORT_LABEL, v)],
  ['note', 'Not', (v) => (v ? String(v) : 'boş')],
];

const EVENT_FIELDS = [
  ['name', 'Ad', (v) => (v ? String(v) : '—')],
  ['starts_at', 'Tarih', (v) => (v ? dayFormat.format(new Date(v)) + ' · ' + timeFormat.format(new Date(v)) : '—')],
  ['location', 'Yer', (v) => (v ? String(v) : 'boş')],
  ['status', 'Durum', (v) => labelled(EVENT_STATUS_LABEL, v)],
  ['capacity_limit', 'Kontenjan', (v) => (v == null ? 'sınırsız' : String(v))],
  ['note', 'Not', (v) => (v ? String(v) : 'boş')],
];

function diffLines(fields, before, after) {
  const lines = [];
  for (const [key, label, format] of fields) {
    if (!(key in after)) continue;
    const from = before[key];
    const to = after[key];
    if (String(from ?? '') === String(to ?? '')) continue;
    lines.push(`${label}: ${format(from)} → ${format(to)}`);
  }
  return lines;
}

// Ham denetim kaydını okunur Türkçeye çevirir. Yalnız gösterim — geri almanın
// neyi yapacağına backend karar verir (revertable / revert_blocked_reason).
export function describeActivity(row) {
  const before = asRecord(row.before);
  const after = asRecord(row.after);
  const who = personOf(row);
  const vehicle = row.vehicle_label ? ` · ${row.vehicle_label}` : '';

  switch (row.action) {
    case 'event_created':
      return { icon: 'Plus', tone: 'is-add', title: 'Etkinlik oluşturuldu', detail: after.name ? String(after.name) : '' };
    case 'event_updated': {
      const lines = diffLines(EVENT_FIELDS, before, after);
      return {
        icon: 'Settings', tone: '', title: 'Etkinlik bilgileri güncellendi',
        detail: lines.join('\n') || 'Ayrıntı kaydedilmemiş.',
      };
    }
    case 'event_deleted':
      return { icon: 'Trash', tone: 'is-danger', title: 'Etkinlik silindi', detail: '' };
    case 'event_fee_item_created':
      return {
        icon: 'Tag', tone: 'is-add', title: 'Ücret kalemi eklendi',
        detail: [after.label, after.amount != null ? fmtTL(Number(after.amount)) : null].filter(Boolean).join(' · '),
      };
    case 'event_participant_added':
      return {
        icon: 'Users', tone: 'is-add', title: `${who} listeye eklendi`,
        detail: [labelled(ROLE_LABEL, after.role), labelled(RSVP_LABEL, after.rsvpStatus)].join(' · '),
      };
    case 'event_participant_updated': {
      const lines = diffLines(PARTICIPANT_FIELDS, before, after);
      return {
        icon: 'Edit', tone: '', title: `${who} güncellendi`,
        detail: lines.join('\n') || 'Ayrıntı kaydedilmemiş.',
      };
    }
    case 'event_participant_contacted':
      return {
        icon: 'Phone', tone: '', title: `${who} arandı`,
        detail: after.note ? String(after.note) : 'Not bırakılmadı.',
      };
    case 'event_participant_contact_reverted':
      return { icon: 'Repeat', tone: '', title: `${who} için arama kaydı geri alındı`, detail: '' };
    case 'event_participant_removed':
      return {
        icon: 'Users', tone: 'is-danger', title: `${who} listeden kaldırıldı`,
        detail: [
          before.removalReason ? labelled(REMOVAL_REASON_LABEL, before.removalReason) : null,
          before.removalNote ? String(before.removalNote) : null,
        ].filter(Boolean).join(' · ') || 'Neden belirtilmemiş.',
      };
    case 'event_participant_guest_unlinked':
      return {
        icon: 'Users', tone: '', title: `${who} artık bağımsız katılımcı`,
        detail: 'Misafirlik bağlantısı, ev sahibi kaldırılırken koparıldı.',
      };
    case 'event_participant_fee_updated':
      return {
        icon: 'Tag', tone: '', title: `${who} · ücret kalemi değişti`,
        detail: `Kim öder: ${labelled(COVERAGE_LABEL, before.coverage)} → ${labelled(COVERAGE_LABEL, after.coverage)}`
          + (String(before.amount ?? '') !== String(after.amount ?? '')
            ? `\nTutar: ${fmtTL(Number(before.amount || 0))} → ${fmtTL(Number(after.amount || 0))}`
            : ''),
      };
    case 'event_participant_payment_recorded':
      return {
        icon: 'Wallet', tone: 'is-money',
        title: `${who} · ${fmtTL(Number(after.amount || 0))} tahsil edildi`,
        detail: labelled(SOURCE_LABEL, after.source, 'Nakit'),
      };
    case 'event_participant_payment_cancelled':
      return {
        icon: 'Wallet', tone: 'is-danger',
        title: `${who} · ${fmtTL(Number(before.amount || 0))} tahsilat iptal edildi`,
        detail: row.note ? String(row.note) : '',
      };
    case 'event_participant_vehicle_assigned':
      return { icon: 'Car', tone: '', title: `${who} araca bindirildi`, detail: '' };
    case 'event_participant_vehicle_unassigned':
      return { icon: 'Car', tone: '', title: `${who} araçtan çıkarıldı`, detail: '' };
    case 'event_vehicle_created':
      return { icon: 'Car', tone: 'is-add', title: `Araç eklendi${vehicle}`, detail: '' };
    case 'event_vehicle_updated':
      return { icon: 'Car', tone: '', title: `Araç güncellendi${vehicle}`, detail: '' };
    case 'event_vehicle_deleted':
      return { icon: 'Car', tone: 'is-danger', title: `Araç silindi${vehicle}`, detail: '' };
    default:
      return { icon: 'Edit', tone: '', title: row.action, detail: '' };
  }
}

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function ActivityRow({ row, onSelect }) {
  const info = describeActivity(row);
  const IconComp = Icon[info.icon] || Icon.Edit;
  const reverted = Boolean(row.reverted_at);

  return (
    <li>
      <button
        type="button"
        className={`evx-act-row${reverted ? ' is-reverted' : ''}`}
        onClick={() => onSelect(row)}
      >
        <span className={`evx-act-icon ${info.tone}`} aria-hidden="true">
          <IconComp width="15" height="15" />
        </span>
        <span className="evx-act-body">
          <span className="evx-act-title">{info.title}</span>
          <span className="evx-act-meta">
            <span className="evx-act-actor">{row.actor_name || 'Bilinmeyen kullanıcı'}</span>
            <span aria-hidden="true">·</span>
            <span>{timeFormat.format(new Date(row.created_at))}</span>
          </span>
        </span>
        {reverted ? (
          <span className="evx-badge tone-reverted">GERİ ALINDI</span>
        ) : row.revertable ? (
          <span className="evx-act-undo" aria-label="Geri alınabilir">
            <Icon.Repeat width="13" height="13" aria-hidden="true" />
          </span>
        ) : null}
      </button>
    </li>
  );
}

function ActivityDetailSheet({ row, busy, error, onClose, onRevert, onOpenParticipant }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  const info = row ? describeActivity(row) : null;
  const reverted = Boolean(row?.reverted_at);

  return (
    <Drawer.Root
      open={Boolean(row)}
      onOpenChange={(next) => { if (!next && !busy) onClose(); }}
      dismissible={!busy}
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-lsheet-overlay" />
        <Drawer.Content className="mobile-lsheet-content mobile-lsheet-content-plan evx-participant-action-sheet">
          <Drawer.Handle className="mobile-lsheet-handle" />
          {row && info && (
            <>
              <header className="evx-action-sheet-header">
                <span className="evx-action-sheet-icon is-contact" aria-hidden="true">
                  {React.createElement(Icon[info.icon] || Icon.Edit, { width: 20, height: 20 })}
                </span>
                <div>
                  <Drawer.Title className="evx-action-sheet-title">{info.title}</Drawer.Title>
                  <Drawer.Description className="evx-action-sheet-description">
                    {row.actor_name || 'Bilinmeyen kullanıcı'}
                    {' · '}
                    {dayFormat.format(new Date(row.created_at))}
                    {' '}
                    {timeFormat.format(new Date(row.created_at))}
                  </Drawer.Description>
                </div>
              </header>

              <div className="evx-action-sheet-body">
                {info.detail && <p className="evx-act-detail">{info.detail}</p>}

                {reverted && (
                  <div className="evx-act-reverted-note">
                    Bu işlem {row.reverted_by_name || 'bir kullanıcı'} tarafından geri alındı
                    {' · '}
                    {dayFormat.format(new Date(row.reverted_at))}
                    {' '}
                    {timeFormat.format(new Date(row.reverted_at))}
                  </div>
                )}

                {!reverted && !row.revertable && row.revert_blocked_reason && (
                  <div className="evx-act-blocked">{row.revert_blocked_reason}</div>
                )}

                {row.revertable && (
                  <p className="evx-hint">
                    Geri alma kaydı silmez: telafi işlemi yeni bir hareket olarak yazılır ve
                    bu satır “geri alındı” olarak işaretlenir.
                  </p>
                )}

                {error && <div className="evx-action-sheet-error" role="alert">{error}</div>}
              </div>

              <footer className="evx-action-sheet-footer">
                {row.participant_id ? (
                  <button
                    type="button"
                    className="evx-action-cancel"
                    disabled={busy}
                    onClick={() => onOpenParticipant(row.participant_id)}
                  >
                    Kişiyi aç
                  </button>
                ) : (
                  <button type="button" className="evx-action-cancel" onClick={onClose} disabled={busy}>
                    Kapat
                  </button>
                )}
                <button
                  type="button"
                  className="evx-action-submit is-danger"
                  disabled={busy || !row.revertable}
                  onClick={() => onRevert(row)}
                >
                  {busy ? 'Geri alınıyor…' : <><Icon.Repeat width="16" height="16" aria-hidden="true" /> Geri al</>}
                </button>
              </footer>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function MobileEventActivity({ eventId, onBack, onOpenParticipant }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  // Başlıktaki etkinlik adı için; detay ekranından gelindiği için önbellek
  // zaten sıcak, ekstra bekleme olmaz.
  const eventQuery = useQuery({
    queryKey: queryKeys.eventById(eventId),
    queryFn: () => getEventById(eventId),
    enabled: !!eventId,
  });
  const activityQuery = useQuery({
    queryKey: queryKeys.eventActivity(eventId),
    queryFn: () => getEventActivity(eventId),
    enabled: !!eventId,
  });

  const rows = activityQuery.data ?? [];
  // Sheet, listedeki güncel satırı okur — geri alma sonrası aynı kayıt "geri
  // alındı" damgasıyla yerinde tazelenir, ayrı bir kopya tutulmaz.
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const groups = React.useMemo(() => {
    const result = [];
    for (const row of rows) {
      const key = dayKeyOf(row.created_at);
      const last = result[result.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else result.push({ key, label: dayLabelOf(row.created_at), rows: [row] });
    }
    return result;
  }, [rows]);

  async function handleRevert(row) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await revertEventActivity(eventId, row.id);
      // Telafi işlemi katılımcı, araç, ücret ve tahsilat verisinin herhangi
      // birine dokunmuş olabilir; etkinliğe bağlı her şeyi tazele.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.eventById(eventId) }),
        queryClient.invalidateQueries({ queryKey: ['eventParticipant'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.events() }),
      ]);
    } catch (err) {
      setError(err?.message || 'Hareket geri alınamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={onBack} title="Geri">
          <Icon.ChevronL width="22" height="22" />
        </button>
        <div className="evx-header-mid">
          <span className="evx-header-title">Hareketler</span>
          <span className="evx-header-sub">{eventQuery.data?.name || 'Etkinlik geçmişi'}</span>
        </div>
      </header>

      <div className="evx-body">
        {activityQuery.isLoading && <p className="evx-hint">Hareketler yükleniyor…</p>}

        {activityQuery.isError && (
          <div className="evx-empty evx-participant-error" role="alert">
            <Icon.Repeat width="28" height="28" />
            <span className="evx-empty-title">Hareketler gösterilemiyor</span>
            <span className="evx-empty-sub">Bağlantıyı kontrol edip yeniden deneyin.</span>
            <button type="button" className="evx-btn-secondary" disabled={activityQuery.isFetching}
              onClick={() => activityQuery.refetch()}>
              {activityQuery.isFetching ? 'Yeniden deneniyor…' : 'Yeniden dene'}
            </button>
          </div>
        )}

        {activityQuery.isSuccess && rows.length === 0 && (
          <div className="evx-empty">
            <Icon.Clock width="28" height="28" />
            <span className="evx-empty-title">Henüz hareket yok</span>
            <span className="evx-empty-sub">Bu etkinlikte yapılan her işlem burada, kim yaptıysa adıyla görünür.</span>
          </div>
        )}

        {groups.map((group) => (
          <div className="evx-section" key={group.key}>
            <div className="evx-group-head">
              <span className="evx-group-title" style={{ color: 'var(--ink-3)' }}>{group.label}</span>
              <span className="evx-group-count">{group.rows.length}</span>
              <span className="evx-group-line" />
            </div>
            <ul className="evx-act-list">
              {group.rows.map((row) => (
                <ActivityRow key={row.id} row={row} onSelect={(next) => { setError(''); setSelectedId(next.id); }} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <ActivityDetailSheet
        row={selected}
        busy={busy}
        error={error}
        onClose={() => { setSelectedId(null); setError(''); }}
        onRevert={handleRevert}
        onOpenParticipant={(participantId) => { setSelectedId(null); onOpenParticipant?.(participantId); }}
      />
    </div>
  );
}

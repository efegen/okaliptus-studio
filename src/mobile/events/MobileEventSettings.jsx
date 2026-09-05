import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { getEventById, updateEvent, deleteEvent } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';

// "Etkinlik ayarları" — Canvas-2'nin doğrudan kapsamında yok (eski "Arama
// listesi" kısayolunun yerini alıyor, bkz. MobileEventDetail). Kahvaltı/ders
// ücreti gibi kalem bazlı fiyatlandırma burada YOK — o, katılımcı satırındaki
// "kimin ödeyeceği" düzenleyicisiyle (ParticipantFeeEditor/FeeCoverageList)
// ayrı bir işte ele alınıyor. Kontenjan sınırı ve ulaşım planı aç/kapa da
// kaldırıldı (kullanıcı isteği) — bir etkinliğin kontenjanı/ulaşımı artık
// yalnızca oluşturma anında belirlenir, sonradan değiştirilmez. Burada yalnız
// genel bilgiler, durum (yeniden açma) ve silme var; iptal/tamamlandı işaretleme
// UI'dan kaldırıldı — status alanı ve changeStatus('upcoming') geri açma için
// hâlâ kullanılıyor.

const STATUS_LABEL = { upcoming: 'Yaklaşıyor', live: 'Canlı', completed: 'Tamamlandı', cancelled: 'İptal' };

function toLocalInputParts(iso) {
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function EventSettingsBody({ eventId, event, onBack, onDeleted }) {
  const queryClient = useQueryClient();
  const startParts = toLocalInputParts(event.starts_at);

  const [name, setName] = React.useState(event.name);
  const [dateStr, setDateStr] = React.useState(startParts.date);
  const [timeStr, setTimeStr] = React.useState(startParts.time);
  const [location, setLocation] = React.useState(event.location || '');
  const [note, setNote] = React.useState(event.note || '');

  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [statusBusy, setStatusBusy] = React.useState(false);
  const [statusError, setStatusError] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState('');

  async function refreshEvent() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.eventById(eventId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.events() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() });
  }

  async function handleSave() {
    setSaveError('');
    const trimmedName = name.trim();
    if (!trimmedName) return setSaveError('Etkinlik adı zorunlu.');
    if (!dateStr || !timeStr) return setSaveError('Tarih ve saat zorunlu.');
    setSaving(true);
    try {
      await updateEvent(eventId, {
        name: trimmedName,
        startsAt: new Date(`${dateStr}T${timeStr}:00`).toISOString(),
        location: location.trim() || null,
        note: note.trim() || null,
      });
      await refreshEvent();
    } catch (err) {
      setSaveError(err?.message || 'Etkinlik güncellenemedi.');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(status) {
    setStatusError('');
    setStatusBusy(true);
    try {
      await updateEvent(eventId, { status });
      await refreshEvent();
    } catch (err) {
      setStatusError(err?.message || 'Durum güncellenemedi.');
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleDelete() {
    const sure = window.confirm(`"${event.name}" silinecek. Bu işlem geri alınamaz. Emin misiniz?`);
    if (!sure) return;
    setDeleteError('');
    setDeleting(true);
    try {
      await deleteEvent(eventId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.events() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() });
      onDeleted();
    } catch (err) {
      setDeleteError(err?.message || 'Etkinlik silinemedi.');
      setDeleting(false);
    }
  }

  const isActive = event.status === 'upcoming' || event.status === 'live';

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={onBack} title="Geri">
          <Icon.ChevronL width="22" height="22" />
        </button>
        <div className="evx-header-mid">
          <span className="evx-header-title">Etkinlik ayarları</span>
          <span className="evx-header-sub">{event.name}</span>
        </div>
      </header>

      <div className="evx-body">
        <div className="evx-section">
          <span className="evx-section-label">Genel bilgiler</span>
          <div className="evx-field is-active">
            <span className="evx-field-label">ETKİNLİK ADI</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="evx-field-grid">
            <div className="evx-field">
              <span className="evx-field-label">TARİH</span>
              <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
            </div>
            <div className="evx-field">
              <span className="evx-field-label">SAAT</span>
              <input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
            </div>
          </div>
          <div className="evx-field">
            <span className="evx-field-label">YER</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="İsteğe bağlı" maxLength={200} />
          </div>
          <div className="evx-field">
            <span className="evx-field-label">NOT</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" rows={2} maxLength={500} />
          </div>
        </div>

        {saveError && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{saveError}</div>}
        <button type="button" className="evx-btn-primary" onClick={handleSave} disabled={saving}>
          <Icon.Check width="16" height="16" />
          {saving ? 'Kaydediliyor…' : 'Değişiklikleri kaydet'}
        </button>

        <div className="evx-section">
          <span className="evx-section-label">Durum</span>
          <div className="evx-row" style={{ cursor: 'default' }}>
            <span className="evx-row-body">
              <span className="evx-row-name">Güncel durum</span>
              <span className="evx-row-sub">{event.totalParticipants} katılımcı · {event.coming} geliyor</span>
            </span>
            <span className={`evx-badge ${isActive ? 'tone-neutral' : 'tone-role-volunteer'}`}>{STATUS_LABEL[event.status]}</span>
          </div>
          {!isActive && (
            <div className="evx-footer-row" style={{ padding: 0 }}>
              <button type="button" className="evx-btn-secondary" disabled={statusBusy} onClick={() => changeStatus('upcoming')}>
                <Icon.Clock width="16" height="16" /> Yaklaşan olarak yeniden aç
              </button>
            </div>
          )}
          {statusError && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{statusError}</div>}
        </div>

        <div className="evx-section">
          <span className="evx-section-label">Tehlikeli bölge</span>
          <button type="button" className="evx-btn-secondary evx-btn-danger" disabled={deleting} onClick={handleDelete}>
            <Icon.Trash width="16" height="16" />
            {deleting ? 'Siliniyor…' : 'Etkinliği sil'}
          </button>
          <p className="evx-hint">Yalnızca hiç ödeme tahsil edilmemiş etkinlikler silinebilir.</p>
          {deleteError && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{deleteError}</div>}
        </div>
      </div>
    </div>
  );
}

export function MobileEventSettings({ eventId, onBack, onDeleted }) {
  const eventQuery = useQuery({ queryKey: queryKeys.eventById(eventId), queryFn: () => getEventById(eventId), enabled: !!eventId });

  if (eventQuery.isLoading) {
    return <div className="evx"><div className="evx-body"><p>Yükleniyor…</p></div></div>;
  }
  if (eventQuery.isError || !eventQuery.data) {
    return (
      <div className="evx">
        <div className="evx-body">
          <p>Etkinlik alınamadı.</p>
          <button type="button" className="evx-btn-secondary" onClick={onBack}>Geri</button>
        </div>
      </div>
    );
  }

  // `key`, kaydet/durum değişikliği sonrası updated_at değişince formu taze
  // sunucu verisiyle yeniden kurar — ayrı bir "hydration" efekti gerekmez.
  return (
    <EventSettingsBody
      key={eventQuery.data.updated_at}
      eventId={eventId}
      event={eventQuery.data}
      onBack={onBack}
      onDeleted={onDeleted}
    />
  );
}

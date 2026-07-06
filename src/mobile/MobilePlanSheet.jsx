import React from 'react';
import { Drawer } from 'vaul';
import { useQuery } from '@tanstack/react-query';
import { updateCalendarEventApi, deleteCalendarEventApi, getStudents } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { formatDuration, DurationStepper, LabelColorDots } from './shared/planFields';
import { MobilePlanParticipantsField, MobilePlanParticipantsRoster } from './shared/PlanParticipants';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function extractIstanbulParts(isoString) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(isoString));
  const get = type => Number(parts.find(p => p.type === type).value);
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

function formatHeaderDate(startsAt) {
  if (!startsAt) return '';
  const { year, month, day } = extractIstanbulParts(startsAt);
  const local = new Date(year, month, day);
  return local.toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function computeEndTime(event) {
  const totalStart = event.hour * 60 + event.minute;
  const totalEnd = totalStart + event.durationMinutes;
  const h = Math.floor(totalEnd / 60) % 24;
  const m = totalEnd % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function NoteBlock({ text }) {
  return (
    <div className="mobile-lsheet-note">
      <span className="mobile-lsheet-note-label">Not</span>
      <span className="mobile-lsheet-note-text">{text}</span>
    </div>
  );
}

export function MobilePlanSheet({ event, onClose, onUpdated }) {
  const open = !!event;
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);

  const [phase, setPhase] = React.useState('detail');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  const [title, setTitle] = React.useState('');
  const [durationMinutes, setDurationMinutes] = React.useState(60);
  const [labelColor, setLabelColor] = React.useState('graphite');
  const [note, setNote] = React.useState('');
  const [participants, setParticipants] = React.useState([]);
  const noteInputRef = React.useRef(null);

  const studentsQuery = useQuery({ queryKey: queryKeys.students(), queryFn: getStudents, staleTime: 2 * 60 * 1000 });
  const students = studentsQuery.data ?? [];

  function resetToDetail() {
    setPhase('detail');
    setError(null);
    setSubmitting(false);
  }

  function goToEdit() {
    setPhase('edit');
    setError(null);
  }

  function goToEditNote() {
    setPhase('edit');
    setError(null);
    setTimeout(() => noteInputRef.current?.focus(), 0);
  }

  // Sheet yeni bir plan için açıldığında hem faz hem edit alanları sıfırlanır.
  React.useEffect(() => {
    if (!event) return;
    resetToDetail();
    setTitle(event.title || '');
    setDurationMinutes(event.durationMinutes || 60);
    setLabelColor(event.labelColor || 'graphite');
    setNote(event.note || '');
    setParticipants(event.participants || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  async function handleCancelPlan() {
    setSubmitting(true);
    setError(null);
    try {
      await deleteCalendarEventApi(event.id);
      onUpdated('Plan iptal edildi');
    } catch (err) {
      setError(err.message || 'Plan iptal edilemedi.');
      setSubmitting(false);
    }
  }

  const canSaveEdit = title.trim().length > 0;

  async function handleSaveEdit() {
    if (!canSaveEdit) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateCalendarEventApi(event.id, {
        title: title.trim(),
        durationMinutes,
        labelColor,
        note: note.trim() || null,
        participantIds: participants.map(p => Number(p.id)),
      });
      onUpdated('Plan güncellendi');
    } catch (err) {
      setError(err.message || 'Plan güncellenemedi.');
      setSubmitting(false);
    }
  }

  const endTime = event ? computeEndTime(event) : '';

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o && !submitting) onClose(); }}
      dismissible={!submitting}
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-lsheet-overlay" />
        <Drawer.Content className="mobile-lsheet-content mobile-lsheet-content-plan">
          <Drawer.Handle className="mobile-lsheet-handle" />
          {event && (
            <>
              <header className="mobile-lsheet-header">
                <span className="mobile-lsheet-pill mobile-lsheet-pill-plan">
                  <span
                    className={'pl-dot pl-dot-' + event.labelColor}
                    style={{
                      width: 9, height: 9, boxShadow: 'none', cursor: 'default',
                      display: 'inline-block', marginRight: 6, verticalAlign: -1,
                    }}
                  />
                  Plan
                </span>
                <Drawer.Title className="mobile-lsheet-name">{event.title}</Drawer.Title>
                <div className="mobile-lsheet-meta">
                  {formatHeaderDate(event.startsAt)} · {event.time} – {endTime} · {formatDuration(event.durationMinutes)}
                </div>
              </header>

              {phase === 'detail' && (
                <>
                  <div className="mobile-lsheet-body">
                    <div className="mpp-section">
                      <span className="mpp-section-label">
                        Katılımcılar{participants.length > 0 ? ` · ${participants.length}` : ''}
                      </span>
                      {participants.length > 0
                        ? <MobilePlanParticipantsRoster participants={participants} />
                        : (
                          <button type="button" className="mobile-lsheet-note-empty" onClick={goToEdit}>
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                            Katılımcı yok. Eklemek için dokunun.
                          </button>
                        )}
                    </div>
                    {event.note
                      ? <NoteBlock text={event.note} />
                      : (
                        <button type="button" className="mobile-lsheet-note-empty" onClick={goToEditNote}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                          Not eklenmedi. Eklemek için dokunun.
                        </button>
                      )}
                    {error && <div className="mobile-lsheet-error" role="alert">{error}</div>}
                  </div>
                  <footer className="mobile-lsheet-actions">
                    <button
                      type="button"
                      className="mobile-lsheet-btn-danger"
                      onClick={() => { setPhase('cancel'); setError(null); }}
                    >
                      İptal et
                    </button>
                    <button
                      type="button"
                      className="mobile-lsheet-btn-primary"
                      onClick={() => { setPhase('edit'); setError(null); }}
                    >
                      Düzenle
                    </button>
                  </footer>
                </>
              )}

              {phase === 'cancel' && (
                <>
                  <div className="mobile-lsheet-body">
                    <div className="mobile-lsheet-subtitle">Planı iptal et</div>
                    <div className="mobile-lsheet-hint">Bu plan takvimden kaldırılacak.</div>
                    {error && <div className="mobile-lsheet-error" role="alert">{error}</div>}
                  </div>
                  <footer className="mobile-lsheet-actions">
                    <button
                      type="button"
                      className="mobile-lsheet-btn-ghost"
                      onClick={resetToDetail}
                      disabled={submitting}
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      className="mobile-lsheet-btn-danger"
                      onClick={handleCancelPlan}
                      disabled={submitting}
                    >
                      {submitting ? 'İptal ediliyor…' : 'Planı iptal et'}
                    </button>
                  </footer>
                </>
              )}

              {phase === 'edit' && (
                <>
                  <div className="mobile-lsheet-body">
                    <div className="mobile-lsheet-form-row">
                      <label className="mobile-lsheet-form-label">Başlık</label>
                      <input
                        type="text"
                        className="mobile-lsheet-input"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                      />
                    </div>

                    <div className="mobile-lsheet-form-row">
                      <label className="mobile-lsheet-form-label">Süre</label>
                      <DurationStepper value={durationMinutes} onChange={setDurationMinutes} />
                    </div>

                    <div className="mobile-lsheet-form-row">
                      <label className="mobile-lsheet-form-label">Etiket rengi</label>
                      <LabelColorDots value={labelColor} onChange={setLabelColor} />
                    </div>

                    <div className="mobile-lsheet-form-row">
                      <label className="mobile-lsheet-form-label">Katılımcılar (opsiyonel)</label>
                      <MobilePlanParticipantsField
                        students={students}
                        value={participants}
                        onChange={setParticipants}
                        loading={studentsQuery.isLoading}
                      />
                    </div>

                    <div className="mobile-lsheet-form-row">
                      <label className="mobile-lsheet-form-label">Not (opsiyonel)</label>
                      <input
                        ref={noteInputRef}
                        type="text"
                        className="mobile-lsheet-input"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Açıklama…"
                      />
                    </div>

                    {error && <div className="mobile-lsheet-error" role="alert">{error}</div>}
                  </div>
                  <footer className="mobile-lsheet-actions">
                    <button
                      type="button"
                      className="mobile-lsheet-btn-ghost"
                      onClick={resetToDetail}
                      disabled={submitting}
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      className="mobile-lsheet-btn-primary"
                      onClick={handleSaveEdit}
                      disabled={submitting || !canSaveEdit}
                    >
                      {submitting ? 'Kaydediliyor…' : 'Kaydet'}
                    </button>
                  </footer>
                </>
              )}
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

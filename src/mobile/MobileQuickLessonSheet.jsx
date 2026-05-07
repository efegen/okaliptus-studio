import React from 'react';
import { Drawer } from 'vaul';
import { useQuery } from '@tanstack/react-query';
import {
  createLesson,
  getStudents,
  getInstructors,
  getLessonTypes,
} from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { MobileStudentCombobox } from './shared/MobileStudentCombobox';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function FormRow({ label, children }) {
  return (
    <div className="mobile-csheet-form-row">
      <label className="mobile-csheet-label">{label}</label>
      {children}
    </div>
  );
}

function OnsiteIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function OnlineIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function nextRoundHourFromNow() {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  // If the rounded-down hour is already past (it always is when minutes>0),
  // step forward one hour so the default sits in the future, not the past.
  if (now.getMinutes() > 0 || now.getSeconds() > 0) {
    next.setHours(now.getHours() + 1);
  } else {
    next.setHours(now.getHours());
  }
  // Clamp to studio hours: if before 08:00 → 08:00 today, if after 22:00 → 08:00 next day.
  const h = next.getHours();
  if (h < 8) {
    next.setHours(8, 0, 0, 0);
  } else if (h > 22) {
    next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);
  }
  return next;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateToInputValue(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timeToInputValue(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function MobileQuickLessonSheet({ open, onClose, onCreated }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);

  const studentsQuery = useQuery({ queryKey: queryKeys.students(), queryFn: getStudents, staleTime: 2 * 60 * 1000, enabled: open });
  const instructorsQuery = useQuery({ queryKey: queryKeys.instructors(), queryFn: getInstructors, staleTime: 5 * 60 * 1000, enabled: open });
  const lessonTypesQuery = useQuery({ queryKey: queryKeys.lessonTypes(), queryFn: getLessonTypes, staleTime: 5 * 60 * 1000, enabled: open });

  const students = studentsQuery.data ?? [];
  const instructors = instructorsQuery.data ?? [];
  const lessonTypes = lessonTypesQuery.data ?? [];
  const metaLoading = studentsQuery.isLoading || instructorsQuery.isLoading || lessonTypesQuery.isLoading;
  const fetchError = [studentsQuery.error, instructorsQuery.error, lessonTypesQuery.error]
    .filter(Boolean).map(e => e.message).join(' · ') || null;

  const [selectedStudent, setSelectedStudent] = React.useState(null);
  const [dateStr, setDateStr] = React.useState('');
  const [timeStr, setTimeStr] = React.useState('');
  const [mode, setMode] = React.useState('onsite');
  const [instructorId, setInstructorId] = React.useState('');
  const [lessonTypeId, setLessonTypeId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(null);

  // Reset whenever sheet opens.
  React.useEffect(() => {
    if (!open) return;
    const def = nextRoundHourFromNow();
    setSelectedStudent(null);
    setDateStr(dateToInputValue(def));
    setTimeStr(timeToInputValue(def));
    setMode('onsite');
    setNote('');
    setSubmitError(null);
    setSubmitting(false);
  }, [open]);

  // Default instructor / lesson type when data loads.
  React.useEffect(() => {
    if (instructors.length > 0 && !instructorId) {
      setInstructorId(String(instructors[0].id));
    }
  }, [instructors]);
  React.useEffect(() => {
    if (lessonTypes.length > 0 && !lessonTypeId) {
      setLessonTypeId(String(lessonTypes[0].id));
    }
  }, [lessonTypes]);

  const lessonDate = React.useMemo(() => {
    if (!dateStr || !timeStr) return null;
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    if (!y || !mo || !d || Number.isNaN(h) || Number.isNaN(mi)) return null;
    return new Date(y, mo - 1, d, h, mi, 0, 0);
  }, [dateStr, timeStr]);

  function selectStudent(s) {
    setSelectedStudent(s);
    const pref = s.preferred_mode || s.default_mode;
    if (pref === 'online' || pref === 'onsite') setMode(pref);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedStudent || !instructorId || !lessonTypeId || !lessonDate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createLesson({
        studentId: Number(selectedStudent.id),
        startsAt: lessonDate.toISOString(),
        mode,
        note: note.trim() || null,
        instructorId: Number(instructorId),
        lessonTypeId: Number(lessonTypeId),
      });
      onCreated('Ders eklendi');
    } catch (err) {
      setSubmitError(err.message || 'Ders oluşturulamadı.');
      setSubmitting(false);
    }
  }

  const canSubmit = !!selectedStudent
    && !!instructorId
    && !!lessonTypeId
    && !!lessonDate
    && !submitting
    && !metaLoading;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o && !submitting) onClose(); }}
      dismissible={!submitting}
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-csheet-overlay" />
        <Drawer.Content className="mobile-csheet-content">
          <Drawer.Handle className="mobile-csheet-handle" />
          <form className="mobile-csheet-form" onSubmit={handleSubmit}>
            <header className="mobile-csheet-header">
              <Drawer.Title className="mobile-csheet-title">Yeni ders</Drawer.Title>
              <div className="mobile-csheet-meta">
                Tarih ve saati seç — takvime düşer
              </div>
            </header>

            <div className="mobile-csheet-body">
              <FormRow label="Öğrenci">
                <MobileStudentCombobox
                  students={students}
                  selected={selectedStudent}
                  onSelect={selectStudent}
                  onClear={() => setSelectedStudent(null)}
                  loading={metaLoading}
                  autoFocus={!selectedStudent}
                />
              </FormRow>

              <div className="mobile-qadd-row-2col">
                <FormRow label="Tarih">
                  <input
                    type="date"
                    className="mobile-csheet-input"
                    value={dateStr}
                    onChange={e => setDateStr(e.target.value)}
                  />
                </FormRow>
                <FormRow label="Saat">
                  <input
                    type="time"
                    className="mobile-csheet-input"
                    value={timeStr}
                    onChange={e => setTimeStr(e.target.value)}
                    step={900}
                  />
                </FormRow>
              </div>

              <FormRow label="Eğitmen">
                <select
                  className="mobile-csheet-select"
                  value={instructorId}
                  onChange={e => setInstructorId(e.target.value)}
                  disabled={metaLoading}
                >
                  {instructors.length === 0 && (
                    <option value="">Aktif eğitmen yok</option>
                  )}
                  {instructors.map(i => (
                    <option key={i.id} value={i.id}>{i.full_name}</option>
                  ))}
                </select>
              </FormRow>

              <FormRow label="Ders türü">
                <select
                  className="mobile-csheet-select"
                  value={lessonTypeId}
                  onChange={e => setLessonTypeId(e.target.value)}
                  disabled={metaLoading}
                >
                  {lessonTypes.length === 0 && (
                    <option value="">Aktif ders türü yok</option>
                  )}
                  {lessonTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </FormRow>

              <FormRow label="Mod">
                <div className="mobile-csheet-mode">
                  <button
                    type="button"
                    className={'mobile-csheet-mode-btn' + (mode === 'onsite' ? ' is-on' : '')}
                    onClick={() => setMode('onsite')}
                  >
                    <OnsiteIcon /> Yüzyüze
                  </button>
                  <button
                    type="button"
                    className={'mobile-csheet-mode-btn' + (mode === 'online' ? ' is-on' : '')}
                    onClick={() => setMode('online')}
                  >
                    <OnlineIcon /> Online
                  </button>
                </div>
              </FormRow>

              <FormRow label="Not (opsiyonel)">
                <input
                  type="text"
                  className="mobile-csheet-input"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Hatırlatıcı, ek bilgi…"
                />
              </FormRow>

              {(submitError || fetchError) && (
                <div className="mobile-csheet-error" role="alert">
                  {submitError || fetchError}
                </div>
              )}
            </div>

            <footer className="mobile-csheet-actions">
              <button
                type="button"
                className="mobile-csheet-btn-ghost"
                onClick={onClose}
                disabled={submitting}
              >
                Vazgeç
              </button>
              <button
                type="submit"
                className="mobile-csheet-btn-primary"
                disabled={!canSubmit}
              >
                {submitting ? 'Ekleniyor…' : 'Ekle'}
              </button>
            </footer>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

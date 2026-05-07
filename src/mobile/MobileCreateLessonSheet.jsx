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

function OnsiteIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
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

function FormRow({ label, children }) {
  return (
    <div className="mobile-csheet-form-row">
      <label className="mobile-csheet-label">{label}</label>
      {children}
    </div>
  );
}

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

export function MobileCreateLessonSheet({ slotInfo, weekStart, onClose, onCreated }) {
  const open = !!slotInfo;
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);

  const studentsQuery = useQuery({ queryKey: queryKeys.students(), queryFn: getStudents, staleTime: 2 * 60 * 1000 });
  const instructorsQuery = useQuery({ queryKey: queryKeys.instructors(), queryFn: getInstructors, staleTime: 5 * 60 * 1000 });
  const lessonTypesQuery = useQuery({ queryKey: queryKeys.lessonTypes(), queryFn: getLessonTypes, staleTime: 5 * 60 * 1000 });

  const students = studentsQuery.data ?? [];
  const instructors = instructorsQuery.data ?? [];
  const lessonTypes = lessonTypesQuery.data ?? [];
  const metaLoading = studentsQuery.isLoading || instructorsQuery.isLoading || lessonTypesQuery.isLoading;
  const fetchError = [studentsQuery.error, instructorsQuery.error, lessonTypesQuery.error]
    .filter(Boolean).map(e => e.message).join(' · ') || null;

  const [selectedStudent, setSelectedStudent] = React.useState(null);
  const [mode, setMode] = React.useState('onsite');
  const [instructorId, setInstructorId] = React.useState('');
  const [lessonTypeId, setLessonTypeId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(null);

  // Reset form whenever sheet opens for a new slot.
  React.useEffect(() => {
    if (!slotInfo) return;
    setSelectedStudent(null);
    setMode('onsite');
    setNote('');
    setSubmitError(null);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotInfo?.dayIndex, slotInfo?.hour, weekStart?.getTime()]);

  // Initialize defaults when data arrives from cache or network.
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
    if (!slotInfo || !weekStart) return null;
    return new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate() + slotInfo.dayIndex,
      slotInfo.hour, 0, 0, 0
    );
  }, [slotInfo, weekStart]);

  const dateLabel = lessonDate
    ? lessonDate.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';
  const timeLabel = slotInfo ? `${String(slotInfo.hour).padStart(2, '0')}:00` : '';

  function selectStudent(s) {
    setSelectedStudent(s);
    const pref = s.preferred_mode || s.default_mode;
    if (pref === 'online' || pref === 'onsite') {
      setMode(pref);
    }
  }

  function clearStudent() {
    setSelectedStudent(null);
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
      onCreated();
    } catch (err) {
      setSubmitError(err.message || 'Ders oluşturulamadı.');
      setSubmitting(false);
    }
  }

  const canSubmit = !!selectedStudent && !!instructorId && !!lessonTypeId && !submitting && !metaLoading;

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
          {open && (
            <form className="mobile-csheet-form" onSubmit={handleSubmit}>
              <header className="mobile-csheet-header">
                <Drawer.Title className="mobile-csheet-title">Yeni ders</Drawer.Title>
                <div className="mobile-csheet-meta">{dateLabel} · {timeLabel}</div>
              </header>

              <div className="mobile-csheet-body">
                <FormRow label="Öğrenci">
                  <MobileStudentCombobox
                    students={students}
                    selected={selectedStudent}
                    onSelect={selectStudent}
                    onClear={clearStudent}
                    loading={metaLoading}
                  />
                </FormRow>

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
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

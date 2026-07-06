import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  createLesson,
  createCalendarEvent,
  getStudents,
  getInstructors,
  getLessonTypes,
} from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { MobileStudentCombobox } from './shared/MobileStudentCombobox';
import { MobilePlanParticipantsField } from './shared/PlanParticipants';
import { fmtTL } from '../data';
import { formatDuration, DurationStepper, LabelColorDots } from './shared/planFields';

// ── Icons ────────────────────────────────────────────────────────────────────

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CalIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ChevIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17v3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function OnsiteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function OnlineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function WhenCard({ title, sub }) {
  return (
    <div className="lb-when">
      <span className="lb-when-ic"><CalIcon /></span>
      <span className="lb-when-tx">
        <span className="lb-when-t">{title}</span>
        <span className="lb-when-d">{sub}</span>
      </span>
    </div>
  );
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Lesson Tab ───────────────────────────────────────────────────────────────

function LessonTab({ slotInfo, weekStart, dateLabel, timeLabel, onCreated, setSubmitting: setParentSubmitting, setSubmitError: setParentError, onStateChange }) {
  const studentsQuery = useQuery({ queryKey: queryKeys.students(), queryFn: getStudents, staleTime: 2 * 60 * 1000 });
  const instructorsQuery = useQuery({ queryKey: queryKeys.instructors(), queryFn: getInstructors, staleTime: 5 * 60 * 1000 });
  const lessonTypesQuery = useQuery({ queryKey: queryKeys.lessonTypes(), queryFn: getLessonTypes, staleTime: 5 * 60 * 1000 });

  const students = studentsQuery.data ?? [];
  const instructors = instructorsQuery.data ?? [];
  const lessonTypes = lessonTypesQuery.data ?? [];
  const metaLoading = studentsQuery.isLoading || instructorsQuery.isLoading || lessonTypesQuery.isLoading;

  const [selectedStudent, setSelectedStudent] = React.useState(null);
  const [mode, setMode] = React.useState('onsite');
  const [instructorId, setInstructorId] = React.useState('');
  const [lessonTypeId, setLessonTypeId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [showStudentSearch, setShowStudentSearch] = React.useState(false);

  React.useEffect(() => {
    if (instructors.length > 0 && !instructorId) setInstructorId(String(instructors[0].id));
  }, [instructors]);

  React.useEffect(() => {
    if (lessonTypes.length > 0 && !lessonTypeId) setLessonTypeId(String(lessonTypes[0].id));
  }, [lessonTypes]);

  const lessonDate = React.useMemo(() => {
    if (!slotInfo || !weekStart) return null;
    return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + slotInfo.dayIndex, slotInfo.hour, 0, 0, 0);
  }, [slotInfo, weekStart]);

  const selectedType = lessonTypes.find(t => String(t.id) === lessonTypeId);
  const selectedInstructor = instructors.find(i => String(i.id) === instructorId);
  const durationMinutes = selectedType?.default_duration_minutes || 60;
  const endHour = slotInfo ? slotInfo.hour + Math.floor(durationMinutes / 60) : 0;
  const endMin = durationMinutes % 60;
  const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

  function selectStudent(s) {
    setSelectedStudent(s);
    setShowStudentSearch(false);
    const pref = s.preferred_mode || s.default_mode;
    if (pref === 'online' || pref === 'onsite') setMode(pref);
  }

  const canSubmit = !!selectedStudent && !!instructorId && !!lessonTypeId && !metaLoading;

  // submitRef always holds the latest closure (selectedStudent/mode/note/…)
  // so the parent's footer CTA can invoke it without a stale-closure risk.
  const submitRef = React.useRef(null);
  submitRef.current = async () => {
    if (!canSubmit || !lessonDate) return false;
    try {
      await createLesson({
        studentId: Number(selectedStudent.id),
        startsAt: lessonDate.toISOString(),
        mode,
        note: note.trim() || null,
        instructorId: Number(instructorId),
        lessonTypeId: Number(lessonTypeId),
      });
      return true;
    } catch (err) {
      setParentError(err.message || 'Ders oluşturulamadı.');
      return false;
    }
  };

  React.useEffect(() => {
    onStateChange({ canSubmit, submit: () => submitRef.current() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit]);

  return (
    <>
      {/* Student picker */}
      {showStudentSearch ? (
        <div className="la-pick" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: '10px 12px' }}>
          <MobileStudentCombobox
            students={students}
            selected={null}
            onSelect={selectStudent}
            onClear={() => setShowStudentSearch(false)}
            loading={metaLoading}
            autoFocus
            placeholder="Öğrenci ara…"
          />
        </div>
      ) : selectedStudent ? (
        <button type="button" className="la-pick" onClick={() => setShowStudentSearch(true)}>
          <span className="la-pick-av">{getInitials(selectedStudent.full_name)}</span>
          <span className="la-pick-tx">
            <span className="la-pick-t">{selectedStudent.full_name}</span>
            <span className="la-pick-d">{selectedStudent.nickname || ''}</span>
          </span>
          <span className="la-pick-edit"><EditIcon /></span>
        </button>
      ) : (
        <button type="button" className="la-pick la-pick-empty" onClick={() => setShowStudentSearch(true)}>
          <span className="la-pick-av ph"><PersonIcon /></span>
          <span className="la-pick-tx">
            <span className="la-pick-t">Öğrenci seç</span>
            <span className="la-pick-d">Ara veya listeden seç</span>
          </span>
          <span className="la-pick-go"><SearchIcon /></span>
        </button>
      )}

      {/* When card */}
      <WhenCard
        title={dateLabel}
        sub={`${timeLabel} – ${endTime} · ${durationMinutes} dk`}
      />

      {/* Detail card */}
      <div className="la-card">
        <div className="la-row" style={{ position: 'relative' }}>
          <span className="la-row-l">Eğitmen</span>
          <span className="la-row-v">{selectedInstructor?.full_name || '–'}</span>
          {instructors.length > 1 && (
            <span className="la-row-go" style={{ position: 'relative' }}>
              <select
                style={{ position: 'absolute', inset: -8, opacity: 0, cursor: 'pointer', width: 'calc(100% + 16px)', height: 'calc(100% + 16px)' }}
                value={instructorId}
                onChange={e => setInstructorId(e.target.value)}
              >
                {instructors.map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}
              </select>
              <ChevIcon />
            </span>
          )}
        </div>
        <div className="la-row" style={{ position: 'relative' }}>
          <span className="la-row-l">Ders türü</span>
          <span className="la-row-v">
            {selectedType?.name || '–'}
            {selectedType && <small>{selectedType.default_duration_minutes} dk · {fmtTL(selectedType.default_price)}</small>}
          </span>
          <span className="la-row-go" style={{ position: 'relative' }}>
            <select
              style={{ position: 'absolute', inset: -8, opacity: 0, cursor: 'pointer', width: 'calc(100% + 16px)', height: 'calc(100% + 16px)' }}
              value={lessonTypeId}
              onChange={e => setLessonTypeId(e.target.value)}
            >
              {lessonTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <ChevIcon />
          </span>
        </div>
        <div className="la-row la-row-mode">
          <span className="la-row-l">Mod</span>
          <div className="la-mode">
            <button type="button" className={'la-mode-btn' + (mode === 'onsite' ? ' on' : '')} onClick={() => setMode('onsite')}>
              <OnsiteIcon /> Yüzyüze
            </button>
            <button type="button" className={'la-mode-btn' + (mode === 'online' ? ' on' : '')} onClick={() => setMode('online')}>
              <OnlineIcon /> Online
            </button>
          </div>
        </div>
      </div>

      <textarea
        className="la-note"
        placeholder="Not (opsiyonel) — hatırlatıcı, ek bilgi…"
        value={note}
        onChange={e => setNote(e.target.value)}
        style={{ minHeight: 64 }}
      />
    </>
  );
}

// ── Plan Tab ─────────────────────────────────────────────────────────────────

const PLAN_CFG = { ph: 'Plan Adı', cta: 'Planı ekle', sampleName: 'Plan' };
const PLAN_EVENT_TYPE = 'plan';

function PlanTab({ slotInfo, weekStart, dateLabel, timeLabel, setSubmitError: setParentError, onStateChange }) {
  const [title, setTitle] = React.useState('');
  const [durationMinutes, setDurationMinutes] = React.useState(60);
  const [labelColor, setLabelColor] = React.useState('graphite');
  const [note, setNote] = React.useState('');
  const [participants, setParticipants] = React.useState([]);

  const studentsQuery = useQuery({ queryKey: queryKeys.students(), queryFn: getStudents, staleTime: 2 * 60 * 1000 });
  const students = studentsQuery.data ?? [];

  const cfg = PLAN_CFG;

  const lessonDate = React.useMemo(() => {
    if (!slotInfo || !weekStart) return null;
    return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + slotInfo.dayIndex, slotInfo.hour, 0, 0, 0);
  }, [slotInfo, weekStart]);

  const endHour = slotInfo ? slotInfo.hour + Math.floor(durationMinutes / 60) : 0;
  const endMin = durationMinutes % 60;
  const endTime = `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`;

  const canSubmit = title.trim().length > 0;

  const submitRef = React.useRef(null);
  submitRef.current = async () => {
    if (!canSubmit || !lessonDate) return false;
    try {
      await createCalendarEvent({
        eventType: PLAN_EVENT_TYPE,
        title: title.trim(),
        startsAt: lessonDate.toISOString(),
        durationMinutes,
        labelColor,
        note: note.trim() || null,
        participantIds: participants.map(p => Number(p.id)),
      });
      return true;
    } catch (err) {
      setParentError(err.message || 'Plan oluşturulamadı.');
      return false;
    }
  };

  React.useEffect(() => {
    onStateChange({ canSubmit, ctaLabel: cfg.cta, submit: () => submitRef.current() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSubmit, cfg.cta]);

  return (
    <>
      {/* Title input */}
      <input
        className="pl-input"
        placeholder={cfg.ph}
        value={title}
        onChange={e => setTitle(e.target.value)}
      />

      {/* When card */}
      <WhenCard title={dateLabel} sub={`${timeLabel} – ${endTime} · ${formatDuration(durationMinutes)}`} />

      {/* Duration */}
      <div className="la-card">
        <div className="la-row">
          <span className="la-row-l">Süre</span>
          <span className="pl-ctrl">
            <DurationStepper value={durationMinutes} onChange={setDurationMinutes} />
          </span>
        </div>
      </div>

      {/* Label color */}
      <div className="la-sec">
        <div className="la-sec-h"><span className="la-sec-t">Etiket rengi</span></div>
        <LabelColorDots value={labelColor} onChange={setLabelColor} />
      </div>

      {/* Participants */}
      <div className="la-sec">
        <div className="la-sec-h"><span className="la-sec-t">Katılımcılar</span><span className="la-sec-opt">opsiyonel</span></div>
        <MobilePlanParticipantsField
          students={students}
          value={participants}
          onChange={setParticipants}
          loading={studentsQuery.isLoading}
        />
      </div>

      <div className="la-sec">
        <div className="la-sec-h"><span className="la-sec-t">Not</span><span className="la-sec-opt">opsiyonel</span></div>
        <textarea
          className="la-note"
          placeholder="Not ekle…"
          value={note}
          onChange={e => setNote(e.target.value)}
          style={{ minHeight: 64 }}
        />
      </div>
    </>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function MobileAddToCalendar({ slotInfo, weekStart, onClose, onCreated }) {
  const [activeTab, setActiveTab] = React.useState('lesson');
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(null);
  const [tabState, setTabState] = React.useState({ canSubmit: false, ctaLabel: '', submit: null });

  React.useEffect(() => {
    setSubmitError(null);
    setTabState({ canSubmit: false, ctaLabel: '', submit: null });
  }, [activeTab]);

  const lessonDate = React.useMemo(() => {
    if (!slotInfo || !weekStart) return null;
    return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + slotInfo.dayIndex, slotInfo.hour, 0, 0, 0);
  }, [slotInfo, weekStart]);

  const dateLabel = lessonDate
    ? lessonDate.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })
    : '';
  const timeLabel = slotInfo ? `${String(slotInfo.hour).padStart(2, '0')}:00` : '';

  const isLesson = activeTab === 'lesson';

  async function handleSubmit() {
    if (submitting || !tabState.submit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ok = await tabState.submit();
      if (ok) {
        onCreated(isLesson ? 'Ders eklendi' : 'Plan eklendi');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = tabState.canSubmit;
  const ctaLabel = isLesson
    ? (canSubmit ? 'Dersi ekle' : 'Önce öğrenci seç')
    : (tabState.ctaLabel || 'Ekle');

  return (
    <div className="la-page">
      <header className="la-top">
        <button type="button" className="la-icbtn" aria-label="Geri" onClick={onClose}>
          <BackIcon />
        </button>
        <div className="lb-tabs">
          <button type="button" className={'lb-tab' + (isLesson ? ' on' : '')} onClick={() => setActiveTab('lesson')}>
            Ders ekle
          </button>
          <button type="button" className={'lb-tab' + (!isLesson ? ' on' : '')} onClick={() => setActiveTab('plan')}>
            Plan ekle
          </button>
        </div>
        <div className="la-top-spacer" />
      </header>

      <div className="la-body">
        {isLesson ? (
          <LessonTab
            slotInfo={slotInfo}
            weekStart={weekStart}
            dateLabel={dateLabel}
            timeLabel={timeLabel}
            onCreated={onCreated}
            setSubmitting={setSubmitting}
            setSubmitError={setSubmitError}
            onStateChange={setTabState}
          />
        ) : (
          <PlanTab
            slotInfo={slotInfo}
            weekStart={weekStart}
            dateLabel={dateLabel}
            timeLabel={timeLabel}
            setSubmitError={setSubmitError}
            onStateChange={setTabState}
          />
        )}

        {submitError && (
          <div className="la-error" role="alert">{submitError}</div>
        )}
      </div>

      <footer className="la-foot">
        <button
          type="button"
          className={'la-cta' + (!isLesson ? ' ink' : '')}
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
        >
          {submitting ? 'Ekleniyor…' : ctaLabel}
        </button>
      </footer>
    </div>
  );
}

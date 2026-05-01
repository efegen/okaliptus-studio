// Home / Dashboard page - hierarchy-first, action-center right rail

import React from 'react';
import {
  STUDENTS, WEEK_SESSIONS, DEBTS, INCOME_HISTORY,
  DAYS_TR, DAYS_TR_SHORT,
  getStudent, fmtTL,
} from './data';
import { Icon, Avatar } from './layout';
import {
  getWeeklyKpi, getWeekLessons, getStudents, getSettings,
  createLesson, completeLessonApi, changeLessonStatusApi, deleteLessonApi,
  createProductSaleApi, updateProductSaleApi, deleteProductSaleApi, createCashPayment,
  getInstructors, getLessonTypes,
  getDebtors, getStudentLessons, getStudentProductSales,
} from './api';
import { ReceivePaymentModal } from './students';

function parseNumericValue(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampBarWidth(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function useWeeklyKpiState() {
  const [state, setState] = React.useState({
    data: null,
    error: null,
    isLoading: true,
  });

  React.useEffect(() => {
    let cancelled = false;

    async function loadWeeklyKpi() {
      try {
        const data = await getWeeklyKpi();

        if (cancelled) {
          return;
        }

        setState({
          data,
          error: null,
          isLoading: false,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error('[WeeklyKpi] fetch basarisiz, mock veriye donuluyor:', error);
        setState({
          data: null,
          error: error instanceof Error ? error.message : 'Haftalik KPI verisi alinamadi.',
          isLoading: false,
        });
      }
    }

    void loadWeeklyKpi();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function getIstanbulToday() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const y = Number(parts.find(p => p.type === 'year').value);
  const mo = Number(parts.find(p => p.type === 'month').value) - 1;
  const d = Number(parts.find(p => p.type === 'day').value);
  return new Date(y, mo, d, 0, 0, 0, 0);
}

function getTodayDateStr() {
  const t = getIstanbulToday();
  return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
}

const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 7; h <= 23; h++) {
    opts.push(`${String(h).padStart(2,'0')}:00`);
    if (h < 23) opts.push(`${String(h).padStart(2,'0')}:30`);
  }
  return opts;
})();

function extractIstanbulParts(isoString) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(isoString));
  const get = type => Number(parts.find(p => p.type === type).value);
  return { year: get('year'), month: get('month') - 1, day: get('day'), hour: get('hour'), minute: get('minute') };
}

function getCurrentMonday() {
  const today = getIstanbulToday();
  const daysSinceMonday = (today.getDay() + 6) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday, 0, 0, 0, 0);
}

function addWeeks(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n * 7, 0, 0, 0, 0);
}

function getMondayOfDate(date) {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday, 0, 0, 0, 0);
}

function getWeekDayNumbers(weekStart) {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i).getDate()
  );
}

function getTodayColumnIndex(weekStart) {
  const today = getIstanbulToday();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
      return i;
    }
  }
  return -1;
}

function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatWeekRange(weekStart) {
  const sunday = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const s = weekStart.getDate();
  const e = sunday.getDate();
  if (weekStart.getMonth() === sunday.getMonth()) {
    return `${s} – ${e} ${sunday.toLocaleDateString('tr-TR', { month: 'short' })}`;
  }
  return `${s} ${weekStart.toLocaleDateString('tr-TR', { month: 'short' })} – ${e} ${sunday.toLocaleDateString('tr-TR', { month: 'short' })}`;
}

function formatWeekHeader(weekStart) {
  const weekNum = getISOWeekNumber(weekStart);
  const sunday = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const s = weekStart.getDate();
  const e = sunday.getDate();
  const year = sunday.getFullYear();
  if (weekStart.getMonth() === sunday.getMonth()) {
    return `Hafta ${weekNum} · ${s} – ${e} ${sunday.toLocaleDateString('tr-TR', { month: 'long' })} ${year}`;
  }
  return `Hafta ${weekNum} · ${s} ${weekStart.toLocaleDateString('tr-TR', { month: 'long' })} – ${e} ${sunday.toLocaleDateString('tr-TR', { month: 'long' })} ${year}`;
}

function getLessonState(status, paid, price) {
  if (status === "cancelled" || status === "no_show") return "cancelled";
  const isCompleted = status === "completed" || status === "geçti";
  if (!isCompleted) return "planned";
  const paidNum = Number(paid) || 0;
  const priceNum = Number(price) || 0;
  if (priceNum === 0) return "unpaid"; // no price data = treat as unpaid (conservative)
  if (paidNum >= priceNum) return "paid";
  if (paidNum > 0) return "partial";
  return "unpaid";
}

const PAYMENT_METHOD_LABELS = {
  cash: "Nakit",
  bank_transfer: "IBAN",
  card: "Kart",
  mixed: "Karışık",
};

function getLessonStateInfo(s) {
  switch (s.lessonState) {
    case "planned":
      return { label: "Planlandı", summary: null };
    case "unpaid":
      return {
        label: "Tamamlandı · Ödenmedi",
        summary: s.price > 0 ? fmtTL(s.price) : null,
      };
    case "partial": {
      const summary = s.price > 0 ? `${fmtTL(s.paid)} / ${fmtTL(s.price)}` : null;
      return { label: "Kısmi ödendi", summary };
    }
    case "paid": {
      const methodLabel = s.paymentMethod
        ? (PAYMENT_METHOD_LABELS[s.paymentMethod] || s.paymentMethod)
        : null;
      const label = methodLabel ? `Ödendi · ${methodLabel}` : "Ödendi";
      const summary = s.price > 0 ? `${fmtTL(s.paid)} / ${fmtTL(s.price)}` : null;
      return { label, summary };
    }
    case "cancelled":
      return { label: "İptal", summary: null };
    default:
      return { label: "", summary: null };
  }
}


function normalizeApiLesson(l) {
  const { year, month, day, hour, minute } = extractIstanbulParts(l.starts_at);
  const localDate = new Date(year, month, day);
  const dayIndex = (localDate.getDay() + 6) % 7; // 0=Mon..6=Sun
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const paid = Number(l.paid_amount) || 0;
  const gross = Number(l.price_snapshot) || 0;
  const discount = Number(l.discount_amount) || 0;
  // Karar 7: takvim ve ödeme karşılaştırmaları net tutar üzerinden yürür.
  const price = Number(l.net_amount ?? (gross - discount)) || 0;
  const productSales = Array.isArray(l.product_sales)
    ? l.product_sales.map(sale => ({
        id: String(sale.id),
        totalAmount: Number(sale.total_amount) || 0,
        paidAmount: Number(sale.paid_amount) || 0,
        remaining: Number(sale.remaining) || 0,
        note: sale.note || null,
      }))
    : [];
  return {
    id: l.id,
    studentId: l.student_id,
    studentName: l.student_name,
    studentNickname: l.student_nickname || null,
    day: dayIndex,
    time: `${hh}:${mm}`,
    mode: l.mode,
    paid,
    price,
    grossPrice: gross,
    discountAmount: discount,
    paymentMethod: l.payment_source || null,
    note: l.note || null,
    status: l.status,
    startsAt: l.starts_at,
    lessonState: getLessonState(l.status, paid, price),
    productSales,
  };
}

function useWeekLessonsState(weekStart, refreshKey) {
  const [state, setState] = React.useState({
    lessons: null,
    error: null,
    isLoading: true,
  });

  const weekStartKey = weekStart.getTime();

  React.useEffect(() => {
    let cancelled = false;

    // Synchronously clear stale lessons before the async fetch so the
    // calendar never renders a previous week's sessions under the new week's columns.
    setState({ lessons: null, error: null, isLoading: true });

    async function loadWeekLessons() {
      try {
        const lessons = await getWeekLessons(weekStart);

        if (cancelled) {
          return;
        }

        setState({ lessons, error: null, isLoading: false });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState({
          lessons: null,
          error: error instanceof Error ? error.message : 'Haftalik ders verisi alinamadi.',
          isLoading: false,
        });
      }
    }

    void loadWeekLessons();

    return () => {
      cancelled = true;
    };
  }, [weekStartKey, refreshKey]);

  return state;
}

// ─── Collapsed calendar helpers ─────────────────────────────────────────────

const COLLAPSED_H = 28;    // px height of a collapsed band row
const CALENDAR_START = 8;  // earliest visible hour (08:00)
const MORNING_BAND_END = 13; // morning [CALENDAR_START, MORNING_BAND_END), afternoon [MORNING_BAND_END, alwaysFrom)

// Builds the ordered list of row descriptors for the calendar grid.
// Rules:
//   - Grid always starts at CALENDAR_START (08) regardless of sessions.
//   - alwaysTo is the last always-visible hour (inclusive); loop runs to alwaysTo + 1.
//   - Hours in [alwaysFrom, alwaysTo] are always shown as individual rows.
//   - Hours before alwaysFrom without sessions form collapsible bands, capped at fixed
//     split points (morning / afternoon) so they collapse independently.
//   - Hours occupied by sessions are always shown as individual rows.
function buildCalendarRows(sessions, expandedBands, alwaysFrom, alwaysTo) {
  const occupied = new Set(sessions.map(s => parseInt(s.time.split(':')[0], 10)));
  const endHour = alwaysTo + 1; // include the alwaysTo hour slot (e.g. 23:00)
  const bandStarts = [CALENDAR_START, MORNING_BAND_END, alwaysFrom].sort((a, b) => a - b);
  const rows = [];
  let i = CALENDAR_START;
  while (i < endHour) {
    const alwaysOn = i >= alwaysFrom;
    if (alwaysOn || occupied.has(i)) {
      rows.push({ type: 'hour', hour: i });
      i++;
    } else {
      const nextBoundary = bandStarts.find(s => s > i) ?? alwaysFrom;
      let j = i;
      while (j < nextBoundary && !occupied.has(j)) {
        j++;
      }
      if (expandedBands.has(i)) {
        for (let k = i; k < j; k++) rows.push({ type: 'hour', hour: k });
      } else {
        rows.push({ type: 'collapsed', from: i, to: j });
      }
      i = j;
    }
  }
  return rows;
}

function computeRowLayout(rows, hourH) {
  let offset = 0;
  const offsets = [];
  for (const row of rows) {
    offsets.push(offset);
    offset += row.type === 'hour' ? hourH : COLLAPSED_H;
  }
  return { rowOffsets: offsets, totalHeight: offset };
}

function getSessionTopPx(rows, rowOffsets, hourH, time) {
  const [h, m] = time.split(':').map(Number);
  const idx = rows.findIndex(r => r.type === 'hour' && r.hour === h);
  if (idx === -1) return -1;
  return rowOffsets[idx] + (m / 60) * hourH;
}

// ─── Settings loader ────────────────────────────────────────────────────────

function useStudioSettings() {
  const [settings, setSettings] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    getSettings()
      .then(data => { if (!cancelled) setSettings(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return settings;
}

// ─── Create Lesson Modal ─────────────────────────────────────────────────────

function CreateLessonModal({ dayIndex, hour, weekStart, onClose, onCreated, defaultMode = 'onsite' }) {
  const [students, setStudents] = React.useState([]);
  const [instructors, setInstructors] = React.useState([]);
  const [lessonTypes, setLessonTypes] = React.useState([]);
  const [metaLoading, setMetaLoading] = React.useState(true);
  const [selectedStudent, setSelectedStudent] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [comboOpen, setComboOpen] = React.useState(false);
  const [comboHighlight, setComboHighlight] = React.useState(0);
  const [mode, setMode] = React.useState(defaultMode);
  const [studentDefaultMode, setStudentDefaultMode] = React.useState(null);
  const [instructorId, setInstructorId] = React.useState('');
  const [lessonTypeId, setLessonTypeId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [fetchError, setFetchError] = React.useState(null);
  const [submitError, setSubmitError] = React.useState(null);
  const inputRef = React.useRef(null);
  const comboRootRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getStudents(), getInstructors(), getLessonTypes()])
      .then(([studentsR, instructorsR, typesR]) => {
        if (cancelled) return;
        const errors = [];
        if (studentsR.status === 'fulfilled') setStudents(studentsR.value);
        else errors.push('Öğrenci listesi alınamadı.');
        if (instructorsR.status === 'fulfilled') {
          setInstructors(instructorsR.value);
          if (instructorsR.value.length > 0) setInstructorId(String(instructorsR.value[0].id));
        } else {
          errors.push('Eğitmen listesi alınamadı.');
        }
        if (typesR.status === 'fulfilled') {
          setLessonTypes(typesR.value);
          if (typesR.value.length > 0) setLessonTypeId(String(typesR.value[0].id));
        } else {
          errors.push('Ders türü listesi alınamadı.');
        }
        if (errors.length > 0) setFetchError(errors.join(' '));
        setMetaLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!comboOpen) return;
    function onDocClick(e) {
      if (comboRootRef.current && !comboRootRef.current.contains(e.target)) {
        setComboOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [comboOpen]);

  const lessonDate = React.useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    d.setHours(hour, 0, 0, 0);
    return d;
  }, [weekStart, dayIndex, hour]);

  const dateLabel = lessonDate.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeLabel = `${String(hour).padStart(2, '0')}:00`;

  const filtered = React.useMemo(() => {
    if (!query.trim()) return students;
    const q = query.toLowerCase();
    const qd = query.replace(/\D/g, '');
    return students.filter(s =>
      s.full_name.toLowerCase().includes(q) ||
      (s.nickname && s.nickname.toLowerCase().includes(q)) ||
      (qd.length > 0 && s.phone && s.phone.replace(/\D/g, '').includes(qd))
    );
  }, [students, query]);

  function selectStudent(s) {
    setSelectedStudent(s);
    setQuery('');
    setComboOpen(false);
    const pref = s.preferred_mode || s.default_mode;
    if (pref === 'online' || pref === 'onsite') {
      setMode(pref);
      setStudentDefaultMode(pref);
    } else {
      setStudentDefaultMode(null);
    }
  }

  function clearStudent() {
    setSelectedStudent(null);
    setQuery('');
    setStudentDefaultMode(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleComboKey(e) {
    const opts = filtered.slice(0, 8);
    if (!comboOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setComboOpen(true);
        setComboHighlight(0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setComboHighlight(h => Math.min(h + 1, opts.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setComboHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (opts[comboHighlight]) selectStudent(opts[comboHighlight]);
    } else if (e.key === 'Escape') {
      setComboOpen(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedStudent) return;
    if (!instructorId || !lessonTypeId) return;
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-create-lesson" onClick={e => e.stopPropagation()}>

        <div className="mcl-head">
          <div className="mcl-title-row">
            <h3>Yeni ders</h3>
            <button type="button" className="mcl-close" onClick={onClose} aria-label="Kapat">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="mcl-when">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.35"/>
              <path d="M2 7h12" stroke="currentColor" strokeWidth="1.35"/>
              <path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
            </svg>
            <span className="mcl-when-date">{dateLabel}</span>
            <span className="mcl-when-sep">·</span>
            <span className="mcl-when-time">{timeLabel}</span>
          </div>
        </div>

        {fetchError && <div className="mcl-banner mcl-banner-error">{fetchError}</div>}

        <form onSubmit={handleSubmit} className="mcl-form">

          <div className="form-row">
            <label>Öğrenci</label>
            <div className="combo-root" ref={comboRootRef}>
              {selectedStudent ? (
                <div className="combo-chosen">
                  <Avatar name={selectedStudent.full_name} size="xs" soft />
                  <span className="combo-chosen-name">{selectedStudent.full_name}{selectedStudent.nickname && <span className="combo-opt-nick"> ({selectedStudent.nickname})</span>}</span>
                  <button type="button" className="combo-clear" onClick={clearStudent} aria-label="Seçimi temizle">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                </div>
              ) : (
                <div className="combo-field">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="combo-icon" aria-hidden="true">
                    <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.35"/>
                    <path d="M9.5 9.5L13.5 13.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    className="combo-input"
                    placeholder="İsim veya telefon ara…"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setComboOpen(true); setComboHighlight(0); }}
                    onFocus={() => setComboOpen(true)}
                    onKeyDown={handleComboKey}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              )}
              {comboOpen && !selectedStudent && (
                <div className="combo-drop">
                  {students.length === 0 ? (
                    <div className="combo-hint">Öğrenciler yükleniyor…</div>
                  ) : filtered.length === 0 ? (
                    <div className="combo-hint">Sonuç bulunamadı.</div>
                  ) : (
                    filtered.slice(0, 8).map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        className={"combo-opt" + (i === comboHighlight ? " is-hi" : "")}
                        onMouseEnter={() => setComboHighlight(i)}
                        onMouseDown={e => { e.preventDefault(); selectStudent(s); }}
                      >
                        <Avatar name={s.full_name} size="xs" soft />
                        <span className="combo-opt-name">{s.full_name}{s.nickname && <span className="combo-opt-nick"> ({s.nickname})</span>}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-row">
              <label>Eğitmen</label>
              <select
                value={instructorId}
                onChange={e => setInstructorId(e.target.value)}
                disabled={metaLoading || instructors.length === 0}
              >
                {metaLoading && <option value="">Yükleniyor…</option>}
                {!metaLoading && instructors.length === 0 && (
                  <option value="">Aktif eğitmen yok</option>
                )}
                {instructors.map(i => (
                  <option key={i.id} value={String(i.id)}>{i.full_name}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Ders türü</label>
              <select
                value={lessonTypeId}
                onChange={e => setLessonTypeId(e.target.value)}
                disabled={metaLoading || lessonTypes.length === 0}
              >
                {metaLoading && <option value="">Yükleniyor…</option>}
                {!metaLoading && lessonTypes.length === 0 && (
                  <option value="">Aktif ders türü yok</option>
                )}
                {lessonTypes.map(t => (
                  <option key={t.id} value={String(t.id)}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <label>
              Mod
              {studentDefaultMode && (
                <span className="mcl-mode-hint">· varsayılan: {studentDefaultMode === 'online' ? 'online' : 'yüzyüze'}</span>
              )}
              {selectedStudent && !studentDefaultMode && (
                <span className="mcl-mode-hint mcl-mode-hint-muted">· tercih belirlenmemiş</span>
              )}
            </label>
            <div className="mode-seg">
              <button
                type="button"
                className={"mode-btn" + (mode === 'onsite' ? ' is-on' : '')}
                onClick={() => setMode('onsite')}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                </svg>
                Yüzyüze
              </button>
              <button
                type="button"
                className={"mode-btn" + (mode === 'online' ? ' is-on' : '')}
                onClick={() => setMode('online')}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="1.5" y="3" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Online
              </button>
            </div>
          </div>

          <div className="form-row mcl-note-row">
            <label>Not <span className="mcl-opt">(opsiyonel)</span></label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Hatırlatıcı veya ek bilgi…"
            />
          </div>

          {submitError && (
            <div className="mcl-banner mcl-banner-error" style={{ marginBottom: 4 }}>{submitError}</div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                !selectedStudent ||
                submitting ||
                metaLoading ||
                !instructorId ||
                !lessonTypeId
              }
            >
              {submitting ? 'Ekleniyor…' : 'Ekle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Standalone Create Lesson Modal (Quick Actions) ─────────────────────────

function StandaloneCreateLessonModal({ onClose, onCreated, defaultMode = 'onsite' }) {
  const [students, setStudents] = React.useState([]);
  const [instructors, setInstructors] = React.useState([]);
  const [lessonTypes, setLessonTypes] = React.useState([]);
  const [metaLoading, setMetaLoading] = React.useState(true);
  const [selectedStudent, setSelectedStudent] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [comboOpen, setComboOpen] = React.useState(false);
  const [comboHighlight, setComboHighlight] = React.useState(0);
  const [mode, setMode] = React.useState(defaultMode);
  const [studentDefaultMode, setStudentDefaultMode] = React.useState(null);
  const [instructorId, setInstructorId] = React.useState('');
  const [lessonTypeId, setLessonTypeId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [dateStr, setDateStr] = React.useState(getTodayDateStr);
  const [timeStr, setTimeStr] = React.useState('09:00');
  const [submitting, setSubmitting] = React.useState(false);
  const [fetchError, setFetchError] = React.useState(null);
  const [submitError, setSubmitError] = React.useState(null);
  const inputRef = React.useRef(null);
  const comboRootRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getStudents(), getInstructors(), getLessonTypes()])
      .then(([studentsR, instructorsR, typesR]) => {
        if (cancelled) return;
        const errors = [];
        if (studentsR.status === 'fulfilled') setStudents(studentsR.value);
        else errors.push('Öğrenci listesi alınamadı.');
        if (instructorsR.status === 'fulfilled') {
          setInstructors(instructorsR.value);
          if (instructorsR.value.length > 0) setInstructorId(String(instructorsR.value[0].id));
        } else {
          errors.push('Eğitmen listesi alınamadı.');
        }
        if (typesR.status === 'fulfilled') {
          setLessonTypes(typesR.value);
          if (typesR.value.length > 0) setLessonTypeId(String(typesR.value[0].id));
        } else {
          errors.push('Ders türü listesi alınamadı.');
        }
        if (errors.length > 0) setFetchError(errors.join(' '));
        setMetaLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!comboOpen) return;
    function onDocClick(e) {
      if (comboRootRef.current && !comboRootRef.current.contains(e.target)) setComboOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [comboOpen]);

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !submitting) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return students;
    const q = query.toLowerCase();
    const qd = query.replace(/\D/g, '');
    return students.filter(s =>
      s.full_name.toLowerCase().includes(q) ||
      (s.nickname && s.nickname.toLowerCase().includes(q)) ||
      (qd.length > 0 && s.phone && s.phone.replace(/\D/g, '').includes(qd))
    );
  }, [students, query]);

  function selectStudent(s) {
    setSelectedStudent(s);
    setQuery('');
    setComboOpen(false);
    const pref = s.preferred_mode || s.default_mode;
    if (pref === 'online' || pref === 'onsite') {
      setMode(pref);
      setStudentDefaultMode(pref);
    } else {
      setStudentDefaultMode(null);
    }
  }

  function clearStudent() {
    setSelectedStudent(null);
    setQuery('');
    setStudentDefaultMode(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleComboKey(e) {
    const opts = filtered.slice(0, 8);
    if (!comboOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); setComboOpen(true); setComboHighlight(0); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setComboHighlight(h => Math.min(h + 1, opts.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setComboHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (opts[comboHighlight]) selectStudent(opts[comboHighlight]); }
    else if (e.key === 'Escape') { setComboOpen(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedStudent || !instructorId || !lessonTypeId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const [y, mo, d] = dateStr.split('-').map(Number);
      const [th, tm] = timeStr.split(':').map(Number);
      const startsAt = new Date(y, mo - 1, d, th, tm, 0, 0).toISOString();
      await createLesson({
        studentId: Number(selectedStudent.id),
        startsAt,
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-create-lesson" onClick={e => e.stopPropagation()}>
        <div className="mcl-head">
          <div className="mcl-title-row">
            <h3>Yeni ders</h3>
            <button type="button" className="mcl-close" onClick={onClose} aria-label="Kapat">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {fetchError && <div className="mcl-banner mcl-banner-error">{fetchError}</div>}

        <form onSubmit={handleSubmit} className="mcl-form">

          <div className="form-row-2">
            <div className="form-row">
              <label>Tarih</label>
              <input
                type="date"
                value={dateStr}
                onChange={e => setDateStr(e.target.value)}
                required
              />
            </div>
            <div className="form-row">
              <label>Saat</label>
              <select value={timeStr} onChange={e => setTimeStr(e.target.value)}>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <label>Öğrenci</label>
            <div className="combo-root" ref={comboRootRef}>
              {selectedStudent ? (
                <div className="combo-chosen">
                  <Avatar name={selectedStudent.full_name} size="xs" soft />
                  <span className="combo-chosen-name">{selectedStudent.full_name}{selectedStudent.nickname && <span className="combo-opt-nick"> ({selectedStudent.nickname})</span>}</span>
                  <button type="button" className="combo-clear" onClick={clearStudent} aria-label="Seçimi temizle">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                </div>
              ) : (
                <div className="combo-field">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="combo-icon" aria-hidden="true">
                    <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.35"/>
                    <path d="M9.5 9.5L13.5 13.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    className="combo-input"
                    placeholder="İsim veya telefon ara…"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setComboOpen(true); setComboHighlight(0); }}
                    onFocus={() => setComboOpen(true)}
                    onKeyDown={handleComboKey}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              )}
              {comboOpen && !selectedStudent && (
                <div className="combo-drop">
                  {students.length === 0 ? (
                    <div className="combo-hint">Öğrenciler yükleniyor…</div>
                  ) : filtered.length === 0 ? (
                    <div className="combo-hint">Sonuç bulunamadı.</div>
                  ) : (
                    filtered.slice(0, 8).map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        className={"combo-opt" + (i === comboHighlight ? " is-hi" : "")}
                        onMouseEnter={() => setComboHighlight(i)}
                        onMouseDown={e => { e.preventDefault(); selectStudent(s); }}
                      >
                        <Avatar name={s.full_name} size="xs" soft />
                        <span className="combo-opt-name">{s.full_name}{s.nickname && <span className="combo-opt-nick"> ({s.nickname})</span>}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-row">
              <label>Eğitmen</label>
              <select
                value={instructorId}
                onChange={e => setInstructorId(e.target.value)}
                disabled={metaLoading || instructors.length === 0}
              >
                {metaLoading && <option value="">Yükleniyor…</option>}
                {!metaLoading && instructors.length === 0 && <option value="">Aktif eğitmen yok</option>}
                {instructors.map(i => <option key={i.id} value={String(i.id)}>{i.full_name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Ders türü</label>
              <select
                value={lessonTypeId}
                onChange={e => setLessonTypeId(e.target.value)}
                disabled={metaLoading || lessonTypes.length === 0}
              >
                {metaLoading && <option value="">Yükleniyor…</option>}
                {!metaLoading && lessonTypes.length === 0 && <option value="">Aktif ders türü yok</option>}
                {lessonTypes.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <label>
              Mod
              {studentDefaultMode && (
                <span className="mcl-mode-hint">· varsayılan: {studentDefaultMode === 'online' ? 'online' : 'yüzyüze'}</span>
              )}
              {selectedStudent && !studentDefaultMode && (
                <span className="mcl-mode-hint mcl-mode-hint-muted">· tercih belirlenmemiş</span>
              )}
            </label>
            <div className="mode-seg">
              <button type="button" className={"mode-btn" + (mode === 'onsite' ? ' is-on' : '')} onClick={() => setMode('onsite')}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                </svg>
                Yüzyüze
              </button>
              <button type="button" className={"mode-btn" + (mode === 'online' ? ' is-on' : '')} onClick={() => setMode('online')}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="1.5" y="3" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Online
              </button>
            </div>
          </div>

          <div className="form-row mcl-note-row">
            <label>Not <span className="mcl-opt">(opsiyonel)</span></label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Hatırlatıcı veya ek bilgi…"
            />
          </div>

          {submitError && (
            <div className="mcl-banner mcl-banner-error" style={{ marginBottom: 4 }}>{submitError}</div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selectedStudent || submitting || metaLoading || !instructorId || !lessonTypeId || !dateStr}
            >
              {submitting ? 'Ekleniyor…' : 'Ekle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Quick Sale Modal ────────────────────────────────────────────────────────

function QuickSaleModal({ onClose, onCreated }) {
  const [students, setStudents] = React.useState([]);
  const [selectedStudent, setSelectedStudent] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [comboOpen, setComboOpen] = React.useState(false);
  const [comboHighlight, setComboHighlight] = React.useState(0);
  const [amount, setAmount] = React.useState('');
  const [saleNote, setSaleNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [fetchError, setFetchError] = React.useState(null);
  const [submitError, setSubmitError] = React.useState(null);
  const inputRef = React.useRef(null);
  const comboRootRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    getStudents()
      .then(data => { if (!cancelled) setStudents(data); })
      .catch(() => { if (!cancelled) setFetchError('Öğrenci listesi alınamadı.'); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!comboOpen) return;
    function onDocClick(e) {
      if (comboRootRef.current && !comboRootRef.current.contains(e.target)) setComboOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [comboOpen]);

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !submitting) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return students;
    const q = query.toLowerCase();
    const qd = query.replace(/\D/g, '');
    return students.filter(s =>
      s.full_name.toLowerCase().includes(q) ||
      (s.nickname && s.nickname.toLowerCase().includes(q)) ||
      (qd.length > 0 && s.phone && s.phone.replace(/\D/g, '').includes(qd))
    );
  }, [students, query]);

  function selectStudent(s) {
    setSelectedStudent(s);
    setQuery('');
    setComboOpen(false);
  }

  function clearStudent() {
    setSelectedStudent(null);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleComboKey(e) {
    const opts = filtered.slice(0, 8);
    if (!comboOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); setComboOpen(true); setComboHighlight(0); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setComboHighlight(h => Math.min(h + 1, opts.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setComboHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (opts[comboHighlight]) selectStudent(opts[comboHighlight]); }
    else if (e.key === 'Escape') { setComboOpen(false); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!selectedStudent || !amount || parseFloat(amount) <= 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createProductSaleApi({
        studentId: Number(selectedStudent.id),
        soldAt: new Date().toISOString(),
        totalAmount: parseFloat(amount),
        note: saleNote.trim() || null,
      });
      onCreated();
    } catch (err) {
      setSubmitError(err.message || 'Ürün satışı kaydedilemedi.');
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-create-lesson" onClick={e => e.stopPropagation()}>
        <div className="mcl-head">
          <div className="mcl-title-row">
            <h3>Ürün satışı</h3>
            <button type="button" className="mcl-close" onClick={onClose} aria-label="Kapat">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {fetchError && <div className="mcl-banner mcl-banner-error">{fetchError}</div>}

        <form onSubmit={handleSubmit} className="mcl-form">

          <div className="form-row">
            <label>Öğrenci</label>
            <div className="combo-root" ref={comboRootRef}>
              {selectedStudent ? (
                <div className="combo-chosen">
                  <Avatar name={selectedStudent.full_name} size="xs" soft />
                  <span className="combo-chosen-name">{selectedStudent.full_name}{selectedStudent.nickname && <span className="combo-opt-nick"> ({selectedStudent.nickname})</span>}</span>
                  <button type="button" className="combo-clear" onClick={clearStudent} aria-label="Seçimi temizle">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                </div>
              ) : (
                <div className="combo-field">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="combo-icon" aria-hidden="true">
                    <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.35"/>
                    <path d="M9.5 9.5L13.5 13.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    className="combo-input"
                    placeholder="İsim veya telefon ara…"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setComboOpen(true); setComboHighlight(0); }}
                    onFocus={() => setComboOpen(true)}
                    onKeyDown={handleComboKey}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              )}
              {comboOpen && !selectedStudent && (
                <div className="combo-drop">
                  {students.length === 0 ? (
                    <div className="combo-hint">Öğrenciler yükleniyor…</div>
                  ) : filtered.length === 0 ? (
                    <div className="combo-hint">Sonuç bulunamadı.</div>
                  ) : (
                    filtered.slice(0, 8).map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        className={"combo-opt" + (i === comboHighlight ? " is-hi" : "")}
                        onMouseEnter={() => setComboHighlight(i)}
                        onMouseDown={e => { e.preventDefault(); selectStudent(s); }}
                      >
                        <Avatar name={s.full_name} size="xs" soft />
                        <span className="combo-opt-name">{s.full_name}{s.nickname && <span className="combo-opt-nick"> ({s.nickname})</span>}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="form-row">
            <label>Tutar (₺)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              required
            />
          </div>

          <div className="form-row mcl-note-row">
            <label>Not <span className="mcl-opt">(opsiyonel)</span></label>
            <input
              type="text"
              value={saleNote}
              onChange={e => setSaleNote(e.target.value)}
              placeholder="Ürün adı veya açıklama…"
            />
          </div>

          {submitError && (
            <div className="mcl-banner mcl-banner-error" style={{ marginBottom: 4 }}>{submitError}</div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selectedStudent || !amount || parseFloat(amount) <= 0 || submitting}
            >
              {submitting ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Quick Pay Modal ─────────────────────────────────────────────────────────

function QuickPayModal({ onClose }) {
  const [students, setStudents] = React.useState([]);
  const [selectedStudent, setSelectedStudent] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [comboOpen, setComboOpen] = React.useState(false);
  const [comboHighlight, setComboHighlight] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [paymentTarget, setPaymentTarget] = React.useState(null);
  const [fetchError, setFetchError] = React.useState(null);
  const inputRef = React.useRef(null);
  const comboRootRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    getStudents()
      .then(data => { if (!cancelled) setStudents(data); })
      .catch(() => { if (!cancelled) setFetchError('Öğrenci listesi alınamadı.'); });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!comboOpen) return;
    function onDocClick(e) {
      if (comboRootRef.current && !comboRootRef.current.contains(e.target)) setComboOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [comboOpen]);

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !loading && !paymentTarget) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, loading, paymentTarget]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return students;
    const q = query.toLowerCase();
    const qd = query.replace(/\D/g, '');
    return students.filter(s =>
      s.full_name.toLowerCase().includes(q) ||
      (s.nickname && s.nickname.toLowerCase().includes(q)) ||
      (qd.length > 0 && s.phone && s.phone.replace(/\D/g, '').includes(qd))
    );
  }, [students, query]);

  function selectStudent(s) {
    setSelectedStudent(s);
    setQuery('');
    setComboOpen(false);
  }

  function clearStudent() {
    setSelectedStudent(null);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleComboKey(e) {
    const opts = filtered.slice(0, 8);
    if (!comboOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); setComboOpen(true); setComboHighlight(0); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setComboHighlight(h => Math.min(h + 1, opts.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setComboHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (opts[comboHighlight]) selectStudent(opts[comboHighlight]); }
    else if (e.key === 'Escape') { setComboOpen(false); }
  }

  async function handleProceed() {
    if (!selectedStudent) return;
    setLoading(true);
    try {
      const [lessons, productSales] = await Promise.all([
        getStudentLessons(selectedStudent.id),
        getStudentProductSales(selectedStudent.id),
      ]);
      setPaymentTarget({
        student: { id: selectedStudent.id, full_name: selectedStudent.full_name },
        detail: { lessons, productSales },
      });
    } finally {
      setLoading(false);
    }
  }

  if (paymentTarget) {
    return (
      <ReceivePaymentModal
        student={paymentTarget.student}
        detail={paymentTarget.detail}
        onClose={onClose}
        onSuccess={onClose}
      />
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-create-lesson" onClick={e => e.stopPropagation()}>
        <div className="mcl-head">
          <div className="mcl-title-row">
            <h3>Ödeme al</h3>
            <button type="button" className="mcl-close" onClick={onClose} aria-label="Kapat">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {fetchError && <div className="mcl-banner mcl-banner-error">{fetchError}</div>}

        <div className="mcl-form">
          <div className="form-row">
            <label>Öğrenci</label>
            <div className="combo-root" ref={comboRootRef}>
              {selectedStudent ? (
                <div className="combo-chosen">
                  <Avatar name={selectedStudent.full_name} size="xs" soft />
                  <span className="combo-chosen-name">{selectedStudent.full_name}{selectedStudent.nickname && <span className="combo-opt-nick"> ({selectedStudent.nickname})</span>}</span>
                  <button type="button" className="combo-clear" onClick={clearStudent} aria-label="Seçimi temizle">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  </button>
                </div>
              ) : (
                <div className="combo-field">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="combo-icon" aria-hidden="true">
                    <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.35"/>
                    <path d="M9.5 9.5L13.5 13.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    className="combo-input"
                    placeholder="İsim veya telefon ara…"
                    value={query}
                    onChange={e => { setQuery(e.target.value); setComboOpen(true); setComboHighlight(0); }}
                    onFocus={() => setComboOpen(true)}
                    onKeyDown={handleComboKey}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              )}
              {comboOpen && !selectedStudent && (
                <div className="combo-drop">
                  {students.length === 0 ? (
                    <div className="combo-hint">Öğrenciler yükleniyor…</div>
                  ) : filtered.length === 0 ? (
                    <div className="combo-hint">Sonuç bulunamadı.</div>
                  ) : (
                    filtered.slice(0, 8).map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        className={"combo-opt" + (i === comboHighlight ? " is-hi" : "")}
                        onMouseEnter={() => setComboHighlight(i)}
                        onMouseDown={e => { e.preventDefault(); selectStudent(s); }}
                      >
                        <Avatar name={s.full_name} size="xs" soft />
                        <span className="combo-opt-name">{s.full_name}{s.nickname && <span className="combo-opt-nick"> ({s.nickname})</span>}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!selectedStudent || loading}
              onClick={handleProceed}
            >
              {loading ? 'Yükleniyor…' : 'Devam'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Lesson Modal ────────────────────────────────────────────────────────────

const LESSON_STATE_META = {
  planned: { label: 'Planlandı',              cls: 'lm-pill-planned' },
  unpaid:  { label: 'Tamamlandı · Ödenmedi',  cls: 'lm-pill-unpaid' },
  partial: { label: 'Kısmi ödendi',           cls: 'lm-pill-partial' },
  paid:    { label: 'Ödendi',                 cls: 'lm-pill-paid' },
};

function ShoppingBagIcon({ size = 11 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="ic-bag"
    >
      <path
        d="M3.5 5.5h9l-0.7 8.2a1 1 0 0 1-1 0.9H5.2a1 1 0 0 1-1-0.9L3.5 5.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 5.5V4a2.5 2.5 0 1 1 5 0v1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function debtStateFor(paid, total) {
  if (total <= 0) return 'empty';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

// Borç kartı — açık borç durumunda kalan rakamı baskın (BÜYÜK + renkli),
// gross küçük ve sakin durur. Tahsil edildikten sonra sade görünüme döner.
// Sol kenar şeridi durumu tek bakışta okunur kılar.
function DebtCard({ label, icon, total, paid, remaining, paymentMethod, onCollect, onEdit, disabled }) {
  const state = debtStateFor(paid, total);
  const headline = state === 'partial' ? 'kalan' : 'borç';
  return (
    <div className={"lm-debt-card lm-debt-card-" + state}>
      <div className="lm-debt-head">
        <span className="lm-debt-label">
          {icon}
          <span className="lm-debt-label-text">{label}</span>
          {onEdit && (
            <button
              type="button"
              className="lm-debt-edit"
              onClick={onEdit}
              disabled={disabled}
              aria-label="Düzenle"
              title="Düzenle"
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M10 4l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </span>
        {(state === 'paid' || state === 'empty') && (
          <span className="lm-debt-gross">{state === 'empty' ? '—' : fmtTL(total)}</span>
        )}
      </div>

      {state === 'paid' && (
        <div className="lm-debt-cleared">
          <span className="lm-debt-cleared-tick" aria-hidden="true">✓</span>
          <span>
            Tahsil edildi
            {paymentMethod ? ` · ${paymentMethod}` : ''}
          </span>
        </div>
      )}

      {(state === 'unpaid' || state === 'partial') && (
        <>
          <div className="lm-debt-headline">
            <span className="lm-debt-amt-big">{fmtTL(remaining)}</span>
            <span className="lm-debt-amt-sub">{headline}</span>
          </div>
          <div className="lm-debt-foot">
            <span className="lm-debt-meta">
              {state === 'partial'
                ? `${fmtTL(paid)} / ${fmtTL(total)} ödendi`
                : `${fmtTL(total)} toplam`}
            </span>
            <button
              type="button"
              className="btn btn-primary lm-debt-collect"
              disabled={disabled}
              onClick={onCollect}
            >{`${fmtTL(remaining)} tahsil et`}</button>
          </div>
        </>
      )}
    </div>
  );
}

function LessonModal({ session, onClose, onUpdated, activePaymentMethods = { cash: true, iban: true } }) {
  // phase: 'detail' | 'complete' | 'cancel' | 'pay' | 'edit-sale'
  const [phase, setPhase] = React.useState('detail');
  // saleChoice: null (henüz seçilmedi) | 'no' (ürün satışı yok) | 'yes' (var, form açık)
  const [saleChoice, setSaleChoice] = React.useState(null);
  const [saleAmount, setSaleAmount] = React.useState('');
  const [saleNote, setSaleNote] = React.useState('');
  const [cancelReason, setCancelReason] = React.useState(null); // 'student' | 'mistake'
  const [paySource, setPaySource] = React.useState(activePaymentMethods.cash ? 'cash' : 'iban');
  const [payAmount, setPayAmount] = React.useState('');
  const [payNote, setPayNote] = React.useState('');
  // payTarget pay fazının hangi borç kalemine yöneldiğini taşır.
  // { type: 'lesson' | 'product_sale', id, label, total, paid, remaining }
  const [payTarget, setPayTarget] = React.useState(null);
  // edit-sale fazı: hangi ürün satışının düzenlendiği + form değerleri.
  // { id, paid, originalTotal, originalNote }
  const [editSaleTarget, setEditSaleTarget] = React.useState(null);
  const [editSaleAmount, setEditSaleAmount] = React.useState('');
  const [editSaleNote, setEditSaleNote] = React.useState('');
  // Düzenleme penceresinde "Bu satışı sil" basıldıktan sonraki onay alt-adımı.
  const [confirmingDeleteSale, setConfirmingDeleteSale] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !submitting) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  if (!session) return null;

  const isScheduled = session.lessonState === 'planned';
  const isCompleted = ['paid', 'unpaid', 'partial'].includes(session.lessonState);
  const price = Number(session.price) || 0;
  const paid = Number(session.paid) || 0;
  const remaining = Math.max(0, price - paid);
  const productSales = Array.isArray(session.productSales) ? session.productSales : [];
  // Toplam kalan = ders kalanı + tüm bağlı ürün satışlarının kalan tutarları.
  // Bu satır kullanıcıyı yalnızca ders borcunu görüp diğerini atlamaktan korur.
  const productSalesRemaining = productSales.reduce(
    (sum, s) => sum + (Number(s.remaining) || 0),
    0,
  );
  const totalRemaining = remaining + productSalesRemaining;

  const dateLabel = session.startsAt
    ? new Date(session.startsAt).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })
    : DAYS_TR[session.day] || '';
  const stateMeta = LESSON_STATE_META[session.lessonState] || LESSON_STATE_META.planned;

  function resetToDetail() {
    setPhase('detail');
    setSaleChoice(null);
    setSaleAmount('');
    setSaleNote('');
    setCancelReason(null);
    setPayAmount('');
    setPayNote('');
    setPaySource(activePaymentMethods.cash ? 'cash' : 'iban');
    setPayTarget(null);
    setEditSaleTarget(null);
    setEditSaleAmount('');
    setEditSaleNote('');
    setConfirmingDeleteSale(false);
    setError(null);
  }

  // Ürün satışını düzenleme fazını açar. Yanlış girilen tutar ya da nota
  // düzeltme imkanı sağlar; tahsil edilmiş kısım varsa yeni tutar ondan
  // küçük olamaz (aşağı doğru düzenlemede submit'te validate edilir).
  function openEditSalePhase(sale) {
    setEditSaleTarget({
      id: sale.id,
      paid: Number(sale.paidAmount) || 0,
      originalTotal: Number(sale.totalAmount) || 0,
      originalNote: sale.note || '',
    });
    setEditSaleAmount(String(Number(sale.totalAmount) || 0));
    setEditSaleNote(sale.note || '');
    setConfirmingDeleteSale(false);
    setError(null);
    setPhase('edit-sale');
  }

  // Bir borç kaleminin "Tahsil" butonuna basıldığında çağrılır. Pay fazını
  // o kaleme özel bağlamda açar: hangi kalem için olduğu pay ekranında
  // bariz görünür ve tutar input'u kalan miktarla hazır gelir (tek tık ile
  // tam tahsil; kullanıcı isterse düzenleyebilir).
  function openPayPhase(target) {
    setPayTarget(target);
    setPayAmount(target.remaining > 0 ? String(target.remaining) : '');
    setPayNote('');
    setPaySource(activePaymentMethods.cash ? 'cash' : 'iban');
    setError(null);
    setPhase('pay');
  }

  async function handleComplete() {
    setSubmitting(true);
    setError(null);
    try {
      // Tamamlama yalnızca dersi + (varsa) satışı kaydeder. Tahsilat ayrı bir
      // adım — detay görünümünde her açık borç için Tahsil butonu var. Bu sayede
      // kısmi/çoklu kaynaklı ödemeler (ör. kısmi nakit + sonra IBAN) doğal akışla
      // ayrı payment kayıtları olarak tutulabiliyor.
      const productSale =
        saleChoice === 'yes' && saleAmount && parseFloat(saleAmount) > 0
          ? {
              totalAmount: parseFloat(saleAmount),
              note: saleNote || null,
            }
          : null;
      await completeLessonApi(session.id, productSale ? { productSale } : {});
      onUpdated();
    } catch (err) {
      setError(err.message || 'Bir hata oluştu.');
      setSubmitting(false);
    }
  }

  async function handleCancelSubmit() {
    if (!cancelReason) return;
    setSubmitting(true);
    setError(null);
    try {
      if (cancelReason === 'mistake') {
        await deleteLessonApi(session.id);
      } else {
        await changeLessonStatusApi(session.id, 'cancelled');
      }
      onUpdated();
    } catch (err) {
      setError(err.message || 'Ders iptal edilemedi.');
      setSubmitting(false);
    }
  }

  async function handlePay(e) {
    e.preventDefault();
    if (!payTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      await createCashPayment({
        targetType: payTarget.type,
        targetId: payTarget.id,
        amount: parseFloat(payAmount),
        source: paySource,
        paidAt: new Date().toISOString(),
        note: payNote || null,
      });
      onUpdated();
    } catch (err) {
      setError(err.message || 'Ödeme kaydedilemedi.');
      setSubmitting(false);
    }
  }

  async function handleEditSaleSubmit(e) {
    e.preventDefault();
    if (!editSaleTarget) return;
    const newAmount = parseFloat(editSaleAmount);
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      setError('Geçerli bir tutar gir.');
      return;
    }
    if (newAmount < editSaleTarget.paid) {
      setError(`Yeni tutar ödenmiş ${fmtTL(editSaleTarget.paid)} miktarından düşük olamaz.`);
      return;
    }
    const trimmedNote = editSaleNote.trim();
    const fields = {};
    if (newAmount !== editSaleTarget.originalTotal) fields.totalAmount = newAmount;
    if (trimmedNote !== (editSaleTarget.originalNote || '')) {
      fields.note = trimmedNote === '' ? null : trimmedNote;
    }
    if (Object.keys(fields).length === 0) {
      resetToDetail();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateProductSaleApi(editSaleTarget.id, fields);
      onUpdated();
    } catch (err) {
      setError(err.message || 'Ürün satışı güncellenemedi.');
      setSubmitting(false);
    }
  }

  async function handleDeleteSale() {
    if (!editSaleTarget) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteProductSaleApi(editSaleTarget.id);
      onUpdated();
    } catch (err) {
      setError(err.message || 'Ürün satışı silinemedi.');
      setSubmitting(false);
    }
  }

  // Tamamla butonu için kurallar:
  //  - submit oluyorsa pasif
  //  - "Bu derste ürün satışı yapıldı mı?" sorusuna henüz cevap verilmediyse pasif (atlama önlenir)
  //  - "Evet" seçildiyse tutar zorunlu, > 0 olmalı
  const completeDisabled =
    submitting ||
    saleChoice === null ||
    (saleChoice === 'yes' && (!saleAmount || parseFloat(saleAmount) <= 0));

  return (
    <div className="modal-backdrop" onClick={() => { if (!submitting) onClose(); }}>
      <div className="modal modal-lesson" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>

        {/* ── Head ── */}
        <div className="lm-head">
          <div className="lm-head-top">
            <span className={"lm-state-pill " + stateMeta.cls}>{stateMeta.label}</span>
            <button className="lm-close" onClick={onClose} aria-label="Kapat" disabled={submitting}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="lm-student-name">{session.studentName}{session.studentNickname && <span className="combo-opt-nick"> ({session.studentNickname})</span>}</div>
          <div className="lm-when">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.35"/>
              <path d="M2 7h12" stroke="currentColor" strokeWidth="1.35"/>
              <path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
            </svg>
            <span className="lm-date">{dateLabel}</span>
            <span className="lm-sep">·</span>
            <span className="lm-time-badge">{session.time}</span>
            <span className={"lm-mode-tag" + (session.mode === 'online' ? ' lm-mode-online' : '')}>
              {session.mode === 'online' ? 'Online' : 'Yüzyüze'}
            </span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="lm-body">

          {/* DETAIL — planned */}
          {phase === 'detail' && isScheduled && (
            <>
              <div className="lm-summary">
                <div className="lm-sum-row">
                  <span className="lm-sum-label">Ders ücreti</span>
                  <span className="lm-sum-val">{price > 0 ? fmtTL(price) : '—'}</span>
                </div>
              </div>
              {session.note && (
                <div className="lm-note">
                  <span className="lm-note-label">Not</span>
                  <span className="lm-note-text">{session.note}</span>
                </div>
              )}
              {error && <div className="lm-error">{error}</div>}
            </>
          )}

          {/* DETAIL — completed / partial / paid */}
          {phase === 'detail' && isCompleted && (
            <>
              <DebtCard
                label="Ders ücreti"
                total={price}
                paid={paid}
                remaining={remaining}
                paymentMethod={session.paymentMethod
                  ? (PAYMENT_METHOD_LABELS[session.paymentMethod] || session.paymentMethod)
                  : null}
                disabled={submitting}
                onCollect={() => openPayPhase({
                  type: 'lesson',
                  id: session.id,
                  label: 'Ders ücreti',
                  total: price,
                  paid,
                  remaining,
                })}
              />

              {productSales.map(sale => {
                const saleLabel = (sale.note && sale.note.trim()) || 'Ürün satışı';
                return (
                  <DebtCard
                    key={sale.id}
                    label={saleLabel}
                    icon={<ShoppingBagIcon size={11} />}
                    total={sale.totalAmount}
                    paid={sale.paidAmount}
                    remaining={sale.remaining}
                    paymentMethod={null}
                    disabled={submitting}
                    onCollect={() => openPayPhase({
                      type: 'product_sale',
                      id: sale.id,
                      label: `Ürün satışı${sale.note && sale.note.trim() ? ` · ${sale.note.trim()}` : ''}`,
                      total: sale.totalAmount,
                      paid: sale.paidAmount,
                      remaining: sale.remaining,
                    })}
                    onEdit={() => openEditSalePhase(sale)}
                  />
                );
              })}

              {/* Toplam kalan — bağlı satış yoksa gizli (tek kart zaten kendisi
                  toplam) ; varsa baskın koyu şerit ile öne çıkar. */}
              {productSales.length > 0 && totalRemaining > 0 && (
                <div className="lm-total-line">
                  <span className="lm-total-label">Toplam kalan</span>
                  <span className="lm-total-amt">{fmtTL(totalRemaining)}</span>
                </div>
              )}
              {productSales.length > 0 && totalRemaining === 0 && (
                <div className="lm-total-line is-cleared">
                  <span className="lm-total-label">Tüm tahsilatlar tamamlandı</span>
                </div>
              )}

              {session.note && (
                <div className="lm-note">
                  <span className="lm-note-label">Not</span>
                  <span className="lm-note-text">{session.note}</span>
                </div>
              )}
              {error && <div className="lm-error">{error}</div>}
            </>
          )}

          {/* COMPLETE */}
          {phase === 'complete' && (
            <>
              <div className="lm-step-intro">
                <div className="lm-step-title">Dersi tamamla</div>
                <div className="lm-step-sub">
                  Ders tamamlandı olarak işaretlenecek. Ödeme detayını bu adımda ya da sonradan girebilirsin.
                </div>
              </div>

              {/* Ürün satışı sorgusu — bilinçli karar için zorunlu Evet/Hayır */}
              <div className="lm-sale-q">
                <div className="lm-sale-q-label">Bu derste ürün satışı yapıldı mı?</div>
                <div className="lm-sale-q-choices">
                  <button
                    type="button"
                    className={"lm-sale-choice" + (saleChoice === 'no' ? ' is-sel' : '')}
                    onClick={() => {
                      setSaleChoice('no');
                      setSaleAmount('');
                      setSaleNote('');
                      setSalePaySource(null);
                    }}
                  >Hayır</button>
                  <button
                    type="button"
                    className={"lm-sale-choice" + (saleChoice === 'yes' ? ' is-sel' : '')}
                    onClick={() => setSaleChoice('yes')}
                  >Evet, var</button>
                </div>
              </div>

              {saleChoice === 'yes' && (
                <div className="lm-sale-card">
                  <div className="lm-sale-head">
                    <span>Ürün satışı</span>
                  </div>
                  <div className="form-row">
                    <label>Satış tutarı (₺)</label>
                    <input
                      type="number" min="0" step="1"
                      value={saleAmount}
                      onChange={e => setSaleAmount(e.target.value)}
                      placeholder="0"
                      autoFocus
                    />
                  </div>
                  <div className="form-row lm-last-field">
                    <label>Not <span className="lm-opt">(opsiyonel)</span></label>
                    <input
                      type="text"
                      value={saleNote}
                      onChange={e => setSaleNote(e.target.value)}
                      placeholder="Ürün adı veya açıklama…"
                    />
                  </div>
                  <div className="lm-sale-hint">
                    Satış borç olarak kaydedilir. Tahsilatı bu ekrandan sonra Tahsil butonu ile yapabilirsin (kısmi ya da farklı yöntemlerle).
                  </div>
                </div>
              )}
              {error && <div className="lm-error">{error}</div>}
            </>
          )}

          {/* CANCEL */}
          {phase === 'cancel' && (
            <>
              <div className="lm-step-intro">
                <div className="lm-step-title">Dersi neden iptal ediyorsun?</div>
                <div className="lm-step-sub">İptal edilen ders hiçbir durumda borç oluşturmaz.</div>
              </div>
              <div className="lm-reason-list">
                <button
                  type="button"
                  className={"lm-reason" + (cancelReason === 'student' ? ' is-sel' : '')}
                  onClick={() => setCancelReason('student')}
                >
                  <span className="lm-reason-radio" aria-hidden="true" />
                  <span className="lm-reason-body">
                    <span className="lm-reason-title">Öğrenci iptal etti</span>
                    <span className="lm-reason-desc">
                      Ders, öğrencinin geçmişinde “iptal” olarak görünür. Takvimden kaldırılır, borç oluşturmaz.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={"lm-reason" + (cancelReason === 'mistake' ? ' is-sel' : '')}
                  onClick={() => setCancelReason('mistake')}
                >
                  <span className="lm-reason-radio" aria-hidden="true" />
                  <span className="lm-reason-body">
                    <span className="lm-reason-title">Yanlışlıkla eklendi</span>
                    <span className="lm-reason-desc">
                      Ders kaydı tamamen silinir. Hiç oluşmamış gibi, öğrencinin geçmişinde de görünmez.
                    </span>
                  </span>
                </button>
              </div>
              {error && <div className="lm-error">{error}</div>}
            </>
          )}

          {/* PAY — payTarget bağlamında çalışır: hangi borç kaleminin tahsil
              edileceği ekranın tepesinde net olarak görünür. */}
          {phase === 'pay' && payTarget && (
            <form id="lm-pay-form" onSubmit={handlePay}>
              <div className="lm-pay-context">
                <span className="lm-pay-context-label">Tahsilat</span>
                <span className="lm-pay-context-val">{payTarget.label}</span>
              </div>
              <div className="lm-summary">
                <div className="lm-sum-row">
                  <span className="lm-sum-label">Tutar</span>
                  <span className="lm-sum-val">{fmtTL(payTarget.total)}</span>
                </div>
                <div className="lm-sum-row">
                  <span className="lm-sum-label">Daha önce ödenen</span>
                  <span className="lm-sum-val">{fmtTL(payTarget.paid)}</span>
                </div>
                <div className="lm-sum-row lm-sum-remain">
                  <span className="lm-sum-label">Kalan</span>
                  <span className="lm-sum-val">{fmtTL(payTarget.remaining)}</span>
                </div>
              </div>
              <div className="lm-pay-fields">
                <div className="form-row">
                  <div className="lm-amount-label-row">
                    <label>Tutar (₺)</label>
                    {payTarget.remaining > 0 && parseFloat(payAmount || '0') !== payTarget.remaining && (
                      <button
                        type="button"
                        className="lm-fill-remaining"
                        onClick={() => setPayAmount(String(payTarget.remaining))}
                      >Tamamını doldur</button>
                    )}
                  </div>
                  <input
                    type="number" min="0" step="1"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder="0"
                    required
                    autoFocus
                  />
                </div>
                {(activePaymentMethods.cash && activePaymentMethods.iban) && (
                  <div className="form-row">
                    <label>Yöntem</label>
                    <div className="mode-seg lm-pay-seg">
                      <button type="button" className={"mode-btn" + (paySource === 'cash' ? ' is-on' : '')} onClick={() => setPaySource('cash')}>Nakit</button>
                      <button type="button" className={"mode-btn" + (paySource === 'iban' ? ' is-on' : '')} onClick={() => setPaySource('iban')}>IBAN</button>
                    </div>
                  </div>
                )}
                <div className="form-row lm-last-field">
                  <label>Not <span className="lm-opt">(opsiyonel)</span></label>
                  <input
                    type="text"
                    value={payNote}
                    onChange={e => setPayNote(e.target.value)}
                    placeholder="Açıklama…"
                  />
                </div>
              </div>
              {error && <div className="lm-error">{error}</div>}
            </form>
          )}

          {/* EDIT SALE — yanlış girilen ürün satışını düzeltmek için. Kısmi
              tahsilat yapılmışsa yeni tutar ödenenden küçük olamaz. Aynı
              ekrandan satışı tamamen iptal edip silebilirsin (tahsilat varsa
              backend reddeder). */}
          {phase === 'edit-sale' && editSaleTarget && !confirmingDeleteSale && (
            <form id="lm-edit-sale-form" onSubmit={handleEditSaleSubmit}>
              <div className="lm-step-intro">
                <div className="lm-step-title">Ürün satışını düzenle</div>
                <div className="lm-step-sub">
                  Yanlış girdiğin tutarı veya notu düzeltebilir, ya da satışı tamamen iptal edebilirsin.
                  {editSaleTarget.paid > 0 && ` Bu satıştan ${fmtTL(editSaleTarget.paid)} tahsil edilmiş; yeni tutar bundan düşük olamaz ve tahsilat geri alınmadan silinemez.`}
                </div>
              </div>
              <div className="lm-pay-fields">
                <div className="form-row">
                  <label>Satış tutarı (₺)</label>
                  <input
                    type="number" min="0" step="1"
                    value={editSaleAmount}
                    onChange={e => setEditSaleAmount(e.target.value)}
                    placeholder="0"
                    required
                    autoFocus
                  />
                </div>
                <div className="form-row lm-last-field">
                  <label>Not <span className="lm-opt">(opsiyonel)</span></label>
                  <input
                    type="text"
                    value={editSaleNote}
                    onChange={e => setEditSaleNote(e.target.value)}
                    placeholder="Ürün adı veya açıklama…"
                  />
                </div>
              </div>
              {error && <div className="lm-error">{error}</div>}
              <div className="lm-edit-sale-danger">
                <button
                  type="button"
                  className="lm-edit-sale-delete"
                  onClick={() => { setError(null); setConfirmingDeleteSale(true); }}
                  disabled={submitting || editSaleTarget.paid > 0}
                  title={editSaleTarget.paid > 0
                    ? 'Bu satıştan tahsilat yapılmış, silinemez.'
                    : 'Bu satışı sil'}
                >Bu satışı sil</button>
              </div>
            </form>
          )}

          {phase === 'edit-sale' && editSaleTarget && confirmingDeleteSale && (
            <div className="lm-step-intro">
              <div className="lm-step-title">Bu satışı silmek istediğine emin misin?</div>
              <div className="lm-step-sub">
                {fmtTL(editSaleTarget.originalTotal)} tutarındaki ürün satışı kaldırılacak.
                Bu işlem geri alınamaz; sadece geçmiş hareketler arasında iz olarak görünür.
              </div>
              {error && <div className="lm-error">{error}</div>}
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="lm-footer">
          {phase === 'detail' && isScheduled && (
            <>
              <button className="btn btn-ghost lm-btn-danger" onClick={() => { setPhase('cancel'); setError(null); }}>
                İptal et
              </button>
              <button className="btn btn-primary" onClick={() => { setPhase('complete'); setError(null); }}>
                Dersi tamamla
              </button>
            </>
          )}
          {/* Detay görünümünde tahsilat aksiyonları artık her borç kartının
              kendi içinde — buradaki footer sadece kapatmak için. */}
          {phase === 'detail' && isCompleted && (
            <button className="btn btn-ghost lm-footer-full" onClick={onClose}>Kapat</button>
          )}
          {phase === 'complete' && (
            <>
              <button className="btn btn-ghost" onClick={resetToDetail} disabled={submitting}>Geri</button>
              <button
                className="btn btn-primary"
                disabled={completeDisabled}
                onClick={handleComplete}
              >{submitting ? 'Kaydediliyor…' : 'Tamamla'}</button>
            </>
          )}
          {phase === 'cancel' && (
            <>
              <button className="btn btn-ghost" onClick={resetToDetail} disabled={submitting}>Geri</button>
              <button
                className="btn btn-primary lm-btn-danger"
                disabled={!cancelReason || submitting}
                onClick={handleCancelSubmit}
              >{submitting
                ? (cancelReason === 'mistake' ? 'Siliniyor…' : 'İptal ediliyor…')
                : (cancelReason === 'mistake' ? 'Kaydı sil' : 'Dersi iptal et')}</button>
            </>
          )}
          {phase === 'pay' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={resetToDetail} disabled={submitting}>Geri</button>
              <button
                type="submit"
                form="lm-pay-form"
                className="btn btn-primary"
                disabled={!payAmount || submitting}
              >{submitting ? 'Kaydediliyor…' : 'Ödemeyi kaydet'}</button>
            </>
          )}
          {phase === 'edit-sale' && !confirmingDeleteSale && (
            <>
              <button type="button" className="btn btn-ghost" onClick={resetToDetail} disabled={submitting}>Geri</button>
              <button
                type="submit"
                form="lm-edit-sale-form"
                className="btn btn-primary"
                disabled={!editSaleAmount || submitting}
              >{submitting ? 'Kaydediliyor…' : 'Kaydet'}</button>
            </>
          )}
          {phase === 'edit-sale' && confirmingDeleteSale && (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setError(null); setConfirmingDeleteSale(false); }}
                disabled={submitting}
              >Vazgeç</button>
              <button
                type="button"
                className="btn btn-primary lm-btn-danger"
                onClick={handleDeleteSale}
                disabled={submitting}
              >{submitting ? 'Siliniyor…' : 'Evet, sil'}</button>
            </>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Week Nav Bar ────────────────────────────────────────────────────────────

const MC_DAYS_TR = ['P', 'S', 'Ç', 'P', 'C', 'C', 'P'];

function WeekNavBar({ weekStart, onPrev, onNext, onToday, onWeekSelect, sessions }) {
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState(() => new Date(weekStart.getFullYear(), weekStart.getMonth(), 1));
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    setMonth(new Date(weekStart.getFullYear(), weekStart.getMonth(), 1));
  }, [weekStart]);

  React.useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const lessonDateKeys = React.useMemo(() => {
    const set = new Set();
    if (!sessions) return set;
    sessions.forEach(s => {
      const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + s.day);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    });
    return set;
  }, [sessions, weekStart]);

  const calDays = React.useMemo(() => {
    const year = month.getFullYear();
    const mo = month.getMonth();
    const firstDow = (new Date(year, mo, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, mo + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDow; i++) {
      days.push({ date: new Date(year, mo, 1 - firstDow + i), otherMonth: true });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ date: new Date(year, mo, i), otherMonth: false });
    }
    while (days.length % 7 !== 0) {
      const last = days[days.length - 1].date;
      days.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), otherMonth: true });
    }
    return days;
  }, [month]);

  const today = getIstanbulToday();
  const selEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);

  function isInSelWeek(date) { return date >= weekStart && date <= selEnd; }
  function isToday(date) {
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  }
  function hasLesson(date) {
    return lessonDateKeys.has(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  }

  const monthLabel = month.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  const monthLabelCap = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  return (
    <div className="wk-nav">
      <button className="wk-today-btn" onClick={onToday}>Bugün</button>
      <button className="iconbtn" onClick={onPrev}><Icon.ChevronL width="14" height="14"/></button>
      <div className="wk-mini-cal-wrap" ref={wrapRef}>
        <span className="wk-label" onClick={() => setOpen(o => !o)}>{formatWeekRange(weekStart)}</span>
        {open && (
          <div className="wk-mini-cal">
            <div className="wk-mc-head">
              <button className="iconbtn" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
                <Icon.ChevronL width="12" height="12"/>
              </button>
              <span className="wk-mc-month">{monthLabelCap}</span>
              <button className="iconbtn" onClick={() => setMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
                <Icon.ChevronR width="12" height="12"/>
              </button>
            </div>
            <div className="wk-mc-grid">
              {MC_DAYS_TR.map((d, i) => <div key={i} className="wk-mc-dh">{d}</div>)}
              {calDays.map((item, i) => (
                <div
                  key={i}
                  className={['wk-mc-day', item.otherMonth ? 'other-month' : '', isInSelWeek(item.date) ? 'in-sel-week' : '', isToday(item.date) ? 'is-today' : ''].filter(Boolean).join(' ')}
                  onClick={() => { onWeekSelect(getMondayOfDate(item.date)); setOpen(false); }}
                >
                  <div className="wk-mc-day-num">{item.date.getDate()}</div>
                  {hasLesson(item.date) && <div className="wk-mc-dot" />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <button className="iconbtn" onClick={onNext}><Icon.ChevronR width="14" height="14"/></button>
    </div>
  );
}

// ─── Week Calendar ───────────────────────────────────────────────────────────

export function WeekCalendar({ weekStart, variant = "detailed", onSessionClick, alwaysFrom = 17, alwaysTo = 23, defaultLessonMode = 'onsite', activePaymentMethods = { cash: true, iban: true }, onSessionsLoaded, externalRefreshKey = 0 }) {
  const hourH = variant === "compact" ? 36 : 48;

  const weekDayNumbers = React.useMemo(() => getWeekDayNumbers(weekStart), [weekStart]);
  const todayIndex = React.useMemo(() => getTodayColumnIndex(weekStart), [weekStart]);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [expandedBands, setExpandedBands] = React.useState(new Set());
  const [createModal, setCreateModal] = React.useState(null);
  const [lessonModalSession, setLessonModalSession] = React.useState(null);

  function handleSessionClick(s) {
    setLessonModalSession(s);
    onSessionClick && onSessionClick(s);
  }

  const { lessons, error } = useWeekLessonsState(weekStart, `${refreshKey}_${externalRefreshKey}`);

  // Reset expanded bands when week changes so bands from the old week don't bleed over.
  React.useEffect(() => {
    setExpandedBands(new Set());
  }, [weekStart]);

  const sessions = React.useMemo(() => {
    if (lessons === null) return [];
    return lessons
      .map(normalizeApiLesson)
      .filter(s => s.lessonState !== 'cancelled');
  }, [lessons]);

  React.useEffect(() => {
    onSessionsLoaded && onSessionsLoaded(sessions);
  }, [sessions]);

  const rows = React.useMemo(
    () => buildCalendarRows(sessions, expandedBands, alwaysFrom, alwaysTo),
    [sessions, expandedBands, alwaysFrom, alwaysTo]
  );

  const { rowOffsets, totalHeight } = React.useMemo(
    () => computeRowLayout(rows, hourH),
    [rows, hourH]
  );

  function handleBandExpand(fromHour) {
    setExpandedBands(prev => { const n = new Set(prev); n.add(fromHour); return n; });
  }

  function handleSlotClick(dayIndex, hour) {
    setCreateModal({ dayIndex, hour });
  }

  return (
    <>
      <div className={"wk-cal wk-cal-" + variant} data-wk-error={error ? "1" : undefined}>
        <div className="wk-head">
          <div className="wk-time-col"></div>
          {DAYS_TR_SHORT.map((d, i) => (
            <div key={i} className={"wk-day-h" + (i === todayIndex ? " today" : "")}>
              <div className="wk-day-name">{d}</div>
              <div className="wk-day-num">{weekDayNumbers[i]}</div>
            </div>
          ))}
        </div>
        <div className="wk-body" style={{ height: totalHeight }}>
          <div className="wk-time-col-body">
            {rows.map((row, i) => {
              if (row.type === 'collapsed') {
                return (
                  <div key={i} className="wk-collapsed-label" style={{ height: COLLAPSED_H }}
                    onClick={() => handleBandExpand(row.from)}>
                    <span>{String(row.from).padStart(2,'0')}–{String(row.to).padStart(2,'0')}</span>
                  </div>
                );
              }
              return (
                <div key={i} className="wk-hour-label" style={{ height: hourH }}>
                  {String(row.hour).padStart(2, "0")}
                </div>
              );
            })}
          </div>
          <div className="wk-grid">
            {Array.from({ length: 7 }, (_, d) => (
              <div key={d} className={"wk-col" + (d === todayIndex ? " today" : "")}>
                {rows.map((row, i) => {
                  if (row.type === 'collapsed') {
                    return (
                      <div key={i} className="wk-collapsed-band" style={{ height: COLLAPSED_H }}
                        onClick={() => handleBandExpand(row.from)} />
                    );
                  }
                  return (
                    <div key={i} className="wk-hour-cell" style={{ height: hourH }}
                      onClick={() => handleSlotClick(d, row.hour)} />
                  );
                })}
                {sessions.filter(s => s.day === d).map(s => {
                  const top = getSessionTopPx(rows, rowOffsets, hourH, s.time);
                  if (top < 0) return null;
                  return (
                    <div
                      key={s.id}
                      className={"wk-sess wk-sess-" + s.lessonState}
                      style={{ top, height: hourH - 3 }}
                      onClick={e => { e.stopPropagation(); handleSessionClick(s); }}
                    >
                      <div className="wk-sess-top">
                        <span className="wk-sess-time">{s.time}</span>
                        {Array.isArray(s.productSales) && s.productSales.length > 0 && (
                          <span
                            className="wk-sess-sale"
                            title={`Ürün satışı: ${s.productSales.length} kalem`}
                          >
                            <ShoppingBagIcon size={10} />
                          </span>
                        )}
                        {s.mode === "online" && <span className="wk-sess-mode">ONLINE</span>}
                        {s.lessonState === 'partial' && Number(s.price) > Number(s.paid) && (
                          <span className="wk-sess-remain">-{fmtTL(Number(s.price) - Number(s.paid))}</span>
                        )}
                      </div>
                      <div className="wk-sess-name">{s.studentNickname || s.studentName}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {createModal && (
        <CreateLessonModal
          dayIndex={createModal.dayIndex}
          hour={createModal.hour}
          weekStart={weekStart}
          defaultMode={defaultLessonMode}
          onClose={() => setCreateModal(null)}
          onCreated={() => { setCreateModal(null); setRefreshKey(k => k + 1); }}
        />
      )}
      {lessonModalSession && (
        <LessonModal
          session={lessonModalSession}
          activePaymentMethods={activePaymentMethods}
          onClose={() => setLessonModalSession(null)}
          onUpdated={() => { setLessonModalSession(null); setRefreshKey(k => k + 1); }}
        />
      )}
    </>
  );
}

export function IncomeSparkline() {
  const data = INCOME_HISTORY;
  const max = Math.max(...data.map(d => d.total));
  const W = 280, H = 60, pad = 3;
  const bw = (W - pad * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sparkline">
      {data.map((d, i) => {
        const h = (d.total / max) * (H - pad * 2);
        const isLast = i === data.length - 1;
        return (
          <rect key={i}
            x={pad + i * bw + bw * 0.15}
            y={H - pad - h}
            width={bw * 0.7}
            height={h}
            rx="1.5"
            fill={isLast ? "var(--accent)" : "var(--ink-3)"}
            opacity={isLast ? 1 : 0.35}
          />
        );
      })}
    </svg>
  );
}


function DebtActionCard() {
  const [debtors, setDebtors] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [paymentTarget, setPaymentTarget] = React.useState(null);
  const [paymentLoading, setPaymentLoading] = React.useState(false);

  async function loadDebtors() {
    try {
      const data = await getDebtors();
      setDebtors(data);
    } catch {
      // keep previous state on error
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadDebtors(); }, []);

  async function handleTahsil(debtor) {
    setPaymentLoading(true);
    try {
      const [lessons, productSales] = await Promise.all([
        getStudentLessons(debtor.student_id),
        getStudentProductSales(debtor.student_id),
      ]);
      setPaymentTarget({
        student: { id: debtor.student_id, full_name: debtor.full_name },
        detail: { lessons, productSales },
      });
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handlePaymentSuccess() {
    setPaymentTarget(null);
    setLoading(true);
    await loadDebtors();
  }

  const totalDebtSum = debtors.reduce((s, d) => s + parseFloat(d.total_debt || '0'), 0);
  const items = debtors.slice(0, 3);

  return (
    <div className="card card-debts-inline">
      <div className="card-head">
        <h3 className="card-title">
          Bekleyen{!loading && debtors.length > 0 ? ` · ${fmtTL(totalDebtSum)}` : ''}
        </h3>
        {!loading && (
          <span className="card-sub">
            {debtors.length > 0 ? `${debtors.length} kişi` : 'Borç yok'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="empty" style={{fontSize: 12}}>Yükleniyor…</div>
      ) : items.length === 0 ? (
        <div className="empty">Bekleyen tahsilat yok.</div>
      ) : (
        <ul className="debt-list">
          {items.map((d) => {
            const days = d.oldest_debt_since
              ? Math.round((Date.now() - new Date(d.oldest_debt_since).getTime()) / 86400000)
              : null;
            return (
              <li key={d.student_id} className="debt-item">
                <Avatar name={d.full_name} size="sm" soft/>
                <div className="debt-body">
                  <div className="debt-row1">
                    <span className="debt-name">{d.full_name}</span>
                    <span className="debt-amount">{fmtTL(parseFloat(d.total_debt))}</span>
                  </div>
                  <div className="debt-row2">
                    <span className="debt-reason">
                      {parseFloat(d.lesson_debt) > 0 && parseFloat(d.product_debt) > 0
                        ? 'Ders + ürün borcu'
                        : parseFloat(d.lesson_debt) > 0
                          ? 'Ders borcu'
                          : 'Ürün borcu'}
                    </span>
                    {days !== null && (
                      <span className={"debt-age" + (days > 14 ? " old" : "")}>{days}g</span>
                    )}
                  </div>
                </div>
                <button
                  className="debt-action-inline"
                  onClick={() => handleTahsil(d)}
                  disabled={paymentLoading}
                >
                  Tahsil
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {debtors.length > 3 && (
        <button className="link-btn" style={{marginTop: 8}}>
          {debtors.length - 3} kişi daha →
        </button>
      )}

      {paymentLoading && (
        <div className="modal-backdrop">
          <div className="modal stu-loading-modal">Yükleniyor…</div>
        </div>
      )}

      {paymentTarget && (
        <ReceivePaymentModal
          student={paymentTarget.student}
          detail={paymentTarget.detail}
          onClose={() => setPaymentTarget(null)}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}

function UpcomingEventsCard() {
  const today = getIstanbulToday();

  const birthdays = STUDENTS.map(s => {
    const b = new Date(s.birthday);
    let next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate());
    const days = Math.round((next - today) / 86400000);
    return { student: s, days };
  }).filter(x => x.days <= 14).sort((a, b) => a.days - b.days);

  const staleDebts = DEBTS.filter(d => {
    const ref = d.lastContact ? new Date(d.lastContact) : new Date(d.since);
    return Math.round((today - ref) / 86400000) >= 14;
  }).slice(0, 2);

  const total = birthdays.length + staleDebts.length;

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Yaklaşan</h3>
        {total > 0 && <span className="pill pill-accent">{total} öğe</span>}
      </div>
      {total === 0 ? (
        <p className="empty">Bu hafta öne çıkan bir şey yok.</p>
      ) : (
        <div className="events-list">
          {birthdays.map(({ student: s, days }) => (
            <div key={s.id} className="event-item">
              <div className="event-dot event-dot-gold"></div>
              <div className="event-body">
                <div className="event-title">{s.name}</div>
                <div className="event-sub">
                  {days === 0 ? "Bugün doğum günü!" : `Doğum günü · ${days} gün sonra`}
                </div>
              </div>
              {days <= 3 && <span className="pill pill-warn">yakında</span>}
            </div>
          ))}
          {staleDebts.map((d, i) => {
            const st = getStudent(d.studentId);
            const ref = d.lastContact ? new Date(d.lastContact) : new Date(d.since);
            const daysSince = Math.round((today - ref) / 86400000);
            return (
              <div key={i} className="event-item">
                <div className="event-dot event-dot-warn"></div>
                <div className="event-body">
                  <div className="event-title">{st.name}</div>
                  <div className="event-sub">{fmtTL(d.amount)} · {daysSince}g iletişim yok</div>
                </div>
                <button className="event-action">Ara</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuickActions({ defaultLessonMode = 'onsite', activePaymentMethods = { cash: true, iban: true }, onNavigate, onLessonCreated }) {
  const [modal, setModal] = React.useState(null); // 'lesson' | 'sale' | 'pay'

  return (
    <div className="quick-actions">
      <button className="qa-btn qa-btn-accent" onClick={() => setModal('lesson')}>
        <div className="qa-icon">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.35"/>
            <path d="M2 7h12" stroke="currentColor" strokeWidth="1.35"/>
            <path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
            <path d="M8 9.5v3M6.5 11h3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="qa-text">
          <span className="qa-label">Ders ekle</span>
          <span className="qa-sub">Yeni ders planla</span>
        </div>
      </button>

      <button className="qa-btn qa-btn-gold" onClick={() => setModal('sale')}>
        <div className="qa-icon">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M1.5 2h2.2l2.3 7h6l1.5-4.5H5.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="7" cy="13" r="1.1" fill="currentColor"/>
            <circle cx="11.2" cy="13" r="1.1" fill="currentColor"/>
          </svg>
        </div>
        <div className="qa-text">
          <span className="qa-label">Ürün satışı</span>
          <span className="qa-sub">Mat, kıyafet vb. kaydet</span>
        </div>
      </button>

      <button className="qa-btn qa-btn-sage" onClick={() => setModal('pay')}>
        <div className="qa-icon">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.5" y="4.5" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.35"/>
            <path d="M1.5 7.5h13" stroke="currentColor" strokeWidth="1.35"/>
            <path d="M4.5 2h7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
            <circle cx="11" cy="10.5" r="1.1" fill="currentColor"/>
          </svg>
        </div>
        <div className="qa-text">
          <span className="qa-label">Ödeme al</span>
          <span className="qa-sub">Borç tahsil et</span>
        </div>
      </button>

      <button className="qa-btn qa-btn-neutral" onClick={() => onNavigate?.('students')}>
        <div className="qa-icon">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="5.5" r="2.8" stroke="currentColor" strokeWidth="1.35"/>
            <path d="M2 14c0-3.038 2.262-4.5 5-4.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
            <path d="M12 9.5v5M9.5 12h5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="qa-text">
          <span className="qa-label">Yeni öğrenci</span>
          <span className="qa-sub">Profil oluştur</span>
        </div>
      </button>

      {modal === 'lesson' && (
        <StandaloneCreateLessonModal
          defaultMode={defaultLessonMode}
          onClose={() => setModal(null)}
          onCreated={() => { setModal(null); onLessonCreated?.(); }}
        />
      )}
      {modal === 'sale' && (
        <QuickSaleModal
          onClose={() => setModal(null)}
          onCreated={() => setModal(null)}
        />
      )}
      {modal === 'pay' && (
        <QuickPayModal
          activePaymentMethods={activePaymentMethods}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

export function HomePage({ layout, onNavigate }) {
  const weeklyKpiState = useWeeklyKpiState();
  const studioSettings = useStudioSettings();
  const weeklyKpiData = weeklyKpiState.data;
  const cashInflowTotal = parseNumericValue(weeklyKpiData?.cashInflow?.total, 0);
  const revenueTotal = parseNumericValue(weeklyKpiData?.revenue?.total, 0);
  const lessonsPlanned = parseNumericValue(weeklyKpiData?.lessonCounts?.planned, 0);
  const lessonsCompleted = parseNumericValue(weeklyKpiData?.lessonCounts?.completed, 0);
  const occupancyRatio = parseNumericValue(weeklyKpiData?.occupancyRatio, null);
  const receivable = parseNumericValue(weeklyKpiData?.receivable, 0);
  const debtorStudentCount = parseNumericValue(weeklyKpiData?.debtorStudentCount, null);
  const collectionRateValue = revenueTotal > 0 ? Math.round((cashInflowTotal / revenueTotal) * 100) : 0;
  const collectionRateBarWidth = clampBarWidth(collectionRateValue);
  const monthlyCashInflowTotal = parseNumericValue(weeklyKpiData?.monthlyCashInflow?.total, 0);
  const monthlyRevenueTotal = parseNumericValue(weeklyKpiData?.monthlyRevenue?.total, 0);
  const monthlyCollectionRateValue = monthlyRevenueTotal > 0 ? Math.round((monthlyCashInflowTotal / monthlyRevenueTotal) * 100) : 0;
  const monthlyCollectionRateBarWidth = clampBarWidth(monthlyCollectionRateValue);
  const currentMonthLabel = getIstanbulToday().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }).toLocaleUpperCase('tr-TR');
  const weeklyCapacity = studioSettings?.weeklyCapacity ?? null;
  const occupancyPercent = occupancyRatio !== null ? Math.round(occupancyRatio * 100) : (weeklyCapacity ? Math.round(lessonsPlanned / weeklyCapacity * 100) : 0);
  const occupancyBarWidth = clampBarWidth(occupancyPercent);
  const remainingLessons = Math.max(0, lessonsPlanned - lessonsCompleted);
  const emptySlots = weeklyCapacity !== null ? Math.max(0, weeklyCapacity - lessonsPlanned) : null;
  const calendarAlwaysFrom = studioSettings?.calendarStartHour ?? 17;
  const calendarAlwaysTo = studioSettings?.calendarEndHour ?? 23;
  const defaultLessonMode = studioSettings?.defaultLessonMode ?? 'onsite';
  const activePaymentMethods = {
    cash: studioSettings?.paymentMethodCash ?? true,
    iban: studioSettings?.paymentMethodIban ?? true,
  };

  const [weekStart, setWeekStart] = React.useState(() => getCurrentMonday());
  const [weekSessions, setWeekSessions] = React.useState([]);
  const [calRefreshKey, setCalRefreshKey] = React.useState(0);
  function goToPrevWeek() { setWeekStart(ws => addWeeks(ws, -1)); }
  function goToNextWeek() { setWeekStart(ws => addWeeks(ws, 1)); }
  function goToCurrentWeek() { setWeekStart(getCurrentMonday()); }

  if (layout === "sakin") {
    return (
      <div className="page page-home home-sakin">
        <div className="page-head">
          <div>
            <div className="eyebrow">{formatWeekHeader(weekStart)}</div>
          </div>
          <div className="head-actions">
            <div className="head-stats" style={{display:"flex",gap:32}}>
              <div>
                <div style={{fontFamily:"var(--f-serif)",fontSize:26,fontWeight:500,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{fmtTL(cashInflowTotal)}</div>
                <div style={{fontSize:11,color:"var(--ink-3)",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginTop:4}}>tahsil</div>
              </div>
              <div>
                <div style={{fontFamily:"var(--f-serif)",fontSize:26,fontWeight:500,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{lessonsPlanned}</div>
                <div style={{fontSize:11,color:"var(--ink-3)",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginTop:4}}>ders</div>
              </div>
              <div>
                <div style={{fontFamily:"var(--f-serif)",fontSize:26,fontWeight:500,lineHeight:1,fontVariantNumeric:"tabular-nums",color:"var(--warn)"}}>{fmtTL(receivable)}</div>
                <div style={{fontSize:11,color:"var(--ink-3)",textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:600,marginTop:4}}>bekleyen</div>
              </div>
            </div>
          </div>
        </div>
        <div className="card card-flat">
          <div className="card-head">
            <h3 className="card-title">Haftalık takvim</h3>
            <div className="card-actions">
              <WeekNavBar weekStart={weekStart} onPrev={goToPrevWeek} onNext={goToNextWeek} onToday={goToCurrentWeek} onWeekSelect={setWeekStart} sessions={weekSessions} />
            </div>
          </div>
          <WeekCalendar weekStart={weekStart} variant="detailed" alwaysFrom={calendarAlwaysFrom} alwaysTo={calendarAlwaysTo} defaultLessonMode={defaultLessonMode} activePaymentMethods={activePaymentMethods} onSessionsLoaded={setWeekSessions} externalRefreshKey={calRefreshKey} />
          <div className="cal-legend">
            <span className="leg"><span className="leg-sw ls-planned"></span>Planlandı</span>
            <span className="leg"><span className="leg-sw ls-unpaid"></span>Tamamlandı · Ödenmedi</span>
            <span className="leg"><span className="leg-sw ls-partial"></span>Kısmi ödendi</span>
            <span className="leg"><span className="leg-sw ls-paid"></span>Ödendi</span>
          </div>
        </div>
      </div>
    );
  }

  if (layout === "ajanda") {
    const ajandaTodayIdx = (getIstanbulToday().getDay() + 6) % 7;
    const todayCount = WEEK_SESSIONS.filter(s => s.day === ajandaTodayIdx).length;
    const todayLabel = getIstanbulToday().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return (
      <div className="page page-home home-ajanda">
        <div className="page-head">
          <div>
            <div className="eyebrow">{todayLabel}</div>
            <h1 className="page-title page-title-serif">Bugün {todayCount} ders</h1>
          </div>
        </div>

        <div className="ajanda-grid">
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">Bugünün dersleri</h3>
              <span className="card-sub">{todayCount} öğrenci</span>
            </div>
            <ul className="today-list">
              {WEEK_SESSIONS.filter(s => s.day === ajandaTodayIdx).map((s, i) => {
                const st = getStudent(s.studentId);
                return (
                  <li key={s.id} className={"today-item" + (i === 0 ? " next" : "")} style={{position:"relative"}}>
                    <div className="today-time">{s.time}</div>
                    <Avatar name={st.name} size="sm" soft/>
                    <div className="today-info">
                      <div className="today-name">{st.name}</div>
                      <div className="today-meta">{s.mode} · {s.paid >= s.price ? "ödendi" : "ödenmedi"}</div>
                    </div>
                    <div className="today-price">{fmtTL(s.price)}</div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="card-title">Tahsilat <span style={{opacity:0.55, fontWeight:500, fontSize:"0.85em"}}>· {currentMonthLabel}</span></h3>
              <span className="card-sub">%{monthlyCollectionRateValue} · hedef</span>
            </div>
            <div className="income-row">
              <div className="income-main">{fmtTL(monthlyCashInflowTotal)}</div>
            </div>
            <div className="progress"><div className="progress-bar" style={{ width: monthlyCollectionRateBarWidth + "%" }}></div></div>
            <IncomeSparkline />
            <div className="sparkline-labels"><span>8 hafta önce</span><span>bu hafta</span></div>
          </div>

          <DebtActionCard />
        </div>

        <div className="card card-flat">
          <div className="card-head">
            <h3 className="card-title">Haftalık program</h3>
            <div className="card-actions">
              <WeekNavBar weekStart={weekStart} onPrev={goToPrevWeek} onNext={goToNextWeek} onToday={goToCurrentWeek} onWeekSelect={setWeekStart} sessions={weekSessions} />
            </div>
          </div>
          <WeekCalendar weekStart={weekStart} variant="compact" alwaysFrom={calendarAlwaysFrom} alwaysTo={calendarAlwaysTo} defaultLessonMode={defaultLessonMode} activePaymentMethods={activePaymentMethods} onSessionsLoaded={setWeekSessions} externalRefreshKey={calRefreshKey} />
        </div>
      </div>
    );
  }

  // detaylı (default) -------------------------------------------------------
  return (
    <div className="page page-home home-detayli">
      <div className="page-head page-head-solo">
        <div>
          <div className="eyebrow">{formatWeekHeader(weekStart)}</div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-card-label">Tahsilat / Ciro <span style={{opacity:0.55, fontWeight:500}}>· {currentMonthLabel}</span></div>
          <div className="kpi-card-main">
            <span className="kpi-card-val">{fmtTL(monthlyCashInflowTotal)}</span>
            <span className="kpi-card-sep">/</span>
            <span className="kpi-card-val2">{fmtTL(monthlyRevenueTotal)}</span>
          </div>
          <div className="kpi-card-bar">
            <div className="kpi-card-bar-fill" style={{width: `${monthlyCollectionRateBarWidth}%`}} />
          </div>
          <div className="kpi-card-sub">
            Tahsilat oranı <strong>%{monthlyCollectionRateValue}</strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-label">Bu hafta ders</div>
          <div className="kpi-card-main">
            <span className="kpi-card-val">{lessonsPlanned}</span>
            <span className="kpi-card-val2">ders planlandı</span>
          </div>
          <div className="kpi-card-sub"><strong>{lessonsCompleted}</strong> tamamlandı · <strong>{remainingLessons}</strong> sırada</div>
        </div>

        <div className={`kpi-card${receivable > 0 ? " kpi-card-warn" : ""}`}>
          <div className="kpi-card-label">Bekleyen tahsilat</div>
          <div className="kpi-card-main">
            <span className="kpi-card-val">{fmtTL(receivable)}</span>
          </div>
          <div className="kpi-card-bar kpi-card-bar-warn">
            <div className="kpi-card-bar-fill" style={{width: receivable > 0 ? "100%" : "0%"}} />
          </div>
          <div className="kpi-card-sub">
            <strong>{debtorStudentCount ?? 0}</strong> öğrencinin borcu var
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-label">Haftalık doluluk</div>
          <div className="kpi-card-main">
            <span className="kpi-card-val">%{occupancyPercent}</span>
          </div>
          <div className="kpi-card-bar">
            <div className="kpi-card-bar-fill" style={{width: `${occupancyBarWidth}%`}} />
          </div>
          <div className="kpi-card-sub">
            <strong>{lessonsPlanned}{weeklyCapacity !== null ? `/${weeklyCapacity}` : ''}</strong> ders
            {emptySlots !== null && <> · <strong>{emptySlots}</strong> boş slot</>}
          </div>
        </div>
      </div>

      <div className="home-grid">
        <div className="card card-cal" style={{padding: 0}}>
          <div className="card-head" style={{padding: "16px 18px 0"}}>
            <h3 className="card-title">Haftalık takvim</h3>
            <div className="card-actions">
              <WeekNavBar weekStart={weekStart} onPrev={goToPrevWeek} onNext={goToNextWeek} onToday={goToCurrentWeek} onWeekSelect={setWeekStart} sessions={weekSessions} />
            </div>
          </div>
          <div style={{padding: "14px 18px 18px"}}>
            <WeekCalendar weekStart={weekStart} variant="detailed" alwaysFrom={calendarAlwaysFrom} alwaysTo={calendarAlwaysTo} defaultLessonMode={defaultLessonMode} activePaymentMethods={activePaymentMethods} onSessionsLoaded={setWeekSessions} externalRefreshKey={calRefreshKey} />
            <div className="cal-legend">
              <span className="leg"><span className="leg-sw onsite"></span>yüzyüze</span>
              <span className="leg"><span className="leg-sw online"></span>online</span>
              <span className="leg"><span className="leg-sw unpaid"></span>ödenmedi</span>
            </div>
          </div>
        </div>

        <div className="home-side">
          <div className="card card-flat">
            <div className="card-head">
              <h3 className="card-title">Hızlı aksiyonlar</h3>
            </div>
            <QuickActions
              defaultLessonMode={defaultLessonMode}
              activePaymentMethods={activePaymentMethods}
              onNavigate={onNavigate}
              onLessonCreated={() => setCalRefreshKey(k => k + 1)}
            />
          </div>
          <DebtActionCard />
          <UpcomingEventsCard />
        </div>
      </div>
    </div>
  );
}

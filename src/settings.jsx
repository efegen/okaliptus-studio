import React from 'react';
import { getSettings, updateSettings } from './api';
import { ActivityPanel } from './settings-activity';

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, i) => i);

function HourSelect({ value, onChange, min = 0, max = 24 }) {
  return (
    <select
      className="stg-select"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
    >
      {HOUR_OPTIONS.filter(h => h >= min && h <= max).map(h => (
        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
      ))}
    </select>
  );
}

function NumInput({ value, onChange, min = 0, max, unit }) {
  return (
    <div className="stg-num-wrap">
      <input
        type="number"
        className="stg-num"
        value={value}
        min={min}
        max={max}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
      {unit && <span className="stg-unit">{unit}</span>}
    </div>
  );
}

function ModeToggle({ value, onChange }) {
  return (
    <div className="mode-seg">
      <button
        type="button"
        className={'mode-btn' + (value === 'onsite' ? ' is-on' : '')}
        onClick={() => onChange('onsite')}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.5 7L8 2l5.5 5v6.5h-3.5V9.5h-4V13.5H2.5V7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        </svg>
        Yüzyüze
      </button>
      <button
        type="button"
        className={'mode-btn' + (value === 'online' ? ' is-on' : '')}
        onClick={() => onChange('online')}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="3" width="13" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        Online
      </button>
    </div>
  );
}

function CheckToggle({ checked, onChange, label }) {
  return (
    <label className="stg-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function SettingRow({ label, children, info, top }) {
  return (
    <div className={'stg-row' + (top ? ' stg-row-top' : '')}>
      <div className="stg-row-label">{label}</div>
      <div className="stg-row-control">
        {children}
        {info && <span className="stg-row-info">{info}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="stg-section">
      <div className="stg-section-head">{title}</div>
      {children}
    </div>
  );
}

const PREVIEW_BLOCKS = [
  { cls: 'wk-sess-planned',  label: 'Planlandı', time: '09:00' },
  { cls: 'wk-sess-unpaid',   label: 'Ödenmedi',  time: '10:00' },
  { cls: 'wk-sess-partial',  label: 'Kısmi',     time: '11:00' },
  { cls: 'wk-sess-paid',     label: 'Ödendi',    time: '12:00' },
];

function LessonColorPreview() {
  return (
    <div className="stg-lesson-preview">
      {PREVIEW_BLOCKS.map(({ cls, label, time }) => (
        <div key={cls} className={`stg-prev-block ${cls}`}>
          <div className="wk-sess-top">{time}</div>
          <div className="wk-sess-name">{label}</div>
        </div>
      ))}
    </div>
  );
}

function SatSlider({ value, onChange, onReset }) {
  return (
    <div className="stg-sat-row">
      <div className="stg-slider-wrap">
        <input
          type="range"
          className="stg-slider"
          min={0.2}
          max={2.0}
          step={0.05}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
        />
        <span className="stg-slider-val">{value.toFixed(2)}×</span>
        {value !== 1 && (
          <button type="button" className="stg-sat-reset" onClick={onReset}>
            sıfırla
          </button>
        )}
      </div>
      <LessonColorPreview />
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = React.useState('general');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(null);
  const [saved, setSaved] = React.useState(null); // baseline from server
  const [form, setForm] = React.useState(null);   // current form state
  const [saving, setSaving] = React.useState(false);
  const [feedback, setFeedback] = React.useState(null); // { ok: bool, msg: string }
  const savedSatRef = React.useRef(1);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    getSettings()
      .then(data => {
        if (cancelled) return;
        savedSatRef.current = data.lessonColorSaturation ?? 1;
        setSaved(data);
        setForm(data);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setLoadError(err.message || 'Ayarlar yüklenemedi.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Restore CSS var when navigating away without saving
  React.useEffect(() => {
    return () => {
      document.documentElement.style.setProperty('--ls-sat', String(savedSatRef.current));
    };
  }, []);

  const isDirty = React.useMemo(() => {
    if (!saved || !form) return false;
    return (
      form.weeklyCapacity !== saved.weeklyCapacity ||
      form.calendarStartHour !== saved.calendarStartHour ||
      form.calendarEndHour !== saved.calendarEndHour ||
      form.defaultLessonMode !== saved.defaultLessonMode ||
      form.paymentMethodCash !== saved.paymentMethodCash ||
      form.paymentMethodIban !== saved.paymentMethodIban ||
      form.lessonColorSaturation !== saved.lessonColorSaturation
    );
  }, [saved, form]);

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
    if (key === 'lessonColorSaturation') {
      document.documentElement.style.setProperty('--ls-sat', String(value));
    }
    setFeedback(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!isDirty || saving) return;

    setSaving(true);
    setFeedback(null);

    try {
      const updated = await updateSettings({
        weeklyCapacity: form.weeklyCapacity,
        calendarStartHour: form.calendarStartHour,
        calendarEndHour: form.calendarEndHour,
        defaultLessonMode: form.defaultLessonMode,
        paymentMethodCash: form.paymentMethodCash,
        paymentMethodIban: form.paymentMethodIban,
        lessonColorSaturation: form.lessonColorSaturation,
      });
      savedSatRef.current = updated.lessonColorSaturation ?? 1;
      setSaved(updated);
      setForm(updated);
      setFeedback({ ok: true, msg: 'Ayarlar kaydedildi.' });
    } catch (err) {
      setFeedback({ ok: false, msg: err.message || 'Ayarlar kaydedilemedi.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page settings-page">
        <div className="page-head page-head-solo">
          <h1 className="page-title">Ayarlar</h1>
        </div>
        <div className="stg-loading">Yükleniyor…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page settings-page">
        <div className="page-head page-head-solo">
          <h1 className="page-title">Ayarlar</h1>
        </div>
        <div className="stg-feedback stg-feedback-err">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <div className="page-head page-head-solo">
        <div>
          <h1 className="page-title">Ayarlar</h1>
        </div>
      </div>

      <div className="stg-tabs">
        <button
          type="button"
          className={'stg-tab' + (tab === 'general' ? ' is-active' : '')}
          onClick={() => setTab('general')}
        >
          Genel
        </button>
        <button
          type="button"
          className={'stg-tab' + (tab === 'activity' ? ' is-active' : '')}
          onClick={() => setTab('activity')}
        >
          Aktivite
        </button>
      </div>

      {tab === 'activity' && <ActivityPanel />}

      {tab === 'general' && <form onSubmit={handleSave} className="stg-form">

        <Section title="Takvim">
          <SettingRow label="Haftalık kapasite">
            <NumInput
              value={form.weeklyCapacity}
              onChange={v => set('weeklyCapacity', v)}
              min={1}
              max={200}
              unit="ders"
            />
          </SettingRow>

          <SettingRow label="Haftanın başlangıcı" info="Pazartesi · v1 sabit">
          </SettingRow>

          <SettingRow label="Görünür saat aralığı">
            <div className="stg-time-range">
              <HourSelect
                value={form.calendarStartHour}
                onChange={v => set('calendarStartHour', v)}
                min={0}
                max={23}
              />
              <span className="stg-range-sep">→</span>
              <HourSelect
                value={form.calendarEndHour}
                onChange={v => set('calendarEndHour', v)}
                min={1}
                max={24}
              />
            </div>
          </SettingRow>
        </Section>

        <Section title="Dersler">
          <SettingRow label="Varsayılan ders modu">
            <ModeToggle
              value={form.defaultLessonMode}
              onChange={v => set('defaultLessonMode', v)}
            />
          </SettingRow>
        </Section>

        <Section title="Görünüm">
          <SettingRow label="Ders rengi doygunluğu" top>
            <SatSlider
              value={form.lessonColorSaturation ?? 1}
              onChange={v => set('lessonColorSaturation', v)}
              onReset={() => set('lessonColorSaturation', 1)}
            />
          </SettingRow>
        </Section>

        <Section title="Finans">
          <SettingRow label="Para birimi" info="TRY · v1 sabit">
          </SettingRow>

          <SettingRow label="Aktif ödeme yöntemleri">
            <div className="stg-checks">
              <CheckToggle
                checked={form.paymentMethodCash}
                onChange={v => set('paymentMethodCash', v)}
                label="Nakit"
              />
              <CheckToggle
                checked={form.paymentMethodIban}
                onChange={v => set('paymentMethodIban', v)}
                label="IBAN"
              />
            </div>
          </SettingRow>
        </Section>

        {feedback && (
          <div className={'stg-feedback' + (feedback.ok ? ' stg-feedback-ok' : ' stg-feedback-err')}>
            {feedback.ok && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {feedback.msg}
          </div>
        )}

        <div className="stg-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!isDirty || saving}
          >
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>

      </form>}

    </div>
  );
}

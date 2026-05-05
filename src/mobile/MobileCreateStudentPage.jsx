import React from 'react';
import { createPortal } from 'react-dom';
import { createStudent } from '../api';
import { formatPhoneTr, todayIso, previewInitials } from './shared/studentMeta';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function ChevronLeftIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

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

function UnsetIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M6 7c.2-1.3 1-2 2-2 1.2 0 2 .7 2 1.8 0 1-.5 1.5-1.5 2M8 10.8v.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ModePreferenceSeg({ value, onChange }) {
  const options = [
    { key: 'onsite', label: 'Yüzyüze', icon: <OnsiteIcon /> },
    { key: 'online', label: 'Online', icon: <OnlineIcon /> },
    { key: null, label: 'Belirtmedim', icon: <UnsetIcon /> },
  ];
  return (
    <div className="mobile-cstudent-mode">
      {options.map(opt => (
        <button
          key={opt.key ?? 'null'}
          type="button"
          className={'mobile-cstudent-mode-btn' + (value === opt.key ? ' is-on' : '')}
          onClick={() => onChange(opt.key)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mobile-cstudent-section">
      <div className="mobile-cstudent-section-title">{title}</div>
      {children}
    </section>
  );
}

function Row({ label, children, last }) {
  return (
    <label className={'mobile-cstudent-row' + (last ? ' is-last' : '')}>
      <span className="mobile-cstudent-row-label">{label}</span>
      {children}
    </label>
  );
}

export function MobileCreateStudentPage({ onClose, onCreated }) {
  const [fullName, setFullName] = React.useState('');
  const [nickname, setNickname] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [birthday, setBirthday] = React.useState('');
  const [joinedAt, setJoinedAt] = React.useState(todayIso());
  const [preferredMode, setPreferredMode] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const nameRef = React.useRef(null);

  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  React.useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  const trimmedName = fullName.trim();
  const trimmedNickname = nickname.trim();
  const initials = previewInitials(fullName);
  const nameValid = trimmedName.length >= 2;
  const canSubmit = nameValid && !submitting;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createStudent({
        fullName: trimmedName,
        nickname: trimmedNickname || null,
        preferredMode,
        phone: phone.trim() || null,
        email: email.trim() || null,
        birthday: birthday || null,
        joinedAt: joinedAt || null,
        note: note.trim() || null,
      });
      await onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Öğrenci oluşturulamadı.');
      setSubmitting(false);
    }
  }

  const portalRoot = getMobilePaletteRoot();

  const content = (
    <div className="mobile-cstudent-page" role="dialog" aria-modal="true" aria-labelledby="cstudent-title">
      <header className="mobile-cstudent-topbar">
        <button
          type="button"
          className="mobile-cstudent-back"
          onClick={onClose}
          disabled={submitting}
          aria-label="Geri"
        >
          <ChevronLeftIcon />
        </button>
        <h1 id="cstudent-title" className="mobile-cstudent-topbar-title">Yeni öğrenci</h1>
        <div className="mobile-cstudent-topbar-spacer" />
      </header>

      <form className="mobile-cstudent-form" onSubmit={handleSubmit} noValidate>
        <div className="mobile-cstudent-body">
          <div className="mobile-cstudent-hero">
            <div className={'mobile-cstudent-hero-avatar' + (initials ? '' : ' is-placeholder')}>
              {initials || <PersonIcon />}
            </div>
            <input
              ref={nameRef}
              type="text"
              className="mobile-cstudent-hero-name"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Ad Soyad"
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
              aria-label="Ad Soyad"
              required
            />
            <input
              type="text"
              className="mobile-cstudent-hero-nick"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="Lakap (opsiyonel)"
              maxLength={60}
              autoComplete="off"
              spellCheck={false}
              aria-label="Lakap"
            />
            {!nameValid && (
              <div className="mobile-cstudent-hero-hint">Devam etmek için adı girin</div>
            )}
          </div>

          <Section title="İletişim">
            <div className="mobile-cstudent-card">
              <Row label="Telefon">
                <input
                  type="tel"
                  inputMode="numeric"
                  className="mobile-cstudent-row-input"
                  value={phone}
                  onChange={e => setPhone(formatPhoneTr(e.target.value))}
                  placeholder="0 5__ ___ __ __"
                  autoComplete="off"
                />
              </Row>
              <Row label="E-posta" last>
                <input
                  type="email"
                  className="mobile-cstudent-row-input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="ornek@posta.com"
                  autoComplete="off"
                />
              </Row>
            </div>
          </Section>

          <Section title="Tarihler">
            <div className="mobile-cstudent-card">
              <Row label="Doğum günü">
                <input
                  type="date"
                  className="mobile-cstudent-row-input"
                  value={birthday}
                  onChange={e => setBirthday(e.target.value)}
                  max={todayIso()}
                />
              </Row>
              <Row label="Kayıt tarihi" last>
                <input
                  type="date"
                  className="mobile-cstudent-row-input"
                  value={joinedAt}
                  onChange={e => setJoinedAt(e.target.value)}
                />
              </Row>
            </div>
          </Section>

          <Section title="Ders tercihi">
            <ModePreferenceSeg value={preferredMode} onChange={setPreferredMode} />
          </Section>

          <Section title="Not">
            <textarea
              className="mobile-cstudent-textarea"
              rows="3"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Tercih, sağlık bilgisi, hatırlatıcı…"
              maxLength={500}
            />
          </Section>

          {error && (
            <div className="mobile-cstudent-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <footer className="mobile-cstudent-actions">
          <button
            type="submit"
            className="mobile-cstudent-btn-primary"
            disabled={!canSubmit}
          >
            {submitting ? 'Ekleniyor…' : 'Öğrenciyi ekle'}
          </button>
        </footer>
      </form>
    </div>
  );

  if (!portalRoot) return content;
  return createPortal(content, portalRoot);
}

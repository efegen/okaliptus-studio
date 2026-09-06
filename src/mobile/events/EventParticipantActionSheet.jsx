import React from 'react';
import { Drawer } from 'vaul';
import { Icon } from '../../layout';

const REMOVAL_REASONS = [
  { id: 'student_cancelled', label: 'Öğrenci iptal etti' },
  { id: 'plans_changed', label: 'Planı değişti' },
  { id: 'added_by_mistake', label: 'Yanlışlıkla eklendi' },
  { id: 'other', label: 'Diğer' },
];

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

// Misafiri olan biri kaldırılırken zorunlu ikinci seçim (bkz. backend
// GuestResolution) — kullanıcı ne olacağını açıkça seçmeden gönderim kapalı.
const GUEST_RESOLUTIONS = [
  {
    id: 'unlink',
    label: 'Bağlantıları kopart',
    description: (name, guestNames) =>
      `${guestNames} kalır, ama artık ${name || 'bu kişinin'} misafiri olarak görünmez — normal, bağımsız birer katılımcı olurlar. Kendi ödeme ve ulaşım durumlarını korurlar.`,
  },
  {
    id: 'remove_guests',
    label: 'Misafirleri de kaldır',
    description: (name, guestNames) =>
      `${guestNames}, ${name || 'bu kişiyle'} birlikte listeden tamamen çıkarılır. Tahsilatı alınmış bir misafir varsa önce onun ödemesi iade edilmeli.`,
  },
];

function participantName(participant) {
  return participant?.student_nickname || participant?.student_name || '';
}

function guestDisplayName(guest) {
  return guest?.student_nickname || guest?.student_name || 'Misafir';
}

function formatGuestNames(guests) {
  const names = guests.map(guestDisplayName);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} ve ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} ve ${names[names.length - 1]}`;
}

function formatContactTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function EventParticipantActionSheet({ participant, action, guests = [], busy, error, onClose, onSubmit }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  const [reason, setReason] = React.useState('');
  const [note, setNote] = React.useState('');
  const [guestResolution, setGuestResolution] = React.useState('');
  const open = Boolean(participant && action);
  const isRemove = action === 'remove';
  const name = participantName(participant);
  const phone = participant?.student_phone?.trim() || '';
  const telHref = phone ? `tel:${phone.replace(/[^+\d]/g, '')}` : null;
  const hasGuests = isRemove && guests.length > 0;
  const guestNames = hasGuests ? formatGuestNames(guests) : '';

  React.useEffect(() => {
    setReason('');
    setNote('');
    setGuestResolution('');
  }, [participant?.id, action]);

  function submit() {
    if (busy || (isRemove && !reason) || (hasGuests && !guestResolution)) return;
    onSubmit(isRemove
      ? { reason, note: note.trim() || null, ...(hasGuests && { guestResolution }) }
      : { note: note.trim() || null });
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose(); }}
      dismissible={!busy}
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-lsheet-overlay" />
        <Drawer.Content className="mobile-lsheet-content mobile-lsheet-content-plan evx-participant-action-sheet">
          <Drawer.Handle className="mobile-lsheet-handle" />
          {participant && (
            <>
              <header className="evx-action-sheet-header">
                <span className={`evx-action-sheet-icon ${isRemove ? 'is-danger' : 'is-contact'}`} aria-hidden="true">
                  {isRemove ? <Icon.Trash width="20" height="20" /> : <Icon.Phone width="20" height="20" />}
                </span>
                <div>
                  <Drawer.Title className="evx-action-sheet-title">
                    {isRemove ? `${name} kaldırılsın mı?` : `${name} arandı mı?`}
                  </Drawer.Title>
                  <Drawer.Description className="evx-action-sheet-description">
                    {isRemove
                      ? hasGuests
                        ? `Kaldırma nedenini seçin ve ${guestNames} için ne yapılacağına karar verin. Bu bilgi etkinlik geçmişinde saklanır.`
                        : 'Kaldırma nedenini seçin. Bu bilgi etkinlik geçmişinde saklanır.'
                      : 'Aramayla ilgili kısa bir not bırakıp arandı olarak kaydedin.'}
                  </Drawer.Description>
                </div>
              </header>

              <div className="evx-action-sheet-body">
                {isRemove ? (
                  <fieldset className="evx-action-reasons">
                    <legend>Neden kaldırıyorsunuz?</legend>
                    <div className="evx-action-reason-grid">
                      {REMOVAL_REASONS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`evx-action-reason${reason === item.id ? ' is-on' : ''}`}
                          aria-pressed={reason === item.id}
                          disabled={busy}
                          onClick={() => setReason(item.id)}
                        >
                          <span className="evx-action-radio" aria-hidden="true" />
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}

                {hasGuests && (
                  <fieldset className="evx-action-reasons evx-action-guest-resolution">
                    <legend>{`${name || 'Bu kişinin'} ${guests.length} misafiri var — ${guestNames} ne olsun?`}</legend>
                    <div className="evx-action-reason-grid">
                      {GUEST_RESOLUTIONS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`evx-action-reason${guestResolution === item.id ? ' is-on' : ''}`}
                          aria-pressed={guestResolution === item.id}
                          disabled={busy}
                          onClick={() => setGuestResolution(item.id)}
                        >
                          <span className="evx-action-radio" aria-hidden="true" />
                          {item.label}
                        </button>
                      ))}
                    </div>
                    {guestResolution && (
                      <p className="evx-hint evx-action-guest-resolution-hint">
                        {GUEST_RESOLUTIONS.find((item) => item.id === guestResolution).description(name, guestNames)}
                      </p>
                    )}
                  </fieldset>
                )}

                {!isRemove && (
                  <div className="evx-action-call-block">
                    {telHref ? (
                      <a className="evx-action-call-button" href={telHref}>
                        <Icon.Phone width="18" height="18" aria-hidden="true" />
                        <span><strong>Şimdi ara</strong><small>{phone}</small></span>
                      </a>
                    ) : (
                      <div className="evx-action-no-phone">
                        <Icon.Phone width="18" height="18" aria-hidden="true" />
                        Telefon numarası kayıtlı değil
                      </div>
                    )}
                    {participant.last_contacted_at && (
                      <div className="evx-action-last-contact">
                        <span>Son arama · {formatContactTime(participant.last_contacted_at)}</span>
                        {participant.contact_note && <p>{participant.contact_note}</p>}
                      </div>
                    )}
                  </div>
                )}

                <label className="evx-action-note-field">
                  <span>{isRemove ? 'Kaldırma notu' : 'Arama notu'} <small>(isteğe bağlı)</small></span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={isRemove ? 'Eklemek istediğiniz bir ayrıntı var mı?' : 'Örn. ulaşılamadı, yarın tekrar aranacak…'}
                    rows={3}
                    maxLength={500}
                    disabled={busy}
                  />
                  <small>{note.length}/500</small>
                </label>

                {error && <div className="evx-action-sheet-error" role="alert">{error}</div>}
              </div>

              <footer className="evx-action-sheet-footer">
                <button type="button" className="evx-action-cancel" onClick={onClose} disabled={busy}>Vazgeç</button>
                <button
                  type="button"
                  className={`evx-action-submit${isRemove ? ' is-danger' : ''}`}
                  onClick={submit}
                  disabled={busy || (isRemove && !reason) || (hasGuests && !guestResolution)}
                >
                  {busy
                    ? 'Kaydediliyor…'
                    : isRemove
                      ? 'Listeden kaldır'
                      : <><Icon.Check width="17" height="17" aria-hidden="true" /> Arandı olarak kaydet</>}
                </button>
              </footer>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { searchEventStudents, addEventParticipant, getEventById, getEventParticipants } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { COVERAGE_PRESET_BY_ROLE, FeeCoverageList, FeeCoverageTotals } from './feeCoverage';

// Canvas-2 "6a" (ara) → "6b" (kayıtlı öğrenci) veya "6c" (yeni kişi). Tek
// bileşende iç adım state'i olarak tutulur.
//
// Rol seçimi ücretlerin ÖN AYARI'dır: seçince aşağıdaki kalemler o role göre
// dolar, sonra kalem kalem değiştirilebilir (fees[] olarak gönderilir).
// "Gelmiyor" bilinçli olarak burada yok — gelmeyecek birini listeye eklemek
// yerine hiç eklememek doğru; katılımcı listesinde durum yine değiştirilebilir.

function initialsOf(name) {
  return (name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

const ROLES = [
  ['regular', 'Normal'],
  ['invited', 'Davetli'],
  ['volunteer', 'Gönüllü'],
];

function GuestOfPicker({ eventId, value, onChange, excludeStudentId, participants }) {
  const [query, setQuery] = React.useState('');
  const searchQuery = useQuery({
    queryKey: ['eventParticipantSearch', eventId, query],
    queryFn: () => searchEventStudents(eventId, query),
    enabled: query.trim().length > 0,
    staleTime: 10 * 1000,
  });
  // Arama sonucu öğrenci id'si döner ama guestOfParticipantId bu etkinlikteki
  // event_participants satırının id'sini ister — burada karşılığı bulunur.
  const results = (searchQuery.data ?? [])
    .filter((r) => r.already_in_event && r.id !== excludeStudentId)
    .map((r) => ({ ...r, participantId: participants.find((p) => p.student_id === r.id)?.id }))
    .filter((r) => r.participantId != null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, marginTop: -9, background: 'oklch(0.988 0.005 80)', border: '1px solid var(--line)', borderTop: '1px dashed var(--line)', borderRadius: '0 0 14px 14px' }}>
      <div className="evx-field is-active" style={{ padding: '8px 12px' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="İsim yazarak arayın" />
      </div>
      {value && (
        <div className="evx-row" style={{ minHeight: 44, padding: '6px 11px' }}>
          <span className="evx-row-body"><span className="evx-row-name" style={{ fontSize: 13.5 }}>{value.label}</span></span>
          <button type="button" onClick={() => onChange(null)} style={{ border: 0, background: 'none', color: 'var(--ink-4)', padding: 0, minHeight: 0 }}>×</button>
        </div>
      )}
      {!value && results.length > 0 && (
        <ul className="evx-group-list">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="evx-row" style={{ minHeight: 44, padding: '6px 11px' }}
                onClick={() => onChange({ participantId: r.participantId, label: r.nickname || r.full_name })}>
                <span className="evx-avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{initialsOf(r.full_name)}</span>
                <span className="evx-row-body"><span className="evx-row-name" style={{ fontSize: 13.5 }}>{r.nickname || r.full_name}</span></span>
                <span className="evx-row-trail">Seç ›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailsForm({ eventId, identity, participants, onSubmit, submitting, error }) {
  const event = useQuery({ queryKey: queryKeys.eventById(eventId), queryFn: () => getEventById(eventId) }).data;
  const [role, setRole] = React.useState(identity.defaultRole);
  const [isGuest, setIsGuest] = React.useState(identity.defaultIsGuest);
  const [guestOf, setGuestOf] = React.useState(identity.defaultGuestOf ?? null);
  const [transportMode] = React.useState('needs_vehicle');
  const [rsvpStatus, setRsvpStatus] = React.useState(identity.defaultRsvp);

  const feeItems = event?.feeItems ?? [];
  const feeItemsKey = feeItems.map((i) => `${i.id}:${i.is_lesson_fee ? 1 : 0}`).join(',');
  const [coverage, setCoverage] = React.useState({});
  const [feesExpanded, setFeesExpanded] = React.useState(role !== 'regular');
  const feesContentId = React.useId();

  // Rol değişince (ve kalemler yüklenince) ön ayar baştan uygulanır — rol
  // seçmek "bu kişinin durumu baştan farklı" demek olduğu için özelleştirmeler
  // bilinçli olarak sıfırlanır. "studio" ön ayarı ders ücretinde geçerli değil —
  // stüdyonun kendi gelirinde gerçek bir masraf oluşmaz, o yüzden orada
  // "almıyor"a düşer; kahvaltı gibi diğer kalemlerde normal uygulanır.
  React.useEffect(() => {
    const preset = COVERAGE_PRESET_BY_ROLE[role] ?? 'student';
    setCoverage(Object.fromEntries(
      feeItemsKey ? feeItemsKey.split(',').map((pair) => {
        const [id, isLessonFee] = pair.split(':');
        const resolved = preset === 'studio' && isLessonFee === '1' ? 'none' : preset;
        return [id, resolved];
      }) : []
    ));
  }, [role, feeItemsKey]);

  // "Normal" rol standart kapalı gelir (çoğu zaman ön ayar yeterlidir);
  // davetli/gönüllü seçilince ücret dağılımı gözden geçirilmesi gerektiği
  // için otomatik açılır. Elle kapatılsa bile rol tekrar değişince açılır.
  React.useEffect(() => {
    if (role !== 'regular') setFeesExpanded(true);
  }, [role]);

  function handleSubmit() {
    onSubmit({
      role,
      rsvpStatus,
      transportMode: event?.transport_enabled ? transportMode : 'unspecified',
      guestOfParticipantId: isGuest ? guestOf?.participantId ?? null : null,
      fees: Object.entries(coverage).map(([feeItemId, cov]) => ({ feeItemId, coverage: cov })),
    });
  }

  return (
    <>
      <div className="evx-body" style={{ paddingBottom: 140 }}>
        {identity.summary && (
          <div className={identity.stickySummary === false ? undefined : 'evx-identity-sticky'}>{identity.summary}</div>
        )}

        <div className="evx-section">
          <span className="evx-section-label">Bu etkinlikteki rolü</span>
          <div className="evx-seg">
            {ROLES.map(([id, label]) => (
              <button key={id} type="button" className={`evx-seg-btn${role === id ? ' is-on' : ''}`} onClick={() => setRole(id)}>{label}</button>
            ))}
          </div>
          <p className="evx-hint">Rol bir ön ayardır — ücretleri aşağıdan kalem kalem değiştirebilirsiniz</p>
        </div>

        {feeItems.length > 0 && (
          <div className="evx-section">
            <button type="button" className="evx-fees-toggle" aria-expanded={feesExpanded}
              aria-controls={feesContentId} onClick={() => setFeesExpanded((v) => !v)}>
              <span className="evx-section-label">Ücretler · kimin ödeyeceği</span>
              <Icon.ChevronDown width="18" height="18" aria-hidden="true" />
            </button>
            <div id={feesContentId} hidden={!feesExpanded}>
              {feesExpanded && <FeeCoverageList
                items={feeItems}
                value={coverage}
                onChange={(feeItemId, next) => setCoverage((cur) => ({ ...cur, [feeItemId]: next }))}
              />}
            </div>
            <FeeCoverageTotals items={feeItems} value={coverage} />
          </div>
        )}

        <div className="evx-section">
          <div className="evx-toggle-row" style={{ borderRadius: isGuest ? '14px 14px 0 0' : 14 }}>
            <div className="evx-toggle-body">
              <span className="evx-toggle-title">Birinin misafiri</span>
              <span className="evx-toggle-sub">Katılımı bir öğrenciye bağlanır</span>
            </div>
            <input type="checkbox" className="evx-toggle" checked={isGuest} onChange={(e) => { setIsGuest(e.target.checked); setGuestOf(null); }} />
          </div>
          {isGuest && (
            <GuestOfPicker eventId={eventId} value={guestOf} onChange={setGuestOf} excludeStudentId={identity.studentId} participants={participants} />
          )}
        </div>

        <div className="evx-section">
          <span className="evx-section-label">Gelme durumu</span>
          <div className="evx-choice">
            <button type="button" className={`evx-choice-btn tone-accent${rsvpStatus === 'coming' ? ' is-on' : ''}`} onClick={() => setRsvpStatus('coming')}>
              <span className="evx-choice-dot" style={{ background: 'oklch(0.5 0.08 145)' }} /> Geliyor
            </button>
            <button type="button" className={`evx-choice-btn tone-amber${rsvpStatus === 'unsure' ? ' is-on' : ''}`} onClick={() => setRsvpStatus('unsure')}>
              <span className="evx-choice-dot" style={{ background: 'oklch(0.8 0.13 80)' }} /> Belirsiz
            </button>
          </div>
        </div>

        {error && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{error}</div>}
      </div>
      <div className="evx-footer">
        <button type="button" className="evx-btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Kaydediliyor…' : identity.submitLabel}
        </button>
        {identity.submitNote && <p className="evx-footer-note">{identity.submitNote}</p>}
      </div>
    </>
  );
}

export function MobileEventAddPerson({ eventId, onClose, onAdded, presetGuestOf }) {
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState('search');
  const [query, setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const [selectedStudent, setSelectedStudent] = React.useState(null);
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  const searchResults = useQuery({
    queryKey: ['eventParticipantSearch', eventId, deferredQuery],
    queryFn: () => searchEventStudents(eventId, deferredQuery),
    enabled: deferredQuery.trim().length > 0,
  });
  const participantsQuery = useQuery({ queryKey: queryKeys.eventParticipants(eventId), queryFn: () => getEventParticipants(eventId) });
  const participants = participantsQuery.data ?? [];

  async function refreshAndClose() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipants(eventId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.eventById(eventId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.upcomingEvent() });
    onAdded();
  }

  async function submitExisting(details) {
    setSubmitting(true);
    setError('');
    try {
      await addEventParticipant(eventId, { studentId: selectedStudent.id, ...details });
      await refreshAndClose();
    } catch (err) {
      setError(err?.message || 'Katılımcı eklenemedi.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitNew(details) {
    if (!newName.trim()) return setError('Ad soyad zorunlu.');
    setSubmitting(true);
    setError('');
    try {
      await addEventParticipant(eventId, { fullName: newName.trim(), phone: newPhone.trim() || null, ...details });
      await refreshAndClose();
    } catch (err) {
      setError(err?.message || 'Katılımcı eklenemedi.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'existing' && selectedStudent) {
    return (
      <div className="evx">
        <header className="evx-header">
          <button type="button" className="evx-header-btn" onClick={() => setStep('search')}><Icon.ChevronL width="22" height="22" /></button>
          <div className="evx-header-mid"><span className="evx-header-title">Etkinliğe ekle</span></div>
        </header>
        <DetailsForm
          eventId={eventId}
          participants={participants}
          submitting={submitting}
          error={error}
          onSubmit={submitExisting}
          identity={{
            studentId: selectedStudent.id,
            defaultRole: 'regular',
            defaultIsGuest: !!presetGuestOf,
            defaultGuestOf: presetGuestOf,
            defaultRsvp: 'unsure',
            submitLabel: `${selectedStudent.nickname || selectedStudent.full_name}'i etkinliğe ekle`,
            summary: (
              <div className="evx-row" style={{ cursor: 'default' }}>
                <span className="evx-avatar is-lg">{initialsOf(selectedStudent.full_name)}</span>
                <span className="evx-row-body">
                  <span className="evx-participant-name-row">
                    <span className="evx-row-name" style={{ fontSize: 16 }}>{selectedStudent.full_name}</span>
                    <span className="evx-badge tone-neutral">KAYITLI</span>
                  </span>
                  <span className="evx-row-sub">{selectedStudent.phone || 'Telefon yok'}</span>
                </span>
              </div>
            ),
          }}
        />
      </div>
    );
  }

  if (step === 'new') {
    return (
      <div className="evx">
        <header className="evx-header">
          <button type="button" className="evx-header-btn" onClick={() => setStep('search')}><Icon.ChevronL width="22" height="22" /></button>
          <div className="evx-header-mid">
            <span className="evx-header-title">Yeni kişi</span>
            <span className="evx-header-sub">Öğrenci listenize de kaydedilir</span>
          </div>
        </header>
        <DetailsForm
          eventId={eventId}
          participants={participants}
          submitting={submitting}
          error={error}
          onSubmit={submitNew}
          identity={{
            studentId: null,
            defaultRole: 'regular',
            defaultIsGuest: !!presetGuestOf,
            defaultGuestOf: presetGuestOf,
            defaultRsvp: 'coming',
            submitLabel: 'Oluştur ve etkinliğe ekle',
            submitNote: `${newName.trim() || 'Yeni kişi'}, öğrenci listenize de eklenecek`,
            stickySummary: false,
            summary: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="evx-field is-active">
                  <span className="evx-field-label">AD SOYAD</span>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus placeholder={query} />
                </div>
                <div className="evx-field">
                  <span className="evx-field-label">TELEFON</span>
                  <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="İsteğe bağlı" inputMode="tel" />
                </div>
              </div>
            ),
          }}
        />
      </div>
    );
  }

  const alreadyAdded = new Set(participants.map((p) => p.student_id));

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={onClose}><Icon.ChevronL width="22" height="22" /></button>
        <div className="evx-header-mid"><span className="evx-header-title">Kişi ekle</span></div>
      </header>
      <div className="evx-body">
        <div className="evx-field is-active">
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="İsim veya telefon" />
        </div>
        <p className="evx-hint">Önce kayıtlı öğrencilerde aranır — aynı kişiyi ikinci kez oluşturmamak için.</p>

        {deferredQuery.trim() && (
          <div className="evx-section">
            <div className="evx-group-head">
              <span className="evx-group-title" style={{ color: 'var(--ink-2)' }}>KAYITLI ÖĞRENCİLER</span>
              <span className="evx-group-count">{searchResults.data?.length ?? 0} eşleşme</span>
              <span className="evx-group-line" />
            </div>
            <ul className="evx-group-list">
              {(searchResults.data ?? []).map((r) => (
                <li key={r.id}>
                  {r.already_in_event || alreadyAdded.has(r.id) ? (
                    <div className="evx-row is-muted">
                      <span className="evx-avatar">{initialsOf(r.full_name)}</span>
                      <span className="evx-row-body">
                        <span className="evx-row-name" style={{ color: 'var(--ink-3)' }}>{r.full_name}</span>
                        <span className="evx-row-sub">{r.phone || ''}</span>
                      </span>
                      <span className="evx-badge tone-neutral">Zaten listede</span>
                    </div>
                  ) : (
                    <button type="button" className="evx-row" onClick={() => { setSelectedStudent(r); setStep('existing'); }}>
                      <span className="evx-avatar">{initialsOf(r.full_name)}</span>
                      <span className="evx-row-body">
                        <span className="evx-row-name">{r.full_name}</span>
                        <span className="evx-row-sub">{r.phone || 'Telefon yok'}</span>
                      </span>
                      <span className="evx-row-trail">Ekle ›</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="evx-section">
          <div className="evx-group-head">
            <span className="evx-group-title" style={{ color: 'var(--ink-3)' }}>ARADIĞINIZ KİŞİ YOK MU?</span>
            <span className="evx-group-line" />
          </div>
          <button
            type="button"
            className="evx-row"
            style={{ border: '1.5px dashed var(--line-2)', background: 'transparent' }}
            onClick={() => { setNewName(query.trim() ? query : ''); setStep('new'); }}
          >
            <span className="evx-avatar" style={{ background: 'transparent', border: '1.5px dashed var(--line-2)' }}>
              <Icon.Plus width="17" height="17" />
            </span>
            <span className="evx-row-body">
              <span className="evx-row-name">{query.trim() ? `"${query.trim()}" için yeni kişi oluştur` : 'Yeni kişi oluştur'}</span>
              <span className="evx-row-sub">Öğrenci listenize de kaydedilir</span>
            </span>
            <span className="evx-row-chev">›</span>
          </button>
        </div>
      </div>
    </div>
  );
}

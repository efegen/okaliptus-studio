import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Drawer } from 'vaul';
import { Icon } from '../../layout';
import { searchEventStudents } from '../../api';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function nameOf(participant) {
  return participant.student_nickname || participant.student_name || 'İsimsiz';
}

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('tr-TR');
}

function participantChoice(participant) {
  return {
    key: `participant:${participant.id}`,
    participantId: participant.id,
    studentId: participant.student_id,
    name: nameOf(participant),
    phone: participant.student_phone || null,
    source: 'participant',
  };
}

function studentChoice(student) {
  return {
    key: `student:${student.id}`,
    studentId: student.id,
    name: student.nickname || student.full_name,
    phone: student.phone || null,
    source: 'student',
  };
}

function ChoiceRow({ choice, selected, disabled, meta, onToggle }) {
  return (
    <button
      type="button"
      className={`evx-passenger-choice${selected ? ' is-selected' : ''}`}
      disabled={disabled}
      onClick={() => onToggle(choice)}
      aria-pressed={selected}
    >
      <span className="evx-passenger-avatar">{initialsOf(choice.name)}</span>
      <span className="evx-passenger-choice-copy">
        <strong>{choice.name}</strong>
        <span>{meta || choice.phone || (choice.source === 'participant' ? 'Etkinlikte' : 'Kayıtlı öğrenci')}</span>
      </span>
      <span className="evx-passenger-check" aria-hidden="true">{selected ? '✓' : '+'}</span>
    </button>
  );
}

export function MobileEventPassengerPicker({
  open,
  eventId,
  participants = [],
  value = [],
  max = 0,
  excludedStudentIds = [],
  submitting = false,
  error = '',
  title = 'Yolcu ekle',
  onClose,
  onConfirm,
}) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  const externalCounter = React.useRef(0);
  const [query, setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const [draft, setDraft] = React.useState(value);
  const [externalOpen, setExternalOpen] = React.useState(false);
  const [externalName, setExternalName] = React.useState('');
  const [externalPhone, setExternalPhone] = React.useState('');
  const [localError, setLocalError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setDraft(value);
    setQuery('');
    setExternalOpen(false);
    setExternalName('');
    setExternalPhone('');
    setLocalError('');
    // Selection is intentionally reset only when a fresh sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const searchQuery = useQuery({
    queryKey: ['eventPassengerSearch', eventId, deferredQuery],
    queryFn: () => searchEventStudents(eventId, deferredQuery),
    enabled: open && deferredQuery.trim().length > 0,
    staleTime: 10 * 1000,
  });

  const selectedKeys = new Set(draft.map((choice) => choice.key));
  const excludedStudentKeySet = new Set(excludedStudentIds.map(String));
  const selectableParticipants = participants.filter((participant) => (
    !participant.vehicle_id && !excludedStudentKeySet.has(String(participant.student_id))
  ));
  const reachedLimit = draft.length >= max;

  function toggleChoice(choice) {
    setLocalError('');
    setDraft((current) => {
      if (current.some((item) => item.key === choice.key)) {
        return current.filter((item) => item.key !== choice.key);
      }
      if (current.length >= max) {
        setLocalError(`Bu araçta en fazla ${max} yolcu seçebilirsiniz.`);
        return current;
      }
      return [...current, choice];
    });
  }

  function startExternalPerson() {
    if (reachedLimit) {
      setLocalError(`Bu araçta en fazla ${max} yolcu seçebilirsiniz.`);
      return;
    }
    setExternalName(query.trim());
    setExternalPhone('');
    setExternalOpen(true);
    setLocalError('');
  }

  function addExternalPerson() {
    const name = externalName.trim();
    if (!name) {
      setLocalError('Dışarıdan kişinin adını yazın.');
      return;
    }
    if (draft.length >= max) {
      setLocalError(`Bu araçta en fazla ${max} yolcu seçebilirsiniz.`);
      return;
    }
    externalCounter.current += 1;
    setDraft((current) => [...current, {
      key: `external:${externalCounter.current}`,
      fullName: name,
      phone: externalPhone.trim() || null,
      name,
      source: 'external',
    }]);
    setExternalOpen(false);
    setExternalName('');
    setExternalPhone('');
    setQuery('');
    setLocalError('');
  }

  function handleClose() {
    if (!submitting) onClose();
  }

  const searchResults = (searchQuery.data ?? []).map((student) => {
    const participant = participants.find((item) => String(item.student_id) === String(student.id));
    return {
      student,
      participant,
      choice: participant ? participantChoice(participant) : studentChoice(student),
      assigned: !!participant?.vehicle_id,
      excluded: excludedStudentKeySet.has(String(student.id)),
    };
  });

  if (!open) return null;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) handleClose(); }}
      dismissible={!submitting}
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="evx-passenger-overlay" />
        <Drawer.Content className="evx-passenger-sheet" aria-busy={submitting}>
          <Drawer.Handle className="evx-passenger-handle" />
          <header className="evx-passenger-head">
            <Drawer.Title>{title}</Drawer.Title>
            <Drawer.Description>{max} boş koltuk için kişi seçin.</Drawer.Description>
          </header>

          <div className="evx-passenger-body">
            {draft.length > 0 && (
              <section className="evx-passenger-selected" aria-label="Seçilen yolcular">
                <span className="evx-passenger-section-label">Seçilenler · {draft.length}/{max}</span>
                <div>
                  {draft.map((choice) => (
                    <button key={choice.key} type="button" onClick={() => toggleChoice(choice)} disabled={submitting}>
                      {choice.name}<span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <label className="evx-passenger-search">
              <Icon.Search width="18" height="18" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setExternalOpen(false); setLocalError(''); }}
                placeholder="Öğrenci ara veya isim yaz"
                aria-label="Yolcu ara"
              />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Aramayı temizle">×</button>}
            </label>

            {!deferredQuery.trim() && selectableParticipants.length > 0 && (
              <section className="evx-passenger-section">
                <span className="evx-passenger-section-label">Etkinliktekiler</span>
                <div className="evx-passenger-list">
                  {selectableParticipants.map((participant) => {
                    const choice = participantChoice(participant);
                    return (
                      <ChoiceRow
                        key={choice.key}
                        choice={choice}
                        selected={selectedKeys.has(choice.key)}
                        disabled={submitting || (reachedLimit && !selectedKeys.has(choice.key))}
                        meta={participant.transport_mode === 'needs_vehicle' ? 'Araç bekliyor' : 'Etkinlikte'}
                        onToggle={toggleChoice}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {deferredQuery.trim() && (
              <section className="evx-passenger-section">
                <span className="evx-passenger-section-label">Öğrenciler</span>
                {searchQuery.isLoading ? (
                  <div className="evx-passenger-state">Aranıyor…</div>
                ) : searchResults.length > 0 ? (
                  <div className="evx-passenger-list">
                    {searchResults.map(({ student, participant, choice, assigned, excluded }) => (
                      <ChoiceRow
                        key={choice.key}
                        choice={choice}
                        selected={selectedKeys.has(choice.key)}
                        disabled={submitting || assigned || excluded || (reachedLimit && !selectedKeys.has(choice.key))}
                        meta={excluded ? 'Bu aracın şoförü' : assigned ? 'Başka araçta' : participant ? 'Etkinlikte' : student.phone || 'Kayıtlı öğrenci'}
                        onToggle={toggleChoice}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="evx-passenger-state">Eşleşen öğrenci bulunamadı.</div>
                )}
              </section>
            )}

            {!externalOpen ? (
              <button type="button" className="evx-passenger-external" onClick={startExternalPerson} disabled={submitting || reachedLimit}>
                <span><Icon.Plus width="17" height="17" /></span>
                <span>
                  <strong>{query.trim() ? `“${query.trim()}” adlı dışarıdan kişiyi ekle` : 'Dışarıdan kişi ekle'}</strong>
                  <small>Listede olmayan bir yolcu</small>
                </span>
                <Icon.ChevronR width="17" height="17" aria-hidden="true" />
              </button>
            ) : (
              <section className="evx-passenger-external-form">
                <span className="evx-passenger-section-label">Dışarıdan kişi</span>
                <label>
                  <span>Ad soyad</span>
                  <input value={externalName} onChange={(event) => setExternalName(event.target.value)} autoFocus />
                </label>
                <label>
                  <span>Telefon · isteğe bağlı</span>
                  <input value={externalPhone} onChange={(event) => setExternalPhone(event.target.value)} inputMode="tel" />
                </label>
                <div>
                  <button type="button" className="evx-btn-secondary" onClick={() => setExternalOpen(false)}>Vazgeç</button>
                  <button type="button" className="evx-btn-primary" onClick={addExternalPerson}>Listeye ekle</button>
                </div>
              </section>
            )}

            {(localError || error) && <p className="evx-passenger-error" role="alert">{localError || error}</p>}
          </div>

          <footer className="evx-passenger-footer">
            <button type="button" className="evx-btn-secondary" onClick={handleClose} disabled={submitting}>Vazgeç</button>
            <button
              type="button"
              className="evx-btn-primary"
              onClick={() => onConfirm(draft)}
              disabled={submitting || draft.length === 0}
            >
              {submitting ? 'Ekleniyor…' : `${draft.length} yolcuyu seç`}
            </button>
          </footer>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

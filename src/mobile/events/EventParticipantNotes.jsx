import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import {
  getEventParticipantNotes, addEventParticipantNote, updateEventParticipantNote, deleteEventParticipantNote,
} from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { useCurrentUser } from '../../currentUser';

// Katılımcı profili not akışı. Bu ekrandan yazılan etkinliğe özel
// notlara ek olarak, aynı katılım kaydının arama notlarını ve genel Notlar'da
// bu öğrencinin etiketlendiği notları da tarih sırasıyla gösterir. Dış
// kaynaklar salt-okunurdur; yalnız etkinlik notu kendi yazarınca düzenlenir.

const NOTE_MAX_LEN = 1000;
const SOURCE_META = {
  participant_note: { label: 'Etkinlik notu', icon: Icon.Edit },
  contact_note: { label: 'Arama notu', icon: Icon.Phone },
  mention: { label: 'Genel notta etiketlendi', icon: Icon.Tag },
};

function noteSource(note) {
  return note.source || 'participant_note';
}

function initialsOf(name) {
  return (name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

function formatNoteTime(iso) {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }).format(date);
  const sameDay = new Date().toDateString() === date.toDateString();
  if (sameDay) return `Bugün ${time}`;
  const dateStr = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long' }).format(date);
  return `${dateStr} · ${time}`;
}

function ParticipantNoteCard({ note, isMine, onSaved, onDeleted }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(note.body);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const moreButtonRef = React.useRef(null);
  const moreMenuRef = React.useRef(null);

  React.useEffect(() => {
    if (!menuOpen) return undefined;

    function closeOnOutsidePointer(event) {
      const target = event.target;
      if (moreButtonRef.current?.contains(target) || moreMenuRef.current?.contains(target)) return;
      setMenuOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      moreButtonRef.current?.focus();
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  async function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await updateEventParticipantNote(note.id, trimmed);
      setEditing(false);
      onSaved(updated);
    } catch (err) {
      setError(err?.message || 'Not güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Bu not silinecek. Emin misiniz?')) return;
    setBusy(true);
    try {
      await deleteEventParticipantNote(note.id);
      onDeleted(note.id);
    } catch (err) {
      window.alert(err?.message || 'Not silinemedi.');
      setBusy(false);
    }
  }

  const source = noteSource(note);
  const sourceMeta = SOURCE_META[source] || SOURCE_META.participant_note;
  const SourceIcon = sourceMeta.icon;
  const edited = source === 'participant_note' && note.updated_at !== note.created_at;

  return (
    <li className={`evx-note-card evx-participant-note-card is-${source}`}>
      <div className="evx-note-card-head">
        <span className="evx-avatar" style={{ width: 32, height: 32, fontSize: 11.5, flexShrink: 0 }}>
          {initialsOf(note.author_name)}
        </span>
        <span className="evx-note-author-col">
          <span className="evx-note-author">
            <span className="evx-note-author-name">{note.author_name}</span>
          </span>
          <span className="evx-note-time">{formatNoteTime(note.created_at)}{edited ? ' · düzenlendi' : ''}</span>
        </span>
        {isMine && !editing && (
          <span className="evx-note-menu-wrap">
            <button
              ref={moreButtonRef}
              type="button"
              className={`evx-note-more-btn${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen((value) => !value)}
              aria-label="Not işlemleri"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Icon.More width="18" height="18" />
            </button>
            {menuOpen && (
              <div ref={moreMenuRef} className="evx-note-more-menu" role="menu" aria-label="Not işlemleri">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setDraft(note.body); setEditing(true); }}
                >
                  <Icon.Edit width="15" height="15" /> Düzenle
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => { setMenuOpen(false); handleDelete(); }}
                  disabled={busy}
                >
                  <Icon.Trash width="15" height="15" /> Sil
                </button>
              </div>
            )}
          </span>
        )}
      </div>

      {editing ? (
        <>
          <div className="evx-field">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={NOTE_MAX_LEN}
              disabled={busy}
              autoFocus
            />
          </div>
          <div className="evx-note-composer-row">
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="evx-btn-secondary"
              style={{ minHeight: 36, padding: '0 14px', fontSize: 13 }}
              onClick={() => { setEditing(false); setError(''); }}
              disabled={busy}
            >
              Vazgeç
            </button>
            <button type="button" className="evx-btn-primary evx-note-add-btn" onClick={saveEdit} disabled={busy || !draft.trim()}>
              {busy ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
          {error && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{error}</div>}
        </>
      ) : (
        <>
          <div className="evx-participant-note-meta">
            <span className="evx-participant-note-source">
              <SourceIcon width="12" height="12" aria-hidden="true" />
              {sourceMeta.label}
            </span>
            {note.has_image && <span className="evx-participant-note-attachment">Fotoğraf ekli</span>}
          </div>
          {(note.categories || []).length > 0 && (
            <div className="evx-note-category-badges">
              {note.categories.map((category) => (
                <span key={category.id} className="evx-note-category-badge">{category.name}</span>
              ))}
            </div>
          )}
          <p className="evx-note-body">{note.body}</p>
        </>
      )}
    </li>
  );
}

export function ParticipantNotesSection({ participantId }) {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const [draft, setDraft] = React.useState('');
  const [posting, setPosting] = React.useState(false);
  const [error, setError] = React.useState('');

  const notesQuery = useQuery({
    queryKey: queryKeys.eventParticipantNotes(participantId),
    queryFn: () => getEventParticipantNotes(participantId),
  });
  const notes = notesQuery.data ?? [];

  function patchNote(updated) {
    queryClient.setQueryData(queryKeys.eventParticipantNotes(participantId), (old) => (
      Array.isArray(old) ? old.map((n) => (
        noteSource(n) === 'participant_note' && String(n.id) === String(updated.id) ? updated : n
      )) : old
    ));
  }

  function removeNote(noteId) {
    queryClient.setQueryData(queryKeys.eventParticipantNotes(participantId), (old) => (
      Array.isArray(old) ? old.filter((n) => (
        noteSource(n) !== 'participant_note' || String(n.id) !== String(noteId)
      )) : old
    ));
  }

  async function handleSubmit() {
    const trimmed = draft.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError('');
    try {
      await addEventParticipantNote(participantId, trimmed);
      setDraft('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.eventParticipantNotes(participantId) });
    } catch (err) {
      setError(err?.message || 'Not eklenemedi.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="evx-section evx-participant-notes">
      <div className="evx-participant-notes-intro">
        <strong>Kişiyle ilgili tüm notlar</strong>
        <span>Etkinlik notları, arama notları ve genel notlardaki etiketlemeler birlikte görünür.</span>
      </div>

      {notesQuery.isLoading && <p className="evx-hint">Notlar yükleniyor…</p>}
      {notesQuery.isError && <p className="evx-hint">Notlar alınamadı.</p>}

      {!notesQuery.isLoading && notes.length > 0 && (
        <ul className="evx-note-list">
          {notes.map((note) => (
            <ParticipantNoteCard
              key={`${noteSource(note)}:${note.id}`}
              note={note}
              isMine={noteSource(note) === 'participant_note' && !!currentUser && String(currentUser.id) === String(note.author_user_id)}
              onSaved={patchNote}
              onDeleted={removeNote}
            />
          ))}
        </ul>
      )}

      {!notesQuery.isLoading && notes.length === 0 && (
        <div className="evx-participant-notes-empty">
          <strong>Bu kişi için henüz not yok</strong>
          <span>Buraya eklediğiniz ilk not bu etkinliğe özel kaydedilir.</span>
        </div>
      )}

      <label className="evx-participant-note-composer-label" htmlFor={`participant-note-${participantId}`}>
        Bu etkinlik için yeni not
      </label>
      <div className="evx-field">
        <textarea
          id={`participant-note-${participantId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Bu kişinin bu etkinlikteki durumu hakkında not yazın…"
          rows={2}
          maxLength={NOTE_MAX_LEN}
          disabled={posting}
        />
      </div>
      <div className="evx-note-composer-row">
        <span style={{ flex: 1 }} />
        <button type="button" className="evx-btn-primary evx-note-add-btn" onClick={handleSubmit} disabled={posting || !draft.trim()}>
          {posting ? 'Gönderiliyor…' : 'Gönder'}
        </button>
      </div>
      {error && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{error}</div>}
    </div>
  );
}

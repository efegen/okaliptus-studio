import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Drawer } from 'vaul';
import { Icon } from '../layout';
import {
  getNotes,
  getNoteCategories,
  createNoteCategory,
  updateNoteCategory,
  deleteNoteCategory,
  getStudents,
  getNoteReminderRecipients,
  addNote,
  updateNote,
  deleteNote,
  toggleNoteReaction,
  uploadNoteImage,
  getNoteImage,
} from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { useCurrentUser } from '../currentUser';
import { compressToBoundedWebp } from '../imageCompress';

// Notlar — stüdyo geneli TEK bir paylaşılan not akışı. Önce etkinlik detayının
// bir alt ekranı olarak doğdu (etkinlik başına ayrı liste), kullanıcı isteğiyle
// genelleştirildi (bkz. 0273_general_notes.sql): ana sayfadaki "Notlar" butonu
// da etkinlik detayındaki "Notlar" kısayolu da aynı listeyi açar. Düzenleme,
// silme, daraltılabilir tek seviye yanıt, emoji tepkisi, fotoğraf ve "@" ile
// öğrenci bahsi destekler. Okuma görünümünde bahis "@" olmadan profil bağlantısı
// olur. Herkes görebilir; düzenleme/silme yalnız notun kendi yazarına açık
// (bkz. notes.service.ts lockOwnedNote).
//
// Bilinçli tasarım kararı: ekrana girince direkt bir yazı kutusu ÇIKMAZ —
// önce not listesi görünür, sağ altta yüzen "Not yaz" butonu ayrı bir "Yeni not"
// görünümüne yönlendirir (bkz. MobileEventAddPerson'daki adım tabanlı
// gezinme örüntüsü). Yanıt yazma ise bağlamdan kopmasın diye ayrı bir ekrana
// gitmez — yanıtlanan notun hemen altında satır içi açılır.

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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function noteMatchesQuery(note, normalizedQuery) {
  if ((note.body || '').toLowerCase().includes(normalizedQuery)) return true;
  if ((note.author_name || '').toLowerCase().includes(normalizedQuery)) return true;
  if ((note.category?.name || '').toLowerCase().includes(normalizedQuery)) return true;
  return (note.mentions || []).some((m) => m.name.toLowerCase().includes(normalizedQuery));
}

// mentions [{studentId, name}] içindeki "@Ad Soyad" dizilerini gövde metninde
// bulup vurgular. En uzun ada göre sıralanır ki bir ad başka bir adın alt
// dizisi olduğunda (ör. "Ali" / "Ali Veli") yanlış eşleşme olmasın.
function renderBodyWithMentions(body, mentions, onOpenStudent) {
  if (!mentions || mentions.length === 0) return body;
  const tokens = [...new Set(mentions.map((m) => `@${m.name}`))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'g');
  return body.split(pattern).map((part, i) => (
    tokens.includes(part)
      ? (
          <button
            key={i}
            type="button"
            className="evx-note-mention"
            onClick={() => {
              const mention = mentions.find((m) => `@${m.name}` === part);
              if (mention) onOpenStudent?.(mention.studentId);
            }}
          >
            {part.slice(1)}
          </button>
        )
      : <React.Fragment key={i}>{part}</React.Fragment>
  ));
}

const NOTE_SMART_FILTERS = [
  { id: 'all', label: 'Tümü' },
  { id: 'photo', label: 'Fotoğraflı' },
  { id: 'repliedToMe', label: 'Bana yanıt' },
];

const MENTION_QUERY_RE = /(^|\s)@([^\s@]{0,40})$/;
const NOTE_BODY_MAX_LEN = 1000;
const NOTE_REACTIONS = [
  { emoji: '👍', label: 'Beğen' },
  { emoji: '❤️', label: 'Sevgi' },
  { emoji: '🙌', label: 'Kutla' },
  { emoji: '😂', label: 'Gül' },
  { emoji: '😮', label: 'Şaşır' },
  { emoji: '😢', label: 'Üzgün' },
];

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toTimeInputValue(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Hızlı zaman preset'leri her zaman öğlen 12:00'a sabitlenir — kullanıcı bir
// hatırlatma için "ne zaman" derken tam saat önemli değildir, gün önemlidir;
// öğlen mesai saatleri içinde, uykuyu bölmeyecek nötr bir andır.
function reminderPreset(kind, now = new Date()) {
  const result = new Date(now);
  result.setHours(12, 0, 0, 0);
  if (kind === 'week') {
    result.setDate(result.getDate() + 7);
  } else if (kind === 'month') {
    result.setMonth(result.getMonth() + 1);
  } else {
    result.setDate(result.getDate() + 1);
  }
  return { date: toDateInputValue(result), time: toTimeInputValue(result) };
}

function formatReminderDate(dateValue, timeValue) {
  if (!dateValue || !timeValue) return '';
  const target = new Date(`${dateValue}T${timeValue}:00`);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetKey = toDateInputValue(target);
  const label = targetKey === toDateInputValue(today)
    ? 'Bugün'
    : targetKey === toDateInputValue(tomorrow)
      ? 'Yarın'
      : new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' }).format(target);
  return `${label} · ${timeValue}`;
}

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function NoteReminderSheet({ open, onOpenChange, users, value, onSave, onRemove }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  const defaultRecipientIds = React.useMemo(() => {
    const me = users.find((user) => user.isMe);
    return me ? [String(me.userId)] : [];
  }, [users]);
  const [dateValue, setDateValue] = React.useState('');
  const [timeValue, setTimeValue] = React.useState('');
  const [recipientIds, setRecipientIds] = React.useState([]);

  React.useEffect(() => {
    if (!open) return;
    const initialTime = value ?? reminderPreset('tomorrow');
    setDateValue(initialTime.date);
    setTimeValue(initialTime.time);
    setRecipientIds(value?.recipientIds?.map(String) ?? defaultRecipientIds);
  }, [open, value, defaultRecipientIds]);

  const selectedTimestamp = dateValue && timeValue ? new Date(`${dateValue}T${timeValue}:00`).getTime() : NaN;
  const isPast = Number.isFinite(selectedTimestamp) && selectedTimestamp <= Date.now();
  const canSave = !!dateValue && !!timeValue && recipientIds.length > 0 && !isPast;

  function selectPreset(kind) {
    const preset = reminderPreset(kind);
    setDateValue(preset.date);
    setTimeValue(preset.time);
  }

  function toggleRecipient(userId) {
    const id = String(userId);
    setRecipientIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  }

  function handleSave() {
    if (!canSave) return;
    onSave({ date: dateValue, time: timeValue, recipientIds });
    onOpenChange(false);
  }

  const presets = [
    { id: 'tomorrow', label: 'Yarın' },
    { id: 'week', label: '1 hafta sonra' },
    { id: 'month', label: '1 ay sonra' },
  ];

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false} repositionInputs={false}>
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="evx-note-reminder-overlay" />
        <Drawer.Content className="evx-note-reminder-sheet">
          <Drawer.Handle className="evx-note-reminder-handle" />
          <header className="evx-note-reminder-head">
            <Drawer.Title className="evx-note-reminder-title">Hatırlatıcı ekle</Drawer.Title>
            <Drawer.Description className="evx-note-reminder-sub">Bu not için seçtiğiniz kişilere bildirim gönderilir.</Drawer.Description>
          </header>

          <div className="evx-note-reminder-body">
            <section className="evx-note-reminder-section" aria-labelledby="note-reminder-when">
              <span id="note-reminder-when" className="evx-note-reminder-label">Ne zaman?</span>
              <div className="evx-note-reminder-presets">
                {presets.map((preset) => {
                  const presetValue = reminderPreset(preset.id);
                  const selected = presetValue.date === dateValue && presetValue.time === timeValue;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`evx-note-reminder-preset${selected ? ' is-on' : ''}`}
                      onClick={() => selectPreset(preset.id)}
                      aria-pressed={selected}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="evx-note-reminder-datetime">
                <label>
                  <span>Tarih</span>
                  <input type="date" value={dateValue} min={toDateInputValue(new Date())} onChange={(event) => setDateValue(event.target.value)} />
                </label>
                <label>
                  <span>Saat</span>
                  <input type="time" value={timeValue} onChange={(event) => setTimeValue(event.target.value)} />
                </label>
              </div>
              {isPast && <span className="evx-note-reminder-error" role="alert">Gelecekte bir saat seçin.</span>}
            </section>

            <section className="evx-note-reminder-section" aria-labelledby="note-reminder-who">
              <span id="note-reminder-who" className="evx-note-reminder-label">Kime?</span>
              <div className="evx-note-reminder-people" role="group" aria-label="Hatırlatılacak kişiler">
                {users.map((user) => {
                  const selected = recipientIds.includes(String(user.userId));
                  return (
                    <button
                      key={user.userId}
                      type="button"
                      className={`evx-note-reminder-person${selected ? ' is-on' : ''}`}
                      onClick={() => toggleRecipient(user.userId)}
                      aria-pressed={selected}
                    >
                      <span className="evx-avatar">{initialsOf(user.label)}</span>
                      <span className="evx-note-reminder-person-name">{user.label}</span>
                      {user.isMe && <span className="evx-note-reminder-me">Sen</span>}
                      <span className="evx-note-reminder-check" aria-hidden="true">
                        {selected && <Icon.Check width="13" height="13" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {recipientIds.length === 0 && <span className="evx-note-reminder-error">En az bir kişi seçin.</span>}
            </section>
          </div>

          <footer className="evx-note-reminder-actions">
            <button
              type="button"
              className="evx-note-reminder-secondary"
              onClick={() => {
                if (value) onRemove();
                onOpenChange(false);
              }}
            >
              {value ? 'Hatırlatıcıyı kaldır' : 'Vazgeç'}
            </button>
            <button type="button" className="evx-note-reminder-primary" disabled={!canSave} onClick={handleSave}>
              {value ? 'Güncelle' : 'Ekle'}
            </button>
          </footer>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// DOM düğümlerini gövde metnine çevirir: bahis chip'leri "@Ad Soyad" olarak
// (bkz. renderBodyWithMentions'daki eşleşme biçimi), <br> satır sonu olarak
// geri yazılır. Composer'da chip görünürken "@" saklıdır ama gönderilen
// body'de backend/okuma tarafının beklediği gibi hâlâ mevcuttur.
function serializeComposerNodes(nodes) {
  let out = '';
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR') {
        out += '\n';
      } else if (node.dataset && node.dataset.name) {
        out += `@${node.dataset.name}`;
      } else {
        out += serializeComposerNodes(node.childNodes);
        if (node.tagName === 'DIV' || node.tagName === 'P') out += '\n';
      }
    }
  }
  return out;
}

function getTextBeforeCaret(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return '';
  const preRange = range.cloneRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.startContainer, range.startOffset);
  return serializeComposerNodes(preRange.cloneContents().childNodes);
}

function appendTextWithBreaks(root, text) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) root.appendChild(document.createElement('br'));
    if (line) root.appendChild(document.createTextNode(line));
  });
}

function makeMentionChip(studentId, name) {
  const chip = document.createElement('span');
  chip.className = 'evx-mention-chip';
  chip.setAttribute('contenteditable', 'false');
  chip.dataset.studentId = String(studentId);
  chip.dataset.name = name;
  chip.textContent = name;
  return chip;
}

// initialBody içindeki "@Ad Soyad" dizilerini initialMentions'a bakarak chip
// düğümlerine çevirir (düzenleme/yanıt akışında composer ilk açıldığında).
function buildInitialContent(root, body, mentions) {
  root.innerHTML = '';
  if (!body) return;
  const byName = new Map((mentions || []).map((m) => [m.name, m]));
  const tokens = [...new Set((mentions || []).map((m) => `@${m.name}`))].sort((a, b) => b.length - a.length);
  const parts = tokens.length ? body.split(new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'g')) : [body];
  for (const part of parts) {
    if (tokens.includes(part)) {
      const name = part.slice(1);
      const m = byName.get(name);
      root.appendChild(makeMentionChip(m ? m.studentId : '', name));
    } else {
      appendTextWithBreaks(root, part);
    }
  }
}

function NotePhoto({ note }) {
  const [src, setSrc] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const imageQuery = useQuery({
    queryKey: queryKeys.noteImage(note.id, note.image_updated_at),
    queryFn: () => getNoteImage(note.id, note.image_updated_at),
    enabled: !!note.has_image,
    staleTime: Infinity,
  });

  React.useEffect(() => {
    if (!imageQuery.data) {
      setSrc('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(imageQuery.data);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageQuery.data]);

  if (!note.has_image) return null;
  if (imageQuery.isLoading || (imageQuery.data && !src)) {
    return <div className="evx-note-photo-loading">Fotoğraf yükleniyor…</div>;
  }
  if (imageQuery.isError || !src) return <div className="evx-note-photo-loading is-error">Fotoğraf açılamadı.</div>;

  return (
    <>
      <button type="button" className="evx-note-photo" onClick={() => setOpen(true)} aria-label="Fotoğrafı büyüt">
        <img src={src} alt="Nota eklenen fotoğraf" />
      </button>
      {open && (
        <div className="evx-note-photo-lightbox" role="dialog" aria-modal="true" aria-label="Not fotoğrafı" onClick={() => setOpen(false)}>
          <button type="button" className="evx-note-photo-close" onClick={() => setOpen(false)} aria-label="Kapat">×</button>
          <img src={src} alt="Nota eklenen fotoğraf" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}

// Bileşik metin alanı: "@" yazılınca öğrenciler arasında otomatik tamamlama
// gösterir (bkz. yukarıdaki header notu). Seçilen bahis, düz "@Ad
// Soyad" metni yerine düzenlenemeyen (contenteditable=false) bir chip olarak
// eklenir — hem görünürde vurgulanır hem de "@" karakteri saklanır; gövde
// string'ine dönüştürülürken (serializeComposerNodes) chip yine "@Ad Soyad"
// olarak yazılır ki okuma tarafı (renderBodyWithMentions) ve backend
// değişmeden çalışsın. Yeni not, yanıt ve düzenleme aynı bileşeni kullanır —
// yalnız initialBody/initialMentions ve submit etiketiyle farklılaşır.
function MentionComposer({
  students,
  initialBody = '',
  initialMentions = [],
  placeholder,
  rows = 3,
  autoFocus = false,
  submitLabel = 'Paylaş',
  submitting = false,
  error = '',
  hint = '',
  allowPhoto = false,
  allowReminder = false,
  reminderUsers = [],
  onSubmit,
  onCancel,
}) {
  const editorRef = React.useRef(null);
  const photoInputRef = React.useRef(null);
  const [hasContent, setHasContent] = React.useState(() => !!initialBody.trim());
  const [suggestQuery, setSuggestQuery] = React.useState(null);
  const [photoBlob, setPhotoBlob] = React.useState(null);
  const [photoPreview, setPhotoPreview] = React.useState('');
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [photoError, setPhotoError] = React.useState('');
  const [reminderOpen, setReminderOpen] = React.useState(false);
  const [reminder, setReminder] = React.useState(null);

  React.useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    buildInitialContent(root, initialBody, initialMentions);
    if (autoFocus) root.focus();
    // Yalnız mount'ta çalışır — initialBody/initialMentions sonradan değişmez
    // (composer, editing/replying açılıp kapandığında yeniden mount olur).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  function updateDerivedState() {
    const root = editorRef.current;
    if (!root) return;
    let text = serializeComposerNodes(root.childNodes);
    if (text.length > NOTE_BODY_MAX_LEN) {
      document.execCommand('undo');
      const after = serializeComposerNodes(root.childNodes);
      // Programatik eklemeler (ör. bahis chip'i) native undo geçmişine
      // girmeyebilir — o durumda sonsuz döngüye girmemek için sınırı aşan
      // hâliyle kabul edilir.
      if (after.length < text.length) return updateDerivedState();
      text = after;
    }
    setHasContent(!!text.trim());
    const beforeCaret = getTextBeforeCaret(root);
    const match = beforeCaret.match(MENTION_QUERY_RE);
    setSuggestQuery(match ? match[2] : null);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape' && suggestQuery !== null) {
      e.preventDefault();
      setSuggestQuery(null);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      updateDerivedState();
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  }

  async function handlePickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const blob = await compressToBoundedWebp(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
      const preview = URL.createObjectURL(blob);
      setPhotoPreview(preview);
      setPhotoBlob(blob);
    } catch (err) {
      setPhotoError(err?.message || 'Fotoğraf işlenemedi.');
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleRemovePhoto() {
    setPhotoPreview('');
    setPhotoBlob(null);
    setPhotoError('');
  }

  function handlePickMention(student) {
    if (suggestQuery === null) return;
    const root = editorRef.current;
    const sel = window.getSelection();
    if (!root || !sel) return;
    root.focus();
    if (!sel.rangeCount || !root.contains(sel.anchorNode)) {
      const endRange = document.createRange();
      endRange.selectNodeContents(root);
      endRange.collapse(false);
      sel.removeAllRanges();
      sel.addRange(endRange);
    } else {
      const charsToDelete = suggestQuery.length + 1;
      for (let i = 0; i < charsToDelete; i += 1) sel.modify('extend', 'backward', 'character');
      document.execCommand('delete');
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const chip = makeMentionChip(student.studentId, student.label);
    const space = document.createTextNode(' ');
    const frag = document.createDocumentFragment();
    frag.appendChild(chip);
    frag.appendChild(space);
    range.insertNode(frag);
    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    setSuggestQuery(null);
    updateDerivedState();
  }

  function handleSubmit() {
    const root = editorRef.current;
    if (!root) return;
    const trimmedBody = serializeComposerNodes(root.childNodes).trim();
    if (!trimmedBody || submitting) return;
    // Yalnız gövdede hâlâ geçen (silinmemiş) chip'lerin öğrenci id'leri
    // gönderilir — chip atomik bir birim olduğundan kısmi silme olmaz.
    const mentionedStudentIds = [...new Set(
      [...root.querySelectorAll('[data-student-id]')].map((el) => el.dataset.studentId).filter(Boolean)
    )];
    onSubmit(trimmedBody, mentionedStudentIds, photoBlob, reminder);
  }

  const suggestions = suggestQuery !== null
    ? students.filter((p) => p.label.toLowerCase().includes(suggestQuery.toLowerCase())).slice(0, 6)
    : [];

  return (
    <div className="evx-note-composer">
      <div
        ref={editorRef}
        className={`evx-note-input${hasContent ? '' : ' is-empty'}`}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        style={{ minHeight: `${rows * 20}px` }}
        onInput={updateDerivedState}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
      {suggestions.length > 0 && (
        <ul className="evx-mention-list">
          {suggestions.map((p) => (
            <li key={p.studentId}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => handlePickMention(p)}>
                <span className="evx-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{initialsOf(p.label)}</span>
                <span>{p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(allowPhoto || allowReminder) && (
        <div className="evx-note-composer-tools">
          {allowPhoto && (
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePickPhoto}
            style={{ display: 'none' }}
          />
          )}
          {allowPhoto && !photoPreview && (
            <button
              type="button"
              className="evx-note-composer-tool"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoBusy || submitting}
            >
              <Icon.Camera width="16" height="16" />
              {photoBusy ? 'Fotoğraf işleniyor…' : 'Fotoğraf ekle'}
            </button>
          )}
          {allowReminder && !reminder && (
            <button type="button" className="evx-note-composer-tool" onClick={() => setReminderOpen(true)} disabled={submitting}>
              <Icon.Bell width="16" height="16" />
              Hatırlatıcı ekle
            </button>
          )}
        </div>
      )}
      {photoPreview && (
        <div className="evx-note-photo-preview">
          <img src={photoPreview} alt="Eklenecek fotoğraf" />
          <button type="button" onClick={handleRemovePhoto} disabled={submitting}>Kaldır</button>
        </div>
      )}
      {photoError && <span className="evx-note-photo-error" role="alert">{photoError}</span>}
      {allowReminder && reminder && (
        <div className="evx-note-reminder-summary">
          <button type="button" className="evx-note-reminder-summary-main" onClick={() => setReminderOpen(true)} disabled={submitting}>
            <span className="evx-note-reminder-summary-icon"><Icon.Bell width="17" height="17" /></span>
            <span className="evx-note-reminder-summary-copy">
              <strong>{formatReminderDate(reminder.date, reminder.time)}</strong>
              <span>
                {reminder.recipientIds.length === 1
                  ? reminderUsers.find((user) => String(user.userId) === reminder.recipientIds[0])?.isMe
                    ? 'Sana hatırlatılacak'
                    : `${reminderUsers.find((user) => String(user.userId) === reminder.recipientIds[0])?.label ?? '1 kişi'} kişisine`
                  : `${reminder.recipientIds.length} kişiye hatırlatılacak`}
              </span>
            </span>
            <Icon.ChevronR width="16" height="16" />
          </button>
          <button type="button" className="evx-note-reminder-summary-remove" onClick={() => setReminder(null)} aria-label="Hatırlatıcıyı kaldır" disabled={submitting}>×</button>
        </div>
      )}
      {allowReminder && (
        <NoteReminderSheet
          open={reminderOpen}
          onOpenChange={setReminderOpen}
          users={reminderUsers}
          value={reminder}
          onSave={setReminder}
          onRemove={() => setReminder(null)}
        />
      )}
      <div className="evx-note-composer-row">
        {hint && <span className="evx-note-composer-hint">{hint}</span>}
        {!hint && <span style={{ flex: 1 }} />}
        {onCancel && (
          <button type="button" className="evx-btn-secondary" style={{ minHeight: 38, padding: '0 14px', fontSize: 13 }} onClick={onCancel} disabled={submitting}>
            Vazgeç
          </button>
        )}
        <button
          type="button"
          className="evx-btn-primary evx-note-add-btn"
          onClick={handleSubmit}
          disabled={!hasContent || submitting}
        >
          {submitting ? 'Gönderiliyor…' : submitLabel}
        </button>
      </div>
      {error && <div className="evx-hint" style={{ color: 'oklch(0.5 0.18 30)' }} role="alert">{error}</div>}
    </div>
  );
}

// Kategori isteğe bağlı ve tek seçimlidir. Seçili chip'e yeniden
// dokunmak bağı temizler; ayrı bir "Kategorisiz" seçeneği gerekmez.
function NoteCategoryPicker({ categories, value, onChange, disabled = false }) {
  if (categories.length === 0) return null;

  function toggle(categoryId) {
    const id = String(categoryId);
    onChange(value === id ? null : id);
  }

  return (
    <div className="evx-note-category-picker" role="group" aria-label="Not kategorileri">
      <span className="evx-note-category-picker-label">Kategori</span>
      <div className="evx-note-category-options">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`evx-filter-chip${value === String(category.id) ? ' is-on' : ''}`}
            onClick={() => toggle(category.id)}
            aria-pressed={value === String(category.id)}
            disabled={disabled}
          >
            {category.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function NoteCategorySettings({ categories, loading, loadError, onBack }) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = React.useState('');
  const [editingId, setEditingId] = React.useState(null);
  const [editingName, setEditingName] = React.useState('');
  const [busyId, setBusyId] = React.useState(null);
  const [error, setError] = React.useState('');

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.noteCategories() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notes() }),
    ]);
  }

  async function handleCreate(event) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusyId('new');
    setError('');
    try {
      await createNoteCategory(name);
      setNewName('');
      await refresh();
    } catch (err) {
      setError(err?.message || 'Kategori eklenemedi.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(category) {
    const name = editingName.trim();
    if (!name || name === category.name) {
      setEditingId(null);
      return;
    }
    setBusyId(String(category.id));
    setError('');
    try {
      await updateNoteCategory(category.id, name);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err?.message || 'Kategori güncellenemedi.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(category) {
    const confirmed = window.confirm(`“${category.name}” kategorisi silinsin mi? Notlar silinmez, yalnız kategori bağı temizlenir.`);
    if (!confirmed) return;
    setBusyId(String(category.id));
    setError('');
    try {
      await deleteNoteCategory(category.id);
      if (String(editingId) === String(category.id)) setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err?.message || 'Kategori silinemedi.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={onBack} title="Geri">
          <Icon.ChevronL width="22" height="22" />
        </button>
        <div className="evx-header-mid">
          <span className="evx-header-title">Not kategorileri</span>
          <span className="evx-header-sub">{categories.length} kategori</span>
        </div>
      </header>

      <div className="evx-body evx-note-category-settings">
        <form className="evx-note-category-add" onSubmit={handleCreate}>
          <label htmlFor="new-note-category">Yeni kategori</label>
          <div>
            <input
              id="new-note-category"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={40}
              placeholder="Örn. Operasyon"
              disabled={busyId !== null}
            />
            <button type="submit" disabled={!newName.trim() || busyId !== null}>
              <Icon.Plus width="17" height="17" /> Ekle
            </button>
          </div>
        </form>

        {error && <p className="evx-note-category-error" role="alert">{error}</p>}
        {loadError && <p className="evx-note-category-error" role="alert">Not kategorileri alınamadı.</p>}
        {loading && <p className="evx-hint">Kategoriler yükleniyor…</p>}
        {!loading && categories.length === 0 && (
          <div className="evx-empty evx-note-category-empty">
            <Icon.Edit width="26" height="26" />
            <span className="evx-empty-title">Henüz kategori yok</span>
            <span className="evx-empty-sub">Notları gruplamak için ilk kategoriyi ekleyin.</span>
          </div>
        )}

        {categories.length > 0 && (
          <ul className="evx-note-category-list">
            {categories.map((category) => {
              const isEditing = String(editingId) === String(category.id);
              const busy = String(busyId) === String(category.id);
              return (
                <li key={category.id}>
                  {isEditing ? (
                    <form onSubmit={(event) => { event.preventDefault(); handleRename(category); }}>
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        maxLength={40}
                        aria-label={`${category.name} kategori adı`}
                        disabled={busy}
                      />
                      <button type="submit" className="is-save" disabled={!editingName.trim() || busy}>Kaydet</button>
                      <button type="button" onClick={() => setEditingId(null)} disabled={busy}>Vazgeç</button>
                    </form>
                  ) : (
                    <>
                      <span className="evx-note-category-row-copy">
                        <strong>{category.name}</strong>
                        <small>{Number(category.note_count || 0)} not</small>
                      </span>
                      <button
                        type="button"
                        className="evx-note-category-icon-btn"
                        aria-label={`${category.name} kategorisini düzenle`}
                        onClick={() => { setEditingId(String(category.id)); setEditingName(category.name); setError(''); }}
                        disabled={busyId !== null}
                      >
                        <Icon.Edit width="17" height="17" />
                      </button>
                      <button
                        type="button"
                        className="evx-note-category-icon-btn is-danger"
                        aria-label={`${category.name} kategorisini sil`}
                        onClick={() => handleDelete(category)}
                        disabled={busyId !== null}
                      >
                        <Icon.Trash width="17" height="17" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function NoteCard({ note, isMine, students, categories, isReply = false, replies = [], currentUser, onOpenStudent }) {
  const queryClient = useQueryClient();
  const reactionButtonRef = React.useRef(null);
  const reactionPickerRef = React.useRef(null);
  const moreButtonRef = React.useRef(null);
  const moreMenuRef = React.useRef(null);
  const [editing, setEditing] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  const [reactionOpen, setReactionOpen] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [editCategoryId, setEditCategoryId] = React.useState(note.category ? String(note.category.id) : null);
  const [reactionBusy, setReactionBusy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState('');

  React.useEffect(() => {
    if (!reactionOpen) return undefined;

    function closeOnOutsidePointer(event) {
      const target = event.target;
      if (reactionButtonRef.current?.contains(target) || reactionPickerRef.current?.contains(target)) return;
      setReactionOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key !== 'Escape') return;
      setReactionOpen(false);
      reactionButtonRef.current?.focus();
    }

    // pointerdown, dokunmatik ekranda click'i beklemeden seçiciyi kapatır;
    // düğme ve popover kendi bölgeleri olduğu için iç etkileşimleri korunur.
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [reactionOpen]);

  React.useEffect(() => {
    if (!moreOpen) return undefined;

    function closeOnOutsidePointer(event) {
      const target = event.target;
      if (moreButtonRef.current?.contains(target) || moreMenuRef.current?.contains(target)) return;
      setMoreOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.notes() });
  }

  async function handleSaveEdit(body, mentionedStudentIds) {
    setBusy(true);
    setActionError('');
    try {
      await updateNote(note.id, { body, mentionedStudentIds, categoryId: editCategoryId });
      await refresh();
      setEditing(false);
    } catch (err) {
      setActionError(err?.message || 'Not güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReplySubmit(body, mentionedStudentIds, photoBlob) {
    setBusy(true);
    setActionError('');
    try {
      const created = await addNote({ body, parentNoteId: note.id, mentionedStudentIds });
      if (photoBlob) {
        try {
          await uploadNoteImage(created.id, photoBlob);
        } catch (imageError) {
          let rolledBack = true;
          try {
            await deleteNote(created.id);
          } catch {
            rolledBack = false;
          }
          await refresh();
          if (!rolledBack) {
            throw new Error('Yanıt kaydedildi ancak fotoğraf yüklenemedi. Notlar listesinden kaydı kontrol edin.');
          }
          throw new Error(imageError?.message || 'Fotoğraf yüklenemedi; yanıt paylaşılmadı.');
        }
      }
      await refresh();
      setReplying(false);
    } catch (err) {
      setActionError(err?.message || 'Yanıt eklenemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    const sure = window.confirm('Bu not silinecek. Emin misiniz?');
    if (!sure) return;
    setBusy(true);
    try {
      await deleteNote(note.id);
      await refresh();
    } catch (err) {
      window.alert(err?.message || 'Not silinemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReaction(emoji) {
    if (reactionBusy) return;
    setReactionBusy(true);
    setActionError('');
    try {
      const updated = await toggleNoteReaction(note.id, emoji);
      queryClient.setQueryData(queryKeys.notes(), (old) => (
        Array.isArray(old) ? old.map((item) => (String(item.id) === String(updated.id) ? updated : item)) : old
      ));
      setReactionOpen(false);
    } catch (err) {
      setActionError(err?.message || 'Tepki güncellenemedi.');
    } finally {
      setReactionBusy(false);
    }
  }

  const edited = note.updated_at !== note.created_at;
  const reactions = note.reactions ?? [];
  const CardRoot = isReply ? 'article' : 'li';

  return (
    <CardRoot className={`evx-note-card${isReply ? ' is-reply' : ''}`}>
      <div className="evx-note-card-head">
        <span
          className="evx-avatar"
          style={isReply
            ? { width: 26, height: 26, fontSize: 9.5, flexShrink: 0 }
            : { width: 36, height: 36, fontSize: 12.5, flexShrink: 0 }}
        >
          {initialsOf(note.author_name)}
        </span>
        <span className="evx-note-author-col">
          <span className="evx-note-author">
            <span className="evx-note-author-name">{note.author_name}</span>
          </span>
          <span className="evx-note-time">{formatNoteTime(note.created_at)}{edited ? ' · düzenlendi' : ''}</span>
        </span>
        {isMine && (
          <span className="evx-note-menu-wrap">
            <button
              ref={moreButtonRef}
              type="button"
              className={`evx-note-more-btn${moreOpen ? ' is-open' : ''}`}
              onClick={() => {
                setReactionOpen(false);
                setMoreOpen((value) => !value);
              }}
              aria-label="Not işlemleri"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
            >
              <Icon.More width="18" height="18" />
            </button>
            {moreOpen && (
              <div ref={moreMenuRef} className="evx-note-more-menu" role="menu" aria-label="Not işlemleri">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    setEditCategoryId(note.category ? String(note.category.id) : null);
                    setEditing(true);
                  }}
                >
                  <Icon.Edit width="15" height="15" /> Düzenle
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setMoreOpen(false);
                    handleDelete();
                  }}
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
        <div className="evx-note-edit-wrap">
          {!isReply && (
            <NoteCategoryPicker
              categories={categories}
              value={editCategoryId}
              onChange={setEditCategoryId}
              disabled={busy}
            />
          )}
          <MentionComposer
            students={students}
            initialBody={note.body}
            initialMentions={note.mentions}
            rows={3}
            autoFocus
            submitLabel="Kaydet"
            submitting={busy}
            error={actionError}
            onCancel={() => { setEditing(false); setActionError(''); }}
            onSubmit={handleSaveEdit}
          />
        </div>
      ) : (
        <>
          {note.category && (
            <div className="evx-note-category-badges">
              <span className="evx-note-category-badge">{note.category.name}</span>
            </div>
          )}
          <p className="evx-note-body">{renderBodyWithMentions(note.body, note.mentions, onOpenStudent)}</p>
        </>
      )}

      <NotePhoto note={note} />

      {!editing && (
        <div className="evx-note-interactions">
          <div className="evx-note-actionbar-wrap">
            <div className="evx-note-actionbar">
              <div className="evx-note-reaction-strip" aria-label="Tepkiler">
              {reactions.map((reaction) => (
                <button
                  key={reaction.emoji}
                  type="button"
                  className={`evx-note-reaction${reaction.reactedByMe ? ' is-mine' : ''}`}
                  onClick={() => handleReaction(reaction.emoji)}
                  disabled={reactionBusy}
                  aria-label={`${reaction.emoji} tepkisi, ${reaction.count} kişi`}
                >
                  <span>{reaction.emoji}</span>
                  <span>{reaction.count}</span>
                </button>
              ))}
                <button
                  ref={reactionButtonRef}
                  type="button"
                  className={`evx-note-reaction-add${reactionOpen ? ' is-open' : ''}`}
                  onClick={() => {
                    setMoreOpen(false);
                    setReactionOpen((value) => !value);
                  }}
                  aria-label="Tepki ekle"
                  aria-expanded={reactionOpen}
                >
                  <Icon.SmilePlus width="17" height="17" />
                </button>
              </div>
              {!isReply && (
                <button
                  type="button"
                  className="evx-note-action-btn"
                  onClick={() => {
                    setReactionOpen(false);
                    setMoreOpen(false);
                    setReplying((value) => !value);
                  }}
                >
                  Yanıtla
                </button>
              )}
            </div>

            {reactionOpen && (
              <div ref={reactionPickerRef} className="evx-note-reaction-picker" aria-label="Emoji tepkisi seç">
                {NOTE_REACTIONS.map(({ emoji, label }) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleReaction(emoji)}
                    disabled={reactionBusy}
                    aria-label={label}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {actionError && !editing && !replying && <div className="evx-note-action-error" role="alert">{actionError}</div>}

      {replying && (
        <MentionComposer
          students={students}
          placeholder="Yanıt yazın…"
          rows={2}
          autoFocus
          submitLabel="Gönder"
          submitting={busy}
          error={actionError}
          allowPhoto
          onCancel={() => { setReplying(false); setActionError(''); }}
          onSubmit={handleReplySubmit}
        />
      )}

      {!isReply && (
        <ReplyThread
          replies={replies}
          currentUser={currentUser}
          students={students}
          categories={categories}
          onOpenStudent={onOpenStudent}
        />
      )}
    </CardRoot>
  );
}

function ReplyThread({ replies, currentUser, students, categories, onOpenStudent }) {
  const [expanded, setExpanded] = React.useState(false);
  if (replies.length === 0) return null;

  const isCollapsed = replies.length > 1 && !expanded;
  const visibleReplies = isCollapsed ? [replies[replies.length - 1]] : replies;

  return (
    <div className="evx-note-thread">
      {replies.length > 1 && (
        <div className="evx-note-reply-toggle-row">
          <button
            type="button"
            className="evx-note-reply-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            <Icon.ChevronDown width="14" height="14" />
            {expanded ? 'Yanıtları gizle' : `${replies.length} yanıt · Tümünü göster`}
          </button>
        </div>
      )}
      <div className="evx-note-reply-list">
        {visibleReplies.map((reply) => (
          <NoteCard
            key={reply.id}
            note={reply}
            students={students}
            categories={categories}
            isMine={!!currentUser && String(currentUser.id) === String(reply.author_user_id)}
            isReply
            onOpenStudent={onOpenStudent}
          />
        ))}
      </div>
    </div>
  );
}

export function MobileNotes({ onBack, onOpenStudent }) {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const [view, setView] = React.useState('list');
  const [posting, setPosting] = React.useState(false);
  const [composeError, setComposeError] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState('all');
  const [composeCategoryId, setComposeCategoryId] = React.useState(null);

  function toggleSearch() {
    setSearchOpen((open) => {
      if (open) setSearchQuery('');
      return !open;
    });
  }

  const notesQuery = useQuery({ queryKey: queryKeys.notes(), queryFn: getNotes });
  const categoriesQuery = useQuery({ queryKey: queryKeys.noteCategories(), queryFn: getNoteCategories });
  // "@" tamamlaması artık etkinlik katılımcılarıyla değil, tüm öğrenci
  // listesiyle beslenir — not akışı stüdyo geneli (bkz. üstteki header notu).
  const studentsQuery = useQuery({ queryKey: queryKeys.students(), queryFn: getStudents });
  const reminderRecipientsQuery = useQuery({
    queryKey: queryKeys.noteReminderRecipients(),
    queryFn: getNoteReminderRecipients,
  });

  const notes = notesQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  React.useEffect(() => {
    if (!categoryFilter.startsWith('category:') || categoriesQuery.isLoading) return;
    const selectedId = categoryFilter.slice('category:'.length);
    if (!categories.some((category) => String(category.id) === selectedId)) setCategoryFilter('all');
  }, [categories, categoriesQuery.isLoading, categoryFilter]);

  const students = React.useMemo(() => (
    (studentsQuery.data ?? [])
      .map((s) => ({ studentId: s.id, label: s.nickname || s.full_name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
  ), [studentsQuery.data]);

  // Hatırlatıcı "kime?" seçicisi /notes/reminder-recipients'ten gelir (tüm
  // aktif kullanıcılar — /users'ın aksine yalnız owner değil, bkz.
  // notes.service.ts listNoteReminderRecipients).
  const reminderUsers = React.useMemo(() => (
    (reminderRecipientsQuery.data ?? [])
      .map((u) => ({
        userId: String(u.id),
        label: u.displayName,
        isMe: !!currentUser?.id && String(currentUser.id) === String(u.id),
      }))
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.label.localeCompare(b.label, 'tr'))
  ), [reminderRecipientsQuery.data, currentUser]);

  const topLevelNotes = notes.filter((n) => !n.parent_note_id);
  const activeNoteCount = topLevelNotes.filter((n) => !n.deleted_at).length;
  const repliesByParent = React.useMemo(() => {
    const map = new Map();
    for (const n of notes) {
      // Silinen notlar (yanıt dahil) placeholder bırakmadan listeden tamamen
      // kaybolur — bkz. aşağıdaki render: silinen bir üst not, altında hâlâ
      // silinmemiş yanıt varsa yalnız o yanıtlarla (kartı olmadan) kalır.
      if (!n.parent_note_id || n.deleted_at) continue;
      if (!map.has(n.parent_note_id)) map.set(n.parent_note_id, []);
      map.get(n.parent_note_id).push(n);
    }
    // Notlar genel listede en yeniden en eskiye sıralı gelir (bkz.
    // listNotes); bir yanıt zinciri içinde okuma sırası doğal olarak
    // eskiden yeniye olduğu için burada ayrıca ters çevrilir.
    for (const list of map.values()) list.reverse();
    return map;
  }, [notes]);
  const visibleTopLevelNotes = topLevelNotes.filter((n) => !n.deleted_at || (repliesByParent.get(n.id) ?? []).length > 0);

  const categoryFilteredNotes = visibleTopLevelNotes.filter((n) => {
    if (categoryFilter.startsWith('category:')) {
      const id = categoryFilter.slice('category:'.length);
      return String(n.category?.id ?? '') === id;
    }
    if (categoryFilter === 'photo') return !n.deleted_at && n.has_image;
    if (categoryFilter === 'repliedToMe') {
      if (n.deleted_at) return false;
      const isMine = !!currentUser && String(currentUser.id) === String(n.author_user_id);
      return isMine && (repliesByParent.get(n.id) ?? []).length > 0;
    }
    return true;
  });

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchedTopLevelNotes = normalizedSearch
    ? categoryFilteredNotes.filter((n) => {
        if (!n.deleted_at && noteMatchesQuery(n, normalizedSearch)) return true;
        return (repliesByParent.get(n.id) ?? []).some((reply) => noteMatchesQuery(reply, normalizedSearch));
      })
    : categoryFilteredNotes;

  async function handleAddNote(body, mentionedStudentIds, photoBlob, reminder) {
    setPosting(true);
    setComposeError('');
    try {
      const created = await addNote({
        body,
        mentionedStudentIds,
        categoryId: composeCategoryId,
        reminder: reminder
          ? {
              remindAt: new Date(`${reminder.date}T${reminder.time}:00`).toISOString(),
              recipientUserIds: reminder.recipientIds,
            }
          : undefined,
      });
      if (photoBlob) {
        try {
          await uploadNoteImage(created.id, photoBlob);
        } catch (imageError) {
          // İki adımlı API'de yarım kayıt bırakma: fotoğraf başarısızsa yeni notu
          // geri alıp composer'ı açık tutarız; kullanıcı güvenle tekrar dener.
          let rolledBack = true;
          try {
            await deleteNote(created.id);
          } catch {
            rolledBack = false;
          }
          await queryClient.invalidateQueries({ queryKey: queryKeys.notes() });
          if (!rolledBack) {
            throw new Error('Not kaydedildi ancak fotoğraf yüklenemedi. Notlar listesine dönüp kaydı kontrol edin.');
          }
          throw new Error(imageError?.message || 'Fotoğraf yüklenemedi; not paylaşılmadı.');
        }
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.notes() });
      setComposeCategoryId(null);
      setView('list');
    } catch (err) {
      setComposeError(err?.message || 'Not eklenemedi.');
    } finally {
      setPosting(false);
    }
  }

  if (notesQuery.isError) {
    return (
      <div className="evx">
        <div className="evx-body">
          <p>Notlar alınamadı.</p>
          <button type="button" className="evx-btn-secondary" onClick={onBack}>Geri</button>
        </div>
      </div>
    );
  }

  if (view === 'compose') {
    return (
      <div className="evx">
        <header className="evx-header">
          <button type="button" className="evx-header-btn" onClick={() => setView('list')} title="Geri">
            <Icon.ChevronL width="22" height="22" />
          </button>
          <div className="evx-header-mid">
            <span className="evx-header-title">Yeni not</span>
            <span className="evx-header-sub">Tüm ekip görür</span>
          </div>
        </header>
        <div className="evx-body">
          <NoteCategoryPicker
            categories={categories}
            value={composeCategoryId}
            onChange={setComposeCategoryId}
            disabled={posting}
          />
          <MentionComposer
            students={students}
            placeholder="Bir not yazın… (ör. malzeme durumu, hatırlatma, değişiklik)"
            rows={7}
            autoFocus
            submitLabel="Paylaş"
            submitting={posting}
            error={composeError}
            hint="Tüm ekip görür. @ ile eklediğiniz öğrenci profiline bağlanır."
            allowPhoto
            allowReminder
            reminderUsers={reminderUsers}
            onSubmit={handleAddNote}
          />
        </div>
      </div>
    );
  }

  if (view === 'settings') {
    return (
      <NoteCategorySettings
        categories={categories}
        loading={categoriesQuery.isLoading}
        loadError={categoriesQuery.isError}
        onBack={() => setView('list')}
      />
    );
  }

  return (
    <div className="evx">
      <header className="evx-header">
        <button type="button" className="evx-header-btn" onClick={onBack} title="Geri">
          <Icon.ChevronL width="22" height="22" />
        </button>
        <div className="evx-header-mid">
          <span className="evx-header-title">Notlar</span>
          <span className="evx-header-sub">{activeNoteCount > 0 ? `${activeNoteCount} not` : 'Stüdyo geneli'}</span>
        </div>
        <button
          type="button"
          className="evx-header-btn"
          onClick={toggleSearch}
          title="Notlarda ara"
          aria-expanded={searchOpen}
        >
          <Icon.Search width="20" height="20" />
        </button>
        <button
          type="button"
          className="evx-header-btn"
          onClick={() => setView('settings')}
          title="Not kategorilerini düzenle"
          aria-label="Not kategorilerini düzenle"
        >
          <Icon.Settings width="20" height="20" />
        </button>
      </header>

      <div className="evx-body">
        <div className="evx-scroller">
          {NOTE_SMART_FILTERS.slice(0, 1).map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`evx-filter-chip${categoryFilter === filter.id ? ' is-on' : ''}`}
              onClick={() => setCategoryFilter(filter.id)}
              aria-pressed={categoryFilter === filter.id}
            >
              {filter.label}
            </button>
          ))}
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`evx-filter-chip${categoryFilter === `category:${category.id}` ? ' is-on' : ''}`}
              onClick={() => setCategoryFilter(`category:${category.id}`)}
              aria-pressed={categoryFilter === `category:${category.id}`}
            >
              {category.name}
            </button>
          ))}
          {NOTE_SMART_FILTERS.slice(1).map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`evx-filter-chip${categoryFilter === filter.id ? ' is-on' : ''}`}
              onClick={() => setCategoryFilter(filter.id)}
              aria-pressed={categoryFilter === filter.id}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {searchOpen && (
          <div className="evx-toggle-row" style={{ minHeight: 44 }}>
            <Icon.Search width="17" height="17" style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Not veya kişi ara…"
              style={{ border: 0, background: 'none', outline: 'none', flex: 1, fontSize: 14, color: 'var(--ink)' }}
            />
          </div>
        )}

        {notesQuery.isLoading && <p className="evx-hint">Notlar yükleniyor…</p>}

        {!notesQuery.isLoading && visibleTopLevelNotes.length === 0 && (
          <div className="evx-empty">
            <Icon.Edit width="28" height="28" />
            <span className="evx-empty-title">Henüz not yok</span>
            <span className="evx-empty-sub">Sağ alttaki "Not yaz" ile ilk notu paylaşın — tüm ekip görebilecek.</span>
          </div>
        )}

        {!notesQuery.isLoading && visibleTopLevelNotes.length > 0 && normalizedSearch && searchedTopLevelNotes.length === 0 && (
          <div className="evx-empty">
            <Icon.Search width="28" height="28" />
            <span className="evx-empty-title">Sonuç bulunamadı</span>
            <span className="evx-empty-sub">"{searchQuery.trim()}" ile eşleşen not yok.</span>
          </div>
        )}

        {!notesQuery.isLoading && !normalizedSearch && visibleTopLevelNotes.length > 0 && categoryFilteredNotes.length === 0 && (
          <div className="evx-empty">
            <Icon.Edit width="28" height="28" />
            <span className="evx-empty-title">Bu kategoride not yok</span>
            <span className="evx-empty-sub">
              {categoryFilter.startsWith('category:')
                ? `“${categories.find((item) => `category:${item.id}` === categoryFilter)?.name ?? 'Kategori'}” kategorisinde not yok.`
                : `“${NOTE_SMART_FILTERS.find((f) => f.id === categoryFilter)?.label}” ile eşleşen not yok.`}
            </span>
          </div>
        )}

        {searchedTopLevelNotes.length > 0 && (
          <ul className="evx-note-list">
            {searchedTopLevelNotes.map((n) => (
              n.deleted_at
                ? (
                    <li key={n.id} className="evx-note-card is-thread-only">
                      <ReplyThread
                        replies={repliesByParent.get(n.id) ?? []}
                        currentUser={currentUser}
                        students={students}
                        categories={categories}
                        onOpenStudent={onOpenStudent}
                      />
                    </li>
                  )
                : (
                    <NoteCard
                      key={n.id}
                      note={n}
                      students={students}
                      categories={categories}
                      isMine={!!currentUser && String(currentUser.id) === String(n.author_user_id)}
                      replies={repliesByParent.get(n.id) ?? []}
                      currentUser={currentUser}
                      onOpenStudent={onOpenStudent}
                    />
                  )
            ))}
          </ul>
        )}
      </div>

      <button type="button" className="evx-notes-fab" onClick={() => setView('compose')}>
        <Icon.Edit width="18" height="18" />
        Not yaz
      </button>
    </div>
  );
}

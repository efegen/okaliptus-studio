import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { getNoteImage } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';

// Ana sayfa not destesi (design_handoff_notlar_destesi · Canvas-9 #3a/#4a).
// Kullanıcının görmediği üst notlar üst üste kart olarak durur; kart sola
// kaydırılınca ya da "Gördüm"/"Aç"/"Yanıtla"ya basılınca görüldü sayılır ve
// desteden çıkar. Hangi notların destede olduğu, sırası ve YENİ/SANA bayrakları
// MobileHome'da hesaplanır (bkz. buildDeckNotes); bu bileşen yalnız sunum ve
// kart çıkış/öne gelme animasyonlarını yönetir.

const LEAVE_MS = 280;
const SWIPE_THRESHOLD = -90;
const MAX_RIGHT_DRAG = 40;

// Düşme/halka animasyonları bir not için oturumda bir kez oynar — ana sayfa
// yeniden açıldığında (bileşen yeniden bağlandığında) tekrar oynamasın diye
// modül düzeyinde tutulur.
const animatedIds = new Set();

// Kategoriler dinamik (note_categories) — sabit renk eşlemesi yok. Tasarımın
// üç tonundan biri kategori id'sine göre kalıcı olarak seçilir.
const CATEGORY_TONES = ['blue', 'violet', 'sage'];
const AVATAR_TONES = ['sage', 'blue', 'neutral', 'violet'];

function toneFor(id, tones) {
  const n = Number.parseInt(String(id ?? '0'), 10);
  return tones[(Number.isFinite(n) ? Math.abs(n) : 0) % tones.length];
}

function initialsOf(name) {
  return (name || '?').split(' ').filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR');
}

function istanbulDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(date);
}

export function formatDeckTime(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  if (now - date < 60 * 1000) return 'şimdi';
  if (istanbulDayKey(date) === istanbulDayKey(now)) {
    return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }).format(date);
  }
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (istanbulDayKey(date) === istanbulDayKey(yesterday)) return 'Dün';
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short' }).format(date);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Gövdedeki kullanıcı belirteçleri (`@{u:12}`) ve öğrenci "@Ad" dizileri
// vurgulanır; destede etiketler tıklanmaz (kartın kendisi sürüklenebilir).
function renderBody(note) {
  const body = note.body || '';
  const names = new Map((note.user_mentions || []).map((m) => [String(m.userId), m.name]));
  const studentTokens = [...new Set((note.mentions || []).map((m) => `@${m.name}`))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(@\\{u:\\d+\\}${studentTokens.map((t) => `|${escapeRegExp(t)}`).join('')})`, 'g');
  return body.split(pattern).map((part, i) => {
    const user = /^@\{u:(\d+)\}$/.exec(part);
    if (user) return <span key={i} className="nd-mention">@{names.get(user[1]) ?? 'Kullanıcı'}</span>;
    if (studentTokens.includes(part)) return <span key={i} className="nd-mention">{part}</span>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function metaLine(note) {
  const parts = [];
  if (note.isNew || note.isForMe) parts.push(formatDeckTime(note.created_at));
  const reactions = (note.reactions || []).filter((r) => r.count > 0).map((r) => `${r.emoji} ${r.count}`).join(' ');
  if (reactions) parts.push(reactions);
  if (note.replyCount > 0) parts.push(`${note.replyCount} yanıt`);
  if (note.has_image) parts.push('1 fotoğraf');
  return parts.filter(Boolean).join(' · ');
}

function badgeLabel(note) {
  if (note.isNew) return note.isForMe ? 'YENİ · SANA' : 'YENİ';
  return note.isForMe ? 'SANA' : null;
}

function DeckThumb({ note }) {
  const [src, setSrc] = React.useState('');
  // Tam görsel iner (ayrı küçük resim ucu yok); NotePhoto ile aynı anahtar
  // → Notlar ekranına geçince tekrar indirilmez.
  const imageQuery = useQuery({
    queryKey: queryKeys.noteImage(note.id, note.image_updated_at),
    queryFn: () => getNoteImage(note.id, note.image_updated_at),
    enabled: !!note.has_image,
    staleTime: Infinity,
  });
  React.useEffect(() => {
    if (!imageQuery.data) { setSrc(''); return undefined; }
    const url = URL.createObjectURL(imageQuery.data);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [imageQuery.data]);
  return (
    <div className="nd-thumb">
      {src ? <img src={src} alt="" /> : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 16l-5-5-8 8" />
        </svg>
      )}
    </div>
  );
}

// Kartın içeriği — hem üst (sürüklenebilir) kartta hem de çıkış sırasında öne
// gelen "sonraki" katmanda aynı işaretleme kullanılır.
function DeckCardBody({ note, ringAnim, badgeAnim, onSeen, onOpen }) {
  const badge = badgeLabel(note);
  const avatarTone = toneFor(note.author_user_id, AVATAR_TONES);
  const categoryTone = note.category ? toneFor(note.category.id, CATEGORY_TONES) : null;
  return (
    <div className={`nd-card${note.isNew ? ' is-new' : ''}`} style={{ animation: ringAnim }}>
      <div className="nd-author">
        <div className={`nd-avatar tone-${avatarTone}`}>{initialsOf(note.author_name)}</div>
        <span className="nd-name">{note.author_name}</span>
        {note.category && <span className={`nd-cat tone-${categoryTone}`}>{note.category.name}</span>}
        {badge ? (
          <span className={`nd-badge${note.isNew ? ' is-new' : ''}`} style={{ animation: badgeAnim }}>
            <span className="nd-badge-dot" />{badge}
          </span>
        ) : (
          <span className="nd-time">{formatDeckTime(note.created_at)}</span>
        )}
      </div>
      <div className="nd-content">
        <div className="nd-text">{renderBody(note)}</div>
        {note.has_image && <DeckThumb note={note} />}
      </div>
      <div className="nd-foot">
        <span className="nd-meta">{metaLine(note)}</span>
        <button type="button" className="nd-btn" onClick={onSeen}>Gördüm</button>
        <button type="button" className="nd-btn is-primary" onClick={onOpen}>{note.isForMe ? 'Yanıtla' : 'Aç'}</button>
      </div>
    </div>
  );
}

function reducedMotion() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { return false; }
}

/**
 * notes: destedeki notlar, gösterim sırasıyla (bkz. MobileHome buildDeckNotes).
 * onSeen(id): kart desteden çıktığında çağrılır (görüldü işaretleme parent'ta).
 * onOpenNote(id, { reply }): "Aç"/"Yanıtla".
 * emptyVariant: 'row' (asistan — "Hepsini gördün" satırı) | null (deste gizlenir).
 */
export function NoteDeck({ notes, lastNote, onSeen, onOpenNote, onOpenNotes, emptyVariant = null }) {
  const [leavingId, setLeavingId] = React.useState(null);
  const [dragX, setDragX] = React.useState(null);
  const [settling, setSettling] = React.useState(false);
  const [calmId, setCalmId] = React.useState(null);
  const startXRef = React.useRef(null);
  const leaveTimerRef = React.useRef(null);

  React.useEffect(() => () => clearTimeout(leaveTimerRef.current), []);

  const leavingNote = leavingId ? notes.find((n) => String(n.id) === String(leavingId)) : null;
  const top = leavingNote ?? notes[0] ?? null;
  const rest = top ? notes.filter((n) => n.id !== top.id) : [];
  const next = rest[0] ?? null;
  const count = notes.length;

  // Üst kart hangi yolla geldi: yeni not düştüyse "drop", alttan öne geldiyse
  // "promote". Bir kez belirlenir; kart yer değiştirince tekrar oynamaz.
  const topId = top?.id ?? null;
  // Öne gelen kart, çıkış zamanlayıcısında "promote" olarak önceden kaydedilir
  // (bkz. leave); burada yakalanan her yeni üst kart ise yukarıdan düşmüştür.
  const [topMode, setTopMode] = React.useState({ id: null, dropped: false, fresh: false });
  if (topId !== topMode.id) {
    const fresh = !!top?.isNew && !animatedIds.has(String(topId));
    setTopMode({ id: topId, dropped: fresh, fresh });
  }
  React.useEffect(() => {
    if (topId != null && top?.isNew) animatedIds.add(String(topId));
  }, [topId, top?.isNew]);

  function leave(note) {
    if (!note || leavingId) return;
    setLeavingId(note.id);
    setDragX(null);
    leaveTimerRef.current = setTimeout(() => {
      // Tek render'da hem kuyruk kayar (parent) hem çıkış durumu sıfırlanır —
      // yeni üst kart, sonraki katmanın bıraktığı yerde animasyonsuz durur.
      setLeavingId(null);
      setSettling(false);
      setTopMode({ id: next?.id ?? null, dropped: false, fresh: !!next?.isNew && !animatedIds.has(String(next?.id)) });
      onSeen(note.id);
    }, reducedMotion() ? 0 : LEAVE_MS);
  }

  function handleOpen(note) {
    if (leavingId) return;
    onSeen(note.id);
    onOpenNote(note.id, { reply: !!note.isForMe });
  }

  function onPointerDown(e) {
    if (leavingId || e.target.closest('button')) return;
    startXRef.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setCalmId(topId);
    setSettling(false);
    setDragX(0);
  }
  function onPointerMove(e) {
    if (startXRef.current == null) return;
    setDragX(Math.min(MAX_RIGHT_DRAG, e.clientX - startXRef.current));
  }
  function onPointerUp() {
    if (startXRef.current == null) return;
    startXRef.current = null;
    if ((dragX ?? 0) <= SWIPE_THRESHOLD) {
      leave(top);
    } else {
      setSettling(true);
      setDragX(null);
    }
  }

  if (!top) {
    if (emptyVariant !== 'row') return null;
    return (
      <section className="nd-wrap" aria-label="Notlar">
        <div className="nd-head">
          <div className="nd-head-title">
            <span className="nd-title">Notlar</span>
            <span className="nd-count is-idle">Güncel</span>
          </div>
        </div>
        <div className="nd-stack" style={{ height: 64 }}>
          <button type="button" className="nd-empty" onClick={() => onOpenNotes?.()}>
            <span className="nd-empty-tick">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <span className="nd-empty-copy">
              <span className="nd-empty-title">Hepsini gördün</span>
              <span className="nd-empty-sub">
                {lastNote ? `Son not: ${lastNote.author_name} · ${formatDeckTime(lastNote.created_at)}` : 'Henüz not yok'}
              </span>
            </span>
            <span className="nd-empty-link">Notlar ›</span>
          </button>
        </div>
      </section>
    );
  }

  const leaving = leavingId != null;
  const dragging = dragX != null && dragX !== 0;
  const calm = String(calmId) === String(topId);

  let transform = 'none';
  let opacity = 1;
  let transition = 'none';
  if (leaving) {
    transform = 'translateX(-125%) rotate(-9deg)';
    opacity = 0;
    transition = `transform ${LEAVE_MS}ms ease-in, opacity ${LEAVE_MS}ms ease-in`;
  } else if (dragging) {
    transform = `translateX(${dragX}px) rotate(${dragX / 22}deg)`;
    opacity = Math.max(0.35, 1 - Math.abs(dragX) / 320);
  } else if (settling) {
    transition = 'transform .42s cubic-bezier(.3,1.35,.5,1), opacity .25s ease-out';
  }

  const dropped = topMode.id === topId && topMode.dropped && !calm;
  const fresh = topMode.id === topId && topMode.fresh && !calm;
  const cardAnim = dropped && !dragging && !leaving ? 'nd-drop .8s cubic-bezier(.2,.8,.2,1) both' : 'none';
  const ringAnim = top.isNew && fresh && !dragging ? `nd-ring 1.4s ease-out ${dropped ? '.75s' : '.2s'} 2` : 'none';
  const badgeAnim = top.isNew && dropped ? 'nd-pop .4s cubic-bezier(.2,.9,.3,1.3) .45s both' : 'none';
  const stackHeight = count >= 3 ? 236 : count === 2 ? 222 : 208;
  // Çıkış sırasında arka katmanlar bir kademe geri çekilir (kuyruk henüz kaymadı).
  const layers = leaving ? count - 1 : count;

  return (
    <section className="nd-wrap" aria-label="Notlar">
      <div className="nd-head">
        <div className="nd-head-title">
          <span className="nd-title">Notlar</span>
          <span className="nd-count">{count} okunmamış</span>
        </div>
        <div className="nd-dots" aria-hidden="true">
          {notes.slice(0, 5).map((n, i) => <span key={n.id} className={`nd-dot${i === 0 ? ' is-on' : ''}`} />)}
        </div>
      </div>

      <div className="nd-stack" style={{ height: stackHeight }}>
        {layers > 2 && <div className="nd-layer is-2" />}
        {layers > 1 && <div className="nd-layer is-1" />}
        {leaving && next && (
          <div className="nd-slot is-next">
            <DeckCardBody
              note={next}
              ringAnim="none"
              badgeAnim="nd-pop .3s cubic-bezier(.2,.9,.3,1.3) .06s both"
              onSeen={() => {}}
              onOpen={() => {}}
            />
          </div>
        )}
        <div
          key={top.id}
          className="nd-slot is-top"
          style={{ transform, opacity, transition, animation: cardAnim }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <DeckCardBody
            note={top}
            ringAnim={ringAnim}
            badgeAnim={badgeAnim}
            onSeen={(e) => { e.stopPropagation(); leave(top); }}
            onOpen={(e) => { e.stopPropagation(); handleOpen(top); }}
          />
        </div>
      </div>

      <div className="nd-foot-row">
        <span>← kaydır: görüldü</span>
        <button type="button" className="nd-all" onClick={() => onOpenNotes?.()}>
          Tüm notlar <Icon.ChevronR width="12" height="12" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

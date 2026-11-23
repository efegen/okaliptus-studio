// Talep detayı — tam ekran (alt sekme çubuğu gizli, kendi alt çubuğu var).
// Tasarım: "Studio Talepler mobil" canvas'ı, OnKayit / Ders / Mesaj ekranları.
// İlk etapta "Etkinliğe katılımcı olarak ekle" ve "Öğrenci olarak ekle" yok
// (kullanıcı kararı, 2026-11-22).
//
// Durum akışı: Yeni → "Dönüş yaptım" → Dönüş yapıldı → "Kapat" ya da türe göre
// "Kesin kayda dönüştü" / "Derse başladı" / "Sonuçlandı". ⋯ menüsünde bütün
// durumlar ve Spam. Not alanı odaktan çıkınca kaydedilir.

import React from 'react';
import { Drawer } from 'vaul';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSiteInquiry, updateSiteInquiry } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { useCurrentUser } from '../../currentUser';
import { InqIcon } from './InquiryIcons';
import { InquiryOriginCard } from '../siteStats/InquiryOriginCard';
import {
  detailRows,
  handledText,
  kindMeta,
  longTime,
  mailHref,
  statusMeta,
  suspectReason,
  telHref,
  whatsappHref,
} from './inquiryMeta';
import './inquiries.css';

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

function initialsOf(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR'))
    .join('');
}

function sheetOptions(inquiry) {
  const meta = kindMeta(inquiry.kind);
  const options = [];
  if (inquiry.suspectReason) options.push({ id: 'real', label: 'Şüpheli değil', patch: { suspect: false } });
  options.push(
    { id: 'contacted', label: 'Dönüş yaptım', patch: { status: 'contacted' } },
    { id: 'converted', label: meta.convertedButton, patch: { status: 'converted' } },
    { id: 'closed', label: inquiry.kind === 'contact' ? 'Kapat' : 'Kayıt olmadan kapat', patch: { status: 'closed' } },
    { id: 'new', label: 'Yeniye al', patch: { status: 'new' } },
    { id: 'spam', label: 'Spam olarak işaretle', patch: { status: 'spam' }, danger: true },
  );
  return options;
}

function Header({ title, onBack, onMore }) {
  return (
    <div className="inq-top">
      <header className="inq-head">
        <button type="button" className="inq-iconbtn" onClick={onBack} aria-label="Talepler listesine dön">
          <InqIcon.ChevronL size={22} />
        </button>
        <div className="inq-head-text"><h1 className="inq-title">{title}</h1></div>
        {onMore && (
          <button type="button" className="inq-iconbtn" onClick={onMore} aria-label="Diğer işlemler" style={{ color: 'var(--ink-2)' }}>
            <InqIcon.More />
          </button>
        )}
      </header>
    </div>
  );
}

export function MobileInquiryDetail({ inquiryId, onBack, onOpenInquiry, onOpenStudent }) {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);

  const query = useQuery({
    queryKey: queryKeys.siteInquiry(inquiryId),
    queryFn: () => getSiteInquiry(inquiryId),
    enabled: Boolean(inquiryId),
  });
  const inquiry = query.data;

  const statusMutation = useMutation({
    mutationFn: (patch) => updateSiteInquiry(inquiryId, patch),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.siteInquiry(inquiryId), data),
  });

  // ── Not: odaktan çıkınca kaydedilir; yazarken gelen tazeleme metni ezmez.
  const [note, setNote] = React.useState('');
  const [noteState, setNoteState] = React.useState('idle'); // idle | saving | saved | error
  const editingRef = React.useRef(false);
  React.useEffect(() => {
    if (!editingRef.current) setNote(inquiry?.note ?? '');
  }, [inquiry?.id, inquiry?.note]);
  React.useEffect(() => { setNoteState('idle'); }, [inquiryId]);

  const noteMutation = useMutation({
    mutationFn: (value) => updateSiteInquiry(inquiryId, { note: value }),
    onMutate: () => setNoteState('saving'),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.siteInquiry(inquiryId), data);
      setNoteState('saved');
    },
    onError: () => setNoteState('error'),
  });

  function saveNote() {
    editingRef.current = false;
    const value = note.trim();
    if (value === (inquiry?.note ?? '').trim()) return;
    noteMutation.mutate(value === '' ? null : value);
  }

  function apply(patch) {
    setSheetOpen(false);
    statusMutation.mutate(patch);
  }

  if (!inquiry) {
    return (
      <div className="inq-page inq-detail">
        <Header title="Talep" onBack={onBack} />
        <p className="inq-state">
          {query.isError ? 'Talep bulunamadı.' : 'Yükleniyor…'}
        </p>
      </div>
    );
  }

  const meta = kindMeta(inquiry.kind);
  const status = statusMeta(inquiry.status, inquiry.kind);
  const handled = handledText(inquiry, me?.id);
  const rows = detailRows(inquiry.kind, inquiry.details);
  const tel = telHref(inquiry.phone);
  const wa = whatsappHref(inquiry.phone);
  const mail = mailHref(inquiry.email);
  const actionCount = 1 + (wa ? 1 : 0) + (mail ? 1 : 0);
  const suspect = inquiry.suspectReason ? suspectReason(inquiry.suspectReason) : null;
  const busy = statusMutation.isPending;
  const isDone = inquiry.status === 'converted' || inquiry.status === 'closed' || inquiry.status === 'spam';
  const submissions = inquiry.submissions ?? [];
  const related = inquiry.related ?? [];

  return (
    <div className="inq-page inq-detail">
      <Header title={meta.title} onBack={onBack} onMore={() => setSheetOpen(true)} />

      <div className="inq-detail-scroll">
        {suspect && inquiry.status === 'new' && (
          <div className="inq-suspect-banner">
            <span><strong>Şüpheli: {suspect.label}.</strong> Bildirim gitmedi. {suspect.hint}</span>
          </div>
        )}

        <section className="inq-card inq-person">
          <div className="inq-person-top">
            <span className={`inq-tag k-${inquiry.kind}`}>{meta.tag}</span>
            <span className="inq-person-when">{longTime(inquiry.createdAt)}</span>
            <span className={`inq-status tone-${status.tone}`}>{status.label}</span>
          </div>
          <h2 className="inq-person-name">{inquiry.fullName}</h2>
          <p className="inq-person-phone">{inquiry.phone}</p>
          <p className="inq-person-mail">{inquiry.email || 'E-posta bırakmadı'}</p>
          <div className="inq-actions" style={{ '--inq-cols': actionCount }}>
            {tel && (
              <a className="inq-action is-primary" href={tel}>
                <InqIcon.Phone size={17} />Ara
              </a>
            )}
            {wa && (
              <a className="inq-action" href={wa} target="_blank" rel="noopener noreferrer">
                <InqIcon.Chat size={17} />WhatsApp
              </a>
            )}
            {mail && (
              <a className="inq-action" href={mail}>
                <InqIcon.Mail size={17} />E-posta
              </a>
            )}
          </div>
          {handled && (
            <p className="inq-handled-line"><InqIcon.Check size={14} />{handled}</p>
          )}
        </section>

        {(rows.length > 0 || (inquiry.kind === 'contact' && inquiry.message)) && (
          <section className="inq-card">
            <h2 className="inq-card-title">
              {inquiry.kind === 'camp' ? 'Ön kayıt bilgileri' : inquiry.kind === 'lesson' ? 'Talep' : 'Mesaj'}
            </h2>
            {rows.length > 0 && (
              <dl className="inq-dl">
                {rows.map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}</dt>
                    <dd>
                      <strong>{r.value}</strong>
                      {r.sub && <span>{r.sub}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {inquiry.kind === 'contact' && inquiry.message && (
              <p className="inq-message" style={{ marginTop: rows.length ? 10 : 4 }}>{inquiry.message}</p>
            )}
          </section>
        )}

        {inquiry.kind !== 'contact' && inquiry.message && (
          <section className="inq-card">
            <h2 className="inq-card-title">Mesajı</h2>
            <p className="inq-message">{inquiry.message}</p>
          </section>
        )}

        {submissions.length > 1 && (
          <section className="inq-card">
            <div className="inq-subhead">
              <InqIcon.Copy size={15} />
              <h2>Formu {submissions.length} kez gönderdi</h2>
            </div>
            <div className="inq-subrows">
              {submissions.map((s) => (
                <div key={s.id} className="inq-subrow">
                  <span className="inq-subrow-text">
                    <strong>{longTime(s.createdAt)}</strong>
                    <span>{s.summary}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="inq-subnote">Yukarıdaki bilgiler son gönderimden. Bildirim yalnız ilkinde gitti.</p>
          </section>
        )}

        <InquiryOriginCard origin={inquiry.origin} />

        {inquiry.student && (
          <section className="inq-card">
            <button type="button" className="inq-subrow" onClick={() => onOpenStudent?.(inquiry.student.id)}>
              <span className="inq-student-avatar" aria-hidden="true">{initialsOf(inquiry.student.fullName)}</span>
              <span className="inq-subrow-text">
                <strong>{inquiry.student.fullName}</strong>
                <span>Kayıtlı öğrenci, numara eşleşti</span>
              </span>
              <span className="inq-student-open">Profili aç</span>
            </button>
          </section>
        )}

        {related.length > 0 && (
          <section className="inq-card">
            <div className="inq-subhead">
              <InqIcon.Inbox size={15} />
              <h2>Aynı numaradan diğer talepler</h2>
            </div>
            <div className="inq-subrows">
              {related.map((r) => (
                <button key={r.id} type="button" className="inq-subrow" onClick={() => onOpenInquiry?.(r.id)}>
                  <span className={`inq-tag k-${r.kind}`}>{kindMeta(r.kind).tag}</span>
                  <span className="inq-subrow-text">
                    <strong>{longTime(r.createdAt)}</strong>
                    <span>{r.summary}</span>
                  </span>
                  <InqIcon.ChevronR size={15} style={{ color: 'var(--ink-3)' }} />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="inq-card inq-note">
          <label htmlFor="inq-note">Not</label>
          <textarea
            id="inq-note"
            rows={3}
            maxLength={2000}
            placeholder="Görüşmeden kısa bir not"
            value={note}
            onFocus={() => { editingRef.current = true; }}
            onChange={(e) => { setNote(e.target.value); if (noteState !== 'idle') setNoteState('idle'); }}
            onBlur={saveNote}
          />
          <p className={`inq-note-hint${noteState === 'error' ? ' is-error' : ''}`} aria-live="polite">
            {noteState === 'saving' ? 'Kaydediliyor…'
              : noteState === 'saved' ? 'Kaydedildi. Yalnız ekip görür.'
              : noteState === 'error' ? 'Not kaydedilemedi. Tekrar deneyin.'
              : 'Yalnız ekip görür.'}
          </p>
        </section>
      </div>

      <div className="inq-bar">
        {statusMutation.isError && (
          <p className="inq-bar-error" role="alert">Durum değiştirilemedi. Tekrar deneyin.</p>
        )}
        {inquiry.status === 'new' && suspect ? (
          <>
            <button type="button" className="inq-bar-btn" disabled={busy} onClick={() => apply({ status: 'spam' })}>Spam</button>
            <button type="button" className="inq-bar-btn is-grow is-dark" disabled={busy} onClick={() => apply({ suspect: false })}>
              Gerçek, Yeni'ye al
            </button>
          </>
        ) : inquiry.status === 'new' ? (
          <button type="button" className="inq-bar-btn is-grow is-dark" disabled={busy} onClick={() => apply({ status: 'contacted' })}>
            <InqIcon.Check size={18} />Dönüş yaptım
          </button>
        ) : inquiry.status === 'contacted' ? (
          <>
            <button type="button" className="inq-bar-btn" disabled={busy} onClick={() => apply({ status: 'closed' })}>Kapat</button>
            <button type="button" className="inq-bar-btn is-grow is-accent" disabled={busy} onClick={() => apply({ status: 'converted' })}>
              {meta.convertedButton}
            </button>
          </>
        ) : isDone ? (
          <button type="button" className="inq-bar-btn is-grow" disabled={busy} onClick={() => apply({ status: 'new' })}>
            Yeniye al
          </button>
        ) : null}
      </div>

      <Drawer.Root
        open={sheetOpen}
        onOpenChange={(next) => { if (!next) setSheetOpen(false); }}
        shouldScaleBackground={false}
        repositionInputs={false}
      >
        <Drawer.Portal container={portalContainer || undefined}>
          <Drawer.Overlay className="mobile-lsheet-overlay" />
          <Drawer.Content className="mobile-lsheet-content">
            <Drawer.Handle className="mobile-lsheet-handle" />
            <div className="inq-sheet-body">
              <Drawer.Title className="inq-sheet-title">Durumu değiştir</Drawer.Title>
              <Drawer.Description style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                {inquiry.fullName} talebinin durumu
              </Drawer.Description>
              {sheetOptions(inquiry).map((o) => {
                const current = o.patch.status === inquiry.status && !(inquiry.suspectReason && o.patch.status === 'new');
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`inq-sheet-option${o.danger ? ' is-danger' : ''}`}
                    aria-current={current ? 'true' : undefined}
                    disabled={busy}
                    onClick={() => (current ? setSheetOpen(false) : apply(o.patch))}
                  >
                    <span>{o.label}</span>
                    {current && <InqIcon.Check size={18} />}
                  </button>
                );
              })}
              <button type="button" className="inq-sheet-cancel" onClick={() => setSheetOpen(false)}>Vazgeç</button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}

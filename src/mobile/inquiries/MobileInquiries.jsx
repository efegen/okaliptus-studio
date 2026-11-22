// Talepler listesi — web sitesinin formlarından (Bize ulaşın, ders talebi,
// etkinlik ön kaydı) gelenler. Ana sayfadaki gelen kutusu düğmesinden ya da
// "N yeni talep" bildiriminden açılır. Tasarım: "Studio Talepler mobil"
// canvas'ı, Liste ekranı.
//
// Sekmeler backend kutularıdır: Yeni (new), Dönüş yapıldı (contacted),
// Tamamlanan (done: kayda dönüştü + kapandı). Şüpheli gönderimler ayrı ekranda;
// Yeni'nin sonundaki kesik çizgili satır oraya götürür.

import React from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getSiteInquiries, getSiteInquiryCounts } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { useCurrentUser } from '../../currentUser';
import { InqIcon, KindIcon } from './InquiryIcons';
import { excerpt, groupLabel, handledText, kindMeta, rowTime, statusMeta } from './inquiryMeta';
import './inquiries.css';

const TABS = [
  { id: 'new', label: 'Yeni' },
  { id: 'contacted', label: 'Dönüş yapıldı' },
  { id: 'done', label: 'Tamamlanan' },
];

const KINDS = [
  { id: 'all', label: 'Tümü' },
  { id: 'camp', label: 'Ön kayıt' },
  { id: 'lesson', label: 'Ders' },
  { id: 'contact', label: 'Mesaj' },
];

const EMPTY_TEXT = {
  new: 'Siteden gelen formlar buraya düşer.',
  contacted: 'Dönüş yaptığınız talepler burada durur.',
  done: 'Kayda dönüşen ya da kapanan talepler burada durur.',
};

/** Rozetler için talep sayıları ({ new, contacted, suspect }). */
export function useInquiryCounts(enabled = true) {
  return useQuery({
    queryKey: queryKeys.siteInquiryCounts(),
    queryFn: getSiteInquiryCounts,
    enabled,
    staleTime: 30 * 1000,
  });
}

function InquiryRow({ item, meId, now, onOpen }) {
  const meta = kindMeta(item.kind);
  const status = statusMeta(item.status, item.kind);
  const isNew = item.status === 'new' && !item.suspectReason;
  const ex = item.kind !== 'camp' ? excerpt(item.message) : '';
  // Konu/yer bilgisi yoksa özet zaten mesajın başıdır; ikinci kez yazma.
  const showExcerpt = ex && !item.summary.startsWith(ex.slice(0, 24));
  const handled = item.status === 'contacted' ? handledText(item, meId, now) : '';
  const outcome = item.status === 'converted' || item.status === 'closed' || item.status === 'spam';
  const hasMinis = Boolean(item.student) || item.submissionCount > 1 || outcome;

  return (
    <button type="button" className="inq-row" onClick={() => onOpen(item.id)}>
      <span className={`inq-kind-icon k-${item.kind}`}><KindIcon kind={item.kind} /></span>
      <span className="inq-row-body">
        <span className="inq-row-top">
          {isNew && <span className="inq-dot" role="img" aria-label="Yeni" />}
          <span className="inq-name">{item.fullName}</span>
          <span className="inq-time">{rowTime(item.lastSubmittedAt || item.createdAt, now)}</span>
        </span>
        <span className="inq-row-line">
          <span className={`inq-tag k-${item.kind}`}>{meta.tag}</span>
          <span className="inq-summary">{item.summary}</span>
        </span>
        {showExcerpt && <span className="inq-excerpt">{ex}</span>}
        {handled && (
          <span className="inq-handled"><InqIcon.Check size={13} /><span>{handled}</span></span>
        )}
        {hasMinis && (
          <span className="inq-minis">
            {item.student && (
              <span className="inq-mini"><InqIcon.UserCheck size={12} />Kayıtlı öğrenci</span>
            )}
            {item.submissionCount > 1 && (
              <span className="inq-mini"><InqIcon.Copy size={12} />{item.submissionCount} gönderim</span>
            )}
            {outcome && (
              <span className={`inq-mini ${status.tone === 'converted' ? 'is-good' : 'is-muted'}`}>{status.label}</span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

export function MobileInquiries({ tab = 'new', kind = 'all', onChangeTab, onChangeKind, onBack, onOpen, onOpenSuspects }) {
  const me = useCurrentUser();
  const { data: counts } = useInquiryCounts();
  const list = useInfiniteQuery({
    queryKey: queryKeys.siteInquiries(tab, kind),
    queryFn: ({ pageParam }) => getSiteInquiries({
      box: tab,
      kind: kind === 'all' ? '' : kind,
      before: pageParam || '',
    }),
    initialPageParam: '',
    getNextPageParam: (last) => last?.nextBefore || undefined,
    staleTime: 30 * 1000,
  });

  const items = React.useMemo(
    () => (list.data?.pages ?? []).flatMap((p) => p.items),
    [list.data],
  );
  const now = new Date();
  const groups = [];
  for (const item of items) {
    const label = groupLabel(item.createdAt, now);
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) {
      g = { label, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }

  const tabCount = (id) => {
    if (!counts) return 0;
    if (id === 'new') return counts.new;
    if (id === 'contacted') return counts.contacted;
    return 0;
  };
  const showSuspects = tab === 'new' && kind === 'all' && (counts?.suspect ?? 0) > 0;

  return (
    <div className="inq-page">
      <div className="inq-top">
        <header className="inq-head">
          <button type="button" className="inq-iconbtn" onClick={onBack} aria-label="Geri">
            <InqIcon.ChevronL size={22} />
          </button>
          <div className="inq-head-text">
            <h1 className="inq-title">Talepler</h1>
            <span className="inq-subtitle">Web sitesinden gelen formlar</span>
          </div>
        </header>
        <div className="inq-controls">
          <div className="inq-seg" role="tablist" aria-label="Durum">
            {TABS.map((t) => {
              const n = tabCount(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`inq-seg-btn${tab === t.id ? ' is-on' : ''}`}
                  onClick={() => onChangeTab(t.id)}
                >
                  <span>{t.label}</span>
                  {n > 0 && <span className={`inq-count${t.id === 'new' ? ' is-new' : ''}`}>{n}</span>}
                </button>
              );
            })}
          </div>
          <div className="inq-chips">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={kind === k.id}
                className={`inq-chip${kind === k.id ? ' is-on' : ''}`}
                onClick={() => onChangeKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="inq-list">
        {list.isLoading ? (
          <p className="inq-state">Yükleniyor…</p>
        ) : list.isError ? (
          <div className="inq-state">
            <p style={{ margin: 0 }}>Talepler alınamadı.</p>
            <button type="button" className="inq-more" onClick={() => list.refetch()}>Tekrar dene</button>
          </div>
        ) : items.length === 0 ? (
          <div className="inq-empty">
            <span className="inq-empty-icon"><InqIcon.Inbox size={24} /></span>
            <p className="inq-empty-title">Burada talep yok</p>
            <p className="inq-empty-text">{EMPTY_TEXT[tab]}</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="inq-group-label">{g.label}</h2>
              <div className="inq-rows">
                {g.items.map((item) => (
                  <InquiryRow key={item.id} item={item} meId={me?.id} now={now} onOpen={onOpen} />
                ))}
              </div>
            </section>
          ))
        )}

        {list.hasNextPage && (
          <button
            type="button"
            className="inq-more"
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Yükleniyor…' : 'Daha eski talepler'}
          </button>
        )}

        {showSuspects && (
          <button type="button" className="inq-suspect-link" onClick={onOpenSuspects}>
            <span className="inq-suspect-link-icon"><InqIcon.Shield size={17} /></span>
            <span className="inq-suspect-link-text">
              <strong>{counts.suspect} şüpheli gönderim</strong>
              <span>Bildirim gitmedi. Arada gerçek biri olabilir.</span>
            </span>
            <InqIcon.ChevronR size={16} style={{ color: 'var(--ink-3)' }} />
          </button>
        )}
      </div>
    </div>
  );
}

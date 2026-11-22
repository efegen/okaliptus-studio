// Şüpheli gönderimler — bot gibi görünen (tuzak alan dolu, çok hızlı, siteden
// gelmemiş, aynı ağdan çok sık) ve bu yüzden bildirim göndermeyen talepler.
// Backend bunları reddetmez, burada bekletir (bkz. site-inquiries.service.ts).
// "Gerçek, Yeni'ye al" → suspect:false (Yeni'ye geçer); "Spam" → status spam
// (geri alınabilir). Tasarım: "Studio Talepler mobil" canvas'ı, Supheli ekranı.

import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getSiteInquiries, updateSiteInquiry } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { InqIcon } from './InquiryIcons';
import { kindMeta, longTime, suspectReason } from './inquiryMeta';
import './inquiries.css';

export function MobileInquirySuspects({ onBack }) {
  const query = useQuery({
    queryKey: queryKeys.siteInquiries('suspect', 'all'),
    queryFn: () => getSiteInquiries({ box: 'suspect', limit: 100 }),
    staleTime: 30 * 1000,
  });
  // İşlem yapılan satırlar liste tazelense de bir süre "taşındı" satırı olarak
  // yerinde kalır (geri al için): { [id]: { item, action } }
  const [moved, setMoved] = React.useState({});

  const mutation = useMutation({
    mutationFn: ({ id, patch }) => updateSiteInquiry(id, patch),
  });

  function act(item, action) {
    const patch = action === 'real' ? { suspect: false } : { status: 'spam' };
    mutation.mutate({ id: item.id, patch }, {
      onSuccess: () => setMoved((m) => ({ ...m, [item.id]: { item, action } })),
    });
  }

  function undo(id) {
    mutation.mutate({ id, patch: { status: 'new' } }, {
      onSuccess: () => setMoved((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      }),
    });
  }

  const fresh = query.data?.items ?? [];
  // Tazelenen listede olmayan ama bu ekranda işlem görmüş satırlar da gösterilir.
  const rows = [
    ...fresh.filter((i) => !moved[i.id]).map((item) => ({ item, moved: null })),
    ...Object.values(moved).map(({ item, action }) => ({ item, moved: action })),
  ].sort((a, b) => Number(b.item.id) - Number(a.item.id));

  return (
    <div className="inq-page">
      <div className="inq-top">
        <header className="inq-head">
          <button type="button" className="inq-iconbtn" onClick={onBack} aria-label="Talepler listesine dön">
            <InqIcon.ChevronL size={22} />
          </button>
          <div className="inq-head-text"><h1 className="inq-title">Şüpheli gönderimler</h1></div>
        </header>
      </div>

      <div className="inq-sus">
        <p className="inq-info">
          <InqIcon.Info size={18} />
          <span>Bunlar bot gibi göründüğü için bildirim göndermedi ve Yeni sayısına girmedi. Gerçek görünen varsa Yeni'ye alın.</span>
        </p>

        {mutation.isError && (
          <p className="inq-info" role="alert" style={{ background: 'var(--warn-2)', color: 'var(--warn-ink)' }}>
            İşlem yapılamadı. Tekrar deneyin.
          </p>
        )}

        {query.isLoading ? (
          <p className="inq-state">Yükleniyor…</p>
        ) : query.isError ? (
          <p className="inq-state">Liste alınamadı.</p>
        ) : rows.length === 0 ? (
          <div className="inq-empty">
            <span className="inq-empty-icon"><InqIcon.Shield size={24} /></span>
            <p className="inq-empty-title">Şüpheli gönderim yok</p>
          </div>
        ) : (
          rows.map(({ item, moved: action }) => {
            if (action) {
              return (
                <div key={item.id} className="inq-moved">
                  <InqIcon.Check size={16} style={{ color: 'var(--accent)' }} />
                  <span>{action === 'real' ? `${item.fullName} Yeni'ye taşındı.` : `${item.fullName} spam olarak işaretlendi.`}</span>
                  {action === 'spam' && (
                    <button type="button" disabled={mutation.isPending} onClick={() => undo(item.id)}>Geri al</button>
                  )}
                </div>
              );
            }
            const reason = suspectReason(item.suspectReason);
            return (
              <article key={item.id} className="inq-sus-card">
                <div className="inq-row-top">
                  <span className="inq-name">{item.fullName}</span>
                  <span className="inq-time">{longTime(item.createdAt)}</span>
                </div>
                <div className="inq-row-line">
                  <span className={`inq-tag k-${item.kind}`}>{kindMeta(item.kind).tag}</span>
                  <span className="inq-summary">{item.summary}</span>
                </div>
                <span className="inq-reason"><InqIcon.Shield size={13} />{reason.label}</span>
                {reason.hint && <span className="inq-sus-hint">{reason.hint}</span>}
                <div className="inq-sus-actions">
                  <button type="button" className="inq-sus-real" disabled={mutation.isPending} onClick={() => act(item, 'real')}>
                    Gerçek, Yeni'ye al
                  </button>
                  <button type="button" className="inq-sus-spam" disabled={mutation.isPending} onClick={() => act(item, 'spam')}>
                    Spam
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

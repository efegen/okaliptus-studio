// Hareketler — stüdyo geneli işlem akışı (web).
// Tüm öğrencilerin ürün satışları, gerçekleşmiş dersleri (durumuyla) ve
// tahsilatları tek bir tabloda. Satıra tıklayınca o işlemin detay penceresi açılır
// (öğrenciye otomatik yönlendirme yok); pencereden profile gidilebilir veya borç
// varsa tahsilat alınabilir. Backend: GET /movements.

import React from 'react';
import { useInfiniteQuery, useQueryClient, useQuery } from '@tanstack/react-query';
import { fmtTL } from './data';
import { Icon, Avatar } from './layout';
import { getMovements, getStudentLessons, getStudentProductSales, getProductSale } from './api';
import { ReceivePaymentModal } from './students';
import { queryKeys } from './hooks/queryKeys';

const PAGE_SIZE = 50;

const MODE_TR = { online: 'Online', onsite: 'Yüzyüze' };

export const KIND_TITLE = {
  product_sale: 'Ürün satışı',
  lesson_completed: 'Tamamlanan ders',
  lesson_cancelled: 'İptal edilen ders',
  lesson_no_show: 'Gelmedi',
  payment: 'Tahsilat',
};

export function money(v) { return parseFloat(v ?? '0') || 0; }

// Tarih + saat — smart year (cari yıl gizlenir).
export function fmtRowDate(iso, { withTime = false } = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  });
  if (!withTime) return date;
  const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export function fmtDateParts(iso) {
  if (!iso) return { date: '—', time: '' };
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return {
    date: d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }),
    time: d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
  };
}

// Tarih grup etiketi: "Bugün" / "Dün" / "Bu hafta" / "Geçen hafta" / "Nisan 2026".
// Sınırlar tarayıcının yerel saatinde hesaplanır (tek operatör Europe/Istanbul).
function dateBucket(iso) {
  if (!iso) return { key: '9-unknown', label: '—' };
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c; };
  const today = startOfDay(now);
  const target = startOfDay(d);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  const dow = (today.getDay() + 6) % 7; // 0 = Pzt
  const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - dow);
  const startOfPrevWeek = new Date(startOfWeek); startOfPrevWeek.setDate(startOfWeek.getDate() - 7);

  if (diffDays === 0) return { key: '1-today', label: 'Bugün' };
  if (diffDays === 1) return { key: '2-yesterday', label: 'Dün' };
  if (target >= startOfWeek) return { key: '3-this-week', label: 'Bu hafta' };
  if (target >= startOfPrevWeek) return { key: '4-prev-week', label: 'Geçen hafta' };

  // Daha yeni ay daha küçük monthsBehind → artan sırada önce gelir (en yeni en üstte).
  const monthsBehind = (today.getFullYear() - target.getFullYear()) * 12 + (today.getMonth() - target.getMonth());
  const monthLabel = d.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  return {
    key: `5-${String(monthsBehind).padStart(4, '0')}`,
    label: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
  };
}

export function bucketByDate(items) {
  const groups = new Map();
  for (const it of items) {
    const b = dateBucket(it.occurred_at);
    if (!groups.has(b.key)) groups.set(b.key, { key: b.key, label: b.label, items: [] });
    groups.get(b.key).items.push(it);
  }
  return Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// ─── Olay → görünüm modeli ────────────────────────────────────────────────────
// tag (kategori) → İşlem sütunundaki renkli etiket; status → Durum sütunu rozeti
// (ödemelerde yok); desc → açıklama; amount → Tutar.

function lessonSub(d) {
  const mode = MODE_TR[d.mode] || (d.mode || 'Ders');
  return `${mode} · ${fmtRowDate(d.starts_at, { withTime: true })}`;
}

export function describeMovement(row) {
  const d = row.details || {};
  switch (row.kind) {
    case 'product_sale': {
      const remaining = money(d.remaining_receivable);
      const paid = money(d.paid_amount);
      let status;
      if (remaining < 0.01 && paid > 0.01) status = { label: 'Ödendi', tone: 'paid' };
      else if (paid > 0.01) status = { label: 'Kısmi', tone: 'partial' };
      else status = { label: 'Borçlu', tone: 'open' };
      return {
        tag: 'sale', tagLabel: 'Ürün',
        desc: d.note?.trim() || 'Ürün satışı',
        status,
        amount: money(d.total_amount),
        amountSub: remaining > 0.01 ? `Kalan ${fmtTL(remaining)}` : null,
      };
    }
    case 'lesson_completed': {
      const prepaid = d.prepaid_package_id != null;
      const remaining = money(d.remaining_receivable);
      const paid = money(d.paid_amount);
      let status;
      if (prepaid) status = { label: 'Krediden', tone: 'credit' };
      else if (remaining < 0.01 && paid > 0.01) status = { label: 'Ödendi', tone: 'paid' };
      else if (paid > 0.01) status = { label: 'Kısmi', tone: 'partial' };
      else status = { label: 'Borçlu', tone: 'open' };
      return {
        tag: 'lesson', tagLabel: 'Ders',
        desc: lessonSub(d),
        status,
        amount: prepaid ? null : money(d.net_amount),
        amountSub: !prepaid && remaining > 0.01 ? `Kalan ${fmtTL(remaining)}` : null,
      };
    }
    case 'lesson_cancelled':
      return { tag: 'lesson', tagLabel: 'Ders', desc: lessonSub(d), status: { label: 'İptal', tone: 'neutral' }, amount: null };
    case 'lesson_no_show':
      return { tag: 'lesson', tagLabel: 'Ders', desc: lessonSub(d), status: { label: 'Gelmedi', tone: 'warn' }, amount: null };
    case 'payment': {
      const srcLabel = d.source === 'iban' ? 'IBAN' : 'Nakit';
      const targetLabel = d.target === 'lesson' ? 'ders' : d.target === 'product_sale' ? 'ürün' : 'paket';
      const note = d.note?.trim();
      return {
        tag: 'payment', tagLabel: 'Tahsilat',
        desc: `${srcLabel} · ${targetLabel} için${note ? ` · ${note}` : ''}`,
        status: null,
        amount: money(d.amount),
        amountPositive: true,
      };
    }
    default:
      return { tag: 'lesson', tagLabel: row.kind, desc: null, status: null, amount: null };
  }
}

// Detay penceresi için anahtar-değer satırları.
export function detailFields(row) {
  const d = row.details || {};
  const rows = [];
  if (row.kind === 'product_sale') {
    rows.push({ label: 'Toplam tutar', value: fmtTL(money(d.total_amount)) });
    rows.push({ label: 'Tahsil edilen', value: fmtTL(money(d.paid_amount)) });
    const rem = money(d.remaining_receivable);
    rows.push({ label: 'Kalan borç', value: fmtTL(rem), tone: rem > 0.01 ? 'warn' : 'paid' });
  } else if (row.kind.startsWith('lesson_')) {
    rows.push({ label: 'Ders zamanı', value: fmtRowDate(d.starts_at, { withTime: true }) });
    rows.push({ label: 'Yöntem', value: MODE_TR[d.mode] || d.mode || '—' });
    if (row.kind === 'lesson_completed') {
      if (d.prepaid_package_id != null) {
        rows.push({ label: 'Ücret', value: 'Paket kredisinden' });
      } else {
        const gross = money(d.price_snapshot);
        const net = money(d.net_amount);
        rows.push({ label: 'Brüt fiyat', value: fmtTL(gross) });
        if (gross - net > 0.01) rows.push({ label: 'İndirim', value: '−' + fmtTL(gross - net) });
        rows.push({ label: 'Net tutar', value: fmtTL(net) });
        rows.push({ label: 'Tahsil edilen', value: fmtTL(money(d.paid_amount)) });
        const rem = money(d.remaining_receivable);
        rows.push({ label: 'Kalan borç', value: fmtTL(rem), tone: rem > 0.01 ? 'warn' : 'paid' });
      }
    }
  } else if (row.kind === 'payment') {
    rows.push({ label: 'Tutar', value: fmtTL(money(d.amount)), tone: 'paid' });
    rows.push({ label: 'Yöntem', value: d.source === 'iban' ? 'IBAN / Havale' : 'Nakit' });
    let forVal = d.target === 'lesson' ? 'Ders' : d.target === 'product_sale' ? 'Ürün satışı' : 'Paket alımı';
    if (d.target === 'lesson' && d.lesson_starts_at) {
      const mode = MODE_TR[d.lesson_mode] ? `${MODE_TR[d.lesson_mode]} · ` : '';
      forVal = `Ders · ${mode}${fmtRowDate(d.lesson_starts_at, { withTime: true })}`;
    }
    rows.push({ label: 'Neyin ödemesi', value: forVal });
  }
  return rows;
}

// ─── Filtreler ────────────────────────────────────────────────────────────────

export const DATE_PRESETS = [
  { id: 'month',  label: 'Bu ay' },
  { id: 'days30', label: 'Son 30 gün' },
  { id: 'week',   label: 'Bu hafta' },
  { id: 'all',    label: 'Tümü' },
];

export function presetFrom(id) {
  if (id === 'all') return null;
  const now = new Date();
  if (id === 'days30') {
    const d = new Date(now); d.setDate(d.getDate() - 30); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (id === 'week') {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d.toISOString();
  }
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
}

export const TYPE_FILTERS = [
  { id: 'all',     label: 'Tümü' },
  { id: 'sale',    label: 'Satış' },
  { id: 'lesson',  label: 'Ders' },
  { id: 'payment', label: 'Tahsilat' },
];

const COL_COUNT = 5;

// ─── Sayfa ────────────────────────────────────────────────────────────────────

export function MovementsPage({ onOpenStudent }) {
  const qc = useQueryClient();
  const [type, setType] = React.useState('all');
  const [datePreset, setDatePreset] = React.useState('month');
  const [search, setSearch] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');

  // İşlem detay penceresi + tahsilat akışı
  const [detailRow, setDetailRow] = React.useState(null);
  const [collecting, setCollecting] = React.useState(false);
  const [collectError, setCollectError] = React.useState(null);
  const [payTarget, setPayTarget] = React.useState(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const from = React.useMemo(() => presetFrom(datePreset), [datePreset]);
  const q = debouncedQ || undefined;

  const query = useInfiniteQuery({
    queryKey: queryKeys.studioMovements({ from, type, q }),
    queryFn: ({ pageParam }) =>
      getMovements({ from, to: null, type, q, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage?.hasMore ? allPages.length + 1 : undefined),
    staleTime: 30 * 1000,
    placeholderData: (prev) => prev,
  });

  const rows = React.useMemo(
    () => (query.data?.pages ?? []).flatMap(p => p?.data ?? []),
    [query.data],
  );
  const summary = query.data?.pages?.[0]?.summary;
  const groups = React.useMemo(() => bucketByDate(rows), [rows]);

  const typeCounts = {
    all: summary ? summary.sales_count + summary.lessons_count + summary.payments_count : null,
    sale: summary?.sales_count,
    lesson: summary?.lessons_count,
    payment: summary?.payments_count,
  };

  const dimming = query.isFetching && !query.isFetchingNextPage && !query.isLoading;

  function closeDetail() { setDetailRow(null); setCollectError(null); }

  function goToStudent(studentId) { closeDetail(); onOpenStudent(String(studentId)); }

  // Borç kalemi için tahsilat: öğrencinin ders+satış borçlarını çekip mevcut
  // ödeme modalını (FIFO/tek-kalem) aç. Tutarlılık için aynı akış kullanılır.
  async function startCollect(row) {
    if (!row) return;
    setCollecting(true);
    setCollectError(null);
    try {
      const [lessons, productSales] = await Promise.all([
        getStudentLessons(row.student_id),
        getStudentProductSales(row.student_id),
      ]);
      setPayTarget({
        student: { id: row.student_id, full_name: row.student_name },
        detail: { lessons, productSales },
      });
      setDetailRow(null);
    } catch (e) {
      setCollectError(e?.message || 'Borç bilgisi alınamadı.');
    } finally {
      setCollecting(false);
    }
  }

  async function handlePaySuccess() {
    setPayTarget(null);
    qc.invalidateQueries({ queryKey: ['movements'] });
    qc.invalidateQueries({ queryKey: queryKeys.weeklyKpi() });
    qc.invalidateQueries({ queryKey: queryKeys.debtors() });
    qc.invalidateQueries({ queryKey: queryKeys.studentsKpi() });
    qc.invalidateQueries({ queryKey: ['student'] });
  }

  return (
    <div className="mv-page">
      <div className="mv-head">
        <h1 className="mv-title">Hareketler</h1>
        <p className="mv-subtitle">Stüdyo genelinde satış, ders ve tahsilat geçmişi</p>
      </div>

      <div className="mv-toolbar">
        <div className="mv-chips">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              className={'sp-chip' + (type === f.id ? ' is-active' : '')}
              onClick={() => setType(f.id)}
            >
              {f.label}
              {typeCounts[f.id] != null && <span className="sp-chip-n">{typeCounts[f.id]}</span>}
            </button>
          ))}
        </div>

        <div className="mv-toolbar-right">
          <div className="mv-date-presets">
            {DATE_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                className={'mv-date-chip' + (datePreset === p.id ? ' is-active' : '')}
                onClick={() => setDatePreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="sp-toolbar-search mv-search">
            <Icon.Search width="13" height="13" />
            <input
              type="text"
              placeholder="Öğrenci ara..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="sp-toolbar-search-clear"
                onClick={() => setSearch('')}
                aria-label="Aramayı temizle"
              >×</button>
            )}
          </div>
        </div>
      </div>

      <div className={'mv-table-wrap' + (dimming ? ' is-fetching' : '')} aria-busy={dimming}>
        <div className="mv-table-scroll">
          <table className="mv-table">
            <thead>
              <tr>
                <th className="mv-th-date">Tarih</th>
                <th>Öğrenci</th>
                <th>İşlem</th>
                <th>Durum</th>
                <th className="mv-th-amount">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <SkeletonRows />
              ) : query.isError ? (
                <tr>
                  <td colSpan={COL_COUNT} className="mv-empty-cell mv-state-error">
                    Hareketler yüklenemedi.{query.error?.message ? ` ${query.error.message}` : ''}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COL_COUNT} className="mv-empty-cell">
                    <div className="mv-state-title">
                      {debouncedQ ? `"${debouncedQ}" için hareket yok` : 'Bu aralıkta hareket yok'}
                    </div>
                    <div className="mv-state-sub">
                      {debouncedQ
                        ? 'Farklı bir isim veya daha geniş bir tarih aralığı deneyin.'
                        : 'Tarih aralığını genişletmeyi deneyin.'}
                    </div>
                  </td>
                </tr>
              ) : (
                groups.map(g => (
                  <React.Fragment key={g.key}>
                    <tr className="mv-group-row">
                      <td colSpan={COL_COUNT}>{g.label}</td>
                    </tr>
                    {g.items.map(r => (
                      <MovementRow key={r.id} row={r} onSelect={setDetailRow} />
                    ))}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {query.hasNextPage && !query.isLoading && (
        <div className="mv-more">
          <button
            type="button"
            className="mv-load-more"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla göster'}
          </button>
        </div>
      )}

      {detailRow && (
        <MovementDetailModal
          key={detailRow.id}
          row={detailRow}
          collecting={collecting}
          collectError={collectError}
          onClose={closeDetail}
          onOpenStudent={goToStudent}
          onCollect={() => startCollect(detailRow)}
        />
      )}

      {payTarget && (
        <ReceivePaymentModal
          student={payTarget.student}
          detail={payTarget.detail}
          onClose={() => setPayTarget(null)}
          onSuccess={handlePaySuccess}
        />
      )}
    </div>
  );
}


function MovementRow({ row, onSelect }) {
  const m = describeMovement(row);
  const { date, time } = fmtDateParts(row.occurred_at);
  const open = () => onSelect(row);

  return (
    <tr
      className="mv-tr"
      onClick={open}
      tabIndex={0}
      aria-label={`${row.student_name} — ${KIND_TITLE[row.kind] || 'işlem'} detayını aç`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }}
    >
      <td className="mv-td-date">
        <span className="mv-d">{date}</span>
        {time && <span className="mv-t">{time}</span>}
      </td>
      <td className="mv-td-student">{row.student_name}</td>
      <td className="mv-td-islem">
        <div className="mv-islem">
          <span className="mv-tag">
            <span className={'mv-tag-dot mv-dot-' + m.tag} aria-hidden="true" />
            {m.tagLabel}
          </span>
          {m.desc && <span className="mv-desc">{m.desc}</span>}
        </div>
      </td>
      <td className="mv-td-durum">
        {m.status && (
          <span className={'sp-badge sp-badge-tone-' + m.status.tone}>{m.status.label}</span>
        )}
      </td>
      <td className="mv-td-amount">
        {m.amount == null ? (
          <span className="mv-amount-mute">—</span>
        ) : (
          <>
            <span className={'mv-amount' + (m.amountPositive ? ' mv-amount-pos' : '')}>
              {m.amountPositive ? '+' : ''}{fmtTL(m.amount)}
            </span>
            {m.amountSub && <span className="mv-amount-sub">{m.amountSub}</span>}
          </>
        )}
      </td>
    </tr>
  );
}

function MovementDetailModal({ row, collecting, collectError, onClose, onOpenStudent, onCollect }) {
  React.useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const m = describeMovement(row);
  const d = row.details || {};
  const { date, time } = fmtDateParts(row.occurred_at);
  const prepaid = d.prepaid_package_id != null;
  const remaining = money(d.remaining_receivable);
  const isDebtKind = row.kind === 'product_sale' || row.kind === 'lesson_completed';
  const canCollect = isDebtKind && !prepaid && remaining > 0.01;
  const fields = detailFields(row);

  // Ürün satışıysa kalemleri (hangi ürünler satıldı) ayrı çek.
  const saleId = row.kind === 'product_sale'
    ? (d.sale_id ?? (typeof row.id === 'string' && row.id.startsWith('sale-') ? row.id.slice(5) : null))
    : null;
  const saleQuery = useQuery({
    queryKey: ['productSale', saleId],
    queryFn: () => getProductSale(saleId),
    enabled: !!saleId,
    staleTime: 60 * 1000,
  });
  const items = saleQuery.data?.items ?? [];

  // Çok kalemli satışta ilk birkaçını göster, gerisini "Tümünü göster" ile aç.
  const [showAllItems, setShowAllItems] = React.useState(false);
  const ITEMS_PREVIEW = 4;
  const collapsible = items.length > 5;
  const visibleItems = collapsible && !showAllItems ? items.slice(0, ITEMS_PREVIEW) : items;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal mvd-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="mvd-head">
          <div className="mvd-head-top">
            <span className="mvd-type">
              <span className={'mv-tag-dot mv-dot-' + m.tag} aria-hidden="true" />
              {KIND_TITLE[row.kind] || m.tagLabel}
            </span>
            <button type="button" className="mvd-close" onClick={onClose} aria-label="Kapat">×</button>
          </div>
          {m.amount != null ? (
            <div className={'mvd-amount' + (m.amountPositive ? ' mvd-amount-pos' : '')}>
              {m.amountPositive ? '+' : ''}{fmtTL(m.amount)}
            </div>
          ) : prepaid ? (
            <div className="mvd-amount-none">Paket kredisinden</div>
          ) : null}
          <div className="mvd-head-meta">
            {m.status && <span className={'sp-badge sp-badge-tone-' + m.status.tone}>{m.status.label}</span>}
            <span>{date}{time ? ` · ${time}` : ''}</span>
          </div>
        </div>

        <div className="mvd-body">
          <button type="button" className="mvd-student" onClick={() => onOpenStudent(row.student_id)}>
            <Avatar name={row.student_name} size="sm" soft />
            <span className="mvd-student-main">
              <span className="mvd-student-name">{row.student_name}</span>
              <span className="mvd-student-go">Profili aç →</span>
            </span>
          </button>

          {row.kind === 'product_sale' && (
            <div className="mvd-items">
              <span className="mvd-section-label">Satılan ürünler</span>
              {saleQuery.isLoading ? (
                <div className="mvd-items-loading">
                  <span className="mv-sk-line" style={{ height: 14 }} />
                  <span className="mv-sk-line" style={{ height: 14, width: '70%' }} />
                </div>
              ) : saleQuery.isError ? (
                <div className="mvd-items-empty">Ürün detayı yüklenemedi.</div>
              ) : items.length === 0 ? (
                <div className="mvd-items-empty">Kalem detayı kaydedilmemiş.</div>
              ) : (
                <>
                  <ul className="mvd-item-list">
                    {visibleItems.map(it => (
                      <li className="mvd-item" key={it.id}>
                        <span className="mvd-item-thumb">
                          <Icon.Tag width="13" height="13" />
                          {it.image_url && (
                            <img
                              src={it.image_url}
                              alt=""
                              loading="lazy"
                              onError={e => { e.currentTarget.style.display = 'none'; }}
                            />
                          )}
                        </span>
                        <span className="mvd-item-name">{it.name_snapshot}</span>
                        <span className="mvd-item-qty">{it.quantity} × {fmtTL(money(it.unit_price_snapshot))}</span>
                        <span className="mvd-item-total">{fmtTL(money(it.line_total))}</span>
                      </li>
                    ))}
                  </ul>
                  {collapsible && (
                    <button
                      type="button"
                      className="mvd-items-toggle"
                      onClick={() => setShowAllItems(s => !s)}
                    >
                      {showAllItems ? 'Daha az göster' : `Tümünü göster · +${items.length - ITEMS_PREVIEW}`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {fields.length > 0 && (
            <dl className="mvd-dl">
              {fields.map((f, i) => (
                <div className="mvd-dl-row" key={i}>
                  <dt className="mvd-dt">{f.label}</dt>
                  <dd className={'mvd-dd' + (f.tone === 'warn' ? ' mvd-dd-warn' : f.tone === 'paid' ? ' mvd-dd-paid' : '')}>
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {d.note?.trim() && (
            <div className="mvd-note">
              <span className="mvd-note-label">Not</span>
              {d.note.trim()}
            </div>
          )}
        </div>

        {(canCollect || collectError) && (
          <div className="mvd-actions">
            {collectError && <div className="mvd-error">{collectError}</div>}
            {canCollect && (
              <button type="button" className="btn btn-accent btn-block" onClick={onCollect} disabled={collecting}>
                {collecting ? 'Yükleniyor…' : `Tahsilat al · ${fmtTL(remaining)}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonRows() {
  return Array.from({ length: 8 }).map((_, i) => (
    <tr className="mv-sk-tr" key={i}>
      <td className="mv-td-date"><span className="mv-sk-line" style={{ width: 84 }} /></td>
      <td><span className="mv-sk-line" style={{ width: 120 }} /></td>
      <td><span className="mv-sk-line" style={{ width: 220 }} /></td>
      <td><span className="mv-sk-pill" /></td>
      <td className="mv-td-amount"><span className="mv-sk-line" style={{ width: 72 }} /></td>
    </tr>
  ));
}

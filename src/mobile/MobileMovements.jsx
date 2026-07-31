// Hareketler — mobil. Menü → Hareketler ile açılır. Stüdyo geneli satış/ders/
// tahsilat akışı; karta dokununca alttan açılan bir detay sheet'i gösterilir
// (profile gitme + borçluysa tahsilat). Gösterim mantığı web ile ortak
// (../movements export'ları). Backend: GET /movements.

import React from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Drawer } from 'vaul';
import { Icon, Avatar } from '../layout';
import { fmtTL } from '../data';
import { getMovements, getProductSale, deletePayment, deleteProductSale } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import {
  money,
  fmtDateParts,
  bucketByDate,
  describeMovement,
  detailFields,
  KIND_TITLE,
  DATE_PRESETS,
  presetFrom,
  TYPE_FILTERS,
} from '../movements';

const PAGE_SIZE = 50;

function getMobilePaletteRoot() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('mobile-palette-root');
}

export function MobileMovements({ onOpenStudent, onOpenPayment, onDeleted }) {
  const [type, setType] = React.useState('all');
  const [datePreset, setDatePreset] = React.useState('month');
  const [search, setSearch] = React.useState('');
  const [debouncedQ, setDebouncedQ] = React.useState('');
  const [detailRow, setDetailRow] = React.useState(null);
  const [dateSheetOpen, setDateSheetOpen] = React.useState(false);

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

  return (
    <div className="mobile-mv-page">
      <div className="mobile-mv-topbar">
        <div className="mobile-mv-search">
          <Icon.Search width="16" height="16" />
          <input
            type="search"
            placeholder="Öğrenci ara…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="mobile-mv-search-clear"
              onClick={() => setSearch('')}
              aria-label="Aramayı temizle"
            >×</button>
          )}
        </div>
        <button
          type="button"
          className="mobile-mv-datebtn"
          onClick={() => setDateSheetOpen(true)}
          aria-label="Tarih aralığı"
        >
          {DATE_PRESETS.find(p => p.id === datePreset)?.label ?? 'Tarih'}
          <Icon.ChevronDown width="14" height="14" />
        </button>
      </div>

      <div className="mobile-mv-chips">
        {TYPE_FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            className={'mobile-mv-chip' + (type === f.id ? ' is-active' : '')}
            onClick={() => setType(f.id)}
          >
            {f.label}
            {typeCounts[f.id] != null && <span className="mobile-mv-chip-n">{typeCounts[f.id]}</span>}
          </button>
        ))}
      </div>

      {query.isError ? (
        <div className="mobile-mv-state mobile-mv-state-error">Hareketler yüklenemedi.</div>
      ) : query.isLoading ? (
        <MobileMvSkeleton />
      ) : rows.length === 0 ? (
        <div className="mobile-mv-state">
          <div className="mobile-mv-state-title">
            {debouncedQ ? `"${debouncedQ}" için hareket yok` : 'Bu aralıkta hareket yok'}
          </div>
          <div className="mobile-mv-state-sub">Tarih aralığını değiştirmeyi dene.</div>
        </div>
      ) : (
        <div className={'mobile-mv-list' + (dimming ? ' is-fetching' : '')}>
          {groups.map(g => (
            <div className="mobile-mv-group" key={g.key}>
              <div className="mobile-mv-group-head">{g.label}</div>
              {g.items.map(r => (
                <MobileMvItem key={r.id} row={r} onSelect={setDetailRow} />
              ))}
            </div>
          ))}
          {query.hasNextPage && (
            <button
              type="button"
              className="mobile-mv-more"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? 'Yükleniyor…' : 'Daha fazla göster'}
            </button>
          )}
        </div>
      )}

      <MobileDateSheet
        open={dateSheetOpen}
        value={datePreset}
        onPick={(id) => { setDatePreset(id); setDateSheetOpen(false); }}
        onClose={() => setDateSheetOpen(false)}
      />

      <MobileMovementDetailSheet
        row={detailRow}
        onClose={() => setDetailRow(null)}
        onOpenStudent={(id) => { setDetailRow(null); onOpenStudent(String(id)); }}
        onOpenPayment={(student) => { setDetailRow(null); onOpenPayment(student); }}
        onDeleted={(kind, saleId) => { setDetailRow(null); onDeleted?.(kind, saleId); }}
      />
    </div>
  );
}

function MobileDateSheet({ open, value, onPick, onClose }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      shouldScaleBackground={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-mvd-overlay" />
        <Drawer.Content className="mobile-mvds-content">
          <Drawer.Handle className="mobile-mvd-handle" />
          <Drawer.Title className="mobile-mvds-title">Tarih aralığı</Drawer.Title>
          <div className="mobile-mvds-list">
            {DATE_PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                className={'mobile-mvds-opt' + (value === p.id ? ' is-active' : '')}
                onClick={() => onPick(p.id)}
              >
                {p.label}
                {value === p.id && <Icon.Check width="18" height="18" />}
              </button>
            ))}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function MobileMvItem({ row, onSelect }) {
  const m = describeMovement(row);
  const { date, time } = fmtDateParts(row.occurred_at);
  return (
    <button type="button" className="mobile-mv-item" onClick={() => onSelect(row)}>
      <span className={'mobile-mv-dot mobile-mv-dot-' + m.tag} aria-hidden="true" />
      <span className="mobile-mv-item-main">
        <span className="mobile-mv-item-top">
          <span className="mobile-mv-item-name">{row.student_name}</span>
          {m.amount != null && (
            <span className={'mobile-mv-item-amount' + (m.amountPositive ? ' is-pos' : '')}>
              {m.amountPositive ? '+' : ''}{fmtTL(m.amount)}
            </span>
          )}
        </span>
        <span className="mobile-mv-item-bottom">
          <span className="mobile-mv-item-meta">
            {date}{time ? ` ${time}` : ''} · {m.tagLabel}
          </span>
          {m.status && (
            <span className={'sp-badge sp-badge-tone-' + m.status.tone}>{m.status.label}</span>
          )}
        </span>
      </span>
    </button>
  );
}

function MobileMvSkeleton() {
  return (
    <div className="mobile-mv-list" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <div className="mobile-mv-item mobile-mv-sk" key={i}>
          <span className="mobile-mv-dot mobile-mv-sk-box" />
          <span className="mobile-mv-item-main">
            <span className="mobile-mv-sk-line" style={{ width: '55%' }} />
            <span className="mobile-mv-sk-line" style={{ width: '78%', height: 11 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function MobileMovementDetailSheet({ row, onClose, onOpenStudent, onOpenPayment, onDeleted }) {
  const portalContainer = React.useMemo(getMobilePaletteRoot, []);
  return (
    <Drawer.Root
      open={!!row}
      onOpenChange={(o) => { if (!o) onClose(); }}
      shouldScaleBackground={false}
    >
      <Drawer.Portal container={portalContainer || undefined}>
        <Drawer.Overlay className="mobile-mvd-overlay" />
        <Drawer.Content className="mobile-mvd-content">
          <Drawer.Handle className="mobile-mvd-handle" />
          {row ? (
            <MobileMovementDetailBody
              row={row}
              onOpenStudent={onOpenStudent}
              onOpenPayment={onOpenPayment}
              onDeleted={onDeleted}
            />
          ) : (
            <Drawer.Title className="mobile-mvd-sronly">İşlem detayı</Drawer.Title>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function MobileMovementDetailBody({ row, onOpenStudent, onOpenPayment, onDeleted }) {
  const m = describeMovement(row);
  const d = row.details || {};
  const { date, time } = fmtDateParts(row.occurred_at);
  const prepaid = d.prepaid_package_id != null;
  const remaining = money(d.remaining_receivable);
  const canCollect =
    (row.kind === 'product_sale' || row.kind === 'lesson_completed') && !prepaid && remaining > 0.01;
  const fields = detailFields(row);

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
  const [showAllItems, setShowAllItems] = React.useState(false);
  const collapsible = items.length > 5;
  const visibleItems = collapsible && !showAllItems ? items.slice(0, 4) : items;

  // Düzeltme (silme): web movements.jsx ile aynı guard'lar.
  // Ödeme: pakete bağlı olmayan tahsilatlar. Satış: yalnız tahsil edilmemiş
  // (ödenmişse backend 409 → butonu gizle). confirm: null | 'payment' | 'sale'.
  const canDeletePayment =
    row.kind === 'payment' && d.target !== 'package' &&
    typeof row.id === 'string' && row.id.startsWith('pay-');
  const paymentId = canDeletePayment ? row.id.slice(4) : null;
  const canDeleteSale = row.kind === 'product_sale' && !!saleId && money(d.paid_amount) < 0.01;

  const [confirm, setConfirm] = React.useState(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState(null);

  async function handleDeletePayment() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePayment(paymentId);
      onDeleted?.('payment');
    } catch (e) {
      setDeleteError(e?.message || 'Ödeme silinemedi.');
      setDeleting(false);
    }
  }

  async function handleDeleteSale() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProductSale(saleId);
      onDeleted?.('sale', saleId);
    } catch (e) {
      setDeleteError(e?.message || 'Ürün satışı silinemedi.');
      setDeleting(false);
    }
  }

  return (
    <div className="mobile-mvd-body">
      <header className="mobile-mvd-head">
        <Drawer.Title className="mobile-mvd-type">
          <span className={'mobile-mv-dot mobile-mv-dot-' + m.tag} aria-hidden="true" />
          {KIND_TITLE[row.kind] || m.tagLabel}
        </Drawer.Title>
        {m.amount != null ? (
          <div className={'mobile-mvd-amount' + (m.amountPositive ? ' is-pos' : '')}>
            {m.amountPositive ? '+' : ''}{fmtTL(m.amount)}
          </div>
        ) : prepaid ? (
          <div className="mobile-mvd-amount-none">Paket kredisinden</div>
        ) : null}
        <div className="mobile-mvd-meta">
          {m.status && <span className={'sp-badge sp-badge-tone-' + m.status.tone}>{m.status.label}</span>}
          <span>{date}{time ? ` · ${time}` : ''}</span>
        </div>
      </header>

      <button type="button" className="mobile-mvd-student" onClick={() => onOpenStudent(row.student_id)}>
        <Avatar name={row.student_name} size="sm" soft />
        <span className="mobile-mvd-student-main">
          <span className="mobile-mvd-student-name">{row.student_name}</span>
          <span className="mobile-mvd-student-go">Profili aç →</span>
        </span>
        <Icon.ChevronR width="18" height="18" />
      </button>

      {row.kind === 'product_sale' && (
        <div className="mobile-mvd-items">
          <span className="mobile-mvd-section">Satılan ürünler</span>
          {saleQuery.isLoading ? (
            <div className="mobile-mvd-item-empty">Yükleniyor…</div>
          ) : saleQuery.isError ? (
            <div className="mobile-mvd-item-empty">Ürün detayı yüklenemedi.</div>
          ) : items.length === 0 ? (
            <div className="mobile-mvd-item-empty">Kalem detayı kaydedilmemiş.</div>
          ) : (
            <>
              <ul className="mobile-mvd-item-list">
                {visibleItems.map(it => (
                  <li className="mobile-mvd-item" key={it.id}>
                    <span className="mobile-mvd-thumb">
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
                    <span className="mobile-mvd-item-name">{it.name_snapshot}</span>
                    <span className="mobile-mvd-item-qty">{it.quantity} × {fmtTL(money(it.unit_price_snapshot))}</span>
                    <span className="mobile-mvd-item-total">{fmtTL(money(it.line_total))}</span>
                  </li>
                ))}
              </ul>
              {collapsible && (
                <button
                  type="button"
                  className="mobile-mvd-items-toggle"
                  onClick={() => setShowAllItems(s => !s)}
                >
                  {showAllItems ? 'Daha az göster' : `Tümünü göster · +${items.length - 4}`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {fields.length > 0 && (
        <dl className="mobile-mvd-dl">
          {fields.map((f, i) => (
            <div className="mobile-mvd-dl-row" key={i}>
              <dt>{f.label}</dt>
              <dd className={f.tone === 'warn' ? 'is-warn' : f.tone === 'paid' ? 'is-paid' : ''}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {d.note?.trim() && (
        <div className="mobile-mvd-note">
          <span className="mobile-mvd-note-label">Not</span>
          {d.note.trim()}
        </div>
      )}

      {canCollect && (
        <button
          type="button"
          className="mobile-mvd-collect"
          onClick={() => onOpenPayment({ id: row.student_id, full_name: row.student_name })}
        >
          Tahsilat al · {fmtTL(remaining)}
        </button>
      )}

      {(canDeletePayment || canDeleteSale) && confirm === null && (
        <button
          type="button"
          className="mobile-mvd-danger"
          onClick={() => setConfirm(canDeletePayment ? 'payment' : 'sale')}
        >
          {canDeletePayment ? 'Bu tahsilatı sil' : 'Bu satışı sil'}
        </button>
      )}

      {confirm !== null && (
        <div className="mobile-mvd-del-confirm">
          <p className="mobile-mvd-del-warn">
            {confirm === 'payment'
              ? 'Bu tahsilat kaydı geri alınacak. Öğrencinin borcu bu tutar kadar yeniden açılır. Nakit iadesi gerekiyorsa elden yapılır. Sonra doğru tutarı yeni bir tahsilat olarak girebilirsiniz.'
              : 'Bu ürün satışı geri alınacak. Öğrencinin borcu düşer ve stok takibi açıksa düşülen stok iade edilir. Yanlış öğrenci/ürün girildiyse silip yeniden ekleyin.'}
          </p>
          {deleteError && <div className="mobile-mvd-error" role="alert">{deleteError}</div>}
          <div className="mobile-mvd-del-actions">
            <button
              type="button"
              className="mobile-mvd-del-ghost"
              onClick={() => { setConfirm(null); setDeleteError(null); }}
              disabled={deleting}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="mobile-mvd-del-danger"
              onClick={confirm === 'payment' ? handleDeletePayment : handleDeleteSale}
              disabled={deleting}
            >
              {deleting ? 'Siliniyor…' : 'Evet, sil'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

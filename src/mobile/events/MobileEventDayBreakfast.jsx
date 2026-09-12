import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { fmtTL } from '../../data';
import {
  createEventDayEntry,
  deleteEventDayEntry,
  getEventDay,
  restoreEventDayEntry,
  updateEventDayEntry,
} from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { EventDayEntrySheet } from './EventDayEntrySheet';
import { EventEntryRow } from './EventEntryRow';
import {
  BREAKFAST_SHORT_LABEL,
  PAYMENT_METHOD_LABEL,
  foldTr,
  toNumber,
} from './eventDayUtils';

// Kahvaltı listesi ekranı (bkz. MobileEventDay.jsx'teki Kahvaltı kartı,
// migration 0286). Etkinlik günü ana listesindeki "Kahvaltı" kartına
// dokununca buraya gelinir — aynı getEventDay verisini (aynı sorgu anahtarı)
// okur, ayrı bir uç gerekmez. İki tür satırı birleştirir: derse gelip
// kahvaltı da seçen katılımcılar + hiç derse katılmayan, öğrenci olmayan
// "sadece kahvaltı" misafirleri (bu ekrandan eklenir). İkincisi ana kapı
// listesinde (MobileEventDay) GÖRÜNMEZ, yalnız burada.

const REFRESH_MS = 5000;

const FILTERS = [
  { id: 'all', label: 'Tümü', test: () => true },
  { id: 'unchecked', label: 'Kontrol edilmedi', test: (entry) => !entry.checked_at },
  { id: 'bf_us', label: 'Bize ödedi', test: (entry) => entry.breakfast === 'paid_to_us' },
  {
    id: 'bf_restaurant',
    label: 'Restoranda',
    test: (entry) => entry.breakfast === 'paid_to_restaurant' && Boolean(entry.breakfast_confirmed_at),
  },
  {
    id: 'bf_restaurant_pending',
    label: 'Fiş bekliyor',
    test: (entry) => entry.breakfast === 'paid_to_restaurant' && !entry.breakfast_confirmed_at,
  },
  { id: 'bf_free', label: 'Stüdyo öder', test: (entry) => entry.breakfast === 'free' },
  { id: 'guests', label: 'Sadece misafir', test: (entry) => entry.breakfast_only },
];

function matchesQuery(entry, query) {
  if (!query) return true;
  if (foldTr(entry.full_name).includes(foldTr(query))) return true;
  const digits = query.replace(/\D/g, '');
  if (digits.length < 2) return false;
  // Kayıtlı öğrencinin telefonu serbest metin olarak saklanabilir (örn.
  // "0532 111 22 33") — sunucudaki arama gibi burada da karşılaştırmadan
  // önce rakam dışı karakterler atılır, yoksa biçimli numaralar bulunamaz.
  const phoneDigits = String(entry.phone ?? '').replace(/\D/g, '');
  return Boolean(phoneDigits) && phoneDigits.includes(digits);
}

function BreakfastEntryRow({ entry, onOpen, onToggle, tickBusy }) {
  const amount = toNumber(entry.amount);
  const parts = [amount > 0 ? `${fmtTL(amount)} · ${PAYMENT_METHOD_LABEL[entry.payment_method] ?? ''}` : 'Ücretsiz'];
  parts.push(BREAKFAST_SHORT_LABEL[entry.breakfast]);
  const breakfastPending = entry.breakfast === 'paid_to_restaurant' && !entry.breakfast_confirmed_at;

  return (
    <EventEntryRow
      entry={entry}
      onOpen={onOpen}
      onToggle={onToggle}
      tickBusy={tickBusy}
      subtitle={parts.join(' · ')}
      titleExtra={(
        <>
          {entry.breakfast_only ? (
            <span className="evx-badge tone-guest evx-badge-sm">MİSAFİR</span>
          ) : (
            entry.is_light && <span className="evx-badge tone-new-student evx-badge-sm">YENİ</span>
          )}
          {breakfastPending && <span className="evx-badge tone-amber evx-badge-sm">FİŞ BEKLİYOR</span>}
        </>
      )}
    />
  );
}

export function MobileEventDayBreakfast({ eventId, onBack }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = React.useState('');
  const trimmedQuery = query.trim();
  const [filter, setFilter] = React.useState('all');
  const [sheet, setSheet] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [sheetError, setSheetError] = React.useState('');
  const [notice, setNotice] = React.useState(null);
  const [tickBusyId, setTickBusyId] = React.useState(null);

  // Aynı sorgu anahtarı MobileEventDay ile paylaşılır — burada yapılan bir
  // ekleme/düzenleme kapı ekranına dönüldüğünde de güncel görünür.
  const dayKey = queryKeys.eventDay(eventId);
  const dayQuery = useQuery({
    queryKey: dayKey,
    queryFn: () => getEventDay(eventId),
    enabled: Boolean(eventId),
    refetchInterval: REFRESH_MS,
  });

  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), notice.undoEntryId ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const data = dayQuery.data;
  const entries = data?.entries ?? [];
  const summary = data?.summary;
  const pricing = data?.pricing;
  const hasBreakfast = pricing?.breakfastFee != null;
  const breakfastEntries = entries.filter((entry) => entry.breakfast !== 'none');
  const breakfastPendingCount = entries.filter(
    (entry) => entry.breakfast === 'paid_to_restaurant' && !entry.breakfast_confirmed_at,
  ).length;
  const breakfastRestaurantConfirmed = summary
    ? Math.max(0, summary.breakfastPaidToRestaurant - breakfastPendingCount)
    : 0;
  // bkz. MobileEventDay.jsx — borca giren kişi sayısı = "Bize ödedi" +
  // "Stüdyo öder" ("Restoranda" ve "Fiş bekliyor" kendi parasını doğrudan
  // restorana ödediği için borca girmez).
  const breakfastOwedCount = summary ? summary.breakfastPaidToUs + summary.breakfastFree : 0;
  const activeFilter = FILTERS.find((item) => item.id === filter) ?? FILTERS[0];
  const visibleEntries = breakfastEntries.filter(activeFilter.test).filter((entry) => matchesQuery(entry, trimmedQuery));

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: dayKey });
  }

  function openEdit(entry) {
    setSheetError('');
    setSheet({ mode: 'edit', entry });
  }

  function openAddGuest() {
    setSheetError('');
    setSheet({ mode: 'breakfastOnly', name: '', phone: '' });
  }

  function closeSheet() {
    if (busy) return;
    setSheet(null);
    setSheetError('');
  }

  async function submitSheet(payload) {
    const current = sheet;
    if (!current || busy) return;
    setBusy(true);
    setSheetError('');
    try {
      const saved = current.mode === 'edit'
        ? await updateEventDayEntry(current.entry.id, payload)
        : await createEventDayEntry(eventId, payload);
      setSheet(null);
      setNotice({
        text: current.mode === 'edit'
          ? `${saved?.full_name ?? 'Kayıt'} güncellendi`
          : `${saved?.full_name ?? 'Misafir'} kahvaltı listesine eklendi`,
      });
      await refresh();
    } catch (err) {
      setSheetError(err?.message || 'Kayıt kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(entry) {
    if (busy) return;
    setBusy(true);
    setSheetError('');
    try {
      await deleteEventDayEntry(entry.id);
      setSheet(null);
      setNotice({ text: `${entry.full_name} silindi`, undoEntryId: entry.id });
      await refresh();
    } catch (err) {
      setSheetError(err?.message || 'Kayıt silinemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function undoDelete() {
    const entryId = notice?.undoEntryId;
    if (!entryId) return;
    setNotice(null);
    try {
      await restoreEventDayEntry(entryId);
      setNotice({ text: 'Kayıt geri getirildi' });
      await refresh();
    } catch (err) {
      setNotice({ text: err?.message || 'Kayıt geri getirilemedi.' });
    }
  }

  async function toggleChecked(entry) {
    const next = !entry.checked_at;
    setTickBusyId(entry.id);
    await queryClient.cancelQueries({ queryKey: dayKey });
    queryClient.setQueryData(dayKey, (old) => (old ? {
      ...old,
      entries: old.entries.map((item) => (item.id === entry.id
        ? { ...item, checked_at: next ? new Date().toISOString() : null }
        : item)),
      summary: { ...old.summary, checked: Math.max(0, old.summary.checked + (next ? 1 : -1)) },
    } : old));
    try {
      await updateEventDayEntry(entry.id, { checked: next });
    } catch (err) {
      setNotice({ text: err?.message || 'Kontrol işareti kaydedilemedi.' });
    } finally {
      setTickBusyId(null);
      refresh();
    }
  }

  const header = (
    <header className="evx-header">
      <button type="button" className="evx-header-btn" onClick={() => onBack()} title="Geri" aria-label="Geri">
        <Icon.ChevronL width="22" height="22" />
      </button>
      <div className="evx-header-mid">
        <span className="evx-header-title">Kahvaltı listesi</span>
        <span className="evx-header-sub">
          {data ? `${data.event.name} · ${summary.breakfastCount} kahvaltı` : 'Yükleniyor…'}
        </span>
      </div>
      {dayQuery.isError && data && <span className="evd-offline" role="status">Bağlantı sorunu</span>}
    </header>
  );

  if (!data) {
    return (
      <div className="evx evd">
        {header}
        <div className="evx-body">
          {dayQuery.isError ? (
            <div className="evx-empty" role="alert">
              <span className="evx-empty-title">Kahvaltı listesi açılamadı</span>
              <span className="evx-empty-sub">{dayQuery.error?.message || 'Bağlantıyı kontrol edip yeniden deneyin.'}</span>
              <button
                type="button"
                className="evx-btn-secondary"
                onClick={() => dayQuery.refetch()}
                disabled={dayQuery.isFetching}
              >
                {dayQuery.isFetching ? 'Deneniyor…' : 'Yeniden dene'}
              </button>
            </div>
          ) : (
            <p className="evx-hint">Yükleniyor…</p>
          )}
        </div>
      </div>
    );
  }

  if (!hasBreakfast) {
    return (
      <div className="evx evd">
        {header}
        <div className="evx-body">
          <div className="evx-empty">
            <Icon.Users width="28" height="28" />
            <span className="evx-empty-title">Bu etkinlikte kahvaltı kalemi tanımlı değil</span>
          </div>
        </div>
      </div>
    );
  }

  // Misafir ekle/kayıt düzenle tam sayfa açılır (pop-up değil) — kahvaltı
  // listesinin yerini alır, "geri" onu kapatıp listeye döner.
  if (sheet) {
    return (
      <EventDayEntrySheet
        eventId={eventId}
        target={sheet}
        pricing={pricing}
        busy={busy}
        error={sheetError}
        onClose={closeSheet}
        onSubmit={submitSheet}
        onDelete={deleteEntry}
      />
    );
  }

  return (
    <div className="evx evd">
      {header}

      <div className="evx-body evd-body">
        <div className="evd-summary">
          <section className="evd-card" aria-label="Kahvaltı özeti">
            <span className="evd-card-label">Kahvaltı</span>
            <span className="evd-card-big">{summary.breakfastCount - breakfastPendingCount} fiş verildi</span>
            {breakfastPendingCount > 0 && (
              <span className="evd-card-sub">{breakfastPendingCount} fiş bekliyor</span>
            )}
            <div className="evd-stats">
              <div className="evd-stat"><span>Bize ödedi</span><strong>{summary.breakfastPaidToUs}</strong></div>
              <div className="evd-stat"><span>Restoranda</span><strong>{breakfastRestaurantConfirmed}</strong></div>
              <div className="evd-stat"><span>Stüdyo öder</span><strong>{summary.breakfastFree}</strong></div>
              {summary.breakfastPaidToRestaurant > 0 && (
                <div className={`evd-stat${breakfastPendingCount > 0 ? ' tone-amber' : ''}`}>
                  <span>Fiş bekliyor</span><strong>{breakfastPendingCount}</strong>
                </div>
              )}
            </div>
            <span className="evd-card-foot">
              Restorana borç: <strong>{fmtTL(toNumber(summary.restaurantOwed))}</strong>
              {' '}· {breakfastOwedCount} kişi
            </span>
          </section>
        </div>

        <div className="evd-search">
          <div className="evd-search-box">
            <Icon.Search width="18" height="18" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Listede ara — isim ya da telefon"
              aria-label="Kahvaltı listesinde ara"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
            />
            {query && (
              <button type="button" className="evd-search-clear" onClick={() => setQuery('')} aria-label="Aramayı temizle">
                ×
              </button>
            )}
          </div>
        </div>

        {breakfastEntries.length > 0 && (
          <div className="evx-scroller evd-filters">
            {FILTERS.map((item) => {
              const count = breakfastEntries.filter(item.test).length;
              if (item.id !== 'all' && item.id !== filter && count === 0) return null;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`evx-filter-chip${filter === item.id ? ' is-on' : ''}`}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label} · {count}
                </button>
              );
            })}
          </div>
        )}

        {breakfastEntries.length === 0 ? (
          <div className="evx-empty">
            <Icon.Users width="28" height="28" />
            <span className="evx-empty-title">Henüz kahvaltı alan kimse yok</span>
            <span className="evx-empty-sub">
              Derse gelip kahvaltı seçenler kapı ekranından eklendikçe burada görünür; öğrenci olmayan bir misafiri
              aşağıdan doğrudan ekleyebilirsiniz.
            </span>
          </div>
        ) : visibleEntries.length === 0 ? (
          <p className="evx-hint">Bu süzgeçte kimse yok.</p>
        ) : (
          <ul className="evd-list">
            {visibleEntries.map((entry) => (
              <BreakfastEntryRow
                key={entry.id}
                entry={entry}
                onOpen={openEdit}
                onToggle={toggleChecked}
                tickBusy={tickBusyId === entry.id}
              />
            ))}
          </ul>
        )}
      </div>

      {notice && (
        <div className="evd-notice" role="status">
          <span>{notice.text}</span>
          {notice.undoEntryId && <button type="button" onClick={undoDelete}>Geri al</button>}
        </div>
      )}

      <footer className="evx-footer">
        <button type="button" className="evx-btn-primary" onClick={openAddGuest}>
          <Icon.Plus width="17" height="17" aria-hidden="true" /> Misafir ekle
        </button>
      </footer>
    </div>
  );
}

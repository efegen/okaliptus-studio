import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../layout';
import { fmtTL } from '../../data';
import {
  createEventDayEntry,
  deleteEventDayEntry,
  getEventDay,
  restoreEventDayEntry,
  searchEventDay,
  updateEventDayEntry,
} from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { EventDayEntrySheet } from './EventDayEntrySheet';
import { EventEntryRow } from './EventEntryRow';
import {
  BREAKFAST_SHORT_LABEL,
  PAYMENT_METHOD_LABEL,
  formatPhoneDisplay,
  isPhoneQuery,
  phoneDigitsFromInput,
  toNumber,
} from './eventDayUtils';

// Etkinlik günü ekranı (spec §11 "Etkinlik günü ekranı", migration 0284).
// Kapıda tek ekran: üstte özet (kasa, kahvaltı, kontrol), yapışkan arama
// kutusu, altında bugünkü liste. Arama yazılınca liste yerine sonuçlar gelir;
// kayıtlı öğrenci seçilir ya da "yeni kişi" hafif kayıt olarak eklenir. Eski
// katılımcı/ücret/tahsilat modülünü kullanmaz; ön ücretler burada görünmez.
// Tutarlar her zaman düzenlenebilir, kilit yok — satırdaki "ödeme OK" tiki
// tek dokunuşla açılıp kapanır. Liste 5 sn'de bir yenilenir (birden fazla
// telefon aynı anda yazabilir).

const REFRESH_MS = 5000;

const FILTERS = [
  { id: 'all', label: 'Tümü', test: () => true },
  { id: 'unchecked', label: 'Kontrol edilmedi', test: (entry) => !entry.checked_at },
  { id: 'cash', label: 'Nakit', test: (entry) => entry.payment_method === 'cash' },
  { id: 'card', label: 'Kart', test: (entry) => entry.payment_method === 'card' },
  { id: 'iban', label: 'IBAN', test: (entry) => entry.payment_method === 'iban' },
  { id: 'free_entry', label: 'Ücretsiz', test: (entry) => toNumber(entry.amount) === 0 },
  { id: 'bf_any', label: 'Kahvaltı', test: (entry) => entry.breakfast !== 'none' },
  { id: 'bf_us', label: 'Kahvaltı · bize', test: (entry) => entry.breakfast === 'paid_to_us' },
  {
    id: 'bf_restaurant',
    label: 'Kahvaltı · restoranda',
    // Yalnız fişi onaylanmış (restoran fişini getirip göstermiş) olanlar —
    // onaysızlar 'bf_restaurant_pending' kümesinde, ikisi ayrık.
    test: (entry) => entry.breakfast === 'paid_to_restaurant' && Boolean(entry.breakfast_confirmed_at),
  },
  {
    id: 'bf_restaurant_pending',
    label: 'Kahvaltı fişi bekliyor',
    // "Restorana kendi öder" kayıt anında kahvaltı verildi demek değildir —
    // fişini getirip gösterene kadar bekler (bkz. EventDayEntrySheet). Bu
    // yüzden 'bf_restaurant' ile bu ikisi ayrık kümedir: biri onaylı, öbürü
    // bekleyen — aynı kişi ikisinde birden görünmez.
    test: (entry) => entry.breakfast === 'paid_to_restaurant' && !entry.breakfast_confirmed_at,
  },
  { id: 'bf_free', label: 'Kahvaltı · stüdyo öder', test: (entry) => entry.breakfast === 'free' },
];

function initialsOf(name) {
  return (name || '?').split(' ').filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

// Kasa özet rakamlarına dokunmak listeyi o gruba süzer; aynı rakama ikinci
// dokunuş süzgeci kaldırır. Kahvaltı kartının tamamı artık ayrı "Kahvaltı
// listesi" sayfasına gider (bkz. MobileEventDayBreakfast) — bu sayfaya dahil
// olmayan sadece-kahvaltı misafirleri de orada gösterildiği için kart içi
// alt-sayaçlar burada süzgeç değil, düz bilgi.
function SummaryCards({ summary, hasBreakfast, breakfastPendingCount, filter, onFilter, onOpenBreakfast }) {
  const pick = (id) => onFilter(filter === id ? 'all' : id);
  const stat = (id, label, value, tone) => (
    <button
      type="button"
      className={`evd-stat${filter === id ? ' is-on' : ''}${tone ? ` tone-${tone}` : ''}`}
      aria-pressed={filter === id}
      onClick={() => pick(id)}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
  const plainStat = (label, value, tone) => (
    <div className={`evd-stat${tone ? ` tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
  const pending = Math.max(0, summary.people - summary.checked);
  const percent = summary.people ? Math.round((summary.checked / summary.people) * 100) : 0;
  // "Restoranda" yalnız fişi teslim edilmiş (onaylı) kişileri sayar — fişini
  // henüz getirmeyenler "Fiş bekliyor" içinde. Böylece dört satır (bize
  // ödedi / restoranda / stüdyo öder / fiş bekliyor) ayrık kümelerdir ve
  // toplamları kart başlığındaki toplam kahvaltı sayısına eşittir; biri
  // onaylanınca "restoranda"ya geçer, "fiş bekliyor"dan düşer.
  const breakfastRestaurantConfirmed = Math.max(0, summary.breakfastPaidToRestaurant - breakfastPendingCount);
  // Restorana borç yalnız burada, tek bir yerde gösterilir (Kasa kartında
  // ayrı bir "restoran payı" satırı YOK artık — iki kart aynı şeyi farklı
  // cümlelerle söylüyordu, kafa karıştırıyordu). Borcu oluşturan kişi sayısı
  // = "Bize ödedi" + "Stüdyo öder" (ikisi de restorana ödenmesi gereken
  // kahvaltı — "Restoranda" ve "Fiş bekliyor" kendi parasını doğrudan
  // restorana ödediği için borca girmez).
  const breakfastOwedCount = summary.breakfastPaidToUs + summary.breakfastFree;

  return (
    <div className="evd-summary">
      <div className="evd-cards">
        <section className="evd-card" aria-label="Kasa">
          <span className="evd-card-label">Kasa</span>
          <span className="evd-card-big">{fmtTL(toNumber(summary.total))}</span>
          <div className="evd-stats">
            {stat('cash', 'Nakit', fmtTL(toNumber(summary.cash)))}
            {stat('card', 'Kart', fmtTL(toNumber(summary.card)))}
            {stat('iban', 'IBAN', fmtTL(toNumber(summary.iban)))}
          </div>
        </section>
        {hasBreakfast && (
          <section className="evd-card" aria-label="Kahvaltı">
            <button
              type="button"
              className="evd-card-head"
              onClick={onOpenBreakfast}
              aria-label="Kahvaltı listesini aç"
            >
              <span className="evd-card-label">Kahvaltı</span>
              <span className="evd-card-big">{summary.breakfastCount - breakfastPendingCount} fiş verildi</span>
              {breakfastPendingCount > 0 && (
                <span className="evd-card-sub">{breakfastPendingCount} fiş bekliyor</span>
              )}
            </button>
            <div className="evd-stats">
              {plainStat('Bize ödedi', summary.breakfastPaidToUs)}
              {plainStat('Restoranda', breakfastRestaurantConfirmed)}
              {plainStat('Stüdyo öder', summary.breakfastFree)}
              {summary.breakfastPaidToRestaurant > 0 && plainStat(
                'Fiş bekliyor',
                breakfastPendingCount,
                breakfastPendingCount > 0 ? 'amber' : undefined,
              )}
            </div>
            <button type="button" className="evd-card-foot evd-card-foot-link" onClick={onOpenBreakfast}>
              Restorana borç: <strong>{fmtTL(toNumber(summary.restaurantOwed))}</strong>
              {' '}· {breakfastOwedCount} kişi · Listeyi gör ›
            </button>
          </section>
        )}
      </div>
      <button
        type="button"
        className={`evd-progress${filter === 'unchecked' ? ' is-on' : ''}`}
        aria-pressed={filter === 'unchecked'}
        onClick={() => pick('unchecked')}
      >
        <span className="evd-progress-text">
          <strong>{summary.people}</strong> kişi · <strong>{summary.checked}</strong> kontrol edildi
          {pending > 0 && <span className="evd-progress-pending"> · {pending} bekliyor</span>}
        </span>
        <span className="evd-progress-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
      </button>
    </div>
  );
}

function SearchResults({ query, results, loading, failed, onPick, onNew }) {
  const phoneSearch = isPhoneQuery(query);
  return (
    <div className="evx-section">
      {failed && <p className="evx-hint" role="alert">Arama yapılamadı — bağlantıyı kontrol edin.</p>}
      {results.length > 0 && (
        <ul className="evx-group-list">
          {results.map((row) => {
            const listed = Boolean(row.entry_id);
            return (
              <li key={`${row.kind}:${row.student_id ?? ''}:${row.entry_id ?? ''}`}>
                <button
                  type="button"
                  className={`evx-row evd-result${listed ? ' is-listed' : ''}`}
                  onClick={() => onPick(row)}
                >
                  <span className="evx-avatar">{initialsOf(row.full_name)}</span>
                  <span className="evx-row-body">
                    <span className="evd-row-title">
                      <span className="evx-row-name">{row.full_name}</span>
                      {row.pre_registered && <span className="evx-badge tone-neutral evx-badge-sm">ÖN KAYITLI</span>}
                      {row.kind === 'entry' && <span className="evx-badge tone-new-student evx-badge-sm">YENİ</span>}
                    </span>
                    <span className="evx-row-sub">
                      {row.nickname ? `"${row.nickname}" · ` : ''}
                      {row.phone ? formatPhoneDisplay(row.phone) : 'Telefon yok'}
                    </span>
                  </span>
                  <span className={listed ? 'evd-listed' : 'evx-row-trail'}>{listed ? '✓ Listede' : 'Seç ›'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {results.length === 0 && loading && <p className="evx-hint">Aranıyor…</p>}
      {results.length === 0 && !loading && !failed && (
        <p className="evx-hint">{phoneSearch ? 'Bu numarayla kayıtlı kimse yok.' : 'Bu isimle kayıtlı kimse yok.'}</p>
      )}
      <button type="button" className="evx-row evd-new-person" onClick={() => onNew()}>
        <span className="evx-avatar evd-new-avatar" aria-hidden="true"><Icon.Plus width="17" height="17" /></span>
        <span className="evx-row-body">
          <span className="evx-row-name">
            {phoneSearch ? 'Bu numarayla yeni kişi ekle' : `"${query}" yeni kişi olarak ekle`}
          </span>
          <span className="evx-row-sub">Öğrenci listesine eklenmez, yalnız bu etkinlikte</span>
        </span>
        <span className="evx-row-chev" aria-hidden="true">›</span>
      </button>
    </div>
  );
}

function EntryRow({ entry, onOpen, onToggle, tickBusy }) {
  const amount = toNumber(entry.amount);
  const parts = [amount > 0 ? `${fmtTL(amount)} · ${PAYMENT_METHOD_LABEL[entry.payment_method] ?? ''}` : 'Ücretsiz'];
  if (entry.breakfast !== 'none') parts.push(BREAKFAST_SHORT_LABEL[entry.breakfast]);
  // "Restorana kendi öder" kayıt anında kahvaltı verildi demek değildir —
  // fişini getirip gösterene kadar listede göze çarpsın diye rozetlenir.
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
          {entry.is_light && <span className="evx-badge tone-new-student evx-badge-sm">YENİ</span>}
          {breakfastPending && <span className="evx-badge tone-amber evx-badge-sm">FİŞ BEKLİYOR</span>}
        </>
      )}
    />
  );
}

export function MobileEventDay({ eventId, onBack, onOpenParticipants, onOpenBreakfast }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = React.useState('');
  const trimmedQuery = query.trim();
  const deferredQuery = React.useDeferredValue(trimmedQuery);
  const [filter, setFilter] = React.useState('all');
  const [sheet, setSheet] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [sheetError, setSheetError] = React.useState('');
  const [notice, setNotice] = React.useState(null);
  const [tickBusyId, setTickBusyId] = React.useState(null);

  const dayKey = queryKeys.eventDay(eventId);
  const dayQuery = useQuery({
    queryKey: dayKey,
    queryFn: () => getEventDay(eventId),
    enabled: Boolean(eventId),
    refetchInterval: REFRESH_MS,
  });
  const searchQuery = useQuery({
    queryKey: queryKeys.eventDaySearch(eventId, deferredQuery),
    queryFn: () => searchEventDay(eventId, deferredQuery),
    enabled: Boolean(eventId) && deferredQuery.length > 0,
    staleTime: REFRESH_MS,
  });

  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), notice.undoEntryId ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const data = dayQuery.data;
  const entries = data?.entries ?? [];
  // Sadece kahvaltı misafirleri (bkz. migration 0286) bu kapı listesinde
  // görünmez — kendi "Kahvaltı listesi" sayfaları var. "N kişi" toplamı ve
  // kahvaltı özeti (summary, breakfastPendingCount) yine tüm satırları sayar.
  const doorEntries = entries.filter((entry) => !entry.breakfast_only);
  const summary = data?.summary;
  const pricing = data?.pricing;
  const hasBreakfast = pricing?.breakfastFee != null;
  const searching = trimmedQuery.length > 0;
  const activeFilter = FILTERS.find((item) => item.id === filter) ?? FILTERS[0];
  const visibleEntries = doorEntries.filter(activeFilter.test);
  const breakfastPendingCount = entries.filter(
    (entry) => entry.breakfast === 'paid_to_restaurant' && !entry.breakfast_confirmed_at,
  ).length;

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: dayKey });
  }

  function openEdit(entry) {
    setSheetError('');
    setSheet({ mode: 'edit', entry });
  }

  // Aramadan seçim: listede olan kişi (kayıtlı ya da hafif) mevcut satırıyla
  // açılır; olmayan kayıtlı öğrenci için yeni satır paneli açılır.
  function openResult(row) {
    if (row.entry_id) {
      const entry = entries.find((item) => String(item.id) === String(row.entry_id));
      if (entry) {
        openEdit(entry);
      } else {
        refresh();
        setNotice({ text: 'Liste yenileniyor, bir kez daha dokunun.' });
      }
      return;
    }
    setSheetError('');
    setSheet({ mode: 'student', student: row });
  }

  // Telefonla aranıp bulunamayan kişi eklenirken numara alana hazır gelir.
  function openNewPerson() {
    const phoneSearch = isPhoneQuery(trimmedQuery);
    setSheetError('');
    setSheet({
      mode: 'light',
      name: phoneSearch ? '' : trimmedQuery,
      phone: phoneSearch ? phoneDigitsFromInput(trimmedQuery) : '',
    });
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
      setQuery('');
      setNotice({
        text: current.mode === 'edit'
          ? `${saved?.full_name ?? 'Kayıt'} güncellendi`
          : `${saved?.full_name ?? 'Kişi'} listeye eklendi`,
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

  // Tik iyimser güncellenir (kalabalıkta anında görünsün), sonra sunucu
  // yanıtıyla liste tazelenir.
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
        <span className="evx-header-title">Etkinlik günü</span>
        <span className="evx-header-sub">{data ? `${data.event.name} · ${summary.people} kişi` : 'Yükleniyor…'}</span>
      </div>
      {dayQuery.isError && data && <span className="evd-offline" role="status">Bağlantı sorunu</span>}
      {onOpenParticipants && (
        <button
          type="button"
          className="evx-header-btn"
          onClick={onOpenParticipants}
          title="Ön kayıt listesi"
          aria-label="Ön kayıt listesi"
        >
          <Icon.Users width="20" height="20" />
        </button>
      )}
    </header>
  );

  if (!data) {
    return (
      <div className="evx evd">
        {header}
        <div className="evx-body">
          {dayQuery.isError ? (
            <div className="evx-empty" role="alert">
              <span className="evx-empty-title">Etkinlik günü açılamadı</span>
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

  // Kişi ekle/düzenle tam sayfa açılır (pop-up değil) — kapıdaki listenin
  // yerini alır, "geri" onu kapatıp listeye döner.
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
        onPickExisting={openResult}
      />
    );
  }

  return (
    <div className="evx evd">
      {header}

      <div className="evx-body evd-body">
        {!searching && (
          <SummaryCards
            summary={summary}
            hasBreakfast={hasBreakfast}
            breakfastPendingCount={breakfastPendingCount}
            filter={filter}
            onFilter={setFilter}
            onOpenBreakfast={onOpenBreakfast}
          />
        )}

        <div className="evd-search">
          <div className="evd-search-box">
            <Icon.Search width="18" height="18" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="İsim, telefon ya da son 4 hane"
              aria-label="Kişi ara"
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

        {searching ? (
          <SearchResults
            query={trimmedQuery}
            results={searchQuery.data ?? []}
            loading={searchQuery.isFetching}
            failed={searchQuery.isError}
            onPick={openResult}
            onNew={openNewPerson}
          />
        ) : (
          <>
            {doorEntries.length > 0 && (
              <div className="evx-scroller evd-filters">
                {FILTERS.map((item) => {
                  const count = doorEntries.filter(item.test).length;
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

            {doorEntries.length === 0 ? (
              <div className="evx-empty">
                <Icon.Users width="28" height="28" />
                <span className="evx-empty-title">Henüz kimse yazılmadı</span>
                <span className="evx-empty-sub">
                  Gelen kişiyi yukarıdan isim ya da telefonla arayın; bulunamazsa yeni kişi olarak ekleyin.
                </span>
              </div>
            ) : visibleEntries.length === 0 ? (
              <p className="evx-hint">Bu süzgeçte kimse yok.</p>
            ) : (
              <ul className="evd-list">
                {visibleEntries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onOpen={openEdit}
                    onToggle={toggleChecked}
                    tickBusy={tickBusyId === entry.id}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {notice && (
        <div className="evd-notice" role="status">
          <span>{notice.text}</span>
          {notice.undoEntryId && <button type="button" onClick={undoDelete}>Geri al</button>}
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MobileHomeView } from './home/MobileHomeView';
import { MobileAgenda } from './home/MobileAgenda';
import { useWeeklyKpi, parseNumericValue } from './shared/useWeeklyKpi';
import { useWeekLessons } from './shared/useWeekLessons';
import { getSettings, getTrendyolOrdersList, getNotes, markNotesSeen } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { can } from '../permissions';

const ORDERS_WINDOW_DAYS = 90;
const NOTES_REFRESH_MS = 30 * 1000;

// Not destesi oturum durumu — ana sayfa her açılışta yeniden bağlandığı için
// modül düzeyinde tutulur:
// - knownNoteIds: bu oturumdaki ilk başarılı yüklemede var olan notlar. Sonradan
//   gelen (bu kümede olmayan) not "YENİ" sayılır ve destenin en üstüne düşer.
// - locallySeenNoteIds: desteden çıkarılan notlar (+ cihazda bekleyenler, bkz.
//   PENDING_VIEWS_KEY). POST /notes/views sonucu ya da arka plan yenilemesi
//   yarışsa bile kart geri gelmesin (optimistic).
let knownNoteIds = null;
const locallySeenNoteIds = new Set();

// Desteden çıkarılıp sunucuya henüz ulaştığı doğrulanmamış görüldü kayıtları.
// Bellek yetmez: "Aç"tan hemen sonra uygulama yenilenirse (ör. PWA güncellemesi)
// istek yarıda kalır ya da hata sessizce yutulur, not da desteye geri döner.
// Bu yüzden cihazda saklanır, sunucu 204 dönene kadar her açılışta yeniden
// gönderilir ve o zamana kadar kart destede gösterilmez.
const PENDING_VIEWS_KEY = 'noteDeckPendingViews';
const MAX_PENDING_VIEWS = 50;

function readPendingViews() {
  try {
    const ids = JSON.parse(localStorage.getItem(PENDING_VIEWS_KEY) || '[]');
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
}

function writePendingViews(ids) {
  try {
    if (ids.length > 0) localStorage.setItem(PENDING_VIEWS_KEY, JSON.stringify(ids.slice(-MAX_PENDING_VIEWS)));
    else localStorage.removeItem(PENDING_VIEWS_KEY);
  } catch {
    // localStorage kapalı olabilir — yalnız bellekteki küme kalır.
  }
}

for (const id of readPendingViews()) locallySeenNoteIds.add(id);

function flushPendingViews(queryClient) {
  const ids = readPendingViews();
  if (ids.length === 0) return;
  markNotesSeen(ids)
    .then(() => {
      writePendingViews(readPendingViews().filter((id) => !ids.includes(id)));
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(), exact: true });
    })
    .catch(() => {
      // Kayıtlar cihazda kalır; bir sonraki açılışta/görüldü işaretinde tekrar denenir.
    });
}

// Deste: kullanıcının görmediği, başkasının yazdığı üst notlar. Yanıtlar kart
// açmaz, yalnız sayıyı artırır. Sıra: YENİ > bana etiketli > en yeni.
function buildDeckNotes(notes, meId) {
  if (!Array.isArray(notes)) return [];
  const replyCounts = new Map();
  for (const n of notes) {
    if (n.parent_note_id == null || n.deleted_at) continue;
    const key = String(n.parent_note_id);
    replyCounts.set(key, (replyCounts.get(key) ?? 0) + 1);
  }
  return notes
    .filter((n) => n.parent_note_id == null && !n.deleted_at)
    .filter((n) => String(n.author_user_id) !== meId)
    .filter((n) => !n.seen_by_me && !locallySeenNoteIds.has(String(n.id)))
    .map((n) => ({
      ...n,
      isNew: knownNoteIds != null && !knownNoteIds.has(String(n.id)),
      isForMe: (n.user_mentions || []).some((m) => String(m.userId) === meId),
      replyCount: replyCounts.get(String(n.id)) ?? 0,
    }))
    .sort((a, b) => (
      (Number(b.isNew) - Number(a.isNew))
      || (Number(b.isForMe) - Number(a.isForMe))
      || (new Date(b.created_at) - new Date(a.created_at))
    ));
}

function isUrgent(ms) {
  if (!ms) return false;
  const diff = ms - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

function getIstanbulToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find(p => p.type === 'year').value);
  const mo = Number(parts.find(p => p.type === 'month').value) - 1;
  const d = Number(parts.find(p => p.type === 'day').value);
  return new Date(y, mo, d, 0, 0, 0, 0);
}

function getWeekStart(date) {
  const dow = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - dow, 0, 0, 0, 0);
}

function formatDateLabel(date) {
  const weekday = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', weekday: 'long',
  }).format(date);
  const rest = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
  const wd = weekday.charAt(0).toLocaleUpperCase('tr-TR') + weekday.slice(1);
  return `${wd}, ${rest}`;
}

export function MobileHome({ user, onLogout, onOpenFinance, onOpenOccupancy, onOpenOrders, onOpenNotes }) {
  // Rol-bazlı görünürlük: asistan finansal kartları (hero + bekleyen tahsilat)
  // ve pazaryeri siparişlerini görmez. Doluluk kartı herkese açık kalır.
  const canSeeFinance = can(user?.role, 'finance.read');
  const canSeeOrders = can(user?.role, 'marketplace.manage');

  const { data: kpi, isLoading: kpiLoading } = useWeeklyKpi();
  const { data: studioSettings } = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
  });

  // Sipariş sorgusu — MobileOrders ile aynı query key → önbellek paylaşılır.
  // Asistanda /trendyol 403 döneceği için sorgu hiç çalıştırılmaz (enabled).
  const { data: ordersData } = useQuery({
    queryKey: ['trendyolOrders', null, null, ORDERS_WINDOW_DAYS],
    queryFn: () => getTrendyolOrdersList({ windowDays: ORDERS_WINDOW_DAYS }),
    staleTime: 30 * 1000,
    enabled: canSeeOrders,
  });
  const tabCounts = ordersData?.tabCounts ?? {};
  const ordersPending = (tabCounts.yeni ?? 0) + (tabCounts.isleme ?? 0);
  const ordersUrgent = React.useMemo(() => {
    if (!ordersData?.orders) return 0;
    return ordersData.orders.filter(
      o => (o.tab === 'yeni' || o.tab === 'isleme') && isUrgent(o.agreedDeliveryDate),
    ).length;
  }, [ordersData]);

  // Notlar stüdyo geneli, tüm roller görebildiği için burada rol kontrolü yok
  // (Siparişler'in aksine). Ana sayfa açıkken yeni not desteye düşsün diye
  // periyodik yenilenir (push/websocket yok); sekme arka plandayken durur.
  const queryClient = useQueryClient();
  const { data: notesData, isLoading: notesLoading } = useQuery({
    queryKey: queryKeys.notes(),
    queryFn: getNotes,
    staleTime: 30 * 1000,
    refetchInterval: NOTES_REFRESH_MS,
  });
  if (Array.isArray(notesData) && knownNoteIds == null) {
    knownNoteIds = new Set(notesData.map((n) => String(n.id)));
  }
  const meId = String(user?.id ?? '');
  const [seenTick, bumpSeen] = React.useReducer((x) => x + 1, 0);
  const deckNotes = React.useMemo(
    () => buildDeckNotes(notesData, meId),
    // seenTick: locallySeenNoteIds modül kümesi değişince yeniden hesapla.
    [notesData, meId, seenTick],
  );
  const lastNote = React.useMemo(
    () => (notesData ?? []).find((n) => n.parent_note_id == null && !n.deleted_at) ?? null,
    [notesData],
  );
  // Notlar kutusundaki nokta: görülmemiş herhangi bir not ya da yanıt (kendi
  // yazdıklarım hariç) — sunucudaki note_views üzerinden (seen_by_me).
  const notesHasNew = React.useMemo(
    () => (notesData ?? []).some((n) => (
      !n.deleted_at
      && String(n.author_user_id) !== meId
      && !n.seen_by_me
      && !locallySeenNoteIds.has(String(n.id))
    )),
    [notesData, meId, seenTick],
  );

  const markDeckNoteSeen = React.useCallback((noteId) => {
    const id = String(noteId);
    locallySeenNoteIds.add(id);
    bumpSeen();
    queryClient.setQueryData(queryKeys.notes(), (old) => (
      Array.isArray(old) ? old.map((n) => (String(n.id) === id ? { ...n, seen_by_me: true } : n)) : old
    ));
    writePendingViews([...readPendingViews().filter((x) => x !== id), id]);
    flushPendingViews(queryClient);
  }, [queryClient]);

  // Önceki oturumda sunucuya ulaşamamış görüldü kayıtlarını yeniden gönder.
  React.useEffect(() => { flushPendingViews(queryClient); }, [queryClient]);

  const today = React.useMemo(getIstanbulToday, []);
  const thisMonday = React.useMemo(() => getWeekStart(today), [today]);
  const { sessions } = useWeekLessons(thisMonday);

  const todayIndex = (today.getDay() + 6) % 7;
  const todayCount = React.useMemo(() => {
    if (!sessions) return 0;
    return sessions.filter(s => s.day === todayIndex).length;
  }, [sessions, todayIndex]);

  const collected = parseNumericValue(kpi?.last30CashInflow?.total, 0);
  const revenue = parseNumericValue(kpi?.last30Revenue?.total, 0);
  const collectionRate = revenue > 0 ? Math.round((collected / revenue) * 100) : 0;

  const receivable = parseNumericValue(kpi?.receivable, 0);
  const debtorCount = parseNumericValue(kpi?.debtorStudentCount, 0);

  const occupancyRatio = parseNumericValue(kpi?.occupancyRatio, null);
  const plannedLessons = parseNumericValue(kpi?.lessonCounts?.planned, 0);
  const capacity = parseNumericValue(studioSettings?.weeklyCapacity, null);
  const occupancy = occupancyRatio !== null
    ? Math.round(occupancyRatio * 100)
    : (capacity ? Math.round((plannedLessons / capacity) * 100) : 0);

  const dateLabel = React.useMemo(() => formatDateLabel(today), [today]);
  const headline = todayCount === 0 ? 'Bugün ders yok' : `Bugün ${todayCount} ders var`;

  return (
    <>
      <MobileHomeView
        dateLabel={dateLabel}
        headline={headline}
        user={user}
        onLogout={onLogout}
        onOpenFinance={onOpenFinance}
        onOpenOccupancy={onOpenOccupancy}
        onOpenOrders={onOpenOrders}
        onOpenNotes={onOpenNotes}
        collected={collected}
        revenue={revenue}
        collectionRate={collectionRate}
        receivable={receivable}
        debtorCount={debtorCount}
        occupancy={occupancy}
        plannedLessons={plannedLessons}
        capacity={capacity}
        kpiLoading={kpiLoading}
        ordersPending={ordersPending}
        ordersUrgent={ordersUrgent}
        notesHasNew={notesHasNew}
        notesLoading={notesLoading}
        deckNotes={deckNotes}
        lastNote={lastNote}
        onDeckSeen={markDeckNoteSeen}
        canSeeFinance={canSeeFinance}
        canSeeOrders={canSeeOrders}
      />
      <MobileAgenda />
    </>
  );
}

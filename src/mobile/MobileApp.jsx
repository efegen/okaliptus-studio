import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MobileHeader } from './MobileHeader';
import { BottomTabBar } from './BottomTabBar';
import { MobileHome } from './MobileHome';
import { MobileCalendar } from './MobileCalendar';
import { MobileStudents } from './MobileStudents';
import { MobileQuickAddSheet } from './MobileQuickAddSheet';
import { MobileQuickPaymentSheet } from './MobileQuickPaymentSheet';
import { MobileQuickLessonSheet } from './MobileQuickLessonSheet';
import { MobileStudentProfilePage } from './MobileStudentProfilePage';
import { MobileCollectPaymentPage } from './MobileCollectPaymentPage';
import { MobileToast } from './MobileToast';
import { MobileMenu } from './MobileMenu';
import { MobileMovements } from './MobileMovements';
import { MobileFinance } from './MobileFinance';
import { MobileOccupancy } from './MobileOccupancy';
import { MobileOrders } from './MobileOrders';
import { MobileOrderDetail } from './MobileOrderDetail';
import { MobileProductCatalogPage } from './MobileProductCatalogPage';
import { MobileProductSalePage } from './MobileProductSalePage';
import { MobileProductSaleCheckoutPage } from './MobileProductSaleCheckoutPage';
import { MobileEvents } from './events/MobileEvents';
import { MobileEventCreate } from './events/MobileEventCreate';
import { MobileEventDetail } from './events/MobileEventDetail';
import { MobileEventParticipantDetail } from './events/MobileEventParticipantDetail';
import { MobileNotes } from './MobileNotes';
import { MobileEventAddPerson } from './events/MobileEventAddPerson';
import { MobileEventTransport } from './events/MobileEventTransport';
import { MobileEventAddVehicle } from './events/MobileEventAddVehicle';
import { MobileEventSettings } from './events/MobileEventSettings';
import { MobileEventActivity } from './events/MobileEventActivity';
import { SettingsPage } from '../settings';
import { CatalogPage } from '../catalog';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';
import { Icon } from '../layout';

// Mobile shell: header (when shown) + page body + fixed bottom tab bar. The
// center "+" FAB opens the QuickAdd action sheet (Ödeme al · Ürün sat · Ders
// oluştur); each action drives its own bottom sheet.

function PagePlaceholder({ title, children }) {
  return (
    <div className="mobile-page-placeholder">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function MobileApp({
  page,
  setPage,
  studentDetailId,
  setStudentDetailId,
  currentUser,
  onLogout,
}) {
  const queryClient = useQueryClient();
  const onStudentsPage = page === 'students';
  const onMenuChild = page === 'settings' || page === 'catalog' || page === 'products' || page === 'movements' || page === 'events';
  const onProductSale = page === 'product-sale' || page === 'product-sale-checkout';
  const onEventSubPage =
    page === 'event-create' ||
    page === 'event-detail' ||
    page === 'event-add-person' ||
    page === 'event-transport' ||
    page === 'event-add-vehicle' ||
    page === 'event-settings' ||
    page === 'event-participant' ||
    page === 'event-activity';
  const showBack = (onStudentsPage && !!studentDetailId) || onMenuChild;
  const hideHeader =
    page === 'home' ||
    page === 'calendar' ||
    page === 'students' ||
    page === 'menu' ||
    page === 'finance' ||
    page === 'occupancy' ||
    page === 'orders' ||
    page === 'order-detail' ||
    page === 'collect-payment' ||
    page === 'notes' ||
    onProductSale ||
    onEventSubPage;

  // QuickAdd state — `quickAdd` is the entry sheet, `quickFlow` is the chosen
  // sub-sheet ('payment' | 'lesson' | null). 'sale' artık tam sayfa modülüne
  // (`page === 'product-sale'`) yönlenir, sheet değil.
  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
  const [quickFlow, setQuickFlow] = React.useState(null);
  // When a quick sheet is opened from a student profile, this carries the
  // preselected student so the sheet can skip the student picker.
  const [profileActionStudent, setProfileActionStudent] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  // Finans ekranı menüden de ana sayfa hero kartından da açılabiliyor; geri
  // tuşu nereden gelindiyse oraya dönsün diye kaynağı tutuyoruz.
  const [financeFrom, setFinanceFrom] = React.useState('menu');
  // Pazaryeri sipariş detayında gösterilen sipariş (liste ekranının çektiği
  // nesne; ayrı istek yok). 'order-detail' sayfası bunu okur, geri → 'orders'.
  const [orderDetail, setOrderDetail] = React.useState(null);
  // "Ödeme al" tam sayfası nereden açıldıysa (profil / hareketler) geri/onay
  // sonrası oraya dönsün diye kaynağı tutuyoruz.
  const [paymentReturnPage, setPaymentReturnPage] = React.useState('students');
  const [calendarNavNonce, setCalendarNavNonce] = React.useState(0);
  // Etkinlik modülü: hangi etkinlik açık (5a/3d/7a/6a-c hepsi bunun üzerinde
  // çalışır), ana sayfa kartından mı menüden mi açıldığı (geri tuşu için).
  const [eventDetailId, setEventDetailId] = React.useState(null);
  const [eventEntryPage, setEventEntryPage] = React.useState('events');
  // Etkinliğe özel katılımcı profili (MobileEventParticipantDetail) hangi
  // katılımcı için açık.
  const [eventParticipantId, setEventParticipantId] = React.useState(null);
  // Kişi ekle akışı nereden açıldı (liste "Ekle" mi, yoksa bir katılımcının
  // profilindeki "+ Misafir ekle" mi) — ikincisinde akış "birinin misafiri"
  // önceden seçili açılır ve geri/tamamlanınca profile döner.
  const [eventAddPersonGuestOf, setEventAddPersonGuestOf] = React.useState(null);
  const [eventAddPersonReturn, setEventAddPersonReturn] = React.useState('event-detail');
  // Notlar stüdyo geneli tek bir ekran (bkz. MobileNotes.jsx) — ana sayfadaki
  // "Notlar" kutusundan da etkinlik detayındaki kısayoldan da açılır; geri
  // tuşu nereden gelindiyse oraya dönsün diye kaynağı tutuyoruz.
  const [notesReturnPage, setNotesReturnPage] = React.useState('home');
  // Not içindeki öğrenci etiketi profile götürür; profil geri tuşu öğrenci
  // listesine değil, okunan not akışına dönsün.
  const [studentProfileReturnPage, setStudentProfileReturnPage] = React.useState(null);

  function openFinance(from) {
    setFinanceFrom(from);
    setStudentDetailId(null);
    setPage('finance');
  }

  // Ürünler sayfasında header'daki "+" basıldığında artırılır; sayfa bunu
  // izleyip yeni-ürün editörünü açar (state sayfada kalsın diye nonce ile köprü).
  const [newProductNonce, setNewProductNonce] = React.useState(0);

  // Ürün satışı modülünün state'i page'ler arası paylaşılır: katalog → checkout
  // sırasında sepet ve seçili öğrenci korunur, akış sonunda topluca temizlenir.
  const [productSaleCart, setProductSaleCart] = React.useState(() => new Map());
  const [productSaleStudent, setProductSaleStudent] = React.useState(null);
  const [productSaleNote, setProductSaleNote] = React.useState('');

  function openEventDetail(eventId, entryPage) {
    setEventDetailId(eventId);
    setEventEntryPage(entryPage);
    setEventParticipantId(null);
    setStudentDetailId(null);
    setPage('event-detail');
  }

  function openEventParticipant(participantId) {
    setEventParticipantId(participantId);
    setPage('event-participant');
  }

  function openAddPersonForEvent() {
    setEventAddPersonGuestOf(null);
    setEventAddPersonReturn('event-detail');
    setPage('event-add-person');
  }

  function openAddGuestFor(participant) {
    setEventAddPersonGuestOf({
      participantId: participant.id,
      label: participant.student_nickname || participant.student_name,
    });
    setEventAddPersonReturn('event-participant');
    setPage('event-add-person');
  }

  function handleBack() {
    if (onMenuChild) {
      setPage('menu');
      return;
    }
    setStudentDetailId(null);
  }

  function handleNavigate(nextPage) {
    if (nextPage === 'calendar' && page === 'calendar') {
      setCalendarNavNonce(n => n + 1);
    }
    setStudentProfileReturnPage(null);
    setStudentDetailId(null);
    setPage(nextPage);
  }

  function handleQuickAdd() {
    setQuickAddOpen(true);
  }

  function handleQuickPick(actionId) {
    setQuickAddOpen(false);
    if (actionId === 'sale') {
      setProductSaleStudent(null);
      setStudentDetailId(null);
      setPage('product-sale');
      return;
    }
    setQuickFlow(actionId);
  }

  function handleProfilePayment(student) {
    // Profil/hareketler → sağdan tam-sayfa "Ödeme al" (Tasarım A). FAB akışı
    // (öğrenci seçtirmeli) hâlâ alttan sheet kullanır.
    setProfileActionStudent(student);
    setPaymentReturnPage(page);
    setPage('collect-payment');
  }

  function handleCollectPaymentBack() {
    setProfileActionStudent(null);
    setPage(paymentReturnPage);
  }

  function handleCollectPaymentCompleted(message) {
    setProfileActionStudent(null);
    invalidateAfterMutation('payment');
    setPage(paymentReturnPage);
    if (message) setToast(message);
  }

  function handleProfileSale(student) {
    setProductSaleStudent(student);
    setPage('product-sale');
  }

  function handleQuickFlowClose() {
    setQuickFlow(null);
    setProfileActionStudent(null);
  }

  function resetProductSaleState() {
    setProductSaleCart(new Map());
    setProductSaleStudent(null);
    setProductSaleNote('');
  }

  function handleProductSaleClose() {
    resetProductSaleState();
    setPage(studentDetailId ? 'students' : 'home');
  }

  function handleProductSaleCompleted({ count, total, paidAmount = 0 }) {
    resetProductSaleState();
    invalidateAfterMutation('sale');
    setPage(studentDetailId ? 'students' : 'home');
    const remaining = Math.max(0, total - paidAmount);
    let toastMsg;
    if (paidAmount > 0 && remaining <= 0.001) {
      toastMsg = `Satış kaydedildi · ${fmtTL(total)} tahsil edildi`;
    } else if (paidAmount > 0) {
      toastMsg = `Satış kaydedildi · ${fmtTL(paidAmount)} tahsil, ${fmtTL(remaining)} borç`;
    } else {
      toastMsg = `Satış kaydedildi · ${fmtTL(total)} borç eklendi`;
    }
    setToast(toastMsg);
  }

  function invalidateAfterMutation(kind) {
    // Invalidate query caches that may have changed. Erring on the side of
    // refetching too much over too little — these mutations are infrequent.
    queryClient.invalidateQueries({ queryKey: queryKeys.weeklyKpi() });
    queryClient.invalidateQueries({ queryKey: queryKeys.financeFlow() });
    queryClient.invalidateQueries({ queryKey: queryKeys.occupancyFlow() });
    queryClient.invalidateQueries({ queryKey: queryKeys.weekLessons() });
    queryClient.invalidateQueries({ queryKey: queryKeys.studentsKpi() });
    queryClient.invalidateQueries({ queryKey: queryKeys.debtors() });
    queryClient.invalidateQueries({ queryKey: ['student'] });
    queryClient.invalidateQueries({ queryKey: ['movements'] });
    if (kind === 'lesson') {
      queryClient.invalidateQueries({ queryKey: queryKeys.students() });
    }
  }

  function handleQuickCompleted(kind, message) {
    setQuickFlow(null);
    setProfileActionStudent(null);
    invalidateAfterMutation(kind);
    if (message) setToast(message);
  }

  // `page` localStorage'dan restore edilir (bkz. main.jsx) ama eventDetailId
  // edilmez — sayfa 'event-detail' vb. olarak açılıp id'siz kalırsa (yenileme
  // sonrası) kırık bir hata ekranı yerine listeye düşer.
  const eventDetailPages = ['event-detail', 'event-add-person', 'event-transport', 'event-add-vehicle', 'event-settings', 'event-participant', 'event-activity'];
  React.useEffect(() => {
    if (eventDetailPages.includes(page) && !eventDetailId) {
      setPage('events');
      return;
    }
    if (page === 'event-participant' && !eventParticipantId) {
      setPage('event-detail');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, eventDetailId, eventParticipantId]);

  // Track the iOS soft-keyboard inset on :root as `--mobile-kb-h`. iOS Safari
  // does not shrink dvh/100vh when the keyboard opens, so bottom-anchored
  // sheets need this to lift above the keyboard. (We disable vaul's built-in
  // repositionInputs because it transforms inputs and scrolls the body in a
  // way that makes inline-positioned dropdowns end up clipped or in the
  // wrong place — see Drawer.Root props on each sheet.)
  React.useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!vv || !root) return undefined;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--mobile-kb-h', inset > 80 ? `${Math.round(inset)}px` : '0px');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--mobile-kb-h');
    };
  }, []);

  let body;
  if (page === 'home') {
    body = (
      <MobileHome
        user={currentUser}
        onLogout={onLogout}
        onOpenFinance={() => openFinance('home')}
        onOpenOccupancy={() => { setStudentDetailId(null); setPage('occupancy'); }}
        onOpenOrders={() => { setStudentDetailId(null); setPage('orders'); }}
        onOpenNotes={() => { setStudentDetailId(null); setNotesReturnPage('home'); setPage('notes'); }}
        onOpenEvent={(eventId) => (eventId ? openEventDetail(eventId, 'home') : setPage('event-create'))}
      />
    );
  } else if (page === 'events') {
    body = (
      <MobileEvents
        onOpenEvent={(eventId) => openEventDetail(eventId, 'events')}
        onOpenCreate={() => setPage('event-create')}
      />
    );
  } else if (page === 'event-create') {
    body = (
      <MobileEventCreate
        onClose={() => setPage(eventDetailId ? 'event-detail' : 'events')}
        onCreated={(event) => openEventDetail(event.id, 'events')}
      />
    );
  } else if (page === 'event-detail') {
    body = (
      <MobileEventDetail
        eventId={eventDetailId}
        onBack={() => setPage(eventEntryPage)}
        onOpenAddPerson={openAddPersonForEvent}
        onOpenTransport={() => setPage('event-transport')}
        onOpenSettings={() => setPage('event-settings')}
        onOpenParticipant={openEventParticipant}
        onOpenNotes={() => { setNotesReturnPage('event-detail'); setPage('notes'); }}
        onOpenActivity={() => setPage('event-activity')}
      />
    );
  } else if (page === 'event-activity') {
    body = (
      <MobileEventActivity
        eventId={eventDetailId}
        onBack={() => setPage('event-detail')}
        onOpenParticipant={openEventParticipant}
      />
    );
  } else if (page === 'notes') {
    body = (
      <MobileNotes
        onBack={() => setPage(notesReturnPage)}
        onOpenStudent={(studentId) => {
          setStudentProfileReturnPage('notes');
          setStudentDetailId(String(studentId));
          setPage('students');
        }}
      />
    );
  } else if (page === 'event-participant') {
    body = (
      <MobileEventParticipantDetail
        eventId={eventDetailId}
        participantId={eventParticipantId}
        onBack={() => setPage('event-detail')}
        onRemoved={() => { setEventParticipantId(null); setPage('event-detail'); }}
        onOpenParticipant={openEventParticipant}
        onOpenTransport={() => setPage('event-transport')}
        onOpenAddGuest={openAddGuestFor}
      />
    );
  } else if (page === 'event-settings') {
    body = (
      <MobileEventSettings
        eventId={eventDetailId}
        user={currentUser}
        onBack={() => setPage('event-detail')}
        onDeleted={() => { setEventDetailId(null); setPage('events'); }}
      />
    );
  } else if (page === 'event-add-person') {
    body = (
      <MobileEventAddPerson
        eventId={eventDetailId}
        presetGuestOf={eventAddPersonGuestOf}
        onClose={() => setPage(eventAddPersonReturn)}
        onAdded={() => setPage(eventAddPersonReturn)}
      />
    );
  } else if (page === 'event-transport') {
    body = (
      <MobileEventTransport
        eventId={eventDetailId}
        onBack={() => setPage('event-detail')}
        onOpenAddVehicle={() => setPage('event-add-vehicle')}
      />
    );
  } else if (page === 'event-add-vehicle') {
    body = (
      <MobileEventAddVehicle
        eventId={eventDetailId}
        onBack={() => setPage('event-transport')}
      />
    );
  } else if (page === 'finance') {
    body = (
      <MobileFinance
        onBack={() => setPage(financeFrom)}
        onOpenMovements={() => setPage('movements')}
      />
    );
  } else if (page === 'occupancy') {
    // Doluluk yalnız ana sayfadaki "Haftalık doluluk" kartından açılır; geri → ana sayfa.
    body = <MobileOccupancy onBack={() => setPage('home')} />;
  } else if (page === 'orders') {
    // Pazaryeri Siparişleri yalnız ana sayfadaki "Siparişler" (V3·B) butonundan
    // açılır; geri → ana sayfa.
    body = (
      <MobileOrders
        onBack={() => setPage('home')}
        onOpenDetail={(order) => { setOrderDetail(order); setPage('order-detail'); }}
      />
    );
  } else if (page === 'order-detail') {
    // Sipariş detayı (tam ekran takeover, alt sekme çubuğu gizli); geri → liste.
    body = <MobileOrderDetail order={orderDetail} onBack={() => setPage('orders')} />;
  } else if (page === 'students') {
    body = studentDetailId ? (
      <MobileStudentProfilePage
        studentId={studentDetailId}
        onClose={() => {
          setStudentDetailId(null);
          if (studentProfileReturnPage) {
            setPage(studentProfileReturnPage);
            setStudentProfileReturnPage(null);
          }
        }}
        onOpenPayment={handleProfilePayment}
        onOpenSale={handleProfileSale}
      />
    ) : (
      <MobileStudents onOpenStudent={(studentId) => {
        setStudentProfileReturnPage(null);
        setStudentDetailId(studentId);
      }} />
    );
  } else if (page === 'collect-payment') {
    // "Ödeme al" tam-sayfa tahsilat ekranı (profil/hareketlerden push); alt sekme
    // çubuğu + üst başlık gizli, kendi başlık/footer'ı var.
    body = (
      <MobileCollectPaymentPage
        student={profileActionStudent}
        onBack={handleCollectPaymentBack}
        onCompleted={handleCollectPaymentCompleted}
      />
    );
  } else if (page === 'calendar') {
    body = <MobileCalendar navNonce={calendarNavNonce} />;
  } else if (page === 'menu') {
    body = (
      <MobileMenu
        user={currentUser}
        onNavigate={(id) => (id === 'finance' ? openFinance('menu') : setPage(id))}
        onLogout={onLogout}
      />
    );
  } else if (page === 'movements') {
    body = (
      <MobileMovements
        onOpenStudent={(id) => {
          setStudentProfileReturnPage(null);
          setStudentDetailId(id);
          setPage('students');
        }}
        onOpenPayment={handleProfilePayment}
      />
    );
  } else if (page === 'settings') {
    body = <SettingsPage currentUser={currentUser} />;
  } else if (page === 'catalog') {
    body = <CatalogPage />;
  } else if (page === 'products') {
    body = <MobileProductCatalogPage createNonce={newProductNonce} />;
  } else if (page === 'product-sale') {
    body = (
      <MobileProductSalePage
        cart={productSaleCart}
        setCart={setProductSaleCart}
        onOpenCheckout={() => setPage('product-sale-checkout')}
        onClose={handleProductSaleClose}
      />
    );
  } else if (page === 'product-sale-checkout') {
    body = (
      <MobileProductSaleCheckoutPage
        cart={productSaleCart}
        setCart={setProductSaleCart}
        student={productSaleStudent}
        setStudent={setProductSaleStudent}
        note={productSaleNote}
        setNote={setProductSaleNote}
        onBack={() => setPage('product-sale')}
        onCompleted={handleProductSaleCompleted}
      />
    );
  } else {
    body = <PagePlaceholder title="Bilinmeyen sayfa" />;
  }

  return (
    <div className="mobile-shell">
      {!hideHeader && (
        <MobileHeader
          page={page}
          showBack={showBack}
          onBack={handleBack}
          action={page === 'products'
            ? { icon: Icon.Plus, onClick: () => setNewProductNonce(n => n + 1), label: 'Yeni ürün' }
            : null}
        />
      )}
      <main className="mobile-main" data-screen-label={page}>
        {body}
      </main>
      {page !== 'order-detail' && page !== 'collect-payment' && page !== 'notes' && !onEventSubPage && (
        <BottomTabBar
          page={page}
          onNavigate={handleNavigate}
          onQuickAdd={handleQuickAdd}
        />
      )}

      <MobileQuickAddSheet
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onPick={handleQuickPick}
      />
      <MobileQuickPaymentSheet
        open={quickFlow === 'payment'}
        onClose={handleQuickFlowClose}
        onCompleted={(msg) => handleQuickCompleted('payment', msg)}
        preselectedStudent={null}
      />
      <MobileQuickLessonSheet
        open={quickFlow === 'lesson'}
        onClose={handleQuickFlowClose}
        onCreated={(msg) => handleQuickCompleted('lesson', msg)}
      />

      <MobileToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MobileHeader } from './MobileHeader';
import { BottomTabBar } from './BottomTabBar';
import { MobileHome } from './MobileHome';
import { MobileCalendar } from './MobileCalendar';
import { MobileStudents } from './MobileStudents';
import { MobileQuickAddSheet } from './MobileQuickAddSheet';
import { MobileQuickPaymentSheet } from './MobileQuickPaymentSheet';
import { MobileQuickSellSheet } from './MobileQuickSellSheet';
import { MobileQuickLessonSheet } from './MobileQuickLessonSheet';
import { MobileStudentProfilePage } from './MobileStudentProfilePage';
import { MobileToast } from './MobileToast';
import { MobileMenu } from './MobileMenu';
import { MobileProductCatalogPage } from './MobileProductCatalogPage';
import { SettingsPage } from '../settings';
import { CatalogPage } from '../catalog';
import { queryKeys } from '../hooks/queryKeys';

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
  const onMenuChild = page === 'settings' || page === 'catalog' || page === 'products';
  const showBack = (onStudentsPage && !!studentDetailId) || onMenuChild;
  const hideHeader =
    page === 'home' ||
    page === 'calendar' ||
    page === 'students' ||
    page === 'menu';

  // QuickAdd state — `quickAdd` is the entry sheet, `quickFlow` is the chosen
  // sub-sheet ('payment' | 'sale' | 'lesson' | null).
  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
  const [quickFlow, setQuickFlow] = React.useState(null);
  // When a quick sheet is opened from a student profile, this carries the
  // preselected student so the sheet can skip the student picker.
  const [profileActionStudent, setProfileActionStudent] = React.useState(null);
  const [toast, setToast] = React.useState(null);

  function handleBack() {
    if (onMenuChild) {
      setPage('menu');
      return;
    }
    setStudentDetailId(null);
  }

  function handleNavigate(nextPage) {
    setStudentDetailId(null);
    setPage(nextPage);
  }

  function handleQuickAdd() {
    setQuickAddOpen(true);
  }

  function handleQuickPick(actionId) {
    setQuickAddOpen(false);
    setQuickFlow(actionId);
  }

  function handleProfilePayment(student) {
    setProfileActionStudent(student);
    setQuickFlow('payment');
  }

  function handleProfileSale(student) {
    setProfileActionStudent(student);
    setQuickFlow('sale');
  }

  function handleQuickFlowClose() {
    setQuickFlow(null);
    setProfileActionStudent(null);
  }

  function invalidateAfterMutation(kind) {
    // Invalidate query caches that may have changed. Erring on the side of
    // refetching too much over too little — these mutations are infrequent.
    queryClient.invalidateQueries({ queryKey: queryKeys.weeklyKpi() });
    queryClient.invalidateQueries({ queryKey: queryKeys.weekLessons() });
    queryClient.invalidateQueries({ queryKey: queryKeys.studentsKpi() });
    queryClient.invalidateQueries({ queryKey: queryKeys.debtors() });
    queryClient.invalidateQueries({ queryKey: ['student'] });
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
    body = <MobileHome user={currentUser} onLogout={onLogout} />;
  } else if (page === 'students') {
    body = studentDetailId ? (
      <MobileStudentProfilePage
        studentId={studentDetailId}
        onClose={() => setStudentDetailId(null)}
        onOpenPayment={handleProfilePayment}
        onOpenSale={handleProfileSale}
      />
    ) : (
      <MobileStudents onOpenStudent={setStudentDetailId} />
    );
  } else if (page === 'calendar') {
    body = <MobileCalendar />;
  } else if (page === 'menu') {
    body = <MobileMenu onNavigate={setPage} onLogout={onLogout} />;
  } else if (page === 'settings') {
    body = <SettingsPage />;
  } else if (page === 'catalog') {
    body = <CatalogPage />;
  } else if (page === 'products') {
    body = <MobileProductCatalogPage />;
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
          currentUser={currentUser}
          onLogout={onLogout}
        />
      )}
      <main className="mobile-main" data-screen-label={page}>
        {body}
      </main>
      <BottomTabBar
        page={page}
        onNavigate={handleNavigate}
        onQuickAdd={handleQuickAdd}
      />

      <MobileQuickAddSheet
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onPick={handleQuickPick}
      />
      <MobileQuickPaymentSheet
        open={quickFlow === 'payment'}
        onClose={handleQuickFlowClose}
        onCompleted={(msg) => handleQuickCompleted('payment', msg)}
        preselectedStudent={profileActionStudent}
      />
      <MobileQuickSellSheet
        open={quickFlow === 'sale'}
        onClose={handleQuickFlowClose}
        onCompleted={(msg) => handleQuickCompleted('sale', msg)}
        preselectedStudent={profileActionStudent}
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

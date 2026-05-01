import React from 'react';
import { MobileHeader } from './MobileHeader';
import { BottomTabBar } from './BottomTabBar';
import { MobileHome } from './MobileHome';

/*
 * Mobile shell.
 *
 *  ┌──────────────────────────┐
 *  │  MobileHeader (sticky)   │
 *  ├──────────────────────────┤
 *  │  Sayfa içeriği (scroll)  │
 *  ├──────────────────────────┤
 *  │  BottomTabBar (fixed)    │
 *  └──────────────────────────┘
 *
 * Page bodies are placeholders for now — Faz C–F will fill them in with
 * MobileHome, MobileStudents, MobileCatalog, MobileSettings and the
 * MobileStudentProfile detail view. The shell itself just has to:
 *   1. show a sticky header (with a back button when a student detail is
 *      pushed),
 *   2. swap which placeholder is rendered based on `page`,
 *   3. render the bottom tab bar (which drives navigation), and
 *   4. provide a Quick-Add slot (the center "+" FAB) — currently a no-op
 *      stub, wired up in Faz E.1.
 */

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
}) {
  const onStudentsPage = page === 'students';
  const showBack = onStudentsPage && !!studentDetailId;
  const hideHeader = page === 'home';

  function handleBack() {
    setStudentDetailId(null);
  }

  function handleNavigate(nextPage) {
    setStudentDetailId(null);
    setPage(nextPage);
  }

  function handleQuickAdd() {
    // Wired up in Faz E.1 (MobileQuickAdd bottom sheet).
  }

  let body;
  if (page === 'home') {
    body = <MobileHome user={currentUser} />;
  } else if (page === 'students') {
    body = studentDetailId ? (
      <PagePlaceholder title="Öğrenci profili">
        Faz D.2'de doldurulacak — şu an gösterilen öğrenci id'si:
        {' '}<code>{studentDetailId}</code>
      </PagePlaceholder>
    ) : (
      <PagePlaceholder title="Öğrenciler">
        Faz D.1'de doldurulacak (kart listesi, sticky arama, FAB → yeni öğrenci).
      </PagePlaceholder>
    );
  } else if (page === 'catalog') {
    body = (
      <PagePlaceholder title="Katalog">
        Faz F.1'de doldurulacak (Ders Türleri / Eğitmenler chip tab'leri).
      </PagePlaceholder>
    );
  } else if (page === 'settings') {
    body = (
      <PagePlaceholder title="Ayarlar">
        Faz F.2'de doldurulacak (çalışma saatleri, ders varsayılanları).
      </PagePlaceholder>
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
    </div>
  );
}

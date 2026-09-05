import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import './styles.css';
import './mobile/styles.css';
import { Sidebar, Header } from './layout';
import { HomePage } from './home';
import { StudentsPage } from './students';
import { StudentProfilePage } from './student-profile';
import { SettingsPage } from './settings';
import { CatalogPage } from './catalog';
import { ProductsPage } from './products';
import { MappingPage } from './mapping';
import { OrdersPage } from './orders';
import { MovementsPage } from './movements';
import { LoginPage } from './login';
import { ProductSalePage } from './ProductSalePage';
import { Toast } from './Toast';
import { getSettings, getMe, logout as apiLogout } from './api';
import { fmtTL } from './data';
import { queryKeys } from './hooks/queryKeys';
import { canSeePage } from './permissions';
import { CurrentUserProvider } from './currentUser';
import { useIsMobile } from './mobile/useIsMobile';
import { MobileApp } from './mobile/MobileApp';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "homeLayout": "detayli",
  "palette": "sage",
  "density": "compact"
}/*EDITMODE-END*/;

function App({ currentUser, onLogout }) {
  const [page, setPage] = React.useState(() => {
    const stored = localStorage.getItem("okaliptus-page");
    if (stored === "instructors" || stored === "lesson-types") return "catalog";
    // Notlar etkinlikten koparılıp stüdyo geneli tek ekrana dönüştü (bkz.
    // MobileNotes.jsx); eski 'event-notes' anahtarıyla açık kalmış bir istemci
    // "Bilinmeyen sayfa"ya düşmesin.
    if (stored === "event-notes") return "notes";
    return stored || "home";
  });
  const [studentDetailId, setStudentDetailId] = React.useState(null);
  const [tweaks, setTweaks] = React.useState(TWEAK_DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  const [productSaleCart, setProductSaleCart] = React.useState(() => new Map());
  const [productSaleStudent, setProductSaleStudent] = React.useState(null);
  const [productSaleNote, setProductSaleNote] = React.useState('');
  const [toast, setToast] = React.useState('');
  const isMobile = useIsMobile();
  const qc = useQueryClient();

  React.useEffect(() => {
    localStorage.setItem("okaliptus-page", page);
  }, [page]);

  // Rol koruması (web + mobil): asistanın erişemeyeceği bir sayfaya düşülürse
  // (localStorage'dan restore, eski link vb.) ana sayfaya yönlendir. Güvenlik
  // sunucuda; bu yalnız kırık 403 ekranını göstermemek için. Nav girişleri de
  // ayrıca gizli, bu yüzden normal akışta buraya nadiren düşülür.
  React.useEffect(() => {
    if (!canSeePage(currentUser?.role, page)) {
      setStudentDetailId(null);
      setPage('home');
    }
  }, [page, currentUser]);

  React.useEffect(() => {
    getSettings()
      .then(s => {
        document.documentElement.style.setProperty('--ls-sat', String(s.lessonColorSaturation ?? 1));
      })
      .catch(() => {});
  }, []);

  // Mirror palette/density classes onto <html> so they cascade into every
  // Radix/Vaul portal too (sheets/dialogs render under document.body, outside
  // the React subtree). Without this the portalled bottom sheets fall back to
  // the :root defaults — which are terracotta — and ignore the chosen palette.
  React.useEffect(() => {
    const root = document.documentElement;
    const paletteCls = `palette-${tweaks.palette}`;
    const densityCls = `density-${tweaks.density}`;
    root.classList.add(paletteCls, densityCls);
    return () => {
      root.classList.remove(paletteCls, densityCls);
    };
  }, [tweaks.palette, tweaks.density]);

  function navigate(nextPage) {
    setStudentDetailId(null);
    setPage(nextPage);
  }

  function openStudent(studentId) {
    setStudentDetailId(studentId);
    setPage('students');
  }

  function resetProductSaleState() {
    setProductSaleCart(new Map());
    setProductSaleStudent(null);
    setProductSaleNote('');
  }

  function handleProfileSale(student) {
    setProductSaleStudent(student);
    setStudentDetailId(null);
    setPage('product-sale');
  }

  function handleProductSaleClose() {
    if (productSaleCart.size > 0) {
      const ok = window.confirm('Sepeti boşaltıp çıkmak istediğine emin misin?');
      if (!ok) return;
    }
    const returnStudent = productSaleStudent;
    resetProductSaleState();
    if (returnStudent) {
      setStudentDetailId(Number(returnStudent.id));
      setPage('students');
    } else {
      setPage('home');
    }
  }

  function handleProductSaleCompleted({ count, total, paidAmount = 0 }) {
    qc.invalidateQueries({ queryKey: queryKeys.weeklyKpi() });
    qc.invalidateQueries({ queryKey: queryKeys.weekLessons() });
    qc.invalidateQueries({ queryKey: queryKeys.studentsKpi() });
    qc.invalidateQueries({ queryKey: queryKeys.debtors() });
    qc.invalidateQueries({ queryKey: ['student'] });
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
    const returnStudent = productSaleStudent;
    resetProductSaleState();
    if (returnStudent) {
      setStudentDetailId(Number(returnStudent.id));
      setPage('students');
    } else {
      setPage('home');
    }
  }

  React.useEffect(() => {
    const handler = (e) => {
      if (e.origin !== window.location.origin) return;
      if (!e.data || !e.data.type) return;
      if (e.data.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e.data.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "__edit_mode_available" }, window.location.origin);
    return () => window.removeEventListener("message", handler);
  }, []);

  const updateTweak = (key, value) => {
    setTweaks(t => ({ ...t, [key]: value }));
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [key]: value } }, window.location.origin);
  };

  const cls = [
    "app",
    "palette-" + tweaks.palette,
    "density-" + tweaks.density,
  ].join(" ");

  if (isMobile) {
    // Mobile shell: keep palette/density classes (CSS variables resolve
    // identically), but DROP the `.app` class — `.app` is a 68px-sidebar +
    // 1fr grid, and dragging it onto the mobile tree squashes the entire
    // shell into the 68px sidebar column. The Tweaks panel is also hidden
    // on mobile.
    const mobileCls = ["palette-" + tweaks.palette, "density-" + tweaks.density].join(" ");
    return (
      <div id="mobile-palette-root" className={mobileCls}>
        <MobileApp
          page={page}
          setPage={setPage}
          studentDetailId={studentDetailId}
          setStudentDetailId={setStudentDetailId}
          currentUser={currentUser}
          onLogout={onLogout}
        />
      </div>
    );
  }

  return (
    <div className={cls}>
      <Sidebar page={page} setPage={navigate} />
      <div style={{display:"flex",flexDirection:"column",minWidth:0}}>
        <Header page={page} user={currentUser} onLogout={onLogout} onOpenStudent={openStudent} />
        <main className="main" data-screen-label={page}>
          {page === "home" && <HomePage layout={tweaks.homeLayout} onNavigate={navigate} />}
          {page === "students" && (
            studentDetailId
              ? <StudentProfilePage
                  studentId={studentDetailId}
                  onBack={() => setStudentDetailId(null)}
                  onOpenSale={handleProfileSale}
                />
              : <StudentsPage onOpenStudent={setStudentDetailId} />
          )}
          {page === "catalog" && <CatalogPage />}
          {page === "products" && <ProductsPage onNavigate={navigate} />}
          {page === "mapping" && <MappingPage onNavigate={navigate} />}
          {page === "orders" && <OrdersPage onNavigate={navigate} />}
          {page === "movements" && <MovementsPage onOpenStudent={openStudent} />}
          {page === "settings" && <SettingsPage currentUser={currentUser} />}
          {page === "product-sale" && (
            <ProductSalePage
              cart={productSaleCart}
              setCart={setProductSaleCart}
              student={productSaleStudent}
              setStudent={setProductSaleStudent}
              note={productSaleNote}
              setNote={setProductSaleNote}
              onClose={handleProductSaleClose}
              onCompleted={handleProductSaleCompleted}
              onNavigateToProducts={() => navigate('products')}
            />
          )}
        </main>
        <Toast message={toast} onDismiss={() => setToast('')} />
      </div>

      {tweaksOpen && (
        <div className="tweaks-panel">
          <h4>Tweaks</h4>
          <div className="tweak-row">
            <label>Ana sayfa</label>
            <div className="tweak-seg">
              <button className={tweaks.homeLayout === "sakin" ? "on" : ""} onClick={() => updateTweak("homeLayout","sakin")}>Sakin</button>
              <button className={tweaks.homeLayout === "detayli" ? "on" : ""} onClick={() => updateTweak("homeLayout","detayli")}>Detaylı</button>
              <button className={tweaks.homeLayout === "ajanda" ? "on" : ""} onClick={() => updateTweak("homeLayout","ajanda")}>Ajanda</button>
            </div>
          </div>
          <div className="tweak-row">
            <label>Renk</label>
            <div className="tweak-swatches">
              {[
                { id: "terracotta", color: "oklch(0.52 0.14 40)" },
                { id: "sage", color: "oklch(0.5 0.08 145)" },
                { id: "slate", color: "oklch(0.4 0.06 240)" },
                { id: "gold", color: "oklch(0.58 0.13 75)" },
              ].map(s => (
                <div
                  key={s.id}
                  className={"tweak-sw" + (tweaks.palette === s.id ? " on" : "")}
                  style={{ background: s.color }}
                  onClick={() => updateTweak("palette", s.id)}
                />
              ))}
            </div>
          </div>
          <div className="tweak-row">
            <label>Yoğunluk</label>
            <div className="tweak-seg">
              <button className={tweaks.density === "normal" ? "on" : ""} onClick={() => updateTweak("density","normal")}>Rahat</button>
              <button className={tweaks.density === "compact" ? "on" : ""} onClick={() => updateTweak("density","compact")}>Kompakt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Root() {
  const [authState, setAuthState] = React.useState('loading');
  const [currentUser, setCurrentUser] = React.useState(null);

  React.useEffect(() => {
    getMe()
      .then(user => {
        setCurrentUser(user);
        setAuthState('authenticated');
      })
      .catch(() => setAuthState('unauthenticated'));
  }, []);

  React.useEffect(() => {
    function handler() {
      setCurrentUser(null);
      setAuthState('unauthenticated');
    }
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, []);

  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    function onSwMessage(e) {
      if (e.data?.type === 'auth:unauthorized') {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
    }
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, []);

  function handleLogin(user) {
    setCurrentUser(user);
    setAuthState('authenticated');
  }

  async function handleLogout() {
    try { await apiLogout(); } catch {}
    setCurrentUser(null);
    setAuthState('unauthenticated');
  }

  if (authState === 'loading') return null;
  if (authState === 'unauthenticated') return <LoginPage onLogin={handleLogin} />;
  return (
    <CurrentUserProvider user={currentUser}>
      <App currentUser={currentUser} onLogout={handleLogout} />
    </CurrentUserProvider>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <QueryClientProvider client={queryClient}>
    <Root />
  </QueryClientProvider>
);

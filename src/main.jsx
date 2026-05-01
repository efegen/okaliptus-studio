import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './mobile/styles.css';
import { Sidebar, Header } from './layout';
import { HomePage } from './home';
import { StudentsPage } from './students';
import { StudentProfilePage } from './student-profile';
import { SettingsPage } from './settings';
import { CatalogPage } from './catalog';
import { LoginPage } from './login';
import { getSettings, getMe, logout as apiLogout } from './api';
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
    return stored || "home";
  });
  const [studentDetailId, setStudentDetailId] = React.useState(null);
  const [tweaks, setTweaks] = React.useState(TWEAK_DEFAULTS);
  const [tweaksOpen, setTweaksOpen] = React.useState(false);
  const isMobile = useIsMobile();

  React.useEffect(() => {
    localStorage.setItem("okaliptus-page", page);
  }, [page]);

  React.useEffect(() => {
    getSettings()
      .then(s => {
        document.documentElement.style.setProperty('--ls-sat', String(s.lessonColorSaturation ?? 1));
      })
      .catch(() => {});
  }, []);

  function navigate(nextPage) {
    setStudentDetailId(null);
    setPage(nextPage);
  }

  React.useEffect(() => {
    const handler = (e) => {
      if (!e.data || !e.data.type) return;
      if (e.data.type === "__activate_edit_mode") setTweaksOpen(true);
      if (e.data.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", handler);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  const updateTweak = (key, value) => {
    setTweaks(t => ({ ...t, [key]: value }));
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [key]: value } }, "*");
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
      <div className={mobileCls}>
        <MobileApp
          page={page}
          setPage={setPage}
          studentDetailId={studentDetailId}
          setStudentDetailId={setStudentDetailId}
        />
      </div>
    );
  }

  return (
    <div className={cls}>
      <Sidebar page={page} setPage={navigate} />
      <div style={{display:"flex",flexDirection:"column",minWidth:0}}>
        <Header page={page} user={currentUser} onLogout={onLogout} />
        <main className="main" data-screen-label={page}>
          {page === "home" && <HomePage layout={tweaks.homeLayout} onNavigate={navigate} />}
          {page === "students" && (
            studentDetailId
              ? <StudentProfilePage
                  studentId={studentDetailId}
                  onBack={() => setStudentDetailId(null)}
                />
              : <StudentsPage onOpenStudent={setStudentDetailId} />
          )}
          {page === "catalog" && <CatalogPage />}
          {page === "settings" && <SettingsPage />}
        </main>
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
  return <App currentUser={currentUser} onLogout={handleLogout} />;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<Root />);

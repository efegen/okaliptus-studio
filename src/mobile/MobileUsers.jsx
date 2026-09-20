import React from 'react';
import { getUsers, getUserActivity, updateUserApi } from '../api';
import { initials } from '../data';
import { roleLabel } from '../permissions';
import './users.css';

// Mobil kullanıcı aktivitesi + görünen ad düzenleme (yalnız owner). Rol, şifre,
// pasifleştirme ve kullanıcı ekleme burada YOK (masaüstü Ayarlar → Kullanıcılar).
// Aktivite: bkz. migrations 0288/0289. Süre ping aralıklarından tahmindir.

const REFRESH_MS = 30_000;

function relTime(iso) {
  if (!iso) return 'henüz etkileşim yok';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} sa önce`;
  return `${Math.floor(h / 24)} gün önce`;
}

function fmtDuration(sec) {
  const min = Math.round((sec || 0) / 60);
  if (min < 1) return sec > 0 ? '1 dk’dan az' : '0 dk';
  if (min < 60) return `${min} dk`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}

function clock(iso) {
  return iso ? new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '—';
}

function dayLabel(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function MobileUsers({ currentUser }) {
  const [users, setUsers] = React.useState(null);
  const [activity, setActivity] = React.useState({});
  const [error, setError] = React.useState(null);
  const [openId, setOpenId] = React.useState(null);

  const load = React.useCallback(async () => {
    try {
      const [u, a] = await Promise.all([getUsers(), getUserActivity()]);
      setUsers(u);
      setActivity(Object.fromEntries(a.map((x) => [String(x.userId), x])));
      setError(null);
    } catch (e) {
      setError(e.message || 'Yüklenemedi.');
    }
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (error && !users) return <div className="musr-state musr-err">{error}</div>;
  if (!users) return <div className="musr-state">Yükleniyor…</div>;

  const onlineCount = users.filter((u) => activity[String(u.id)]?.isOnline).length;

  return (
    <div className="musr">
      <p className="musr-summary">
        {onlineCount > 0 ? `${onlineCount} kişi şu an aktif` : 'Şu an aktif kimse yok'}
      </p>
      {error && <div className="musr-err">{error}</div>}
      <div className="musr-list">
        {users.map((u) => (
          <UserCard
            key={u.id}
            user={u}
            act={activity[String(u.id)]}
            isSelf={String(u.id) === String(currentUser?.id)}
            open={openId === u.id}
            onToggle={() => setOpenId(openId === u.id ? null : u.id)}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, act, isSelf, open, onToggle, onChanged }) {
  const [name, setName] = React.useState(user.displayName);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => { setName(user.displayName); }, [user.displayName]);

  async function run(fn, okMsg) {
    if (busy) return false;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await fn();
      setMsg(okMsg);
      onChanged();
      return true;
    } catch (e) {
      setErr(e.message || 'İşlem başarısız.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const saveName = () => run(() => updateUserApi(user.id, { displayName: name.trim() }), 'Ad kaydedildi.');

  const online = !!act?.isOnline;
  const today = act?.todaySessions ?? 0;
  const todaySeconds = act?.todaySeconds ?? 0;

  return (
    <div className={'musr-card' + (user.isActive ? '' : ' is-off')}>
      <button type="button" className="musr-head" onClick={onToggle} aria-expanded={open}>
        <span className="musr-avatar" aria-hidden="true">
          {initials(user.displayName)}
          {online && <span className="musr-dot" />}
        </span>
        <span className="musr-main">
          <span className="musr-name">{user.displayName}{isSelf ? ' (sen)' : ''}</span>
          <span className="musr-sub">
            {roleLabel(user.role)}{!user.isActive ? ' · pasif' : ''}
          </span>
          <span className="musr-sub">
            {online ? 'Şu an aktif' : `Son etkileşim: ${relTime(act?.lastActiveAt)}`}
          </span>
        </span>
      </button>

      <div className="musr-stats">
        <div><strong>{today}</strong><span>giriş</span></div>
        <div><strong>{fmtDuration(todaySeconds)}</strong><span>bugün kullandı</span></div>
        <div><strong>{clock(act?.todayFirstAt)}</strong><span>ilk giriş</span></div>
      </div>

      {open && (
        <div className="musr-body">
          <label className="musr-lbl">Görünen ad (notlarda bu görünür)</label>
          <div className="musr-row">
            <input className="musr-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || name.trim() === user.displayName} onClick={saveName}>
              Kaydet
            </button>
          </div>
          <p className="musr-hint">Kullanıcı adı: @{user.username}</p>

          <label className="musr-lbl">Son 30 gün (giriş · tahmini süre)</label>
          {act?.history?.length ? (
            <ul className="musr-hist">
              {act.history.map((h) => (
                <li key={h.day}><span>{dayLabel(h.day)}</span><strong>{h.sessions} giriş · {fmtDuration(h.seconds)}</strong></li>
              ))}
            </ul>
          ) : (
            <p className="musr-hint">Henüz kayıt yok. Süre yaklaşık bir tahmindir.</p>
          )}

          {msg && <p className="musr-ok">{msg}</p>}
          {err && <p className="musr-err">{err}</p>}
        </div>
      )}
    </div>
  );
}

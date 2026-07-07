import React from 'react';
import { getUsers, createUserApi, updateUserApi, resetUserPasswordApi } from './api';
import { Toggle } from './settings';

const ROLE_LABELS = {
  owner: 'Geliştirici',
  admin: 'Yönetici',
  instructor: 'Yönetici-Eğitmen',
  assistant: 'Asistan',
};
const ROLE_OPTIONS = ['owner', 'admin', 'instructor', 'assistant'];

function RoleBadge({ role }) {
  return <span className={`usr-badge usr-badge-${role}`}>{ROLE_LABELS[role] ?? role}</span>;
}

function formatDateTime(iso) {
  if (!iso) return 'Hiç giriş yapmadı';
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function NewUserForm({ onCreated }) {
  const [open, setOpen] = React.useState(false);
  const [username, setUsername] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [role, setRole] = React.useState('admin');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  function reset() {
    setUsername(''); setDisplayName(''); setPassword(''); setRole('admin'); setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createUserApi({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        role,
      });
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message || 'Kullanıcı oluşturulamadı.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="usr-new-cta">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          Yeni kullanıcı
        </button>
      </div>
    );
  }

  return (
    <form className="usr-new-form" onSubmit={handleSubmit}>
      <div className="usr-new-grid">
        <label className="usr-field">
          <span>Kullanıcı adı</span>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={50}
            autoFocus
          />
        </label>
        <label className="usr-field">
          <span>Görünen ad</span>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} required />
        </label>
        <label className="usr-field">
          <span>Şifre</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        <label className="usr-field">
          <span>Rol</span>
          <select className="stg-select" value={role} onChange={e => setRole(e.target.value)}>
            {ROLE_OPTIONS.map(r => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="stg-feedback stg-feedback-err">{error}</div>}

      <div className="usr-new-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => { setOpen(false); reset(); }}
        >
          Vazgeç
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Oluşturuluyor…' : 'Oluştur'}
        </button>
      </div>
    </form>
  );
}

function PasswordResetForm({ userId, onDone }) {
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await resetUserPasswordApi(userId, password);
      setPassword('');
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err.message || 'Şifre sıfırlanamadı.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost usr-row-action" onClick={() => setOpen(true)}>
        Şifre sıfırla
      </button>
    );
  }

  return (
    <form className="usr-pw-form" onSubmit={handleSubmit}>
      <input
        type="password"
        className="usr-pw-input"
        placeholder="Yeni şifre (min 6)"
        value={password}
        onChange={e => setPassword(e.target.value)}
        minLength={6}
        required
        autoFocus
      />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? '…' : 'Kaydet'}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => { setOpen(false); setPassword(''); setError(null); }}
      >
        Vazgeç
      </button>
      {error && <span className="usr-pw-error">{error}</span>}
    </form>
  );
}

function UserRow({ user, isSelf, onChanged, onNotice }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  async function patch(fields) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateUserApi(user.id, fields);
      onChanged();
    } catch (err) {
      setError(err.message || 'Güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  function handleRoleChange(e) {
    const role = e.target.value;
    if (role === user.role) return;
    patch({ role });
  }

  function handleToggleActive(next) {
    if (!next) {
      const ok = window.confirm(
        `${user.displayName} kullanıcısının oturumları anında kapatılacak ve giriş yapamayacak. Devam edilsin mi?`,
      );
      if (!ok) return;
    }
    patch({ isActive: next });
  }

  return (
    <div className="usr-row">
      <div className="usr-row-main">
        <div className="usr-row-name">
          {user.displayName}
          <span className="usr-row-username">@{user.username}</span>
        </div>
        <div className="usr-row-meta">{formatDateTime(user.lastLoginAt)}</div>
      </div>

      <div className="usr-row-controls">
        <RoleBadge role={user.role} />
        <select
          className="stg-select"
          value={user.role}
          disabled={busy || isSelf}
          onChange={handleRoleChange}
        >
          {ROLE_OPTIONS.map(r => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>

        <Toggle
          checked={user.isActive}
          disabled={busy || isSelf}
          onChange={handleToggleActive}
          label={user.isActive ? 'Kullanıcıyı pasifleştir' : 'Kullanıcıyı aktifleştir'}
        />

        <PasswordResetForm userId={user.id} onDone={() => onNotice('Şifre sıfırlandı.')} />
      </div>

      {error && <div className="stg-feedback stg-feedback-err usr-row-error">{error}</div>}
    </div>
  );
}

export function UsersPanel({ currentUser }) {
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getUsers()
      .then(data => { if (!cancelled) setUsers(data); })
      .catch(err => { if (!cancelled) setError(err.message || 'Kullanıcılar alınamadı.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version]);

  React.useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(t);
  }, [notice]);

  function refresh() {
    setVersion(v => v + 1);
  }

  function refreshWithNotice(msg) {
    setNotice(msg);
    refresh();
  }

  return (
    <div className="usr-panel">
      <NewUserForm onCreated={() => refreshWithNotice('Kullanıcı oluşturuldu.')} />

      {notice && <div className="stg-feedback stg-feedback-ok">{notice}</div>}
      {error && <div className="stg-feedback stg-feedback-err">{error}</div>}

      {loading ? (
        <div className="stg-loading">Yükleniyor…</div>
      ) : (
        <div className="usr-list">
          {users.map(u => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={String(u.id) === String(currentUser?.id)}
              onChanged={refresh}
              onNotice={refreshWithNotice}
            />
          ))}
        </div>
      )}
    </div>
  );
}

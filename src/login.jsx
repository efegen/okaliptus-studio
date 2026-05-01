import React from 'react';
import { login } from './api';

function EyeIcon({ open }) {
  return open
    ? (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>)
    : (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-6.9M9.9 4.2A10.5 10.5 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.4M1 1l22 22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>);
}

export function LoginPage({ onLogin }) {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(username, password);
      onLogin(user);
    } catch {
      setError('Kullanıcı adı veya şifre hatalı.');
    } finally {
      setLoading(false);
    }
  }

  // iOS klavyesi açılınca input'u görünür alanın merkezine kaydır.
  // Çift guard: jsdom'da scrollIntoView undefined; ayrıca 300ms içinde
  // komponent unmount olabilir.
  function handleFocus(e) {
    const target = e.target;
    if (typeof target.scrollIntoView !== 'function') return;
    setTimeout(() => {
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 300);
  }

  return (
    <div className="login-root">
      <div className="login-card">
        <picture>
          <source srcSet="/logo.webp" type="image/webp" />
          <img src="/logo.png" className="login-logo" alt="Okaliptus" />
        </picture>
        <h1 className="login-title">Okaliptus Yoga</h1>
        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label htmlFor="login-username">Kullanıcı adı</label>
            <div className="login-input-wrap">
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onFocus={handleFocus}
                disabled={loading}
                required
                autoFocus
              />
            </div>
          </div>
          <div className="login-field">
            <label htmlFor="login-password">Şifre</label>
            <div className="login-input-wrap">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="has-toggle"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={handleFocus}
                disabled={loading}
                required
              />
              <button
                type="button"
                className="login-eye-btn"
                tabIndex={-1}
                onClick={() => setShowPassword(s => !s)}
                aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Giriş yapılıyor…' : 'Giriş yap'}
          </button>
        </form>
      </div>
    </div>
  );
}

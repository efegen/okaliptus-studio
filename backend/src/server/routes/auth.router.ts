import { Router } from 'express';
import { login, logout } from '../../services/auth.service.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { env } from '../../config/env.js';

export const authRouter = Router();

const COOKIE_NAME = 'session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  const prod = env.nodeEnv === 'production';
  return {
    httpOnly: true,
    secure: prod,
    sameSite: (prod ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: SESSION_MS,
    path: '/',
  };
}

// POST /auth/login
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'username and password required.' } });
    return;
  }

  const token = await login(username, password);
  if (!token) {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
    return;
  }

  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true });
});

// POST /auth/logout
authRouter.post('/logout', (req, res) => {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx !== -1 && part.slice(0, eqIdx).trim() === COOKIE_NAME) {
        const token = decodeURIComponent(part.slice(eqIdx + 1).trim());
        logout(token).catch(() => {});
        break;
      }
    }
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// GET /auth/me
authRouter.get('/me', requireAuth, (req, res) => {
  const { id, username, displayName } = req.currentUser;
  res.json({ data: { id, username, displayName } });
});

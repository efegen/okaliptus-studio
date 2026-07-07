import { Router } from 'express';
import rateLimit from 'express-rate-limit';
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

// 5 failed attempts per 15 min per IP. Successful logins don't count, so a
// legitimate operator who mistypes a few times then succeeds isn't penalised.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Çok fazla başarısız deneme — 15 dk sonra tekrar dene.',
    },
  },
});

// POST /auth/login
authRouter.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'username and password required.' } });
    return;
  }

  const token = await login(username, password, req.ip);
  if (!token) {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
    return;
  }

  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true });
});

// POST /auth/logout — requireAuth: yalnız geçerli oturum kendini kapatabilir,
// böylece forced-logout/CSRF yüzeyi kapanır.
authRouter.post('/logout', requireAuth, (req, res) => {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx !== -1 && part.slice(0, eqIdx).trim() === COOKIE_NAME) {
        const token = decodeURIComponent(part.slice(eqIdx + 1).trim());
        logout(token, req.ip).catch(() => {});
        break;
      }
    }
  }
  // clearCookie option'ları cookie'nin set edildiği cookieOptions() ile aynı
  // httpOnly/secure/sameSite/path değerlerini içermeli (maxAge hariç), yoksa
  // tarayıcı çerezi eşleştiremeyip silemez.
  const { httpOnly, secure, sameSite, path } = cookieOptions();
  res.clearCookie(COOKIE_NAME, { httpOnly, secure, sameSite, path });
  res.json({ ok: true });
});

// GET /auth/me
authRouter.get('/me', requireAuth, (req, res) => {
  const { id, username, displayName, role } = req.currentUser;
  res.json({ data: { id, username, displayName, role } });
});

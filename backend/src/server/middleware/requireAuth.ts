import type { Request, Response, NextFunction } from 'express';
import { validateSession, type AuthUser } from '../../services/auth.service.js';

declare global {
  namespace Express {
    interface Request {
      currentUser: AuthUser;
    }
  }
}

function extractSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    if (part.slice(0, eqIdx).trim() === 'session') {
      return decodeURIComponent(part.slice(eqIdx + 1).trim());
    }
  }
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractSessionToken(req.headers.cookie);
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
    return;
  }

  const user = await validateSession(token);
  if (!user) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Session expired or invalid.' } });
    return;
  }

  req.currentUser = user;
  next();
}

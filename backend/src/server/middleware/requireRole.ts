import type { Request, Response, NextFunction } from 'express';

import { can, type Capability, type Role } from '../../auth/permissions.js';

function forbidden(res: Response): void {
  res.status(403).json({
    error: { code: 'FORBIDDEN', message: 'Bu işlem için yetkiniz yok.' },
  });
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!roles.includes(req.currentUser.role)) {
      forbidden(res);
      return;
    }
    next();
  };
}

export function requireCan(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!can(req.currentUser.role, capability)) {
      forbidden(res);
      return;
    }
    next();
  };
}

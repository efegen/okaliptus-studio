import type { Response } from "express";

import { AppError, ValidationError } from "../../services/errors.js";

/**
 * Parse a URL param as a numeric/string entity id.
 * Throws a ValidationError for non-positive integers.
 */
export function parseId(param: string): string {
  const n = Number(param);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`Invalid id: "${param}".`);
  }
  return param;
}

/**
 * Uniform error → HTTP response mapping.
 *
 * AppError subclass → code + statusCode already set.
 * Unknown → 500 INTERNAL_SERVER_ERROR.
 */
export function sendError(res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  // Unexpected error — log and return 500
  console.error("[unhandled error]", err);
  res.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
  });
}

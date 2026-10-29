// Authentication: passwords are hashed with bcrypt (never stored in plaintext),
// and sessions are stateless JSON Web Tokens. requireAuth is Express middleware
// that rejects a request unless it carries a valid "Authorization: Bearer <jwt>".
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.QUORUM_JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '2h';
const SALT_ROUNDS = 10;

// Make the authenticated user id available on the request object, typed.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: number): string {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Verify a raw token string; returns the user id or null. Reused by the
// WebSocket layer, which authenticates on connect rather than per request.
export function userIdFromToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { uid: number };
    return payload.uid;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }
  const userId = userIdFromToken(token);
  if (userId === null) {
    res.status(401).json({ error: 'invalid or expired token' });
    return;
  }
  req.userId = userId;
  next();
}

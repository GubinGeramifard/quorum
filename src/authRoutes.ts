// Auth endpoints: register and login. Both validate input with Zod and return a
// JWT the client sends on later requests. Passwords are only ever stored hashed.
import { Router } from 'express';
import { z } from 'zod';
import type { DB } from './db';
import { hashPassword, verifyPassword, signToken } from './auth';

const credentials = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
});

export function authRoutes(db: DB): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'username (3-32) and password (8-128) required' });
      return;
    }
    const { username, password } = parsed.data;
    const hash = await hashPassword(password);
    try {
      const info = db
        .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
        .run(username, hash);
      res.status(201).json({ token: signToken(Number(info.lastInsertRowid)) });
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        res.status(409).json({ error: 'username already taken' });
        return;
      }
      res.status(500).json({ error: 'internal error' });
    }
  });

  router.post('/login', async (req, res) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    const { username, password } = parsed.data;
    const row = db
      .prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .get(username) as { id: number; password_hash: string } | undefined;
    // Verify even when the user is missing? Here we short-circuit for simplicity;
    // a production login would compare against a dummy hash to avoid timing leaks.
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    res.json({ token: signToken(row.id) });
  });

  return router;
}

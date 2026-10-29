// Assembles the Express app from its pieces. Takes the db and the real-time hub
// as arguments (dependency injection) so tests can supply an in-memory database.
import express, { type Express, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { DB } from './db';
import type { Hub } from './realtime';
import { authRoutes } from './authRoutes';
import { pollRoutes } from './polls';

export function createApp(db: DB, hub: Hub): Express {
  const app = express();
  app.use(express.json());

  // Rate limiting protects against abuse/brute force. Disabled under test so it
  // never interferes with a fast test suite.
  const testing = process.env.NODE_ENV === 'test';
  const passthrough: RequestHandler = (_req, _res, next) => next();
  const generalLimiter = testing ? passthrough : rateLimit({ windowMs: 60_000, max: 120 });
  const authLimiter = testing ? passthrough : rateLimit({ windowMs: 15 * 60_000, max: 20 });

  app.use(generalLimiter);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/auth', authLimiter, authRoutes(db));
  app.use('/polls', pollRoutes(db, hub));

  // Last-resort error handler (4-arg signature marks it as error middleware).
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(err);
      res.status(500).json({ error: 'internal error' });
    }
  );

  return app;
}

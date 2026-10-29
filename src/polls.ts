// Poll REST endpoints and the tally computation shared with the WebSocket layer.
import { Router } from 'express';
import { z } from 'zod';
import type { DB } from './db';
import { requireAuth } from './auth';
import type { Hub } from './realtime';

export interface Tally {
  poll: { id: number; question: string; closed: boolean };
  options: { id: number; text: string; votes: number }[];
  total: number;
}

// Current results for a poll, or null if it does not exist. A LEFT JOIN keeps
// options with zero votes in the result instead of dropping them.
export function computeTally(db: DB, pollId: number): Tally | null {
  const poll = db.prepare('SELECT id, question, closed FROM polls WHERE id = ?').get(pollId) as
    | { id: number; question: string; closed: number }
    | undefined;
  if (!poll) return null;

  const options = db
    .prepare(
      `SELECT o.id, o.text, COUNT(v.id) AS votes
       FROM options o LEFT JOIN votes v ON v.option_id = o.id
       WHERE o.poll_id = ?
       GROUP BY o.id ORDER BY o.id`
    )
    .all(pollId) as { id: number; text: string; votes: number }[];

  const total = options.reduce((sum, o) => sum + o.votes, 0);
  return { poll: { id: poll.id, question: poll.question, closed: !!poll.closed }, options, total };
}

const createPollSchema = z.object({
  question: z.string().min(1).max(280),
  options: z.array(z.string().min(1).max(120)).min(2).max(10),
});
const voteSchema = z.object({ optionId: z.number().int().positive() });

export function pollRoutes(db: DB, hub: Hub): Router {
  const router = Router();

  // Create a poll with its options, atomically, in a transaction.
  router.post('/', requireAuth, (req, res) => {
    const parsed = createPollSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'question and 2-10 options required' });
      return;
    }
    const { question, options } = parsed.data;
    const create = db.transaction((creatorId: number) => {
      const info = db
        .prepare('INSERT INTO polls (question, creator_id) VALUES (?, ?)')
        .run(question, creatorId);
      const pollId = Number(info.lastInsertRowid);
      const insertOption = db.prepare('INSERT INTO options (poll_id, text) VALUES (?, ?)');
      for (const text of options) insertOption.run(pollId, text);
      return pollId;
    });
    const pollId = create(req.userId!);
    res.status(201).json(computeTally(db, pollId));
  });

  // List all polls (public).
  router.get('/', (_req, res) => {
    const polls = db.prepare('SELECT id, question, closed FROM polls ORDER BY id DESC').all();
    res.json(polls);
  });

  // One poll with its live tally (public).
  router.get('/:id', (req, res) => {
    const tally = computeTally(db, Number(req.params.id));
    if (!tally) {
      res.status(404).json({ error: 'poll not found' });
      return;
    }
    res.json(tally);
  });

  // Cast a vote (auth). One vote per user is enforced by the DB UNIQUE
  // constraint, so even a race between two requests cannot double-count.
  router.post('/:id/vote', requireAuth, (req, res) => {
    const pollId = Number(req.params.id);
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'optionId (positive integer) required' });
      return;
    }
    const poll = db.prepare('SELECT closed FROM polls WHERE id = ?').get(pollId) as
      | { closed: number }
      | undefined;
    if (!poll) {
      res.status(404).json({ error: 'poll not found' });
      return;
    }
    if (poll.closed) {
      res.status(409).json({ error: 'poll is closed' });
      return;
    }
    const option = db
      .prepare('SELECT id FROM options WHERE id = ? AND poll_id = ?')
      .get(parsed.data.optionId, pollId);
    if (!option) {
      res.status(400).json({ error: 'option does not belong to this poll' });
      return;
    }
    try {
      db.prepare('INSERT INTO votes (poll_id, option_id, user_id) VALUES (?, ?, ?)').run(
        pollId,
        parsed.data.optionId,
        req.userId!
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        res.status(409).json({ error: 'you have already voted in this poll' });
        return;
      }
      res.status(500).json({ error: 'internal error' });
      return;
    }
    const tally = computeTally(db, pollId)!;
    hub.broadcast(pollId); // push the new live results to every subscriber
    res.status(201).json(tally);
  });

  // Close a poll (auth, creator only).
  router.post('/:id/close', requireAuth, (req, res) => {
    const pollId = Number(req.params.id);
    const poll = db.prepare('SELECT creator_id FROM polls WHERE id = ?').get(pollId) as
      | { creator_id: number }
      | undefined;
    if (!poll) {
      res.status(404).json({ error: 'poll not found' });
      return;
    }
    if (poll.creator_id !== req.userId) {
      res.status(403).json({ error: 'only the creator can close this poll' });
      return;
    }
    db.prepare('UPDATE polls SET closed = 1 WHERE id = ?').run(pollId);
    hub.broadcast(pollId);
    res.json(computeTally(db, pollId));
  });

  return router;
}

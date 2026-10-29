import request from 'supertest';
import type { Express } from 'express';
import { createDb } from '../src/db';
import { createHub } from '../src/realtime';
import { createApp } from '../src/app';

// Each app gets its own in-memory database, so tests are fully isolated.
function makeApp(): Express {
  const db = createDb(':memory:');
  return createApp(db, createHub(db));
}

async function token(app: Express, username: string): Promise<string> {
  const res = await request(app).post('/auth/register').send({ username, password: 'password123' });
  return res.body.token as string;
}

describe('health', () => {
  it('returns ok', async () => {
    const res = await request(makeApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('auth', () => {
  it('registers then logs in', async () => {
    const app = makeApp();
    const reg = await request(app).post('/auth/register').send({ username: 'alice', password: 'password123' });
    expect(reg.status).toBe(201);
    expect(typeof reg.body.token).toBe('string');

    const login = await request(app).post('/auth/login').send({ username: 'alice', password: 'password123' });
    expect(login.status).toBe(200);
    expect(typeof login.body.token).toBe('string');
  });

  it('rejects a duplicate username', async () => {
    const app = makeApp();
    await request(app).post('/auth/register').send({ username: 'bob', password: 'password123' });
    const dup = await request(app).post('/auth/register').send({ username: 'bob', password: 'password123' });
    expect(dup.status).toBe(409);
  });

  it('rejects a wrong password', async () => {
    const app = makeApp();
    await request(app).post('/auth/register').send({ username: 'carol', password: 'password123' });
    const bad = await request(app).post('/auth/login').send({ username: 'carol', password: 'wrongpass1' });
    expect(bad.status).toBe(401);
  });

  it('requires a token to create a poll', async () => {
    const res = await request(makeApp()).post('/polls').send({ question: 'Q', options: ['a', 'b'] });
    expect(res.status).toBe(401);
  });
});

describe('polls', () => {
  it('creates a poll, votes, and tallies', async () => {
    const app = makeApp();
    const t = await token(app, 'dave');
    const create = await request(app)
      .post('/polls')
      .set('authorization', `Bearer ${t}`)
      .send({ question: 'Best language?', options: ['Go', 'TypeScript', 'Rust'] });
    expect(create.status).toBe(201);
    const pollId = create.body.poll.id as number;
    const optionId = create.body.options[1].id as number; // TypeScript

    const vote = await request(app)
      .post(`/polls/${pollId}/vote`)
      .set('authorization', `Bearer ${t}`)
      .send({ optionId });
    expect(vote.status).toBe(201);
    expect(vote.body.total).toBe(1);
    expect(vote.body.options.find((o: { id: number }) => o.id === optionId).votes).toBe(1);
  });

  it('prevents a user from voting twice (DB-enforced)', async () => {
    const app = makeApp();
    const t = await token(app, 'erin');
    const create = await request(app)
      .post('/polls')
      .set('authorization', `Bearer ${t}`)
      .send({ question: 'Pizza?', options: ['Yes', 'No'] });
    const pollId = create.body.poll.id as number;
    const optionId = create.body.options[0].id as number;

    const first = await request(app).post(`/polls/${pollId}/vote`).set('authorization', `Bearer ${t}`).send({ optionId });
    expect(first.status).toBe(201);
    const second = await request(app).post(`/polls/${pollId}/vote`).set('authorization', `Bearer ${t}`).send({ optionId });
    expect(second.status).toBe(409);
  });

  it('lets only the creator close a poll, and blocks voting after', async () => {
    const app = makeApp();
    const creator = await token(app, 'frank');
    const other = await token(app, 'grace');
    const create = await request(app)
      .post('/polls')
      .set('authorization', `Bearer ${creator}`)
      .send({ question: 'Open?', options: ['a', 'b'] });
    const pollId = create.body.poll.id as number;
    const optionId = create.body.options[0].id as number;

    const forbidden = await request(app).post(`/polls/${pollId}/close`).set('authorization', `Bearer ${other}`);
    expect(forbidden.status).toBe(403);

    const closed = await request(app).post(`/polls/${pollId}/close`).set('authorization', `Bearer ${creator}`);
    expect(closed.status).toBe(200);
    expect(closed.body.poll.closed).toBe(true);

    const lateVote = await request(app).post(`/polls/${pollId}/vote`).set('authorization', `Bearer ${creator}`).send({ optionId });
    expect(lateVote.status).toBe(409);
  });
});
